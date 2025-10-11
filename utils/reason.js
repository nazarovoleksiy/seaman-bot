// utils/reason.js
import { MODELS, requestWithRetries } from './ai.js';

// Решение MCQ по распознанным данным
export async function solveMcq(ocr, lang = 'en') {
    const { question, options } = ocr || {};
    if (!question || !Array.isArray(options) || options.length < 2) return null;

    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, Math.min(options.length, 26)).split('');
    const numbered = options.map((t, i) => `${letters[i]}. ${t}`).join('\n');

    const sys = lang === 'ru'
        ? `Ты — преподаватель. Выбери только один правильный вариант и объясни кратко почему. Верни строго JSON:
{
  "answer_letter": "A|B|C|...",
  "answer_text": "строка",
  "explanation": "1–2 предложения",
  "confidence": 0..1
}`
        : lang === 'uk'
            ? `Ти — викладач. Обери лише один правильний варіант і коротко поясни чому. Поверни лише JSON:
{
  "answer_letter": "A|B|C|...",
  "answer_text": "рядок",
  "explanation": "1–2 речення",
  "confidence": 0..1
}`
            : `You are a teacher. Pick exactly one correct option and briefly explain why. Return strict JSON only:
{
  "answer_letter": "A|B|C|...",
  "answer_text": "string",
  "explanation": "1–2 short sentences",
  "confidence": 0..1
}`;

    const prompt = [
        `Question:\n${question}`,
        `Options:\n${numbered}`,
        `Rules: choose exactly ONE option; be concise; answer as JSON only.`,
    ].join('\n\n');

    // Строгое JSON через json_object (короче и совместимее)
    const req = {
        model: MODELS.REASON,
        input: [
            { role: 'system', content: sys },
            { role: 'user',   content: [{ type: 'input_text', text: prompt }] }
        ],
        text: { format: { type: 'json_object' } }
    };

    const r = await requestWithRetries(req, { tries: 2 });
    const raw = r?.output_text || r?.output?.[0]?.content?.[0]?.text || '';
    const out = safeParse(raw);

    if (!out || !out.answer_letter || !out.answer_text) return null;

    // нормализуем букву и уверенность
    out.answer_letter = String(out.answer_letter).trim().toUpperCase();
    if (typeof out.confidence !== 'number') out.confidence = 0.75;

    return out;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
