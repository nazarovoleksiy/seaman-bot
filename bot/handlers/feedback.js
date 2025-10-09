// bot/handlers/feedback.js
import db, { saveFeedback, getLang } from '../../db/database.js';

const pending = new Map();
const ADMIN_ID = process.env.ADMIN_ID;

export function registerFeedbackHandler(bot) {
    // 1) Кнопка "Оставить отзыв" (inline)
    bot.action('fb:start', async (ctx) => {
        const lang = getLang(ctx.from.id);
        pending.set(ctx.from.id, true);
        // убрать "крутилку" на кнопке
        try { await ctx.answerCbQuery(); } catch {}
        await ctx.reply(lang === 'ru'
            ? '💬 Напиши свой отзыв следующим сообщением.'
            : '💬 Please write your feedback in the next message.'
        );
    });

    // 2) /start feedback (если откроют по deeplink)
    bot.start(async (ctx, next) => {
        const arg = ctx.startPayload; // ?start=feedback
        if (arg === 'feedback') {
            const lang = getLang(ctx.from.id);
            pending.set(ctx.from.id, true);
            return ctx.reply(lang === 'ru'
                ? '💬 Напиши свой отзыв следующим сообщением.'
                : '💬 Please write your feedback in the next message.'
            );
        }
        return next();
    });

    // 3) Команда /feedback (как и было)
    bot.command('feedback', async (ctx) => {
        pending.set(ctx.from.id, true);
        const lang = getLang(ctx.from.id);
        await ctx.reply(lang === 'ru'
            ? '💬 Напиши свой отзыв следующим сообщением.'
            : '💬 Please write your feedback in the next message.'
        );
    });

    // 4) Команда /feedbacks (как и было)
    bot.command('feedbacks', async (ctx) => {
        const lang = getLang(ctx.from.id);
        try {
            const rows = db.prepare(
                'SELECT tg_id, username, text, created_at FROM feedback ORDER BY id DESC LIMIT 10'
            ).all();
            if (!rows.length) {
                return ctx.reply(lang === 'ru' ? '❌ Отзывов пока нет.' : '❌ No feedbacks yet.');
            }
            let msg = (lang === 'ru') ? '📝 Последние отзывы:\n\n' : '📝 Recent feedbacks:\n\n';
            for (const r of rows) {
                msg += `👤 ${r.username ? '@'+r.username : r.tg_id}\n💬 ${r.text}\n\n`;
            }
            await ctx.reply(msg.trim());
        } catch (e) {
            console.error('Feedback fetch error:', e);
            await ctx.reply(lang === 'ru' ? '⚠️ Ошибка при получении отзывов.' : '⚠️ Error loading feedbacks.');
        }
    });

    // 5) Приём текста-отзыва (и уведомление админа)
    bot.on('text', async (ctx, next) => {
        if (ctx.message?.text?.startsWith('/')) return next();
        const uid = ctx.from.id;
        if (!pending.has(uid)) return next();

        pending.delete(uid);
        const text = ctx.message.text?.trim();
        if (!text) return;

        saveFeedback(uid, ctx.from.username, text);

        const lang = getLang(uid);
        await ctx.reply(lang === 'ru' ? '🙏 Спасибо за отзыв!' : '🙏 Thanks for your feedback!');

        if (process.env.ADMIN_ID) {
            const who = ctx.from.username ? `@${ctx.from.username}` : `id:${uid}`;
            const note = `🆕 New feedback\n👤 ${who}\n🕒 ${new Date().toISOString()}\n\n💬 ${text}`;
            try { await ctx.telegram.sendMessage(process.env.ADMIN_ID, note); } catch (e) { console.error(e); }
        }
    });
}
