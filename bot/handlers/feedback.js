// bot/handlers/feedback.js
import db, { saveFeedback, getLang } from '../../db/database.js';

const pending = new Map(); // userId -> ждём текст отзыва
const ADMIN_ID = process.env.ADMIN_ID; // твой Telegram ID

export function registerFeedbackHandler(bot) {
    // /feedback — запросить отзыв
    bot.command('feedback', async (ctx) => {
        pending.set(ctx.from.id, true);
        const lang = getLang(ctx.from.id);
        await ctx.reply(
            lang === 'ru'
                ? '💬 Напиши свой отзыв следующим сообщением.'
                : '💬 Please write your feedback in the next message.'
        );
    });

    // /feedbacks — показать последние 10 отзывов
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
            for (const row of rows) {
                msg += `👤 ${row.username ? '@'+row.username : row.tg_id}\n💬 ${row.text}\n\n`;
            }
            await ctx.reply(msg.trim());
        } catch (err) {
            console.error('Feedback fetch error:', err);
            await ctx.reply(lang === 'ru' ? '⚠️ Ошибка при получении отзывов.' : '⚠️ Error loading feedbacks.');
        }
    });

    // приём текстовых отзывов
    bot.on('text', async (ctx, next) => {
        const uid = ctx.from.id;

        // команды пропускаем
        if (ctx.message?.text?.startsWith('/')) return next();

        // если не ждём отзыв — пропускаем дальше
        if (!pending.has(uid)) return next();

        pending.delete(uid);
        const text = ctx.message.text?.trim();
        if (!text) return next();

        // сохраняем в БД
        saveFeedback(uid, ctx.from.username, text);

        // уведомим автора
        const lang = getLang(uid);
        await ctx.reply(lang === 'ru' ? '🙏 Спасибо за отзыв!' : '🙏 Thanks for your feedback!');

        // уведомим админа (тебя)
        if (ADMIN_ID) {
            const who = ctx.from.username ? `@${ctx.from.username}` : `id:${uid}`;
            const note = `🆕 New feedback\n👤 ${who}\n🕒 ${new Date().toISOString()}\n\n💬 ${text}`;
            try {
                await ctx.telegram.sendMessage(ADMIN_ID, note);
            } catch (e) {
                console.error('Admin notify error:', e);
            }
        }
    });
}
