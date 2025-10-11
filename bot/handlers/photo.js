// bot/handlers/photo.js
import {
    getLang,
    FREE_TOTAL_LIMIT,
    totalUsage,
    incUsage,
    myCreditsLeft,
    hasTimePass,
    myTimePassUntil,
    consumeOneCredit
} from '../../db/database.js';

import { preprocessToDataUrl } from '../../utils/image.js';
import { extractMcqFromImage } from '../../utils/ocr.js';
import { withConcurrency } from '../../utils/ai.js';
import { getCachedAnswer, saveCachedAnswer } from '../../db/answerCache.js';

import {
    reasonWithConsensus,
    pickOptionByText,
    visionOneShotSolve
} from '../../utils/reason.js';

// ===== антифлуд =====
const lastHit = new Map();
const inProgress = new Set();
const COOLDOWN_MS = 10_000;

function cooldownPassed(id) {
    const now = Date.now(), prev = lastHit.get(id) || 0;
    if (now - prev < COOLDOWN_MS) return false;
    lastHit.set(id, now);
    return true;
}

// ===== форматирование времени =====
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
        return h>0&&m>0 ? `${h} ${hL} ${m} ${mL}` : h>0 ? `${h} ${hL}` : `${m} ${mL}`;
    } else if (lang==='uk') {
        return h>0&&m>0 ? `${h} год ${m} хв` : h>0 ? `${h} год` : `${m} хв`;
    } else {
        const hL = h===1?'hour':'hours';
        const mL = m===1?'min':'mins';
        return h>0&&m>0 ? `${h} ${hL} ${m} ${mL}` : h>0 ? `${h} ${hL}` : `${m} ${mL}`;
    }
}

// ===== отрисовка ответа =====
function renderAnswer(out, lang) {
    const THR = Number(process.env.LOW_CONFIDENCE_THRESHOLD || 0.75);
    const low = typeof out.confidence === 'number' && out.confidence < THR;

    if (lang === 'ru') {
        return `✅ Правильный ответ: ${out.answer_letter} — ${out.answer_text}\n` +
            `💡 Объяснение: ${out.explanation || '—'}` +
            (low ? `\n⚠️ Низкая уверенность (${Math.round(out.confidence*100)}%). Попробуй прислать более чёткий скрин.` : ``);
    } else if (lang === 'uk') {
        return `✅ Правильна відповідь: ${out.answer_letter} — ${out.answer_text}\n` +
            `💡 Пояснення: ${out.explanation || '—'}` +
            (low ? `\n⚠️ Низька впевненість (${Math.round(out.confidence*100)}%). Спробуй надіслати чіткіший скрин.` : ``);
    } else {
        return `✅ Correct answer: ${out.answer_letter} — ${out.answer_text}\n` +
            `💡 Explanation: ${out.explanation || '—'}` +
            (low ? `\n⚠️ Low confidence (${Math.round(out.confidence*100)}%). Try a clearer full screenshot.` : ``);
    }
}

// ===== основной обработчик =====
export function registerPhotoHandler(bot) {
    bot.on('photo', async (ctx) => {
        const uid  = ctx.from.id;
        const lang = getLang(uid);

        if (!cooldownPassed(uid)) {
            return ctx.reply(
                lang==='ru' ? '⏳ Подожди 10 секунд и пришли снова.' :
                    lang==='uk' ? '⏳ Зачекай 10 секунд і спробуй ще раз.' :
                        '⏳ Please wait 10 seconds and try again.'
            );
        }

        if (inProgress.has(uid)) {
            return ctx.reply(
                lang==='ru' ? '🛠 Уже разбираю предыдущее фото. Дождись ответа.' :
                    lang==='uk' ? '🛠 Уже розбираю попереднє фото. Зачекай відповіді.' :
                        '🛠 I’m already analyzing your previous photo. Please wait.'
            );
        }

        // доступ
        const hasPass  = hasTimePass(uid);
        const used     = totalUsage(uid);
        const credits  = myCreditsLeft(uid);
        const freeLeft = Math.max(FREE_TOTAL_LIMIT - used, 0);

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
                lang==='ru' ? '📷 Фото получено. Улучшаю изображение и анализирую…' :
                    lang==='uk' ? '📷 Фото отримано. Покращую зображення й аналізую…' :
                        '📷 Photo received. Enhancing and analyzing…'
            );

            // получаем file URL
            const photos  = ctx.message.photo;
            const last    = photos[photos.length - 1];
            const fileUid = last.file_unique_id;
            const file    = await ctx.telegram.getFile(last.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

            // кэш результата по уникальному ID фото
            const VER = process.env.PIPE_VER || 'v1';
            const cached = getCachedAnswer(fileUid, VER);
            let answerObj = cached ? JSON.parse(cached) : null;

            if (!answerObj) {
                // 1) предобработка (если упала — берём исходный URL)
                let dataUrl = null;
                try {
                    dataUrl = await withConcurrency(() => preprocessToDataUrl(fileUrl));
                } catch (e) {
                    console.warn('preprocessToDataUrl failed, using original url:', e?.message || e);
                    dataUrl = fileUrl;
                }

                // 2) OCR
                const ocr = await withConcurrency(() => extractMcqFromImage(dataUrl, lang));
                if (!ocr || !ocr.question || !Array.isArray(ocr.options) || ocr.options.length < 2) {
                    const msg = lang==='ru'
                        ? '⚠️ Не удалось распознать вопрос. Пришли скрин с полным вопросом и вариантами A–F.'
                        : lang==='uk'
                            ? '⚠️ Не вдалося розпізнати питання. Надішли скрин із повним питанням і варіантами A–F.'
                            : '⚠️ Could not read the question. Please send a full screenshot with the question and options A–F.';
                    await ctx.reply(msg);
                    inProgress.delete(uid);
                    return;
                }

                // 3) reasoning с ансамблем
                let r = await withConcurrency(() => reasonWithConsensus(ocr, lang, 3));

                // F1: если буква не сошлась с текстом — пытаемся подобрать по текстовому сходству
                if (r && (!r.answer_text || !ocr.options.includes(r.answer_text))) {
                    const idxByText = pickOptionByText(r.answer_text || r.explanation || '', ocr.options);
                    if (idxByText >= 0) {
                        r.answer_letter = String.fromCharCode(65 + idxByText);
                        r.answer_text   = ocr.options[idxByText];
                        r.confidence    = Math.max(0.55, r.confidence || 0.55);
                    }
                }

                // F2: если всё ещё пусто — решаем напрямую по картинке
                if (!r || !r.answer_letter || !r.answer_text) {
                    r = await visionOneShotSolve(fileUrl, ocr, lang);
                }

                // если и после фолбэков нет ответа — сдаёмся
                if (!r || !r.answer_letter || !r.answer_text) {
                    const msg = lang==='ru'
                        ? '⚠️ Не удалось уверенно решить. Пришли более чёткий скрин.'
                        : lang==='uk'
                            ? '⚠️ Не вдалося впевнено вирішити. Надішли чіткіший скрін.'
                            : '⚠️ Could not confidently solve. Please send a clearer screenshot.';
                    await ctx.reply(msg);
                    inProgress.delete(uid);
                    return;
                }

                answerObj = {
                    answer_letter: r.answer_letter,
                    answer_text:   r.answer_text,
                    explanation:   r.explanation || '',
                    confidence:    r.confidence ?? 0.6
                };

                // кэшируем
                saveCachedAnswer(fileUid, VER, answerObj);
            }

            // ===== учёт доступа по приоритету =====
            let deducted = 'none';
            if (hasPass) {
                deducted = 'pass';
            } else if (used < FREE_TOTAL_LIMIT) {
                incUsage(uid);
                deducted = 'free';
            } else if (credits > 0) {
                consumeOneCredit(uid);
                deducted = 'credit';
            } else {
                const msg = lang==='ru'
                    ? '🚦 Доступ закончился. Купи доступ: /buy'
                    : lang==='uk'
                        ? '🚦 Доступ закінчився. Купи доступ: /buy'
                        : '🚦 Access ended. Buy access: /buy';
                await ctx.reply(msg);
                inProgress.delete(uid);
                return;
            }

            const usedAfter    = deducted==='free'   ? used + 1 : used;
            const creditsAfter = deducted==='credit' ? credits - 1 : credits;
            const freeLeftNow  = Math.max(FREE_TOTAL_LIMIT - usedAfter, 0);

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

            await ctx.reply(renderAnswer(answerObj, lang) + suffix, {
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: lang==='ru' ? 'Оставить отзыв' : lang==='uk' ? 'Залишити відгук' : 'Leave feedback',
                            callback_data: 'fb:start'
                        },
                        {
                            text: lang==='ru' ? '❓ Помощь' : lang==='uk' ? '❓ Допомога' : '❓ Help',
                            callback_data: 'help:open'
                        }
                    ]]
                }
            });

        } catch (e) {
            console.error('Photo handler error:', e);
            await ctx.reply(
                lang==='ru' ? '⚠️ Ошибка при анализе. Попробуй позже.' :
                    lang==='uk' ? '⚠️ Помилка під час аналізу. Спробуй пізніше.' :
                        '⚠️ Error during analysis. Please try later.'
            );
        } finally {
            inProgress.delete(uid);
        }
    });
}
