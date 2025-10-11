// utils/ai.js
import OpenAI from 'openai';

export const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// — нормализуем имена моделей из .env (убираем случайные '=' и пробелы)
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

// Универсальный ретрай для Responses API (текст/визуал — одинаково через responses.create)
export async function requestWithRetries(req, { tries = 2, backoffMs = 400 } = {}) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
        try {
            // В Responses API все модальности передаются внутри req.input[]
            return await ai.responses.create(req);
        } catch (e) {
            lastErr = e;

            // Форматные ошибки (например, неправильный text.format) не лечим ретраем — пусть ловятся выше
            const code = String(e?.code || '');
            if (code.includes('invalid') || code.includes('unknown')) {
                throw e;
            }

            if (i < tries - 1) await delay(backoffMs * (i + 1));
        }
    }
    throw lastErr;
}

// ---- Врапперы, чтобы импорты в остальных модулях были корректны ----
export async function askTextSafe(req) {
    // req: { model, input:[{role:'system',content:...},{role:'user',content:...}], text?:{format?...} }
    return requestWithRetries(req);
}

export async function askVisionSafe(req) {
    // тот же Responses API, просто в req.input будет объект типа { type:'input_image', image_url: ... }
    return requestWithRetries(req);
}
