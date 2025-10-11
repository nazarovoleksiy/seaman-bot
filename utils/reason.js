// utils/reason.js
import { askVisionSafe } from './ai.js';

const PRIMARY  = process.env.ANSWER_MODEL_PRIMARY  || 'o4-mini';
const FALLBACK = process.env.ANSWER_MODEL_FALLBACK || 'o1-mini';
const THR = Number(process.env.LOW_CONFIDENCE_THRESHOLD || 0.75);

const ansSchema = {
    name: "mcq_answer",
    schema: {
        type: "object",
        properties: {
            answer_letter: { type: "string", enum: ["A","B","C","D"] },
            answer_text:   { type: "string" },
            explanation:   { type: "string" },
            confidence:    { type: "number" }
        },
        required: ["answer_letter","answer_text","explanation","confidence"],
        additionalProperties: false
    },
    strict: true
};

function buildPrompt(q, options, lang='en') {
    const optText = options.map(o => `${o.letter}. ${o.text}`).join('\n');
    if (lang === 'ru') {
        return `Вопрос:\n${q}\n\nВарианты:\n${optText}\n\nВыбери ОДИН лучший вариант и верни строгий JSON по схеме.`;
    } else if (lang === 'uk') {
        return `Питання:\n${q}\n\nВаріанти:\n${optText}\n\nОбери ОДИН найкращий варіант і поверни суворий JSON за схемою.`;
    }
    return `Question:\n${q}\n\nOptions:\n${optText}\n\nPick ONE best option and return strict JSON per schema.`;
}

async function askModel(model, q, options, lang) {
    const res = await askVisionSafe({
        model,
        temperature: 0,
        max_output_tokens: 500,
        response_format: { type: "json_schema", json_schema: ansSchema },
        input: [
            { role: 'system', content: 'You carefully solve MCQs. Think step-by-step, but output ONLY JSON.' },
            { role: 'user',   content: [{ type: 'input_text', text: buildPrompt(q, options, lang) }] }
        ]
    });
    let raw = (res.output_text || '').trim();
    const m = raw.match(/\{[\s\S]*\}/);
    raw = m ? m[0] : raw;
    try { return JSON.parse(raw); } catch { return null; }
}

export async function solveMcq(ocr, lang='en') {
    if (!ocr || !ocr.question || !Array.isArray(ocr.options) || ocr.options.length < 2) return null;

    // первичный прогон
    let out = await askModel(PRIMARY, ocr.question, ocr.options, lang);

    // fallback, если низкая уверенность/пусто
    if (!out || typeof out.confidence !== 'number' || out.confidence < THR) {
        try {
            const out2 = await askModel(FALLBACK, ocr.question, ocr.options, lang);
            if (out2 && typeof out2.confidence === 'number' &&
                (!out || out2.confidence >= (out.confidence || 0))) {
                out = out2;
            }
        } catch {}
    }

    // валидация: ответ должен совпадать с одной из опций
    if (out && out.answer_letter) {
        const letter = String(out.answer_letter).toUpperCase();
        const match = ocr.options.find(o => o.letter === letter);
        if (match) {
            // подстрахуем текст точным вариантом
            out.answer_letter = letter;
            out.answer_text = match.text;
        }
    }
    return out;
}
