// utils/ocr.js
import { askVisionSafe } from './ai.js';

const OCR_MODEL = process.env.OCR_MODEL || 'gpt-4o-mini';

// JSON-схема для нового Responses API (через text.format)
const ocrSchema = {
    name: "mcq_ocr",
    schema: {
        type: "object",
        properties: {
            question: { type: "string" },
            options: {
                type: "array",
                minItems: 2,
                maxItems: 6,
                items: {
                    type: "object",
                    properties: {
                        letter: { type: "string", enum: ["A","B","C","D","E","F"] },
                        text:   { type: "string" }
                    },
                    required: ["letter","text"],
                    additionalProperties: false
                }
            }
        },
        required: ["question","options"],
        additionalProperties: false
    },
    strict: true
};

function normalizeLetter(s) {
    return String(s || '').toUpperCase().replace(/[^A-F]/g, '');
}
function dedupeOptions(options) {
    const seen = new Set(), out = [];
    for (const o of options) {
        const k = `${o.letter}::${o.text.trim()}`;
        if (!seen.has(k) && o.letter && o.text.trim()) { seen.add(k); out.push(o); }
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
 * Возвращает { ok:boolean, question, options:[{letter,text}] }
 */
export async function extractMcqFromImage(imageUrl, lang='en') {
    const sys =
        'You extract structured MCQ data from an image. ' +
        'Return STRICT JSON matching the provided schema. 2..6 options. Do not invent options.';
    const user =
        lang === 'ru'
            ? 'На изображении — тест. Извлеки вопрос и 2–6 вариантов ответов (буквы A–F). Верни ТОЛЬКО JSON.'
            : lang === 'uk'
                ? 'На зображенні — тест. Витягни питання і 2–6 варіантів відповідей (A–F). Поверни ЛИШЕ JSON.'
                : 'The image shows an MCQ. Extract the question and 2–6 options (A–F). Return JSON ONLY.';

    const res = await askVisionSafe({
        model: OCR_MODEL,
        temperature: 0,
        text: { format: 'json' }, // <-- только json
        input: [
            { role: 'system', content:
                    sys + '\nReturn ONLY valid JSON with fields: {"question":string,"options":[{"letter":"A|B|C|D|E|F","text":string}]}. 2..6 options.'
            },
            { role: 'user',   content: user },
            { role: 'user',   content: [{ type: 'input_image', image_url: imageSrc }] }
        ]
    });

    let raw = {};
    try { raw = JSON.parse((res.output_text || '{}').trim()); } catch {}

    let question = String(raw.question || '').replace(/\s+/g, ' ').trim();
    let options  = Array.isArray(raw.options) ? raw.options : [];

    options = options.map(o => ({
        letter: normalizeLetter(o.letter),
        text: String(o.text || '').replace(/\s+/g, ' ').trim()
    })).filter(o => o.text);

    if (options.length < 2) return { ok: false };
    if (options.length > 6) options = options.slice(0, 6);

    const uniqueLetters = new Set(options.map(o => o.letter).filter(Boolean));
    if (uniqueLetters.size !== options.length) options = clampToAF(options);

    options = dedupeOptions(options);
    if (options.length < 2) return { ok: false };
    if (!question) question = '(no question text)';

    return { ok: true, question, options };
}
