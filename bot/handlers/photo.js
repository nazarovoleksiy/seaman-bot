// bot/handlers/photo.js
import {
    consumeOneCredit,
    FREE_TOTAL_LIMIT,
    getLang,
    hasTimePass,
    incUsage,
    myCreditsLeft,
    myTimePassUntil,
    totalUsage
} from '../../db/database.js';

import {preprocessToDataUrl} from '../../utils/image.js';
import {extractMcqFromImage} from '../../utils/ocr.js';
import {withConcurrency} from '../../utils/ai.js';
import {getCachedAnswer, saveCachedAnswer} from '../../db/answerCache.js';

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
    if (ms <= 0) return lang === 'ru' ? 'нет' : lang === 'uk' ? 'немає' : 'none';
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (lang === 'ru') {
        const hL = h === 1 ? 'час' : (h >= 2 && h <= 4 ? 'часа' : 'часов');
        const mL = m === 1 ? 'минута' : (m >= 2 && m <= 4 ? 'минуты' : 'минут');
        return h > 0 && m > 0 ? `${h} ${hL} ${m} ${mL}` : h > 0 ? `${h} ${hL}` : `${m} ${mL}`;
    } else if (lang === 'uk') {
        return h > 0 && m > 0 ? `${h} год ${m} хв` : h > 0 ? `${h} год` : `${m} хв`;
    } else {
        const hL = h === 1 ? 'hour' : 'hours';
        const mL = m === 1 ? 'min' : 'mins';
        return h > 0 && m > 0 ? `${h} ${hL} ${m} ${mL}` : h > 0 ? `${h} ${hL}` : `${m} ${mL}`;
    }
}

function renderAnswer(out, lang) {
    const THR = Number(process.env.LOW_CONFIDENCE_THRESHOLD || 0.75);
    const low = typeof out.confidence === 'number' && out.confidence < THR;

    if (lang === 'ru') {
        return `✅ Правильный ответ: ${out.answer_letter} — ${out.answer_text}\n` +
            `💡 Объяснение: ${out.explanation || '—'}` +
            (low ? `\n⚠️ Низкая уверенность (${Math.round(out.confidence * 100)}%). Попробуй прислать более чёткий скрин.` : ``);
    } else if (lang === 'uk') {
        return `✅ Правильна відповідь: ${out.answer_letter} — ${out.answer_text}\n` +
            `💡 Пояснення: ${out.explanation || '—'}` +
            (low ? `\n⚠️ Низька впевненість (${Math.round(out.confidence * 100)}%). Спробуй надіслати чіткіший скрин.` : ``);
    } else {
        return `✅ Correct answer: ${out.answer_letter} — ${out.answer_text}\n` +
            `💡 Explanation: ${out.explanation || '—'}` +
            (low ? `\n⚠️ Low confidence (${Math.round(out.confidence * 100)}%). Try a clearer full screenshot.` : ``);
    }
}

// ===== основной обработчик =====
export function registerPhotoHandler(bot) {
    bot.on('photo', async (ctx) => {
        const uid = ctx.from.id;
        const lang = getLang(uid);

        if (!cooldownPassed(uid)) {
            return ctx.reply(
                lang === 'ru' ? '⏳ Подожди 10 секунд и пришли снова.' :
                    lang === 'uk' ? '⏳ Зачекай 10 секунд і спробуй ще раз.' :
                        '⏳ Please wait 10 seconds and try again.'
            );
        }

        if (inProgress.has(uid)) {
            return ctx.reply(
                lang === 'ru' ? '🛠 Уже разбираю предыдущее фото. Дождись ответа.' :
                    lang === 'uk' ? '🛠 Уже розбираю попереднє фото. Зачекай відповіді.' :
                        '🛠 I’m already analyzing your previous photo. Please wait.'
            );
        }

        // доступ
        const hasPass = hasTimePass(uid);
        const used = totalUsage(uid);
        const credits = myCreditsLeft(uid);
        const freeLeft = Math.max(FREE_TOTAL_LIMIT - used, 0);

        if (!hasPass && freeLeft <= 0 && credits <= 0) {
            const msg = lang === 'ru'
                ? '🚦 Доступ закончился: бесплатные попытки исчерпаны и кредитов нет. Купи доступ: /buy'
                : lang === 'uk'
                    ? '🚦 Доступ закінчився: безкоштовні спроби вичерпані і кредитів немає. Купи доступ: /buy'
                    : '🚦 Access ended: no free attempts and no credits left. Buy access: /buy';
            return ctx.reply(msg);
        }

        inProgress.add(uid);
        try {
            await ctx.reply(
                lang === 'ru' ? '📷 Фото получено. Улучшаю изображение и анализирую…' :
                    lang === 'uk' ? '📷 Фото отримано. Покращую зображення й аналізую…' :
                        '📷 Photo received. Enhancing and analyzing…'
            );

            const photos = ctx.message.photo;
            const last = photos[photos.length - 1];
            const fileUid = last.file_unique_id;
            const file = await ctx.telegram.getFile(last.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

            // кэш по уникальному ID картинки
            const VER = process.env.PIPE_VER || 'v1';
            const cached = getCachedAnswer(fileUid, VER);
            let answerObj = cached ? JSON.parse(cached) : null;

            if (!answerObj) {
                // 1) предобработка (если упала — используем исходный URL)
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
                    const msg = lang === 'ru'
                        ? '⚠️ Не удалось распознать вопрос. Пришли скрин с полным вопросом и вариантами A–F.'
                        : lang === 'uk'
                            ? '⚠️ Не вдалося розпізнати питання. Надішли скрин із повним питанням і варіантами A–F.'
                            : '⚠️ Could not read the question. Please send a full screenshot with the question and options A–F.';
                    await ctx.reply(msg);
                    inProgress.delete(uid);
                    return;
                }

                // 3) Решение (reasoning) с self-check/консенсусом
                const r = await withConcurrency(() => reasonWithConsensus({
                    question: ocr.question,
                    options: ocr.options,
                    lang
                }));

// utils/reason.js
                import {askTextSafe} from './ai.js';

                const REASON_MODEL = (process.env.REASON_MODEL || 'gpt-4o-mini').trim().replace(/^=+/, '');
                const FALLBACK_MODEL = (process.env.ANSWER_MODEL_FALLBACK || 'gpt-4.1-mini').trim().replace(/^=+/, '');

                function toLetter(i) {
                    return String.fromCharCode(65 + i);
                }             // 0->A, 1->B, ...
                function fromLetter(ch) {                                                  // 'A'|'b' -> 0,1,...
                    if (!ch) return -1;
                    const m = String(ch).trim().match(/[A-Za-z]/);
                    if (!m) return -1;
                    const code = m[0].toUpperCase().charCodeAt(0) - 65;
                    return code >= 0 ? code : -1;
                }

                function clamp(n, lo, hi) {
                    return Math.max(lo, Math.min(hi, n));
                }

                function buildPrompt(ocr, lang = 'en') {
                    const {question, options = []} = ocr || {};
                    const optsBlock = options.map((t, i) => `${toLetter(i)}. ${t}`).join('\n');
                    const hdrQ = lang === 'ru' ? 'Вопрос' : lang === 'uk' ? 'Питання' : 'Question';
                    const hdrO = lang === 'ru' ? 'Варианты' : lang === 'uk' ? 'Варіанти' : 'Options';
                    const instr =
                        lang === 'ru'
                            ? `Ты — строгий экзаменационный ассистент. У тебя от 2 до 10 вариантов ответа.
Выбери строго ОДНУ букву правильного варианта и коротко объясни почему.
Верни ТОЛЬКО JSON.`
                            : lang === 'uk'
                                ? `Ти — суворий екзаменаційний асистент. Є від 2 до 10 варіантів.
Обери рівно ОДНУ літеру правильної відповіді та коротко поясни чому.
Поверни ЛИШЕ JSON.`
                                : `You are a strict exam assistant. There are 2..10 options.
Pick exactly ONE correct letter and briefly explain why.
Return JSON ONLY.`;

                    const jsonLine =
                        lang === 'ru'
                            ? `Схема JSON: {"answer_letter":"A|B|C|...","answer_text":"...","explanation":"...","confidence":0..1}`
                            : lang === 'uk'
                                ? `Схема JSON: {"answer_letter":"A|B|C|...","answer_text":"...","explanation":"...","confidence":0..1}`
                                : `JSON schema: {"answer_letter":"A|B|C|...","answer_text":"...","explanation":"...","confidence":0..1}`;

                    const user =
                        `${hdrQ}:
${question}

${hdrO}:
${optsBlock}

${jsonLine}`;

                    return {system: instr, user};
                }

                function cleanJsonText(raw) {
                    // вырезаем возможные code fences и комментарии
                    let t = (raw || '').trim();
                    t = t.replace(/^```(?:json|jsonc)?\s*/i, '').replace(/```$/, '').trim();
                    // иногда модель добавляет текст вокруг JSON
                    const first = t.indexOf('{');
                    const last = t.lastIndexOf('}');
                    if (first !== -1 && last !== -1 && last > first) {
                        t = t.slice(first, last + 1);
                    }
                    return t;
                }

                async function reasonOnce(ocr, lang = 'en', model = REASON_MODEL, temperature = 0.2) {
                    const {question, options} = ocr || {};
                    if (!question || !Array.isArray(options) || options.length < 2) return null;

                    const {system, user} = buildPrompt(ocr, lang);

                    const req = {
                        model,
                        temperature,
                        input: [
                            {role: 'system', content: system},
                            {role: 'user', content: [{type: 'input_text', text: user}]}
                        ],
                        // Просим Responses API вернуть именно JSON-объект
                        text: {format: {type: 'json_object'}}
                    };

                    try {
                        const res = await askTextSafe(req);
                        const raw = cleanJsonText(res?.output_text || '');
                        if (!raw) return null;

                        let data;
                        try {
                            data = JSON.parse(raw);
                        } catch {
                            return null;
                        }

                        // Нормализация/валидация
                        let idx = fromLetter(data.answer_letter);
                        if (idx < 0) return null;
                        idx = clamp(idx, 0, options.length - 1);

                        const normalized = {
                            answer_letter: toLetter(idx),
                            answer_text: options[idx],                        // берём строго из списка!
                            explanation: typeof data.explanation === 'string' ? data.explanation.trim() : '',
                            confidence: typeof data.confidence === 'number' ? Math.max(0, Math.min(1, data.confidence)) : 0.6
                        };

                        return normalized;
                    } catch (e) {
                        // мягкий фолбэк на запасную модель
                        if (model !== FALLBACK_MODEL) {
                            try {
                                return await reasonOnce(ocr, lang, FALLBACK_MODEL, temperature);
                            } catch {
                            }
                        }
                        console.error('reasonOnce error:', e);
                        return null;
                    }
                }

// Небольшой ансамбль: разные температуры для разнообразия ответов
                export async function reasonWithConsensus(ocr, lang = 'en', nRuns = 3) {
                    const temps = [0.2, 0.35, 0.5]; // если прогонов больше — будут по кругу
                    const runs = [];
                    for (let i = 0; i < nRuns; i++) {
                        const model = i < nRuns - 1 ? REASON_MODEL : FALLBACK_MODEL; // последний прогон — фолбэк
                        const t = temps[i % temps.length];
                        // eslint-disable-next-line no-await-in-loop
                        const r = await reasonOnce(ocr, lang, model, t);
                        if (r) runs.push(r);
                    }
                    if (runs.length === 0) return null;

                    // голосование по буквам
                    const count = new Map();
                    for (const r of runs) count.set(r.answer_letter, (count.get(r.answer_letter) || 0) + 1);

                    let best = null, votes = -1;
                    for (const [letter, v] of count.entries()) {
                        if (v > votes) {
                            votes = v;
                            best = letter;
                        }
                    }
                    const winner = runs.find(r => r.answer_letter === best) || runs[0];
                    const confidence = votes / runs.length;

                    return {
                        answer_letter: winner.answer_letter,
                        answer_text: winner.answer_text,
                        explanation: winner.explanation,
                        confidence,                 // 0..1
                        lowConfidence: confidence < (Number(process.env.LOW_CONFIDENCE_THRESHOLD || 0.6))
                    };
                }

// Алиас для обратной совместимости (/ старые импорты)
                export async function solveMcq(ocr, lang) {
                    return reasonWithConsensus(ocr, lang, 1);
                }


                const opt = ocr.options.find(o => o.letter === r.letter);
                const ansText = opt ? opt.text : '';

                answerObj = {
                    answer_letter: r.letter,
                    answer_text: ansText,
                    explanation: r.explanation || '',
                    confidence: r.confidence ?? 0.5
                };

                // кэшируем
                saveCachedAnswer(fileUid, VER, answerObj);
            }

            // ===== учёт доступа по приоритету =====
            let deducted = 'none';
            if (hasPass) {
                deducted = 'pass'; // ничего не списываем
            } else if (used < FREE_TOTAL_LIMIT) {
                incUsage(uid);     // сначала бесплатное
                deducted = 'free';
            } else if (credits > 0) {
                consumeOneCredit(uid); // потом кредиты
                deducted = 'credit';
            } else {
                const msg = lang === 'ru'
                    ? '🚦 Доступ закончился. Купи доступ: /buy'
                    : lang === 'uk'
                        ? '🚦 Доступ закінчився. Купи доступ: /buy'
                        : '🚦 Access ended. Buy access: /buy';
                await ctx.reply(msg);
                inProgress.delete(uid);
                return;
            }

            const usedAfter = deducted === 'free' ? used + 1 : used;
            const creditsAfter = deducted === 'credit' ? credits - 1 : credits;
            const freeLeftNow = Math.max(FREE_TOTAL_LIMIT - usedAfter, 0);

            const passMs = leftMsFromSqlite(myTimePassUntil(uid));
            const passStr = passMs > 0
                ? (lang === 'ru' ? `осталось ${formatHM(passMs, lang)}`
                    : lang === 'uk' ? `залишилось ${formatHM(passMs, lang)}`
                        : `left ${formatHM(passMs, lang)}`)
                : (lang === 'ru' ? 'нет' : lang === 'uk' ? 'немає' : 'none');

            const suffix =
                lang === 'ru'
                    ? `\n\n👤 Твой доступ:\n• Бесплатный лимит: использовано ${usedAfter} из ${FREE_TOTAL_LIMIT} (осталось ${freeLeftNow})\n• Кредиты: ${creditsAfter}\n• Day Pass: ${passStr}`
                    : lang === 'uk'
                        ? `\n\n👤 Твій доступ:\n• Безкоштовний ліміт: використано ${usedAfter} із ${FREE_TOTAL_LIMIT} (залишилось ${freeLeftNow})\n• Кредити: ${creditsAfter}\n• Day Pass: ${passStr}`
                        : `\n\n👤 Your access:\n• Free limit: used ${usedAfter} of ${FREE_TOTAL_LIMIT} (left ${freeLeftNow})\n• Credits: ${creditsAfter}\n• Day Pass: ${passStr}`;

            await ctx.reply(renderAnswer(answerObj, lang) + suffix, {
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: lang === 'ru' ? 'Оставить отзыв' : lang === 'uk' ? 'Залишити відгук' : 'Leave feedback',
                            callback_data: 'fb:start'
                        },
                        {
                            text: lang === 'ru' ? '❓ Помощь' : lang === 'uk' ? '❓ Допомога' : '❓ Help',
                            callback_data: 'help:open'
                        }
                    ]]
                }
            });

        } catch (e) {
            console.error('Photo handler error:', e);
            await ctx.reply(
                lang === 'ru' ? '⚠️ Ошибка при анализе. Попробуй позже.' :
                    lang === 'uk' ? '⚠️ Помилка під час аналізу. Спробуй пізніше.' :
                        '⚠️ Error during analysis. Please try later.'
            );
        } finally {
            inProgress.delete(uid);
        }
    });
}
