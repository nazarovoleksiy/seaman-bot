import { canUseLifetime, getLang } from '../../db/database.js';

export function registerLimitCommand(bot){
    bot.command('limit', async (ctx) => {
        const { used, limit, left } = canUseLifetime(ctx.from.id);
        const lang = getLang(ctx.from.id);
        if (lang === 'ru') {
            return ctx.reply(`📊 Лимит за всё время: использовано ${used} из ${limit}. Осталось: ${left}.`);
        }
        return ctx.reply(`📊 Lifetime limit: used ${used} of ${limit}. Remaining: ${left}.`);
    });
}
