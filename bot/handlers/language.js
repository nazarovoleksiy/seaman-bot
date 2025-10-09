import { getLang, setLang, trackUser, canUseLifetime } from '../../db/database.js';

export function registerLanguageHandlers(bot){
    bot.start(async (ctx, next) => {
        // если пришли через deeplink /start feedback — пусть обработает feedback.js
        if (ctx.startPayload === 'feedback') return next();

        trackUser(ctx.from.id);
        await ctx.reply(
            '👋 Привіт! / Привет! / Hello!\n\n' +
            'Я — AI-помічник: розберу тест за фото, підкажу правильну відповідь і коротко поясню.\n' +
            'Я — AI помощник: разберу тест по фото, подскажу правильный ответ и кратко объясню.\n' +
            'I’m your AI assistant: send a screenshot of a question — I’ll solve and explain.\n\n' +
            '🌍 Choose your language / Обери мову / Выбери язык:\n' +
            '🇬🇧 English | 🇺🇦 Українська | 🇷🇺 Русский',
            { reply_markup: { keyboard: [['🇬🇧 English', '🇺🇦 Українська', '🇷🇺 Русский']], one_time_keyboard: true, resize_keyboard: true } }
        );
    });

    bot.hears(['🇺🇦 Українська','Українська'], async (ctx) => {
        setLang(ctx.from.id, 'uk');
        const { left, limit } = canUseLifetime(ctx.from.id);
        await ctx.reply(
            `✅ Мова: українська. Надішли скріншот питання.\n` +
            `📊 Залишилось назавжди: ${left} із ${limit}.`
        );
    });

    bot.hears(['🇷🇺 Русский','Русский'], async (ctx) => {
        setLang(ctx.from.id, 'ru');
        const { left, limit } = canUseLifetime(ctx.from.id);
        await ctx.reply(
            `✅ Язык: русский. Пришли скриншот вопроса.\n` +
            `📊 Осталось навсегда: ${left} из ${limit}.`
        );
    });

    bot.hears(['🇬🇧 English','English'], async (ctx) => {
        setLang(ctx.from.id, 'en');
        const { left, limit } = canUseLifetime(ctx.from.id);
        await ctx.reply(
            `✅ Language: English. Send a screenshot.\n` +
            `📊 Lifetime remaining: ${left} of ${limit}.`
        );
    });

    // текст (без фото): подсказка + пропуск команд
    bot.on('text', async (ctx, next) => {
        const msg = ctx.message?.text || '';
        if (msg.startsWith('/')) return next(); // команды дальше

        const lang = getLang(ctx.from.id);
        const { left, limit } = canUseLifetime(ctx.from.id);

        if (lang === 'ru') {
            await ctx.reply(
                `🖼 Пришли фото/скриншот с вопросом и вариантами.\n` +
                `📊 Осталось навсегда: ${left} из ${limit}.`
            );
        } else if (lang === 'uk') {
            await ctx.reply(
                `🖼 Надішли фото/скрін питання з варіантами.\n` +
                `📊 Залишилось назавжди: ${left} із ${limit}.`
            );
        } else {
            await ctx.reply(
                `🖼 Please send a photo/screenshot with a question and options.\n` +
                `📊 Lifetime remaining: ${left} of ${limit}.`
            );
        }
    });
}
