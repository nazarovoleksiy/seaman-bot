import { canUseLifetime, getLang, incUsage, hasTimePass, creditsLeft, consumeOneCredit } from '../../db/database.js';
import { askVisionSafe, withConcurrency } from '../../utils/ai.js';

const lastHit = new Map();
const inProgress = new Set();
const COOLDOWN_MS = 10_000;

function cooldownPassed(id){
    const now = Date.now(), prev = lastHit.get(id) || 0;
    if (now - prev < COOLDOWN_MS) return false;
    lastHit.set(id, now); return true;
}

async function analyzeQuestionImage(imageUrl, lang){
    const instruction =
        lang === 'ru' ? `Ты — преподаватель. На фото вопрос с вариантами (A, B, C, D).
Определи правильный ответ и кратко объясни почему.
Формат:
✅ Правильный ответ: <буква> — <текст варианта>
💡 Объяснение: <1–2 предложения>` :
            lang === 'uk' ? `Ти — викладач. На фото тестове питання з варіантами (A, B, C, D).
Визнач правильну відповідь і коротко поясни чому.
Формат:
✅ Правильна відповідь: <літера> — <текст варіанту>
💡 Пояснення: <1–2 короткі речення>` :
                `You are a teacher. The image shows a multiple-choice question (A, B, C, D).
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

    return out || (
        lang === 'ru' ? '⚠️ Не удалось распознать вопрос. Пришли фото четче.' :
            lang === 'uk' ? '⚠️ Не вдалося розпізнати питання. Надішли чіткіше фото.' :
                '⚠️ Could not recognize the question. Please send a clearer photo.');
}

export function registerPhotoHandler(bot){
    bot.on('photo', async (ctx) => {
        const uid  = ctx.from.id;
        const lang = getLang(uid);

        if (!cooldownPassed(uid)) {
            return ctx.reply(lang==='ru' ? '⏳ Подожди 10 секунд и пришли снова.' :
                lang==='uk' ? '⏳ Зачекай 10 секунд і спробуй ще раз.' :
                    '⏳ Please wait 10 seconds and try again.');
        }
        if (inProgress.has(uid)) {
            return ctx.reply(lang==='ru' ? '🛠 Уже разбираю предыдущее фото. Дождись ответа.' :
                lang==='uk' ? '🛠 Уже розбираю попереднє фото. Зачекай відповіді.' :
                    '🛠 I’m already analyzing your previous photo. Please wait.');
        }

        // платные права
        const hasPass = hasTimePass(uid);
        const credits = creditsLeft(uid);

        // бесплатный лимит, если нет прав
        if (!hasPass && credits <= 0) {
            const { ok, used, limit } = canUseLifetime(uid);
            if (!ok) {
                const msg = lang==='ru'
                    ? `🙏 Спасибо! Вы использовали все ${limit} бесплатных запросов.\nЧтобы продолжить: /buy`
                    : lang==='uk'
                        ? `🙏 Дякуємо! Ви використали всі ${limit} безкоштовних запитів.\nЩоб продовжити: /buy`
                        : `🙏 Thank you! You used all ${limit} free requests.\nTo continue: /buy`;
                return ctx.reply(msg, {
                    reply_markup: { inline_keyboard: [[{ text: lang==='ru'?'🔓 Купить доступ':'🔓 Get access', callback_data:'buy:day_1' }]] }
                });
            }
        }

        inProgress.add(uid);
        try {
            await ctx.reply(lang==='ru' ? '📷 Фото получено. Анализирую…' :
                lang==='uk' ? '📷 Фото отримано. Аналізую…' :
                    '📷 Photo received. Analyzing…');

            const photos  = ctx.message.photo;
            const fileId  = photos[photos.length - 1].file_id;
            const file    = await ctx.telegram.getFile(fileId);
            const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

            const result = await withConcurrency(() => analyzeQuestionImage(fileUrl, lang));

            // учёт
            if (!hasPass && credits > 0) consumeOneCredit(uid); // списываем кредит
            incUsage(uid); // для аналитики lifetime

            await ctx.reply(result, {
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: lang === 'ru' ? 'Оставить отзыв'
                                : lang === 'uk' ? 'Залишити відгук'
                                    : 'Leave feedback',
                            callback_data: 'fb:start'
                        },
                        {
                            text: lang === 'ru' ? '❓ Помощь'
                                : lang === 'uk' ? '❓ Допомога'
                                    : '❓ Help',
                            callback_data: 'help:open'
                        }
                    ]]
                }
            });
        } catch (e) {
            console.error('Photo handler error:', e);
            return ctx.reply(lang==='ru' ? '⚠️ Ошибка при анализе. Попробуй позже.' :
                lang==='uk' ? '⚠️ Помилка під час аналізу. Спробуй пізніше.' :
                    '⚠️ Error during analysis. Please try later.');
        } finally {
            inProgress.delete(uid);
        }
    });
}
