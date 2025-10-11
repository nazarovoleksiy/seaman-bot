// utils/ocr.js
import { ai } from './ai.js';

/**
 * Нормализуем метки вариантов в A..F (поддержка 2–6 опций).
 */
function normalizeLetter(s) {
    const t = String(s || '')
        .trim()
        .replace(/^option\s*/i, '')
        .replace(/[\)\].:=-\s]+$/g, '')
        .toUpperCase();
    // допускаем форматы: "A", "A)", "1.", "[B]" — берём первую латинскую букву
    const m = t.match(/[A-F]/);
    return m ? m[0] : '';
}

function dedupeOptions(options) {
    const seen = new Set();
    const out = [];
    for (const o of options) {
        const k = `${o.letter}::${o.text.trim()}`;
        if (!seen.has(k) && o.letter && o.text.trim()) {
            seen.add(k);
            out.push(o);
        }
    }
    return out;
}

function clampToAF(options) {
    // если метки кривые или пропуски — перенумеруем подряд A,B,C,...
    const letters = 'ABCDEF'.split('');
    const clean = [];
    for (let i = 0; i < options.length && i < 6; i++) {
        clean.push({
            letter: letters[i],
            text: String(options[i].text || '').trim()
        });
    }
    return clean;
}

/**
 * Возвращает:
 * {
 *   ok: boolean,
 *   question: string,
 *   options: [{letter:'A'..'F', text:string}], // 2–6 шт.
 * }
 */
export async function extractMcqFromImage(imageUrl, lang = 'en') {
    const sys =
        'You extract structured MCQ data from an image. ' +
        'Return STRICT JSON with fields: {"question": string, "options": [{"letter":"A|B|C|D|E|F","text": string}]} ' +
        '2..6 options only. Do not invent options.';

    const user =
        (lang === 'ru'
            ? 'На фото — тест с вариантами. Извлеки вопрос и варианты (2–6). Верни только JSON без текста вокруг.'
            : lang === 'uk'
                ? 'На фото — тест з варіантами. Витягни питання та варіанти (2–6). Поверни лише JSON без зайвого тексту.'
                : 'The picture shows an MCQ. Extract question and 2–6 options. Return JSON only.');

    const res = await ai.responses.create({
        model: process.env.OCR_MODEL || 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        input: [
            { role: 'system', content: sys },
            { role: 'user', content: user },
            { role: 'user', content: [{ type: 'input_image', image_url: imageUrl }] }
        ]
    });

    let raw = {};
    try { raw = JSON.parse((res.output_text || '{}').trim()); } catch {}

    let question = String(raw.question || '').trim();
    let options = Array.isArray(raw.options) ? raw.options : [];

    // нормализация меток и чистка
    options = options.map(o => ({
        letter: normalizeLetter(o.letter),
        text: String(o.text || '').replace(/\s+/g, ' ').trim()
    })).filter(o => o.text);

    // если метки плохие/повторы — перенумеруем
    const validLetters = new Set(options.map(o => o.letter).filter(Boolean));
    if (options.length < 2) return { ok: false };
    if (options.length > 6) options = options.slice(0, 6);
    if (validLetters.size !== options.length) options = clampToAF(options);

    options = dedupeOptions(options);
    if (options.length < 2) return { ok: false };
    if (!question) question = '(no question text)';

    return { ok: true, question, options };
}
