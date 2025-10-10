import { trackUser, setLang, getLang, totalUsage, FREE_TOTAL_LIMIT } from '../../db/database.js';

export function registerLanguageHandlers(bot){
    bot.start(async (ctx) => {
        trackUser(ctx.from.id, ctx.from.username);
        await ctx.reply(
            '👋 Привіт! / Привет! / Hello!\n\n' +
            'Отправь фото вопроса с вариантами ответов — я найду правильный и коротко объясню почему.\n\n' +
            '🌍 Choose your language / Обери мову / Выбери язык:\n' +
            '🇬🇧 English | 🇺🇦 Українська | 🇷🇺 Русский',
            { reply_markup: { keyboard: [['🇬🇧 English','🇺🇦 Українська','🇷🇺 Русский']], one_time_keyboard: true, resize_keyboard: true } }
        );
    });

    bot.hears(['🇷🇺 Русский','Русский'], async (ctx) => {
        setLang(ctx.from.id, 'ru');
        const used = totalUsage(ctx.from.id);
        await ctx.reply(`✅ Язык: русский. Пришли скрин с вопросом.\n📊 Осталось навсегда: ${Math.max(FREE_TOTAL_LIMIT - used, 0)} из ${FREE_TOTAL_LIMIT}.`);
    });

    bot.hears(['🇺🇦 Українська','Українська'], async (ctx) => {
        setLang(ctx.from.id, 'uk');
        const used = totalUsage(ctx.from.id);
        await ctx.reply(`✅ Мова: українська. Надішли скрін питання.\n📊 Залишилось назавжди: ${Math.max(FREE_TOTAL_LIMIT - used, 0)} із ${FREE_TOTAL_LIMIT}.`);
    });

    bot.hears(['🇬🇧 English','English'], async (ctx) => {
        setLang(ctx.from.id, 'en');
        const used = totalUsage(ctx.from.id);
        await ctx.reply(`✅ Language: English. Send a question screenshot.\n📊 Lifetime remaining: ${Math.max(FREE_TOTAL_LIMIT - used, 0)} of ${FREE_TOTAL_LIMIT}.`);
    });

    // мягкая подсказка для обычного текста
    bot.on('text', async (ctx, next) => {
        const msg = ctx.message?.text || '';
        if (msg.startsWith('/')) return next();

        const lang = getLang(ctx.from.id);
        const used = totalUsage(ctx.from.id);
        if (lang === 'ru') {
            await ctx.reply(`🖼 Пришли фото/скриншот вопроса с вариантами (A/B/C/D).\n📊 Осталось навсегда: ${Math.max(FREE_TOTAL_LIMIT - used, 0)} из ${FREE_TOTAL_LIMIT}.`);
        } else if (lang === 'uk') {
            await ctx.reply(`🖼 Надішли фото/скрін питання з варіантами (A/B/C/D).\n📊 Залишилось назавжди: ${Math.max(FREE_TOTAL_LIMIT - used, 0)} із ${FREE_TOTAL_LIMIT}.`);
        } else {
            await ctx.reply(`🖼 Please send a photo/screenshot with multiple-choice options (A/B/C/D).\n📊 Lifetime remaining: ${Math.max(FREE_TOTAL_LIMIT - used, 0)} of ${FREE_TOTAL_LIMIT}.`);
        }
    });
}
