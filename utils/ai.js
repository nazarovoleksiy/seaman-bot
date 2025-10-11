// utils/ai.js
import OpenAI from 'openai';

export const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ------------ параллелизм ------------
let running = 0;
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY || 5);

export async function withConcurrency(fn) {
    if (running >= MAX_CONCURRENCY) throw new Error('Overloaded');
    running++;
    try { return await fn(); } finally { running--; }
}

// ------------ таймаут + ретраи ------------
function withTimeout(promise, ms = 25_000) {
    let t;
    const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('Timeout')), ms); });
    return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function requestWithRetries(makeReq, { tries = 2, timeoutMs = 25_000, backoffMs = 600 } = {}) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
        try {
            return await withTimeout(makeReq(), timeoutMs);
        } catch (e) {
            lastErr = e;
            if (e?.message === 'Overloaded') throw e;
            if (i === tries - 1) break;
            await sleep(backoffMs * (i + 1));
        }
    }
    throw lastErr;
}

// ------------ публичные обёртки ------------
export async function askVisionSafe(req) {
    return requestWithRetries(() => ai.responses.create(req));
}

export async function askTextSafe(req) {
    return requestWithRetries(() => ai.responses.create(req));
}
