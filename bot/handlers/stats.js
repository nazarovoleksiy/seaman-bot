import { countUsers, totalUsage, getLang } from '../../db/database.js';

export function registerStatsCommand(bot){
    bot.command('stats', async (ctx) => {
        const n = countUsers();
        const used = totalUsage(ctx.from.id);
        const lang = getLang(ctx.from.id);
        const msg = lang==='ru'
            ? `📊 Статистика:\n👥 Пользователей: ${n}\n🧠 Ваши запросы всего: ${used}`
            : lang==='uk'
                ? `📊 Статистика:\n👥 Користувачів: ${n}\n🧠 Ваші запити всього: ${used}`
                : `📊 Stats:\n👥 Users: ${n}\n🧠 Your total requests: ${used}`;
        await ctx.reply(msg);
    });
}
