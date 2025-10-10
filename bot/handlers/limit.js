import { canUseLifetime, getLang, totalUsage, FREE_TOTAL_LIMIT } from '../../db/database.js';

export function registerLimitCommand(bot){
    bot.command('limit', async (ctx) => {
        const { used, limit, left } = canUseLifetime(ctx.from.id);
        const lang = getLang(ctx.from.id);
        if (lang==='ru') return ctx.reply(`📊 Лимит навсегда: использовано ${used} из ${limit}. Осталось: ${left}.`);
        if (lang==='uk') return ctx.reply(`📊 Ліміт назавжди: використано ${used} із ${limit}. Залишилось: ${left}.`);
        return ctx.reply(`📊 Lifetime limit: used ${used} of ${limit}. Left: ${left}.`);
    });
}
