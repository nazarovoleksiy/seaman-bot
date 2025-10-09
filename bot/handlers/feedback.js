// bot/handlers/feedback.js
import { saveFeedback, getLang } from '../../db/database.js';

const pending = new Map(); // userId -> ждём текст отзыва

export function registerFeedbackHandler(bot) {
    bot.command('feedback', async (ctx) => {
        pending.set(ctx.from.id, true);
        const lang = getLang(ctx.from.id);
        await ctx.reply(
            lang === 'ru'
                ? '💬 Напиши свой отзыв следующим сообщением.'
                : '💬 Please write your feedback in the next message.'
        );
    });

    // ВАЖНО: пропускаем дальше, если мы НЕ в режиме ожидания отзыва
    bot.on('text', async (ctx, next) => {
        const uid = ctx.from.id;

        // команды всегда пропускаем дальше
        if (ctx.message?.text?.startsWith('/')) return next();

        if (!pending.has(uid)) return next(); // ← вот это ключевое

        pending.delete(uid);
        const text = ctx.message.text?.trim();
        if (!text) return next();

        saveFeedback(uid, ctx.from.username, text);

        const lang = getLang(uid);
        await ctx.reply(lang === 'ru' ? '🙏 Спасибо за отзыв!' : '🙏 Thanks for your feedback!');
    });
}
