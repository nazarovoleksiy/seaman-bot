// utils/reason.js
import { askTextSafe } from './ai.js';

// Подтягиваем модели (можно оставить дефолты)
const REASON_MODEL   = (process.env.REASON_MODEL   || 'gpt-4o-mini').trim().replace(/^=+/, '');
const FALLBACK_MODEL = (process.env.ANSWER_MODEL_FALLBACK || 'gpt-4.1-mini').trim().replace(/^=+/, '');

function toLetter(i) {
    return String.fromCharCode(65 + i); // A,B,C,...
}

async function reasonOnce(ocr, lang = 'en', model = REASON_MODEL) {
    const { question, options } = ocr || {};
    if (!question || !Array.isArray(options) || options.length < 2) return null;

    const optsBlock = options.map((t, i) => `${toLetter(i)}. ${t}`).join('\n');

    const sys =
        lang === 'ru'
            ? `Ты — строгий экзаменационный ассистент. Выбери вариант правильного ответа и кратко объясни почему. Верни ТОЛЬКО JSON.`
            : lang === 'uk'
                ? `Ти — суворий екзаменаційний асистент. Обери вариант правильної відповіді і коротко поясни чому. Поверни ЛИШЕ JSON.`
                : `You are a strict exam assistant. Pick  correct option letter and briefly explain why. Return JSON ONLY.`;

    const user =
        `${lang === 'ru' ? 'Вопрос' : lang === 'uk' ? 'Питання' : 'Question'}:
${question}

${lang === 'ru' ? 'Варианты' : lang === 'uk' ? 'Варіанти' : 'Options'}:
${optsBlock}

${lang === 'ru'
            ? 'Верни JSON: {"answer_letter":"A|B|C|...","answer_text":"...","explanation":"...","confidence":0..1}'
            : lang === 'uk'
                ? 'Поверни JSON: {"answer_letter":"A|B|C|...","answer_text":"...","explanation":"...","confidence":0..1}'
                : 'Return JSON: {"answer_letter":"A|B|C|...","answer_text":"...","explanation":"...","confidence":0..1}'}`;

    const req = {
        model,
        temperature: 0.2,
        input: [
            { role: 'system', content: sys },
            { role: 'user',   content: [{ type: 'input_text', text: user }] }
        ],
        // Responses API: правильный формат
        text: { format: { type: 'json_object' } }
    };

    try {
        const res = await askTextSafe(req);
        const raw = (res?.output_text || '').trim();
        if (!raw) return null;

        let data;
        try { data = JSON.parse(raw); }
        catch {
            const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/,'').trim();
            data = JSON.parse(cleaned);
        }

        if (!data) return null;
        if (typeof data.answer_letter !== 'string' || typeof data.answer_text !== 'string') return null;

        data.answer_letter = data.answer_letter.trim().slice(0,1).toUpperCase();
        if (typeof data.explanation !== 'string') data.explanation = '';
        if (typeof data.confidence !== 'number') data.confidence = 0.75;

        return data;
    } catch (e) {
        // Фолбэк на запасную модель
        if (model !== FALLBACK_MODEL) {
            try { return await reasonOnce(ocr, lang, FALLBACK_MODEL); } catch {}
        }
        console.error('reasonOnce error:', e);
        return null;
    }
}

// Малая "ансамблевая" логика: несколько прогонов и голосование
export async function reasonWithConsensus(ocr, lang = 'en', nRuns = 3) {
    const runs = [];
    for (let i = 0; i < nRuns; i++) {
        // первые прогоны основной моделью, последний — фолбэком для разнообразия
        const model = i < nRuns - 1 ? REASON_MODEL : FALLBACK_MODEL;
        // eslint-disable-next-line no-await-in-loop
        const r = await reasonOnce(ocr, lang, model);
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
        confidence
    };
}

// Алиас для обратной совместимости
export async function solveMcq(ocr, lang) {
    return reasonWithConsensus(ocr, lang, 1);
}
