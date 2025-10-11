// utils/ocr.js
import { askVisionSafe } from './ai.js';

const OCR_MODEL = process.env.OCR_MODEL || 'gpt-4o-mini';

// Расширенная схема JSON
const ocrSchema = {
    name: "mcq_ocr",
    schema: {
        type: "object",
        properties: {
            question: { type: "string" },
            options: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        letter: { type: "string", enum: ["A","B","C","D","E","F"] },
                        text:   { type: "string" }
                    },
                    required: ["letter","text"],
                    additionalProperties: false
                },
                minItems: 2,
                maxItems: 6
            },
            confidence: { type: "number" }
        },
        required: ["question", "options", "confidence"],
        additionalProperties: false
    },
    strict: true
};

export async function extractMcqFromImage(imageDataUrl, lang='en') {
    const prompt =
        lang === 'ru'
            ? `Извлеки из изображения текст вопроса и варианты ответов (A, B, C, D, E, F — сколько есть). Верни строгий JSON по схеме.`
            : lang === 'uk'
                ? `Витягни з зображення текст питання та варіанти відповідей (A, B, C, D, E, F — скільки є). Поверни суворий JSON за схемою.`
                : `Extract the question text and answer options (A–F, however many there are) from the image. Return strict JSON per schema.`;

    const res = await askVisionSafe({
        model: OCR_MODEL,
        temperature: 0,
        max_output_tokens: 600,
        response_format: { type: "json_schema", json_schema: ocrSchema },
        input: [
            { role: 'system', content: 'You perform OCR for MCQ images. Output ONLY JSON.' },
            { role: 'user', content: [
                    { type: 'input_text', text: prompt },
                    { type: 'input_image', image_url: imageDataUrl }
                ] }
        ]
    });

    let raw = (res.output_text || '').trim();
    const m = raw.match(/\{[\s\S]*\}/);
    raw = m ? m[0] : raw;

    try {
        const obj = JSON.parse(raw);

        // нормализуем буквы и чистим мусор
        if (Array.isArray(obj.options)) {
            obj.options = obj.options
                .filter(o => o && o.letter && o.text)
                .map(o => ({
                    letter: String(o.letter).toUpperCase().replace(/[^A-F]/g, '').trim(),
                    text: String(o.text).replace(/\s+/g, ' ').trim()
                }))
                .filter(o => o.letter && o.text) // убираем пустые
                .slice(0, 6); // максимум 6 опций
        }

        return obj;
    } catch {
        return null;
    }
}
