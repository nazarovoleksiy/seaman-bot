// bot/handlers/stats.js
import {
    countUsers,
    totalUsage,
    getLang,
    FREE_TOTAL_LIMIT,
    countActiveTimePasses,
    sumCreditsLeftAll,
    myCreditsLeft,
    myTimePassUntil,
    paymentsSummary
} from '../../db/database.js';

function fmtDateUTC(iso) {
    if (!iso) return null;
    // iso из sqlite: 'YYYY-MM-DD HH:MM:SS'
    return iso.replace(' ', 'T') + 'Z';
}

export function registerStatsCommand(bot){
    bot.command('stats', async (ctx) => {
        const lang = getLang(ctx.from.id);

        // общие метрики
        const users = countUsers();
        const activePasses = countActiveTimePasses();
        const creditsAll = sumCreditsLeftAll();
        const pay = paymentsSummary(); // [{currency:'USD', cnt: N, sum_cents: M}, ...]

        // мои метрики
        const used = totalUsage(ctx.from.id);
        const leftFree = Math.max(FREE_TOTAL_LIMIT - used, 0);
        const myCredits = myCreditsLeft(ctx.from.id);
        const passUntil = myTimePassUntil(ctx.from.id); // sqlite format
        const passUntilISO = fmtDateUTC(passUntil);

        let lines = [];

        if (lang === 'ru') {
            lines.push('📊 *Статистика проекта*');
            lines.push(`👥 Пользователей: ${users}`);
            lines.push(`⏳ Активные Day Pass: ${activePasses}`);
            lines.push(`🎟 Всего оставшихся кредитов у всех: ${creditsAll}`);
            if (pay.length) {
                const payStr = pay.map(p => `${p.currency}: ${(p.sum_cents/100).toFixed(2)} (${p.cnt})`).join(', ');
                lines.push(`💵 Платежи: ${payStr}`);
            } else {
                lines.push('💵 Платежи: пока нет');
            }
            lines.push('');
            lines.push('🧑 *Ваш доступ*');
            lines.push(`• Бесплатный лимит: использовано ${used} из ${FREE_TOTAL_LIMIT} (осталось ${leftFree})`);
            lines.push(`• Кредиты: ${myCredits}`);
            lines.push(`• Day Pass: ${passUntilISO ? `активен до ${passUntilISO}` : 'нет'}`);
        } else if (lang === 'uk') {
            lines.push('📊 *Статистика проєкту*');
            lines.push(`👥 Користувачів: ${users}`);
            lines.push(`⏳ Активні Day Pass: ${activePasses}`);
            lines.push(`🎟 Усього залишилось кредитів: ${creditsAll}`);
            if (pay.length) {
                const payStr = pay.map(p => `${p.currency}: ${(p.sum_cents/100).toFixed(2)} (${p.cnt})`).join(', ');
                lines.push(`💵 Платежі: ${payStr}`);
            } else {
                lines.push('💵 Платежі: ще немає');
            }
            lines.push('');
            lines.push('🧑 *Ваш доступ*');
            lines.push(`• Безкоштовний ліміт: використано ${used} із ${FREE_TOTAL_LIMIT} (залишилось ${leftFree})`);
            lines.push(`• Кредити: ${myCredits}`);
            lines.push(`• Day Pass: ${passUntilISO ? `активний до ${passUntilISO}` : 'немає'}`);
        } else {
            lines.push('📊 *Project stats*');
            lines.push(`👥 Users: ${users}`);
            lines.push(`⏳ Active Day Passes: ${activePasses}`);
            lines.push(`🎟 Total credits left across users: ${creditsAll}`);
            if (pay.length) {
                const payStr = pay.map(p => `${p.currency}: ${(p.sum_cents/100).toFixed(2)} (${p.cnt})`).join(', ');
                lines.push(`💵 Payments: ${payStr}`);
            } else {
                lines.push('💵 Payments: none yet');
            }
            lines.push('');
            lines.push('*Your access*');
            lines.push(`• Free limit: used ${used} of ${FREE_TOTAL_LIMIT} (left ${leftFree})`);
            lines.push(`• Credits: ${myCredits}`);
            lines.push(`• Day Pass: ${passUntilISO ? `active until ${passUntilISO}` : 'none'}`);
        }

        await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
    });
}
