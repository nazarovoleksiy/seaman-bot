// utils/reason.js
import { askTextSafe } from './ai.js';

const REASON_MODEL   = (process.env.REASON_MODEL || 'gpt-4o-mini').trim().replace(/^=+/, '');
const FALLBACK_MODEL = (process.env.ANSWER_MODEL_FALLBACK || 'gpt-4.1-mini').trim().replace(/^=+/, '');

function toLetter(i) { return String.fromCharCode(65 + i); }             // 0->A, 1->B, ...
function fromLetter(ch){                                                  // 'A'|'b' -> 0,1,...
    if (!ch) return -1;
    const m = String(ch).trim().match(/[A-Za-z]/);
    if (!m) return -1;
    const code = m[0].toUpperCase().charCodeAt(0) - 65;
    return code >= 0 ? code : -1;
}
function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }

function buildPrompt(ocr, lang='en'){
    const { question, options=[] } = ocr || {};
    const optsBlock = options.map((t,i)=>`${toLetter(i)}. ${t}`).join('\n');
    const hdrQ = lang==='ru' ? 'Вопрос' : lang==='uk' ? 'Питання' : 'Question';
    const hdrO = lang==='ru' ? 'Варианты' : lang==='uk' ? 'Варіанти' : 'Options';
    const instr =
        lang==='ru'
            ? `Ты — строгий экзаменационный ассистент. У тебя от 2 до 10 вариантов ответа.
Выбери строго ОДНУ букву правильного варианта и коротко объясни почему.
Верни ТОЛЬКО JSON.`
            : lang==='uk'
                ? `Ти — суворий екзаменаційний асистент. Є від 2 до 10 варіантів.
Обери рівно ОДНУ літеру правильної відповіді та коротко поясни чому.
Поверни ЛИШЕ JSON.`
                : `You are a strict exam assistant. There are 2..10 options.
Pick exactly ONE correct letter and briefly explain why.
Return JSON ONLY.`;

    const jsonLine =
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

${jsonLine}`;

    return { system: instr, user };
}

function cleanJsonText(raw){
    // вырезаем возможные code fences и комментарии
    let t = (raw || '').trim();
    t = t.replace(/^```(?:json|jsonc)?\s*/i, '').replace(/```$/,'').trim();
    // иногда модель добавляет текст вокруг JSON
    const first = t.indexOf('{');
    const last  = t.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
        t = t.slice(first, last + 1);
    }
    return t;
}

async function reasonOnce(ocr, lang='en', model=REASON_MODEL, temperature=0.2){
    const { question, options } = ocr || {};
    if (!question || !Array.isArray(options) || options.length < 2) return null;

    const { system, user } = buildPrompt(ocr, lang);

    const req = {
        model,
        temperature,
        input: [
            { role: 'system', content: system },
            { role: 'user',   content: [{ type: 'input_text', text: user }] }
        ],
        // Просим Responses API вернуть именно JSON-объект
        text: { format: { type: 'json_object' } }
    };

    try {
        const res  = await askTextSafe(req);
        const raw  = cleanJsonText(res?.output_text || '');
        if (!raw) return null;

        let data;
        try { data = JSON.parse(raw); }
        catch { return null; }

        // Нормализация/валидация
        let idx = fromLetter(data.answer_letter);
        if (idx < 0) return null;
        idx = clamp(idx, 0, options.length - 1);

        const normalized = {
            answer_letter: toLetter(idx),
            answer_text:   options[idx],                        // берём строго из списка!
            explanation:   typeof data.explanation === 'string' ? data.explanation.trim() : '',
            confidence:    typeof data.confidence === 'number' ? Math.max(0, Math.min(1, data.confidence)) : 0.6
        };

        return normalized;
    } catch (e){
        // мягкий фолбэк на запасную модель
        if (model !== FALLBACK_MODEL) {
            try { return await reasonOnce(ocr, lang, FALLBACK_MODEL, temperature); } catch {}
        }
        console.error('reasonOnce error:', e);
        return null;
    }
}

// Небольшой ансамбль: разные температуры для разнообразия ответов
export async function reasonWithConsensus(ocr, lang='en', nRuns=3){
    const temps = [0.2, 0.35, 0.5]; // если прогонов больше — будут по кругу
    const runs = [];
    for (let i=0; i<nRuns; i++){
        const model = i < nRuns - 1 ? REASON_MODEL : FALLBACK_MODEL; // последний прогон — фолбэк
        const t     = temps[i % temps.length];
        // eslint-disable-next-line no-await-in-loop
        const r = await reasonOnce(ocr, lang, model, t);
        if (r) runs.push(r);
    }
    if (runs.length === 0) return null;

    // голосование по буквам
    const count = new Map();
    for (const r of runs) count.set(r.answer_letter, (count.get(r.answer_letter) || 0) + 1);

    let best=null, votes=-1;
    for (const [letter, v] of count.entries()){
        if (v > votes){ votes = v; best = letter; }
    }
    const winner = runs.find(r => r.answer_letter === best) || runs[0];
    const confidence = votes / runs.length;

    return {
        answer_letter: winner.answer_letter,
        answer_text:   winner.answer_text,
        explanation:   winner.explanation,
        confidence,                 // 0..1
        lowConfidence: confidence < (Number(process.env.LOW_CONFIDENCE_THRESHOLD || 0.6))
    };
}

// Алиас для обратной совместимости (/ старые импорты)
export async function solveMcq(ocr, lang){
    return reasonWithConsensus(ocr, lang, 1);
}
