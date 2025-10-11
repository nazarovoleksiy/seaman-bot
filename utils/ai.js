// utils/ai.js
import OpenAI from 'openai';

export const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// — нормализуем имена моделей из .env
function cleanModel(name, def) {
    return (name || def).toString().trim().replace(/^=+/, '');
}

export const MODELS = {
    OCR:      cleanModel(process.env.OCR_MODEL,      'gpt-4o-mini'),
    REASON:   cleanModel(process.env.REASON_MODEL,   'gpt-4o-mini'),
    VALIDATE: cleanModel(process.env.VALIDATE_MODEL, 'gpt-4.1-mini'),
};

let running = 0;
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY || 5);

export async function withConcurrency(fn) {
    if (running >= MAX_CONCURRENCY) throw new Error('Overloaded');
    running++;
    try { return await fn(); } finally { running--; }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Универсальный ретрай для responses.create
export async function requestWithRetries(req, { tries = 2, backoffMs = 400 } = {}) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
        try {
            // Внимание: в Responses API все модальности внутри input[]
            return await ai.responses.create(req);
        } catch (e) {
            lastErr = e;
            // Если ошибка формата (например, text.format), даём шанс фолбэку снаружи
            if (String(e?.code || '').includes('invalid') || String(e?.code || '').includes('unknown')) {
                throw e;
            }
            if (i < tries - 1) await delay(backoffMs * (i + 1));
        }
    }
    throw lastErr;
}
