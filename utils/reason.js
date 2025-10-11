// utils/reason.js
import { askTextSafe } from './ai.js';

const REASON_MODEL   = process.env.REASON_MODEL   || 'o4-mini';
const VALIDATE_MODEL = process.env.VALIDATE_MODEL || 'gpt-4.1-mini';

const ansSchema = {
    name: 'mcq_answer',
    schema: {
        type: 'object',
        properties: {
            letter:      { type: 'string', enum: ['A','B','C','D','E','F'] },
            confidence:  { type: 'number' },
            explanation: { type: 'string' }
        },
        required: ['letter','confidence'],
        additionalProperties: false
    },
    strict: true
};

const valSchema = {
    name: 'mcq_validate',
    schema: {
        type: 'object',
        properties: {
            ok:     { type: 'boolean' },
            better: { type: ['string','null'], enum: ['A','B','C','D','E','F', null] }
        },
        required: ['ok','better'],
        additionalProperties: false
    },
    strict: true
};

function normalizeLetter(s) {
    return String(s || '').toUpperCase().replace(/[^A-F]/g, '');
}
function lettersFromOptions(options) {
    return new Set((options || []).map(o => normalizeLetter(o.letter)).filter(Boolean));
}

export async function chooseAnswer({ question, options, lang='en' }) {
    const letters = lettersFromOptions(options);
    const listTxt = options.map(o => `${o.letter}) ${o.text}`).join('\n');

    const sys =
        'You solve MCQs. Pick EXACTLY ONE letter that exists in options. Output STRICT JSON per schema.';
    const user =
        lang === 'ru'
            ? `Вопрос:\n${question}\n\nВарианты:\n${listTxt}`
            : lang === 'uk'
                ? `Питання:\n${question}\n\nВаріанти:\n${listTxt}`
                : `Question:\n${question}\n\nOptions:\n${listTxt}`;

    const res = await askTextSafe({
        model: REASON_MODEL,
        temperature: 0.2,
        text: { format: 'json' },
        input: [
            { role: 'system', content:
                    'You solve MCQs. Pick EXACTLY ONE letter that exists in options. ' +
                    'Return ONLY JSON: {"letter":"A|B|C|D|E|F","confidence":0..1,"explanation":string}'
            },
            { role: 'user',   content: user }
        ]
    });

    let obj = {};
    try { obj = JSON.parse((res.output_text || '{}').trim()); } catch {}
    obj.letter = normalizeLetter(obj.letter);
    if (!letters.has(obj.letter)) obj.letter = '';
    obj.confidence = Math.max(0, Math.min(1, Number(obj.confidence) || 0.5));
    return { letter: obj.letter, confidence: obj.confidence, explanation: obj.explanation || '' };
}

export async function selfCheck({ question, options, chosenLetter, lang='en' }) {
    const letters = lettersFromOptions(options);
    const listTxt = options.map(o => `${o.letter}) ${o.text}`).join('\n');

    const sys = 'Validate MCQ answer. If chosen letter is not best, suggest a better one from options. JSON per schema.';
    const user =
        lang === 'ru'
            ? `Проверь ответ.\nВопрос:\n${question}\n\nВарианты:\n${listTxt}\n\nВыбрано: ${chosenLetter}`
            : lang === 'uk'
                ? `Перевір відповідь.\nПитання:\n${question}\n\nВаріанти:\n${listTxt}\n\nОбрано: ${chosenLetter}`
                : `Validate.\nQuestion:\n${question}\n\nOptions:\n${listTxt}\n\nChosen: ${chosenLetter}`;

    const res = await askTextSafe({
        model: VALIDATE_MODEL,
        temperature: 0,
        text: { format: 'json' },
        input: [
            { role: 'system', content:
                    'Validate MCQ answer. If the chosen letter is not best, suggest a better one ONLY from options. ' +
                    'Return ONLY JSON: {"ok":true|false,"better":"A|B|C|D|E|F|null"}'
            },
            { role: 'user',   content: user }
        ]
    });

    try {
        const obj = JSON.parse((res.output_text || '{}').trim());
        const b = normalizeLetter(obj.better);
        return { ok: !!obj.ok, better: letters.has(b) ? b : null };
    } catch {
        return { ok: true, better: null };
    }
}

export async function reasonWithConsensus({ question, options, lang='en' }) {
    const first = await chooseAnswer({ question, options, lang });
    if (first.letter && first.confidence >= 0.65) return first;

    const check = await selfCheck({ question, options, chosenLetter: first.letter, lang });
    if (!check.ok && check.better) {
        return { letter: check.better, confidence: Math.max(0.7, first.confidence || 0.5), explanation: first.explanation || '' };
    }

    const second = await chooseAnswer({ question, options, lang });
    if (second.letter && second.letter === first.letter) {
        return {
            letter: first.letter,
            confidence: Math.max(first.confidence, second.confidence, 0.7),
            explanation: first.explanation || second.explanation || ''
        };
    }
    return (second.confidence > first.confidence ? second : first);
}
