// utils/reason.js
import { askTextSafe } from './ai.js';

const REASON_MODEL   = process.env.REASON_MODEL   || 'o4-mini';
const VALIDATE_MODEL = process.env.VALIDATE_MODEL || 'gpt-4.1-mini';

function normLetter(s) {
    return String(s || '').toUpperCase().replace(/[^A-F]/g, '');
}
function letterSet(options) {
    return new Set((options || []).map(o => normLetter(o.letter)).filter(Boolean));
}

async function chooseAnswer({ question, options, lang='en' }) {
    const letters = letterSet(options);
    const listTxt = options.map(o => `${o.letter}) ${o.text}`).join('\n');

    const sys =
        'You solve MCQs. Pick EXACTLY ONE letter that exists in options. ' +
        'Return ONLY JSON: {"letter":"A|B|C|D|E|F","confidence":0..1,"explanation":string}';

    const user =
        lang === 'ru'
            ? `Вопрос:\n${question}\n\nВарианты:\n${listTxt}`
            : lang === 'uk'
                ? `Питання:\n${question}\n\nВаріанти:\n${listTxt}`
                : `Question:\n${question}\n\nOptions:\n${listTxt}`;

    const res = await askTextSafe({
        model: REASON_MODEL,
        temperature: 0.2,
        text: { format: { type: 'json_object' } }, // <-- фикс: json_object
        input: [
            { role: 'system', content: sys },
            { role: 'user',   content: user }
        ]
    });

    let obj = {};
    try { obj = JSON.parse((res.output_text || '{}').trim()); } catch {}
    obj.letter = normLetter(obj.letter);
    if (!letters.has(obj.letter)) obj.letter = '';
    obj.confidence = Math.max(0, Math.min(1, Number(obj.confidence) || 0.5));
    return { letter: obj.letter, confidence: obj.confidence, explanation: obj.explanation || '' };
}

async function selfCheck({ question, options, chosenLetter, lang='en' }) {
    const letters = letterSet(options);
    const listTxt = options.map(o => `${o.letter}) ${o.text}`).join('\n');

    const sys =
        'Validate MCQ answer. If the chosen letter is not best, suggest a better one ONLY from options. ' +
        'Return ONLY JSON: {"ok":true|false,"better":"A|B|C|D|E|F|null"}';

    const user =
        lang === 'ru'
            ? `Проверь ответ.\nВопрос:\n${question}\n\nВарианты:\n${listTxt}\n\nВыбрано: ${chosenLetter}`
            : lang === 'uk'
                ? `Перевір відповідь.\nПитання:\n${question}\n\nВаріанти:\n${listTxt}\n\nОбрано: ${chosenLetter}`
                : `Validate.\nQuestion:\n${question}\n\nOptions:\n${listTxt}\n\nChosen: ${chosenLetter}`;

    const res = await askTextSafe({
        model: VALIDATE_MODEL,
        temperature: 0,
        text: { format: { type: 'json_object' } }, // <-- фикс: json_object
        input: [
            { role: 'system', content: sys },
            { role: 'user',   content: user }
        ]
    });

    try {
        const obj = JSON.parse((res.output_text || '{}').trim());
        const b = normLetter(obj.better);
        return { ok: !!obj.ok, better: letters.has(b) ? b : null };
    } catch {
        return { ok: true, better: null };
    }
}

/**
 * reasonWithConsensus -> согласование/проверка ответа
 */
export async function reasonWithConsensus({ question, options, lang='en' }) {
    const first = await chooseAnswer({ question, options, lang });
    if (first.letter && first.confidence >= 0.65) {
        const opt = options.find(o => o.letter === first.letter);
        return {
            letter: first.letter,
            confidence: first.confidence,
            explanation: first.explanation || '',
            text: opt ? opt.text : ''
        };
    }

    const check = await selfCheck({ question, options, chosenLetter: first.letter, lang });
    if (!check.ok && check.better) {
        const opt = options.find(o => o.letter === check.better);
        return {
            letter: check.better,
            confidence: Math.max(0.7, first.confidence || 0.5),
            explanation: first.explanation || '',
            text: opt ? opt.text : ''
        };
    }

    const second = await chooseAnswer({ question, options, lang });
    const pick = (second.confidence > first.confidence ? second : first);
    const opt = options.find(o => o.letter === pick.letter);
    return {
        letter: pick.letter || (options[0]?.letter || 'A'),
        confidence: pick.confidence ?? 0.5,
        explanation: pick.explanation || '',
        text: opt ? opt.text : (options[0]?.text || '')
    };
}

// адаптер под твой photo.js
export async function solveMcq(ocr, lang='en') {
    const r = await reasonWithConsensus({ question: ocr.question, options: ocr.options, lang });
    return {
        answer_letter: r.letter,
        answer_text:   r.text,
        confidence:    r.confidence,
        explanation:   r.explanation
    };
}
