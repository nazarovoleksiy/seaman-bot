// utils/reason.js
import { ai } from './ai.js';

const REASON_MODEL   = process.env.REASON_MODEL   || 'o4-mini';        // логика
const VALIDATE_MODEL = process.env.VALIDATE_MODEL || 'gpt-4.1-mini';    // быстрый чек

function normalizeLetter(s) {
    return String(s || '').toUpperCase().replace(/[^A-F]/g, '');
}
function lettersFromOptions(options) {
    return new Set((options || []).map(o => normalizeLetter(o.letter)).filter(Boolean));
}

async function askTextSafe(req) {
    return ai.responses.create(req);
}

export async function chooseAnswer({ question, options, lang = 'en' }) {
    const letters = lettersFromOptions(options);
    const listTxt = options.map(o => `${o.letter}) ${o.text}`).join('\n');

    const sys = 'You are a strict multiple-choice solver. Pick EXACTLY ONE letter from provided options. Output ONLY JSON.';
    const user =
        (lang === 'ru'
            ? `Вопрос:\n${question}\n\nВарианты:\n${listTxt}\n\nОтветь JSON: {"letter":"A|B|C|D|E|F","confidence":0..1,"explanation":"кратко"}`
            : lang === 'uk'
                ? `Питання:\n${question}\n\nВаріанти:\n${listTxt}\n\nJSON: {"letter":"A|B|C|D|E|F","confidence":0..1,"explanation":"коротко"}`
                : `Question:\n${question}\n\nOptions:\n${listTxt}\n\nJSON only: {"letter":"A|B|C|D|E|F","confidence":0..1,"explanation":"short"}`);

    const res = await askTextSafe({
        model: REASON_MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        input: [
            { role: 'system', content: sys },
            { role: 'user',   content: user }
        ]
    });

    let obj; try { obj = JSON.parse((res.output_text || '{}').trim()); } catch { obj = {}; }
    obj.letter = normalizeLetter(obj.letter);
    if (!letters.has(obj.letter)) obj.letter = '';

    if (!obj.letter) {
        const allowed = [...letters].join(',');
        const res2 = await askTextSafe({
            model: REASON_MODEL,
            temperature: 0,
            response_format: { type: 'json_object' },
            input: [
                { role: 'system', content: sys },
                { role: 'user', content:
                        (lang==='ru'
                                ? `Выбери букву только из: ${allowed}. Верни JSON {"letter":"...","confidence":0..1}.`
                                : lang==='uk'
                                    ? `Обери літеру лише з: ${allowed}. JSON {"letter":"...","confidence":0..1}.`
                                    : `Choose a letter only from: ${allowed}. JSON {"letter":"...","confidence":0..1}.`
                        )
                }
            ]
        });
        try {
            const o2 = JSON.parse((res2.output_text || '{}').trim());
            obj.letter = normalizeLetter(o2.letter);
            obj.confidence = Number(o2.confidence) || 0.5;
        } catch {}
        if (!letters.has(obj.letter)) obj.letter = [...letters][0] || '';
    }

    obj.confidence = Math.max(0, Math.min(1, Number(obj.confidence) || 0.5));
    return { letter: obj.letter, confidence: obj.confidence, explanation: obj.explanation || '' };
}

export async function selfCheck({ question, options, chosenLetter, lang='en' }) {
    const letters = lettersFromOptions(options);
    const listTxt = options.map(o => `${o.letter}) ${o.text}`).join('\n');

    const sys = 'You validate an MCQ answer. If chosen letter is not best, suggest a better letter that exists in options. JSON only.';
    const user =
        (lang==='ru'
            ? `Проверь ответ.\nВопрос:\n${question}\n\nВарианты:\n${listTxt}\n\nВыбрано: ${chosenLetter}\nВерни JSON: {"ok":true|false,"better":"A|B|C|D|E|F|null"}`
            : lang==='uk'
                ? `Перевір відповідь.\nПитання:\n${question}\n\nВаріанти:\n${listTxt}\n\nОбрано: ${chosenLetter}\nJSON: {"ok":true|false,"better":"A|B|C|D|E|F|null"}`
                : `Validate.\nQuestion:\n${question}\n\nOptions:\n${listTxt}\n\nChosen: ${chosenLetter}\nJSON: {"ok":true|false,"better":"A|B|C|D|E|F|null"}`);

    const res = await askTextSafe({
        model: VALIDATE_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        input: [
            { role: 'system', content: sys },
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
    if (first.confidence >= 0.65) return first;

    const check = await selfCheck({ question, options, chosenLetter: first.letter, lang });
    if (!check.ok && check.better) {
        return { letter: check.better, confidence: 0.7, explanation: first.explanation || '' };
    }

    const second = await chooseAnswer({ question, options, lang });
    if (second.letter && second.letter === first.letter) {
        return { letter: first.letter, confidence: Math.max(first.confidence, second.confidence, 0.7), explanation: first.explanation || second.explanation || '' };
    }
    return (second.confidence > first.confidence ? second : first);
}
