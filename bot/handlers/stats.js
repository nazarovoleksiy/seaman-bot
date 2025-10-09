// bot/handlers/stats.js
import { todayUTC } from '../../db/database.js';
import db, { getLang } from '../../db/database.js';

export function registerStatsCommand(bot) {
    bot.command('stats', async (ctx) => {
        try {
            const totalUsers = db.prepare(
                'SELECT COUNT(DISTINCT tg_id) AS total FROM usage_log'
            ).get().total || 0;

            const today = todayUTC();
            const todayCount = db.prepare(
                'SELECT COALESCE(SUM(count), 0) AS sum FROM usage_log WHERE day=?'
            ).get(today).sum || 0;

            const lang = getLang(ctx.from.id);
            const msg = (lang === 'ru')
                ? `📊 Статистика бота:\n👤 Всего пользователей: ${totalUsers}\n🧠 Запросов сегодня: ${todayCount}`
                : `📊 Bot stats:\n👤 Total users: ${totalUsers}\n🧠 Requests today: ${todayCount}`;

            await ctx.reply(msg);
        } catch (e) {
            console.error('Stats error:', e);
            await ctx.reply('⚠️ Error retrieving stats.');
        }
    });
}
