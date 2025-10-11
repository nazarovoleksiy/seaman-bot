// utils/reason.js
// Надёжный reasoner с ансамблем, текстовым сопоставлением и vision-one-shot фолбэком.

import { requestWithRetries } from './ai.js';

// --- модели (убираем случайные "=" из значения env)
const REASON_MODEL =
    (process.env.REASON_MODEL || 'gpt-4o-mini').trim().replace(/^=+/, '');
const FALLBACK_MODEL =
    (process.env.ANSWER_MODEL_FALLBACK || 'gpt-4.1-mini').trim().replace(/^=+/, '');
const VISION_MODEL_FOR_FALLBACK =
    (process.env.OCR_MODEL || 'gpt-4o-mini').trim().replace(/^=+/, '');

function toLetter(i) { return String.fromCharCode(65 + i); }            // 0 -> A
function fromLetter(ch) {
    if (!ch) return -1;
    const m = String(ch).trim().match(/[A-Za-z]/);
    if (!m) return -1;
    const k = m[0].toUpperCase().charCodeAt(0) - 65;
    return k >= 0 ? k : -1;
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function buildPrompt(ocr, lang='en') {
    const { question, options = [] } = ocr || {};
    const optsBlock = options.map((t, i) => `${toLetter(i)}. ${t}`).join('\n');

    const hdrQ = lang==='ru' ? 'Вопрос' : lang==='uk' ? 'Питання' : 'Question';
    const hdrO = lang==='ru' ? 'Варианты' : lang==='uk' ? 'Варіанти' : 'Options';

    const instr =
        lang==='ru'
            ? `Ты — строгий экзаменационный ассистент. У тебя от 2 до 10 вариантов.
Выбери строго ОДНУ букву правильного варианта и кратко объясни почему.
Верни ТОЛЬКО JSON.`
            : lang==='uk'
                ? `Ти — суворий екзаменаційний асистент. Є від 2 до 10 варіантів.
Обери рівно ОДНУ літеру правильної відповіді та коротко поясни чому.
Поверни ЛИШЕ JSON.`
                : `You are a strict exam assistant. There are 2..10 options.
Pick exactly ONE correct letter and briefly explain why.
Return JSON ONLY.`;

    const schemaLine =
        lang==='ru'
            ? `Схема JSON: {"answer_letter":"A|B|C|...","answer_text":"...","explanation":"...","confidence":0..1}`
            : lang==='uk'
                ? `Схема JSON: {"answer_letter":"A|B|C|...","answer_text":"...","explanation":"...","confidence":0..1}`
                : `JSON schema: {"answer_letter":"A|B|C|...","answer_text":"...","explanation":"...","confidence":0..1}`;

    const user =
        `${hdrQ}:
${question}

${hdrO}:
${optsBlock}

${schemaLine}`;

    return { system: instr, user };
}

function cleanJsonText(raw) {
    let t = (raw || '').trim();
    t = t.replace(/^```(?:json|jsonc)?\s*/i, '').replace(/```$/, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a !== -1 && b !== -1 && b > a) t = t.slice(a, b + 1);
    return t;
}

async function reasonOnce(ocr, lang='en', model=REASON_MODEL, temperature=0.2) {
    const { question, options } = ocr || {};
    if (!question || !Array.isArray(options) || options.length < 2) return null;

    const { system, user } = buildPrompt(ocr, lang);

    const req = {
        model,
        temperature,
        input: [
            { role: 'system', content: system },
            { role: 'user', content: [{ type: 'input_text', text: user }] }
        ],
        // Responses API: просим именно JSON-объект
        text: { format: { type: 'json_object' } }
    };

    try {
        const res = await requestWithRetries(req, { tries: 2, backoffMs: 500 });
        const raw = cleanJsonText(res?.output_text || '');
        if (!raw) return null;

        let data;
        try { data = JSON.parse(raw); }
        catch { return null; }

        let idx = fromLetter(data.answer_letter);
        if (idx < 0) return null;
        idx = clamp(idx, 0, options.length - 1);

        return {
            answer_letter: toLetter(idx),
            answer_text: options[idx],                               // строго из набора
            explanation: typeof data.explanation === 'string' ? data.explanation.trim() : '',
            confidence: typeof data.confidence === 'number'
                ? Math.max(0, Math.min(1, data.confidence))
                : 0.6
        };
    } catch (e) {
        if (model !== FALLBACK_MODEL) {
            try { return await reasonOnce(ocr, lang, FALLBACK_MODEL, temperature); } catch {}
        }
        console.error('reasonOnce error:', e?.message || e);
        return null;
    }
}

// --- лёгкий ансамбль (несколько прогонов + голосование) ---
export async function reasonWithConsensus(ocr, lang='en', nRuns=3) {
    const temps = [0.2, 0.35, 0.5];
    const runs = [];
    for (let i = 0; i < nRuns; i++) {
        const model = i < nRuns - 1 ? REASON_MODEL : FALLBACK_MODEL;
        const t = temps[i % temps.length];
        // eslint-disable-next-line no-await-in-loop
        const r = await reasonOnce(ocr, lang, model, t);
        if (r) runs.push(r);
    }
    if (runs.length === 0) return null;

    const count = new Map();
    for (const r of runs) count.set(r.answer_letter, (count.get(r.answer_letter) || 0) + 1);

    let best = null, votes = -1;
    for (const [letter, v] of count.entries()) {
        if (v > votes) { votes = v; best = letter; }
    }
    const winner = runs.find(r => r.answer_letter === best) || runs[0];
    const confidence = votes / runs.length;

    return {
        answer_letter: winner.answer_letter,
        answer_text:   winner.answer_text,
        explanation:   winner.explanation,
        confidence,
        lowConfidence: confidence < (Number(process.env.LOW_CONFIDENCE_THRESHOLD || 0.6))
    };
}

// --- вспомогательное сопоставление по тексту (когда буква не сошлась) ---
function normalize(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .trim();
}
export function pickOptionByText(answerText, options) {
    const tgt = normalize(answerText);
    if (!tgt) return -1;
    const tgtWords = new Set(tgt.split(' '));
    let best = -1, bestScore = -1;

    options.forEach((opt, idx) => {
        const ow = new Set(normalize(opt).split(' '));
        let inter = 0;
        for (const w of tgtWords) if (ow.has(w)) inter++;
        const score = inter / Math.max(1, Math.min(tgtWords.size, ow.size));
        if (score > bestScore) { bestScore = score; best = idx; }
    });

    return bestScore > 0.1 ? best : -1;
}

// --- vision-one-shot: отвечаем по картинке напрямую (когда OCR/парсинг подвёл) ---
export async function visionOneShotSolve(imageUrl, ocr, lang='en', model=VISION_MODEL_FOR_FALLBACK) {
    const optsBlock = (ocr?.options || []).map((t,i)=>`${toLetter(i)}. ${t}`).join('\n');
    const sys = lang==='ru'
        ? 'Ты — преподаватель. По картинке и списку вариантов выбери ОДИН правильный вариант. Верни ТОЛЬКО JSON.'
        : lang==='uk'
            ? 'Ти — викладач. За зображенням і списком варіантів обери ОДИН правильний. Поверни ЛИШЕ JSON.'
            : 'You are a teacher. Using the image and options, choose ONE correct option. Return JSON ONLY.';

    const user =
        `${lang==='ru' ? 'Вопрос на изображении. Варианты ниже' : 'Question is on the image. Options below'}:
${optsBlock}

${lang==='ru'
            ? 'JSON: {"answer_letter":"A|B|C|...","explanation":"..."}'
            : 'JSON: {"answer_letter":"A|B|C|...","explanation":"..."}'}`;

    const req = {
        model,
        temperature: 0.2,
        input: [
            { role: 'system', content: sys },
            { role: 'user', content: [
                    { type: 'input_image', image_url: imageUrl },
                    { type: 'input_text',  text: user }
                ] }
        ],
        text: { format: { type: 'json_object' } }
    };

    try {
        const res = await requestWithRetries(req, { tries: 2, backoffMs: 500 });
        const raw = (res?.output_text || '')
            .replace(/^```json\s*/i,'').replace(/```$/,'').trim();
        if (!raw) return null;
        const data = JSON.parse(raw);

        const letter = String(data.answer_letter || '').trim().slice(0,1).toUpperCase();
        const idx = fromLetter(letter);
        if (idx < 0 || idx >= (ocr?.options?.length || 0)) return null;

        return {
            answer_letter: letter,
            answer_text: ocr.options[idx],
            explanation: typeof data.explanation==='string' ? data.explanation : '',
            confidence: 0.55
        };
    } catch (e) {
        console.error('visionOneShotSolve error:', e?.message || e);
        return null;
    }
}

// --- алиас для обратной совместимости со старым кодом ---
export async function solveMcq(ocr, lang) {
    return reasonWithConsensus(ocr, lang, 1);
}
