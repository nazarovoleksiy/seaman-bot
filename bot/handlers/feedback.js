import { saveFeedback, getLang } from '../../db/database.js';

const pending = new Map(); // userId -> ждём текст

export function registerFeedbackHandler(bot){
    bot.command('feedback', async (ctx) => {
        pending.set(ctx.from.id, true);
        const lang = getLang(ctx.from.id);
        await ctx.reply(lang==='ru' ? '💬 Напиши отзыв следующим сообщением.' :
            lang==='uk' ? '💬 Напиши відгук наступним повідомленням.' :
                '💬 Please write your feedback in the next message.');
    });

    bot.on('text', async (ctx, next) => {
        const uid = ctx.from.id;
        const text = ctx.message?.text || '';
        if (text.startsWith('/')) return next();
        if (!pending.has(uid)) return next();

        pending.delete(uid);
        if (!text.trim()) return;

        saveFeedback(uid, ctx.from.username, text.trim());
        const lang = getLang(uid);
        await ctx.reply(lang==='ru' ? '🙏 Спасибо за отзыв!' :
            lang==='uk' ? '🙏 Дякуємо за відгук!' :
                '🙏 Thanks for your feedback!');
    });

    // кнопка из inline
    bot.action('fb:start', async (ctx) => {
        try { await ctx.answerCbQuery(); } catch {}
        pending.set(ctx.from.id, true);
        const lang = getLang(ctx.from.id);
        await ctx.reply(lang==='ru' ? '💬 Напиши отзыв сообщением.' :
            lang==='uk' ? '💬 Напиши відгук повідомленням.' :
                '💬 Send your feedback as a message.');
    });
}
