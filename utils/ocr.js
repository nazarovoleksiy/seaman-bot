// utils/ocr.js
import { MODELS, requestWithRetries } from './ai.js';

// Пробуем сначала strict JSON (json_schema), если API ругнётся — фолбэк на json_object
export async function extractMcqFromImage(imageDataUrl, lang = 'en') {
    const sys = lang === 'ru'
        ? `Ты распознаёшь вопрос с вариантами ответов из изображения. 
Верни строго JSON с полями:
- question: строка (текст вопроса)
- options: массив строк (2–8 вариантов)
Не добавляй ничего лишнего.`
        : lang === 'uk'
            ? `Ти розпізнаєш питання з варіантами відповідей із зображення.
Поверни суворий JSON з полями:
- question: рядок
- options: масив рядків (2–8 варіантів)
Без зайвого тексту.`
            : `You extract a multiple-choice question from an image.
Return strict JSON with:
- question: string
- options: string[] (2–8 items)
No extra text.`;

    // Пользовательское сообщение: изображение + короткая подсказка
    const userContent = [
        { type: 'input_text', text: 'Extract the MCQ and return JSON only.' },
        { type: 'input_image', image_url: imageDataUrl },
    ];

    // 1) Попытка через text.format: json_schema
    const reqSchema = {
        model: MODELS.OCR,
        input: [
            { role: 'system', content: sys },
            { role: 'user', content: userContent }
        ],
        text: {
            format: {
                type: 'json_schema',
                json_schema: {
                    name: 'MCQ',
                    schema: {
                        type: 'object',
                        properties: {
                            question: { type: 'string' },
                            options:  { type: 'array', minItems: 2, maxItems: 8, items: { type: 'string' } }
                        },
                        required: ['question', 'options'],
                        additionalProperties: true
                    },
                    strict: true
                }
            }
        }
    };

    try {
        const r1 = await requestWithRetries(reqSchema, { tries: 1 });
        // В Responses API JSON доступен как r1.output[0].content[0].text (в json_object/schema это уже строка JSON).
        const raw = r1?.output_text || r1?.output?.[0]?.content?.[0]?.text || '';
        const parsed = safeParse(raw);
        if (isValid(parsed)) return parsed;
    } catch (e) {
        // Если API не поддерживает json_schema/или вернул invalid — пробуем json_object
        // console.warn('OCR json_schema failed, falling back to json_object:', e);
    }

    // 2) Фолбэк: text.format: json_object
    const reqObject = {
        model: MODELS.OCR,
        input: [
            { role: 'system', content: sys },
            { role: 'user', content: userContent }
        ],
        text: { format: { type: 'json_object' } }
    };

    const r2 = await requestWithRetries(reqObject, { tries: 2 });
    const raw2 = r2?.output_text || r2?.output?.[0]?.content?.[0]?.text || '';
    const parsed2 = safeParse(raw2);
    if (isValid(parsed2)) return parsed2;

    return null;
}

function safeParse(s) {
    try { return JSON.parse(s); } catch { return null; }
}
function isValid(obj) {
    return obj && typeof obj.question === 'string'
        && Array.isArray(obj.options) && obj.options.length >= 2;
}
