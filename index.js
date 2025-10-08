import 'dotenv/config';
import express from 'express';
import { Telegraf } from 'telegraf';
import OpenAI from 'openai';
import Database from 'better-sqlite3';

// =============== INIT =================
const app = express();
app.use(express.json()); // Telegram присылает JSON-тело

const bot = new Telegraf(process.env.BOT_TOKEN);
const ai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// простая «память» языка
const userLanguage = new Map();

// анти-флуд + одиночная обработка
const lastHit = new Map();     // userId -> timestamp
const inProgress = new Set();  // userId
const COOLDOWN_MS = 10 * 1000; // 10 секунд

function cooldownPassed(userId) {
    const now = Date.now();
    const prev = lastHit.get(userId) || 0;
    if (now - prev < COOLDOWN_MS) return false;
    lastHit.set(userId, now);
    return true;
}

// параллелизм + таймауты
let running = 0;
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY || 5);
async function withConcurrency(fn) {
    if (running >= MAX_CONCURRENCY) throw new Error('Overloaded');
    running++;
    try { return await fn(); } finally { running--; }
}
async function withTimeout(promise, ms = 25000) {
    let t;
    const timer = new Promise((_, rej) => (t = setTimeout(() => rej(new Error('Timeout')), ms)));
    try { return await Promise.race([promise, timer]); }
    finally { clearTimeout(t); }
}
async function askVisionSafe(req) {
    try   { return await withTimeout(ai.responses.create(req), 25000); }
    catch { return await withTimeout(ai.responses.create(req), 25000); }
}

// =============== DB: дневной лимит =================
const db = new Database(process.env.DATABASE_URL || './data.db');
db.exec(`
CREATE TABLE IF NOT EXISTS usage_log (
  id     INTEGER PRIMARY KEY,
  tg_id  TEXT NOT NULL,
  day    TEXT NOT NULL,   -- YYYY-MM-DD (UTC)
  count  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(tg_id, day)
);
`);
function todayUTC() {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth()+1).padStart(2,'0');
    const dd= String(d.getUTCDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
}
const qGet = db.prepare('SELECT count FROM usage_log WHERE tg_id=? AND day=?');
const qUpsert = db.prepare(`
  INSERT INTO usage_log (tg_id, day, count) VALUES(?,?,1)
  ON CONFLICT(tg_id, day) DO UPDATE SET count = count + 1
`);
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 60); // лимит по умолчанию 60
function usageForToday(tgId) {
    const row = qGet.get(String(tgId), todayUTC());
    return row?.count || 0;
}
function canUseToday(tgId) {
    const used = usageForToday(tgId);
    return { ok: used < DAILY_LIMIT, used, limit: DAILY_LIMIT, left: Math.max(DAILY_LIMIT - used, 0) };
}
function incUsage(tgId) {
    qUpsert.run(String(tgId), todayUTC());
}

// =============== GREETING & LANGUAGE =================
bot.start(async (ctx) => {
    await ctx.reply(
        '👋 Привет! / Hello!\n\n' +
        'Я — твой AI помощник в обучении. / I’m your AI learning assistant.\n\n' +
        '✨ Помогу тебе разбираться в новом и неизведанном. / I’ll help you understand the unknown and learn new things.\n\n' +
        '📸 Пришли фото или скриншот вопроса, теста или темы — и я помогу тебе разобраться. / Send me a photo or screenshot of a question, test, or topic — and I’ll help you figure it out.\n\n' +
        '🌍 Choose your language / Выбери язык:\n\n' +
        '🇬🇧 English\n🇷🇺 Русский',
        { reply_markup: { keyboard: [['🇬🇧 English', '🇷🇺 Русский']], one_time_keyboard: true, resize_keyboard: true } }
    );
});
bot.hears(['🇷🇺 Русский','Русский'], async (ctx) => {
    userLanguage.set(ctx.from.id, 'ru');
    const used = usageForToday(ctx.from.id);
    await ctx.reply(
        '✨ Отлично! Я помогу тебе разбираться в новом и неизведанном.\n' +
        '📸 Пришли фото или скриншот вопроса, теста или темы — и я помогу понять правильный ответ.\n' +
        `📊 Сегодня осталось: ${Math.max(DAILY_LIMIT - used, 0)} из ${DAILY_LIMIT}.`
    );
});
bot.hears(['🇬🇧 English','English'], async (ctx) => {
    userLanguage.set(ctx.from.id, 'en');
    const used = usageForToday(ctx.from.id);
    await ctx.reply(
        '✨ Great! I’ll help you understand the unknown and learn new things.\n' +
        '📸 Send a photo or screenshot of any question, test, or topic — I’ll help you figure it out.\n' +
        `📊 Remaining today: ${Math.max(DAILY_LIMIT - used, 0)} of ${DAILY_LIMIT}.`
    );
});

// текст без фото — мягкая подсказка
bot.on('text', async (ctx) => {
    const lang = userLanguage.get(ctx.from.id) || 'en';
    const used = usageForToday(ctx.from.id);
    if (lang === 'ru') {
        return ctx.reply(`🖼 Пришли фото/скриншот с вопросом и вариантами.\n📊 Сегодня осталось: ${Math.max(DAILY_LIMIT - used, 0)} из ${DAILY_LIMIT}.`);
    } else {
        return ctx.reply(`🖼 Please send a photo/screenshot with a question and options.\n📊 Remaining today: ${Math.max(DAILY_LIMIT - used, 0)} of ${DAILY_LIMIT}.`);
    }
});

// =============== VISION: анализ фото =================
async function analyzeQuestionImage(imageUrl, lang) {
    const instruction =
        lang === 'ru'
            ? `Ты — преподаватель. На фото вопрос с вариантами (A, B, C, D).
Определи правильный ответ и кратко объясни почему.
Формат:
✅ Правильный ответ: <буква> — <текст варианта>
💡 Объяснение: <1–2 предложения>`
            : `You are a teacher. The image shows a multiple-choice question (A, B, C, D).
Find the correct answer and briefly explain why.
Format:
✅ Correct answer: <letter> — <option text>
💡 Explanation: <1–2 short sentences>`;

    const res = await askVisionSafe({
        model: 'gpt-4.1-mini',
        temperature: 0.2,
        input: [
            { role: 'system', content: instruction },
            { role: 'user', content: [{ type: 'input_image', image_url: imageUrl }] },
        ],
    });

    const out = (res.output_text || '')
        .split('\n')
        .filter(line => line.includes('✅') || line.includes('💡'))
        .join('\n')
        .trim();

    return out || (lang === 'ru'
        ? '⚠️ Не удалось распознать вопрос. Пришли фото четче.'
        : '⚠️ Could not recognize the question. Please send a clearer photo.');
}

bot.on('photo', async (ctx) => {
    const uid  = ctx.from.id;
    const lang = userLanguage.get(uid) || 'en';

    // анти-флуд
    if (!cooldownPassed(uid)) {
        return ctx.reply(lang === 'ru'
            ? '⏳ Подожди 10 секунд и пришли снова.'
            : '⏳ Please wait 10 seconds and try again.');
    }

    // один запрос за раз
    if (inProgress.has(uid)) {
        return ctx.reply(lang === 'ru'
            ? '🛠 Уже разбираю предыдущее фото. Дождись ответа.'
            : '🛠 I’m already analyzing your previous photo. Please wait.');
    }

    // дневной лимит
    const { ok, used, limit, left } = canUseToday(uid);
    if (!ok) {
        return ctx.reply(lang === 'ru'
            ? `🚦 Достигнут дневной лимит ${limit} изображений. Попробуй завтра.`
            : `🚦 Daily limit of ${limit} images reached. Try again tomorrow.`);
    }

    inProgress.add(uid);
    try {
        await ctx.reply(lang === 'ru'
            ? '📷 Фото получено. Анализирую…'
            : '📷 Photo received. Analyzing…');

        const photos  = ctx.message.photo;
        const fileId  = photos[photos.length - 1].file_id;
        const file    = await ctx.telegram.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

        const result = await withConcurrency(() => analyzeQuestionImage(fileUrl, lang));

        // считаем использование и показываем остаток
        incUsage(uid);
        const leftAfter = Math.max(limit - (used + 1), 0);

        const suffix = lang === 'ru'
            ? `\n\n📊 Сегодня осталось: ${leftAfter} из ${limit}.`
            : `\n\n📊 Remaining today: ${leftAfter} of ${limit}.`;

        await ctx.reply(result + suffix);

    } catch (e) {
        if (e.message === 'Overloaded') {
            return ctx.reply(lang === 'ru'
                ? '🧯 Высокая нагрузка, попробуй через минуту.'
                : '🧯 High load, please try in a minute.');
        }
        console.error('Photo handler error:', e);
        return ctx.reply(lang === 'ru'
            ? '⚠️ Ошибка при анализе. Попробуй ещё раз позже.'
            : '⚠️ Error during analysis. Please try again later.');
    } finally {
        inProgress.delete(uid);
    }
});

// =============== WEBHOOK (секрет + без токена в пути) ===============
const BASE_URL     = process.env.BASE_URL;               // например: https://seaman-bot.onrender.com
const WH_SECRET    = process.env.WH_SECRET;              // любая длинная строка в Environment
const WEBHOOK_PATH = '/tg/webhook';

if (BASE_URL) {
    const webhookUrl = `${BASE_URL.replace(/\/+$/, '')}${WEBHOOK_PATH}`;

    app.post(WEBHOOK_PATH, (req, res) => {
        const headerSecret = req.get('x-telegram-bot-api-secret-token');
        if (!WH_SECRET || headerSecret === WH_SECRET) {
            bot.handleUpdate(req.body);
            return res.sendStatus(200);
        }
        return res.sendStatus(401);
    });

    bot.telegram.setWebhook(webhookUrl, { secret_token: WH_SECRET })
        .then(() => console.log('✅ Webhook set to', webhookUrl))
        .catch(err => console.error('❌ Webhook set error:', err));
} else {
    // локально без вебхука
    bot.launch().then(() => console.log('✅ Bot polling (local mode)'));
}

// =============== HTTP health =================
app.get('/', (_, res) => res.send('Seaman Assistant OK'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('HTTP on', PORT));

// корректное завершение
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
