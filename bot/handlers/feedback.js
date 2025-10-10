// bot/handlers/feedback.js
import { saveFeedback, getLang } from '../../db/database.js';

const pending = new Map(); // userId -> ждём текст отзыва
const ADMIN_ID = Number(process.env.ADMIN_ID || 0);
const FEEDBACK_CHAT_ID = process.env.FEEDBACK_CHAT_ID || null;

export function registerFeedbackHandler(bot) {
    // кнопка из инлайн-меню
    bot.action('fb:start', async (ctx) => {
        try { await ctx.answerCbQuery(); } catch {}
        pending.set(ctx.from.id, true);
        const lang = getLang(ctx.from.id);
        await ctx.reply(
            lang === 'ru' ? '💬 Напиши свой отзыв следующим сообщением.'
                : lang === 'uk' ? '💬 Напиши свій відгук наступним повідомленням.'
                    : '💬 Please write your feedback in the next message.'
        );
    });

    // команда вручную
    bot.command('feedback', async (ctx) => {
        pending.set(ctx.from.id, true);
        const lang = getLang(ctx.from.id);
        await ctx.reply(
            lang === 'ru' ? '💬 Напиши свой отзыв следующим сообщением.'
                : lang === 'uk' ? '💬 Напиши свій відгук наступним повідомленням.'
                    : '💬 Please write your feedback in the next message.'
        );
    });

    // перехват текста ТОЛЬКО когда ждём отзыв
    bot.on('text', async (ctx, next) => {
        const uid = ctx.from.id;
        const text = ctx.message?.text || '';

        // команды пропускаем дальше
        if (text.startsWith('/')) return next();
        if (!pending.has(uid)) return next();

        pending.delete(uid);
        const clean = text.trim();
        if (!clean) return;

        // сохраняем
        saveFeedback(uid, ctx.from.username, clean);

        // подтверждение пользователю
        const lang = getLang(uid);
        await ctx.reply(
            lang === 'ru' ? '🙏 Спасибо за отзыв!'
                : lang === 'uk' ? '🙏 Дякуємо за відгук!'
                    : '🙏 Thanks for your feedback!'
        );

        // уведомление админу / в чат
        const where = FEEDBACK_CHAT_ID || (ADMIN_ID ? String(ADMIN_ID) : null);
        if (where) {
            const who = ctx.from.username ? `@${ctx.from.username}` : `id:${uid}`;
            const when = new Date().toISOString();
            const msg =
                `🆕 New feedback\n` +
                `👤 ${who}\n` +
                `🕒 ${when}\n\n` +
                `💬 ${clean}`;
            try {
                await ctx.telegram.sendMessage(where, msg, { disable_web_page_preview: true });
            } catch (e) {
                console.error('feedback notify error:', e);
            }
        }
    });
}
