// bot/handlers/photo.js
import {
    getLang,
    FREE_TOTAL_LIMIT,
    totalUsage,
    incUsage,
    myCreditsLeft,
    hasTimePass,
    myTimePassUntil,
    consumeOneCredit,
} from '../../db/database.js';
import { askVisionSafe, withConcurrency } from '../../utils/ai.js';

// ---------- антифлуд / одиночная обработка ----------
const lastHit = new Map();    // userId -> timestamp
const inProgress = new Set(); // userIds
const COOLDOWN_MS = 10_000;

function cooldownPassed(id) {
    const now = Date.now(), prev = lastHit.get(id) || 0;
    if (now - prev < COOLDOWN_MS) return false;
    lastHit.set(id, now);
    return true;
}

// ---------- форматирование оставшегося времени ----------
function leftMsFromSqlite(utcSql) {
    if (!utcSql) return 0;
    const t = new Date(utcSql.replace(' ', 'T') + 'Z').getTime();
    return Math.max(t - Date.now(), 0);
}
function formatHM(ms, lang) {
    if (ms <= 0) return lang==='ru' ? 'нет' : lang==='uk' ? 'немає' : 'none';
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (lang==='ru') {
        const hL = h===1?'час':(h>=2&&h<=4?'часа':'часов');
        const mL = m===1?'минута':(m>=2&&m<=4?'минуты':'минут');
        return h>0 && m>0 ? `${h} ${hL} ${m} ${mL}` : h>0 ? `${h} ${hL}` : `${m} ${mL}`;
    } else if (lang==='uk') {
        return h>0 && m>0 ? `${h} год ${m} хв` : h>0 ? `${h} год` : `${m} хв`;
    } else {
        const hL = h===1?'hour':'hours';
        const mL = m===1?'min':'mins';
        return h>0 && m>0 ? `${h} ${hL} ${m} ${mL}` : h>0 ? `${h} ${hL}` : `${m} ${mL}`;
    }
}

// ---------- визуальный анализ ----------
async function analyzeQuestionImage(imageUrl, lang) {
    const instruction =
        lang === 'ru'
            ? `Ты — преподаватель. На фото вопрос с вариантами (A, B, C, D).
Определи правильный ответ и кратко объясни почему.
Формат:
✅ Правильный ответ: <буква> — <текст варианта>
💡 Объяснение: <1–2 предложения>`
            : lang === 'uk'
                ? `Ти — викладач. На фото тестове питання з варіантами (A, B, C, D).
Визнач правильну відповідь і коротко поясни чому.
Формат:
✅ Правильна відповідь: <літера> — <текст варіанту>
💡 Пояснення: <1–2 короткі речення>`
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
            { role: 'user',   content: [{ type: 'input_image', image_url: imageUrl }] },
        ],
    });

    const out = (res.output_text || '')
        .split('\n')
        .filter(l => l.includes('✅') || l.includes('💡'))
        .join('\n')
        .trim();

    return out || (lang==='ru'
        ? '⚠️ Не удалось распознать вопрос. Пришли фото четче.'
        : lang==='uk'
            ? '⚠️ Не вдалося розпізнати питання. Надішли чіткіше фото.'
            : '⚠️ Could not recognize the question. Please send a clearer photo.');
}

// ---------- обработчик фото ----------
export function registerPhotoHandler(bot) {
    bot.on('photo', async (ctx) => {
        const uid  = ctx.from.id;
        const lang = getLang(uid);

        // антифлуд
        if (!cooldownPassed(uid)) {
            return ctx.reply(
                lang==='ru' ? '⏳ Подожди 10 секунд и пришли снова.'
                    : lang==='uk' ? '⏳ Зачекай 10 секунд і спробуй ще раз.'
                        : '⏳ Please wait 10 seconds and try again.'
            );
        }
        if (inProgress.has(uid)) {
            return ctx.reply(
                lang==='ru' ? '🛠 Уже разбираю предыдущее фото. Дождись ответа.'
                    : lang==='uk' ? '🛠 Уже розбираю попереднє фото. Зачекай відповіді.'
                        : '🛠 I’m already analyzing your previous photo. Please wait.'
            );
        }

        // доступ до запуска модели (экономим токены)
        const hasPass    = hasTimePass(uid);
        const used       = totalUsage(uid);
        const credits    = myCreditsLeft(uid);
        const freeLeft   = Math.max(FREE_TOTAL_LIMIT - used, 0);

        if (!hasPass && freeLeft <= 0 && credits <= 0) {
            const msg = lang==='ru'
                ? '🚦 Доступ закончился: бесплатные попытки исчерпаны и кредитов нет. Купи доступ: /buy'
                : lang==='uk'
                    ? '🚦 Доступ закінчився: безкоштовні спроби вичерпані і кредитів немає. Купи доступ: /buy'
                    : '🚦 Access ended: no free attempts and no credits left. Buy access: /buy';
            return ctx.reply(msg);
        }

        inProgress.add(uid);
        try {
            await ctx.reply(
                lang==='ru' ? '📷 Фото получено. Анализирую…'
                    : lang==='uk' ? '📷 Фото отримано. Аналізую…'
                        : '📷 Photo received. Analyzing…'
            );

            // получить fileUrl
            const photos  = ctx.message.photo;
            const fileId  = photos[photos.length - 1].file_id;
            const file    = await ctx.telegram.getFile(fileId);
            const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

            // анализ (с ограничением параллелизма)
            const result = await withConcurrency(() => analyzeQuestionImage(fileUrl, lang));

            // ====== УЧЁТ ДОСТУПА ПО ПРИОРИТЕТУ ======
            const creditsBefore = credits;   // уже посчитали выше
            const usedBefore    = used;

            let deducted = 'none'; // 'pass' | 'free' | 'credit' | 'none'
            if (hasPass) {
                deducted = 'pass'; // ничего не списываем
            } else if (usedBefore < FREE_TOTAL_LIMIT) {
                incUsage(uid);     // списали бесплатный
                deducted = 'free';
            } else if (creditsBefore > 0) {
                consumeOneCredit(uid); // списали кредит
                deducted = 'credit';
            } else {
                // теоретически сюда не дойдём из-за ранней проверки, но на всякий случай
                const msg = lang==='ru'
                    ? '🚦 Доступ закончился. Купи доступ: /buy'
                    : lang==='uk'
                        ? '🚦 Доступ закінчився. Купи доступ: /buy'
                        : '🚦 Access ended. Buy access: /buy';
                await ctx.reply(msg);
                return;
            }

            // остатки после списания
            const usedAfter    = deducted==='free' ? usedBefore + 1 : usedBefore;
            const freeLeftNow  = Math.max(FREE_TOTAL_LIMIT - usedAfter, 0);
            const creditsAfter = deducted==='credit' ? creditsBefore - 1 : creditsBefore;

            const passMs  = leftMsFromSqlite(myTimePassUntil(uid));
            const passStr = passMs > 0
                ? (lang==='ru' ? `осталось ${formatHM(passMs, lang)}`
                    : lang==='uk' ? `залишилось ${formatHM(passMs, lang)}`
                        : `left ${formatHM(passMs, lang)}`)
                : (lang==='ru' ? 'нет' : lang==='uk' ? 'немає' : 'none');

            const suffix =
                lang==='ru'
                    ? `\n\n👤 Твой доступ:\n• Бесплатный лимит: использовано ${usedAfter} из ${FREE_TOTAL_LIMIT} (осталось ${freeLeftNow})\n• Кредиты: ${creditsAfter}\n• Day Pass: ${passStr}`
                    : lang==='uk'
                        ? `\n\n👤 Твій доступ:\n• Безкоштовний ліміт: використано ${usedAfter} із ${FREE_TOTAL_LIMIT} (залишилось ${freeLeftNow})\n• Кредити: ${creditsAfter}\n• Day Pass: ${passStr}`
                        : `\n\n👤 Your access:\n• Free limit: used ${usedAfter} of ${FREE_TOTAL_LIMIT} (left ${freeLeftNow})\n• Credits: ${creditsAfter}\n• Day Pass: ${passStr}`;

            // ответ + кнопки (Feedback + Help)
            await ctx.reply(result + suffix, {
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: lang==='ru' ? 'Оставить отзыв'
                                : lang==='uk' ? 'Залишити відгук'
                                    : 'Leave feedback',
                            callback_data: 'fb:start'
                        },
                        {
                            text: lang==='ru' ? '❓ Помощь'
                                : lang==='uk' ? '❓ Допомога'
                                    : '❓ Help',
                            callback_data: 'help:open'
                        }
                    ]]
                }
            });

        } catch (e) {
            console.error('Photo handler error:', e);
            return ctx.reply(
                lang==='ru' ? '⚠️ Ошибка при анализе. Попробуй позже.'
                    : lang==='uk' ? '⚠️ Помилка під час аналізу. Спробуй пізніше.'
                        : '⚠️ Error during analysis. Please try later.'
            );
        } finally {
            inProgress.delete(uid);
        }
    });
}
