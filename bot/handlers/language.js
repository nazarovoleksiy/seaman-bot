import { getLang, setLang, usageForToday, DAILY_LIMIT, trackUser } from '../../db/database.js';

export function registerLanguageHandlers(bot){
    bot.start(async (ctx) => {
        trackUser(ctx.from.id);
        await ctx.reply(
            '👋 Привет! / Hello!\n\n' +
            'Я — AI помощник: разберу тест по фото, покажу правильный ответ и объясню.\n' +
            'I’m your AI assistant: send a screenshot of a question — I’ll solve and explain.\n\n' +
            '🌍 Choose your language / Выбери язык:\n🇬🇧 English | 🇷🇺 Русский',
            { reply_markup: { keyboard: [['🇬🇧 English','🇷🇺 Русский']], one_time_keyboard: true, resize_keyboard: true } }
        );
    });

    bot.hears(['🇷🇺 Русский','Русский'], async (ctx) => {
        setLang(ctx.from.id, 'ru');
        const used = usageForToday(ctx.from.id);
        await ctx.reply(`✅ Язык: русский. Пришли скриншот вопроса.\n📊 Сегодня осталось: ${Math.max(DAILY_LIMIT - used, 0)} из ${DAILY_LIMIT}.`);
    });

    bot.hears(['🇬🇧 English','English'], async (ctx) => {
        setLang(ctx.from.id, 'en');
        const used = usageForToday(ctx.from.id);
        await ctx.reply(`✅ Language: English. Send a screenshot.\n📊 Remaining today: ${Math.max(DAILY_LIMIT - used, 0)} of ${DAILY_LIMIT}.`);
    });

    // текст без фото — мягкая подсказка
    bot.on('text', async (ctx) => {
        const lang = getLang(ctx.from.id);
        const used = usageForToday(ctx.from.id);
        if (lang === 'ru') return ctx.reply(`🖼 Пришли фото/скриншот вопроса.\n📊 Сегодня осталось: ${Math.max(DAILY_LIMIT - used, 0)} из ${DAILY_LIMIT}.`);
        return ctx.reply(`🖼 Please send a photo/screenshot of a question.\n📊 Remaining today: ${Math.max(DAILY_LIMIT - used, 0)} of ${DAILY_LIMIT}.`);
    });
}
