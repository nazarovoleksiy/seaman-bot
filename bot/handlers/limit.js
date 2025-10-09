import { usageForToday, DAILY_LIMIT, getLang } from '../../db/database.js';

export function registerLimitCommand(bot){
    bot.command('limit', async (ctx) => {
        const used = usageForToday(ctx.from.id);
        const left = Math.max(DAILY_LIMIT - used, 0);
        const lang = getLang(ctx.from.id);
        if (lang === 'ru') return ctx.reply(`📊 Сегодня осталось: ${left} из ${DAILY_LIMIT}.`);
        return ctx.reply(`📊 Remaining today: ${left} of ${DAILY_LIMIT}.`);
    });
}
