import { saveFeedback, getLang } from '../../db/database.js';

const pending = new Map(); // userId -> waiting

export function registerFeedbackHandler(bot){
    bot.command('feedback', async (ctx) => {
        pending.set(ctx.from.id, true);
        const lang = getLang(ctx.from.id);
        if (lang === 'ru') return ctx.reply('💬 Напиши свой отзыв следующим сообщением.');
        return ctx.reply('💬 Please write your feedback in the next message.');
    });

    bot.on('text', async (ctx) => {
        const uid = ctx.from.id;
        if (!pending.has(uid)) return; // не отзыв — игнор
        pending.delete(uid);
        const text = ctx.message.text;
        saveFeedback(uid, ctx.from.username, text);
        const lang = getLang(uid);
        if (lang === 'ru') return ctx.reply('🙏 Спасибо за отзыв!');
        return ctx.reply('🙏 Thanks for your feedback!');
    });
}
