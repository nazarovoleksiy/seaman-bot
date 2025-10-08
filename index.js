import 'dotenv/config';
import { Telegraf } from 'telegraf';
import OpenAI from 'openai';
import express from 'express';

const app = express();

app.use(express.json());
app.get('/', (_, res) => res.send('Seaman Assistant OK'));

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log('HTTP on', PORT));

const bot = new Telegraf(process.env.BOT_TOKEN);
const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Простая память: кто на каком языке работает
const userLanguage = new Map();

// ========== ВЫБОР ЯЗЫКА ==========
bot.start(async (ctx) => {
    await ctx.reply(
        '🌍 Choose your language / Выбери язык:\n\n🇬🇧 English\n🇷🇺 Русский',
        {
            reply_markup: {
                keyboard: [['🇬🇧 English', '🇷🇺 Русский']],
                one_time_keyboard: true,
                resize_keyboard: true,
            },
        }
    );
});

bot.hears(['🇬🇧 English', 'English'], async (ctx) => {
    userLanguage.set(ctx.from.id, 'en');
    await ctx.reply('✅ Language set to English. Send a test photo with question.');
});

bot.hears(['🇷🇺 Русский', 'Русский'], async (ctx) => {
    userLanguage.set(ctx.from.id, 'ru');
    await ctx.reply('✅ Язык установлен: русский. Пришли фото вопроса.');
});

// ========== ОБРАБОТКА ФОТО ==========
bot.on('photo', async (ctx) => {
    const lang = userLanguage.get(ctx.from.id) || 'en';
    try {
        await ctx.reply(lang === 'ru'
            ? '📷 Фото получено. Проверяю тему...'
            : '📷 Photo received. Checking topic...');

        const photos = ctx.message.photo;
        const fileId = photos[photos.length - 1].file_id;
        const file = await ctx.telegram.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

        // 1) Классификация темы
       /* const { is_maritime, confidence } = await classifyQuestionImage(fileUrl, lang);

        if (!is_maritime || confidence < 60) {
            return ctx.reply(
                lang === 'ru'
                    ? '🛑 Извини, это не похоже на морской тест. Пришли вопрос по судовым системам, безопасности, STCW, навигации, MARPOL и т.п.'
                    : '🛑 Sorry, this doesn’t look like a maritime test. Please send a question about ship systems, safety, STCW, navigation, MARPOL, etc.'
            );
        } */



        // 2) Разбираем правильный ответ (коротко, одна строка)


        const analysis = await analyzeQuestionImage(fileUrl, lang);
        await ctx.reply(analysis);
    } catch (e) {
        console.error('Photo error:', e);
        await ctx.reply(
            lang === 'ru'
                ? '⚠️ Ошибка при обработке фото. Пришли чёткое изображение с вариантами A/B/C/D.'
                : '⚠️ Error processing the photo. Send a clear image with A/B/C/D options.'
        );
    }
});

// ========== АНАЛИЗ ВОПРОСА ==========
async function classifyQuestionImage(imageUrl, lang = 'en') {
    const instruction =
        lang === 'ru'
            ? `Ты — классификатор. По изображению с вопросом определи, относится ли вопрос к морской тематике:
- судовые системы, механизмы, машинное отделение, безопасность, навигация, морское право/СТКВ (STCW), аварийные процедуры, снабжение, бункеровка, экология/ MARPOL.
Ответь строго JSON без лишнего текста:
{"is_maritime": true|false, "confidence": 0..100}`
            : `You are a classifier. From the question image decide if it is MARITIME-related:
- ship systems, machinery, engine room, safety, navigation, maritime law/STCW, emergency procedures, provisioning, bunkering, ecology/MARPOL.
Reply STRICTLY as JSON, no extra text:
{"is_maritime": true|false, "confidence": 0..100}`;

    const res = await ai.responses.create({
        model: 'gpt-4.1-mini',
        temperature: 0,
        input: [
            { role: 'system', content: instruction },
            { role: 'user', content: [{ type: 'input_image', image_url: imageUrl }] }
        ]
    });

    // пытаемся распарсить JSON даже если модель добавила лишнее
    const raw = (res.output_text || '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    try {
        const json = JSON.parse(match ? match[0] : '{}');
        return {
            is_maritime: !!json.is_maritime,
            confidence: Number(json.confidence) || 0
        };
    } catch {
        return { is_maritime: false, confidence: 0 };
    }
}


async function analyzeQuestionImage(imageUrl, lang) {
    const instruction =
        lang === 'ru'
            ? `Ты — преподаватель. На фото изображён вопрос с вариантами ответов (A, B, C, D).
Определи правильный ответ и кратко объясни почему.
Формат:
✅ Правильный ответ: <буква> — <текст варианта>
💡 Объяснение: <1–2 предложения>`
            : `You are a teacher. The image shows a multiple-choice question (A, B, C, D).
Find the correct answer and briefly explain why.
Format:
✅ Correct answer: <letter> — <option text>
💡 Explanation: <1–2 short sentences>`;

    try {
        const res = await ai.responses.create({
            model: 'gpt-4.1-mini',
            temperature: 0.2,
            input: [
                { role: 'system', content: instruction },
                { role: 'user', content: [{ type: 'input_image', image_url: imageUrl }] },
            ],
        });

        // Извлекаем только нужные строки (ответ + объяснение)
        const out = (res.output_text || '')
            .split('\n')
            .filter(line => line.includes('✅') || line.includes('💡'))
            .join('\n')
            .trim();

        return out || (lang === 'ru'
            ? '⚠️ Не удалось распознать вопрос. Пришли фото четче.'
            : '⚠️ Could not recognize the question. Please send a clearer photo.');
    } catch (e) {
        console.error('Vision error:', e);
        return lang === 'ru'
            ? '⚠️ Ошибка при анализе фото. Попробуй позже.'
            : '⚠️ Error analyzing photo. Try again later.';
    }
}

// ========== ЗАПУСК ==========
bot.on('text', async (ctx) => {
    const lang = userLanguage.get(ctx.from.id) || 'en';

    if (lang === 'ru') {
        await ctx.reply('🖼 Я принимаю только фото с вопросами. Пришли изображение с вариантами ответов.');
    } else {
        await ctx.reply('🖼 I only accept photos with questions. Please send an image containing the test.');
    }
});

// ---- Webhook (без токена в пути) ----
const BASE_URL = process.env.BASE_URL; // например: https://seaman-bot.onrender.com
const WH_SECRET = process.env.WH_SECRET; // задай в Render любой длинный рандомный ключ
const WEBHOOK_PATH = '/tg/webhook';     // БЕЗ токена и двоеточий!

if (BASE_URL) {
    const url = `${BASE_URL.replace(/\/+$/, '')}${WEBHOOK_PATH}`;

    // 1) endpoint для Telegram
    app.post(WEBHOOK_PATH, (req, res) => {
        // Проверяем секрет (Telegram пришлёт его в заголовке)
        const headerSecret = req.get('x-telegram-bot-api-secret-token');
        if (!WH_SECRET || headerSecret === WH_SECRET) {
            bot.handleUpdate(req.body);
            return res.sendStatus(200);
        }
        return res.sendStatus(401);
    });

    // 2) Регистрируем вебхук c секретом
    bot.telegram.setWebhook(url, { secret_token: WH_SECRET })
        .then(() => console.log('✅ Webhook set to', url))
        .catch(err => console.error('❌ Webhook set error:', err));
} else {
    // локальная разработка
    bot.launch().then(() => console.log('✅ Bot polling (local mode)'));
}

console.log('⚙️ HTTP server listening...');
console.log('✅ Бот запущен. Работает только с фото-тестами и выбором языка.');
