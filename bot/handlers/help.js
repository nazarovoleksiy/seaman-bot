// bot/handlers/help.js
import { getLang } from '../../db/database.js';

const ADMIN_ID = Number(process.env.ADMIN_ID || 0);
const isAdmin = (uid) => ADMIN_ID && Number(uid) === ADMIN_ID;

function helpText(lang, admin) {
    if (lang === 'ru') {
        let t = '📘 *Доступные команды*\n\n' +
            '/start — начать заново / выбрать язык\n' +
            '/access — мой доступ: Day Pass (сколько осталось), кредиты, бесплатный остаток\n' +
            '/limit — мой бесплатный остаток (lifetime)\n' +
            '/feedback — оставить отзыв\n' +
            '/buy — приобрести доступ\n' +
            '/stats — моя статистика и доступ\n' +
            '/help — показать помощь\n\n' +
            '📸 Пришли фото вопроса с вариантами (A/B/C/D) — я найду правильный ответ и кратко объясню почему.';
        if (admin) {
            t += '\n\n🛠 *Админ*\n' +
                '/myid — мой Telegram ID\n' +
                '/getuser <id> — информация о пользователе\n' +
                '/resetuser <id> — сбросить пользователя (подтв.: /resetuser_confirm <id>)\n' +
                '/resetme — сбросить самого себя\n' +
                '/resetall — полный сброс (подтв.: /resetall_confirm)';
        }
        return t;
    } else if (lang === 'uk') {
        let t = '📘 *Доступні команди*\n\n' +
            '/start — почати заново / обрати мову\n' +
            '/access — мій доступ: Day Pass (скільки лишилось), кредити, безкоштовний залишок\n' +
            '/limit — мій безкоштовний залишок (lifetime)\n' +
            '/feedback — залишити відгук\n' +
            '/buy — придбати доступ\n' +
            '/stats — моя статистика та доступ\n' +
            '/help — показати довідку\n\n' +
            '📸 Надішли фото питання з варіантами (A/B/C/D) — я знайду правильну відповідь і коротко поясню чому.';
        if (admin) {
            t += '\n\n🛠 *Адмін*\n' +
                '/myid — мій Telegram ID\n' +
                '/getuser <id> — інформація про користувача\n' +
                '/resetuser <id> — скинути користувача (підтв.: /resetuser_confirm <id>)\n' +
                '/resetme — скинути себе\n' +
                '/resetall — повний скидання (підтв.: /resetall_confirm)';
        }
        return t;
    } else {
        let t = '📘 *Available commands*\n\n' +
            '/start — restart / choose language\n' +
            '/access — my access: Day Pass (time left), credits, free left\n' +
            '/limit — my free lifetime remaining\n' +
            '/feedback — leave feedback\n' +
            '/buy — purchase access\n' +
            '/stats — my stats & access\n' +
            '/help — show this help\n\n' +
            '📸 Just send a photo with options (A/B/C/D) — I will find the correct answer and explain briefly.';
        if (admin) {
            t += '\n\n🛠 *Admin*\n' +
                '/myid — my Telegram ID\n' +
                '/getuser <id> — user info\n' +
                '/resetuser <id> — reset user (confirm: /resetuser_confirm <id>)\n' +
                '/resetme — reset myself\n' +
                '/resetall — full wipe (confirm: /resetall_confirm)';
        }
        return t;
    }
}

export function helpInlineKeyboard(lang) {
    const label = lang === 'ru' ? '❓ Помощь'
        : lang === 'uk' ? '❓ Допомога'
            : '❓ Help';
    return { inline_keyboard: [[{ text: label, callback_data: 'help:open' }]] };
}

export function registerHelpHandler(bot) {
    bot.command('help', async (ctx) => {
        const lang = getLang(ctx.from.id);
        const admin = isAdmin(ctx.from.id);
        await ctx.reply(helpText(lang, admin), { parse_mode: 'Markdown' });
    });

    bot.action('help:open', async (ctx) => {
        try { await ctx.answerCbQuery(); } catch {}
        const lang = getLang(ctx.from.id);
        const admin = isAdmin(ctx.from.id);
        await ctx.reply(helpText(lang, admin), { parse_mode: 'Markdown' });
    });
}
