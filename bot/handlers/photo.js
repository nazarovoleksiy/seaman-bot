import { getLang, canUseToday, incUsage } from '../../db/database.js';
import { askVisionSafe, withConcurrency } from '../../utils/ai.js';

const lastHit = new Map();          // антифлуд
const inProgress = new Set();
const COOLDOWN_MS = 10_000;

function cooldownPassed(id){
    const now = Date.now(), prev = lastHit.get(id) || 0;
    if (now - prev < COOLDOWN_MS) return false;
    lastHit.set(id, now); return true;
}

async function analyzeQuestionImage(imageUrl, lang){
    const instruction = lang === 'ru'
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
        .filter(l => l.includes('✅') || l.includes('💡'))
        .join('\n').trim();

    return out || (lang === 'ru'
        ? '⚠️ Не удалось распознать вопрос. Пришли фото четче.'
        : '⚠️ Could not recognize the question. Please send a clearer photo.');
}

export function registerPhotoHandler(bot){
    bot.on('photo', async (ctx) => {
        const uid = ctx.from.id;
        const lang = getLang(uid);

        if (!cooldownPassed(uid)) {
            return ctx.reply(lang === 'ru' ? '⏳ Подожди 10 секунд и пришли снова.' : '⏳ Please wait 10 seconds and try again.');
        }
        if (inProgress.has(uid)) {
            return ctx.reply(lang === 'ru' ? '🛠 Уже разбираю предыдущее фото. Дождись ответа.' : '🛠 I’m already analyzing your previous photo. Please wait.');
        }

        const { ok, used, limit } = canUseToday(uid);
        if (!ok) {
            return ctx.reply(lang === 'ru'
                ? `🚦 Достигнут дневной лимит ${limit} изображений. Попробуй завтра.`
                : `🚦 Daily limit of ${limit} images reached. Try again tomorrow.`);
        }

        inProgress.add(uid);
        try {
            await ctx.reply(lang === 'ru' ? '📷 Фото получено. Анализирую…' : '📷 Photo received. Analyzing…');

            const photos = ctx.message.photo;
            const fileId = photos[photos.length - 1].file_id;
            const file = await ctx.telegram.getFile(fileId);
            const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

            const result = await withConcurrency(() => analyzeQuestionImage(fileUrl, lang));

            incUsage(uid);
            const leftAfter = Math.max(limit - (used + 1), 0);
            const suffix = lang === 'ru'
                ? `\n\n📊 Сегодня осталось: ${leftAfter} из ${limit}.`
                : `\n\n📊 Remaining today: ${leftAfter} of ${limit}.`;

            await ctx.reply(result + suffix);
        } catch (e) {
            if (e.message === 'Overloaded') {
                return ctx.reply(lang === 'ru' ? '🧯 Высокая нагрузка, попробуй через минуту.' : '🧯 High load, please try in a minute.');
            }
            console.error('Photo handler error:', e);
            return ctx.reply(lang === 'ru' ? '⚠️ Ошибка при анализе. Попробуй позже.' : '⚠️ Error during analysis. Please try later.');
        } finally {
            inProgress.delete(uid);
        }
    });
}
