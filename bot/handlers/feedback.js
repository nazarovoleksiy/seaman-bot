// bot/handlers/feedback.js
import db, { saveFeedback, getLang } from '../../db/database.js';

const pending = new Map(); // userId -> ждём текст отзыва

export function registerFeedbackHandler(bot) {
    // === команда /feedback ===
    bot.command('feedback', async (ctx) => {
        pending.set(ctx.from.id, true);
        const lang = getLang(ctx.from.id);
        await ctx.reply(
            lang === 'ru'
                ? '💬 Напиши свой отзыв следующим сообщением.'
                : '💬 Please write your feedback in the next message.'
        );
    });

    // === команда /feedbacks — показать последние отзывы ===
    bot.command('feedbacks', async (ctx) => {
        const lang = getLang(ctx.from.id);

        try {
            const rows = db.prepare(
                'SELECT tg_id, username, text, created_at FROM feedback ORDER BY id DESC LIMIT 10'
            ).all();

            if (!rows.length) {
                return ctx.reply(
                    lang === 'ru'
                        ? '❌ Отзывов пока нет.'
                        : '❌ No feedbacks yet.'
                );
            }

            let msg =
                lang === 'ru'
                    ? '📝 Последние отзывы:\n\n'
                    : '📝 Recent feedbacks:\n\n';

            for (const row of rows) {
                msg += `👤 ${row.username || row.tg_id}\n💬 ${row.text}\n\n`;
            }

            await ctx.reply(msg.trim());
        } catch (err) {
            console.error('Feedback fetch error:', err);
            await ctx.reply(
                lang === 'ru'
                    ? '⚠️ Ошибка при получении отзывов.'
                    : '⚠️ Error loading feedbacks.'
            );
        }
    });

    // === приём текстовых отзывов ===
    bot.on('text', async (ctx, next) => {
        const uid = ctx.from.id;

        // команды пропускаем
        if (ctx.message?.text?.startsWith('/')) return next();

        // если не ждём отзыв — пропускаем
        if (!pending.has(uid)) return next();

        pending.delete(uid);
        const text = ctx.message.text?.trim();
        if (!text) return next();

        saveFeedback(uid, ctx.from.username, text);

        const lang = getLang(uid);
        await ctx.reply(lang === 'ru' ? '🙏 Спасибо за отзыв!' : '🙏 Thanks for your feedback!');
    });
}
