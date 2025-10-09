import OpenAI from 'openai';
export const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let running = 0;
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY || 5);

export async function withConcurrency(fn) {
    if (running >= MAX_CONCURRENCY) throw new Error('Overloaded');
    running++;
    try { return await fn(); }
    finally { running--; }
}

export async function withTimeout(promise, ms = 25000) {
    let t;
    const timer = new Promise((_, rej) => (t = setTimeout(() => rej(new Error('Timeout')), ms)));
    try { return await Promise.race([promise, timer]); }
    finally { clearTimeout(t); }
}

export async function askVisionSafe(req) {
    try   { return await withTimeout(ai.responses.create(req), 25000); }
    catch { return await withTimeout(ai.responses.create(req), 25000); }
}
