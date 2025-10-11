// utils/ocr.js
import { askVisionSafe } from './ai.js';

const OCR_MODEL = process.env.OCR_MODEL || 'gpt-4o-mini';

function normalizeLetter(s) {
    return String(s || '').toUpperCase().replace(/[^A-F]/g, '');
}
function dedupeOptions(options) {
    const seen = new Set(), out = [];
    for (const o of options) {
        const k = `${o.letter}::${(o.text || '').trim()}`;
        if (!seen.has(k) && o.letter && (o.text || '').trim()) {
            seen.add(k);
            out.push({ letter: o.letter, text: (o.text || '').trim() });
        }
    }
    return out;
}
function clampToAF(options) {
    const letters = 'ABCDEF'.split('');
    const res = [];
    for (let i = 0; i < options.length && i < 6; i++) {
        res.push({ letter: letters[i], text: String(options[i].text || '').trim() });
    }
    return res;
}

/**
 * Извлекает MCQ из изображения.
 * @param {string} imageUrl - может быть обычный URL (Telegram) или data: URL
 * @param {'ru'|'uk'|'en'} lang
 * @returns {Promise<{ok:boolean, question?:string, options?:{letter:string,text:string}[]}>}
 */
export async function extractMcqFromImage(imageUrl, lang = 'en') {
    const sys =
        'You extract structured MCQ data from an image. ' +
        'Return ONLY valid JSON with fields: ' +
        '{"question": string, "options": [{"letter":"A|B|C|D|E|F","text": string}]} ' +
        'Use 2..6 options that truly appear in the image. Do not invent options.';

    const user =
        lang === 'ru'
            ? 'На изображении — тест. Извлеки вопрос и 2–6 вариантов ответов (буквы A–F). Верни ТОЛЬКО JSON.'
            : lang === 'uk'
                ? 'На зображенні — тест. Витягни питання і 2–6 варіантів відповідей (A–F). Поверни ЛИШЕ JSON.'
                : 'The image shows an MCQ. Extract the question and 2–6 options (A–F). Return JSON ONLY.';

    const res = await askVisionSafe({
        model: OCR_MODEL,
        temperature: 0,
        text: { format: 'json' }, // <-- без json_schema, т.к. у твоего SDK его нет
        input: [
            { role: 'system', content: sys },
            { role: 'user',   content: user },
            { role: 'user',   content: [{ type: 'input_image', image_url: imageUrl }] } // <-- ЕДИНЫЙ imageUrl
        ]
    });

    let raw = {};
    try { raw = JSON.parse((res.output_text || '{}').trim()); } catch {}

    let question = String(raw.question || '').replace(/\s+/g, ' ').trim();
    let options = Array.isArray(raw.options) ? raw.options : [];

    // нормализация
    options = options.map(o => ({
        letter: normalizeLetter(o.letter),
        text: String(o.text || '').replace(/\s+/g, ' ').trim()
    })).filter(o => o.text);

    // базовые проверки и исправления
    if (options.length < 2) return { ok: false };
    if (options.length > 6) options = options.slice(0, 6);

    const uniqueLetters = new Set(options.map(o => o.letter).filter(Boolean));
    if (uniqueLetters.size !== options.length) {
        // кривые/повторные метки — перенумеруем A..F по порядку
        options = clampToAF(options);
    }

    options = dedupeOptions(options);
    if (options.length < 2) return { ok: false };
    if (!question) question = '(no question text)';

    return { ok: true, question, options };
}
