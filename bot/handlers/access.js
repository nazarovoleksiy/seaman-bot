// bot/handlers/access.js
import {
    getLang,
    totalUsage,
    FREE_TOTAL_LIMIT,
    myCreditsLeft,
    myTimePassUntil
} from '../../db/database.js';

// остаток в мс до истечения Day Pass
function getRemainingMs(utcSqlite) {
    if (!utcSqlite) return 0;
    const expires = new Date(utcSqlite.replace(' ', 'T') + 'Z').getTime(); // UTC
    const now = Date.now();
    return Math.max(expires - now, 0);
}

// форматируем как H ч M мин (или h m)
function formatHM(ms, lang) {
    if (ms <= 0) {
        return lang === 'ru' ? 'нет'
            : lang === 'uk' ? 'немає'
                : 'none';
    }
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;

    if (lang === 'ru') {
        const hLabel = h === 1 ? 'час' : (h >= 2 && h <= 4 ? 'часа' : 'часов');
        const mLabel = (m === 1) ? 'минута' : (m >= 2 && m <= 4 ? 'минуты' : 'минут');
        if (h > 0 && m > 0) return `${h} ${hLabel} ${m} ${mLabel}`;
        if (h > 0) return `${h} ${hLabel}`;
        return `${m} ${mLabel}`;
    } else if (lang === 'uk') {
        // простая форма без склонений
        if (h > 0 && m > 0) return `${h} год ${m} хв`;
        if (h > 0) return `${h} год`;
        return `${m} хв`;
    } else {
        // en
        const hLabel = h === 1 ? 'hour' : 'hours';
        const mLabel = m === 1 ? 'min' : 'mins';
        if (h > 0 && m > 0) return `${h} ${hLabel} ${m} ${mLabel}`;
        if (h > 0) return `${h} ${hLabel}`;
        return `${m} ${mLabel}`;
    }
}

export function registerAccessCommand(bot) {
    bot.command('access', async (ctx) => {
        const lang = getLang(ctx.from.id);

        const used = totalUsage(ctx.from.id);
        const leftFree = Math.max(FREE_TOTAL_LIMIT - used, 0);
        const credits = myCreditsLeft(ctx.from.id);

        const untilSql = myTimePassUntil(ctx.from.id);     // 'YYYY-MM-DD HH:MM:SS' (UTC) or null
        const leftMs   = getRemainingMs(untilSql);         // 0 если нет
        const leftText = formatHM(leftMs, lang);           // «нет» / «немає» / «none» или «5 часов 10 минут»

        let lines = [];

        if (lang === 'ru') {
            lines.push('🔐 *Доступ*');
            lines.push(`• Day Pass: ${leftMs > 0 ? `осталось ${leftText}` : 'нет'}`);
            lines.push(`• Кредиты: ${credits}`);
            lines.push(`• Бесплатный лимит: осталось ${leftFree} из ${FREE_TOTAL_LIMIT} (использовано ${used})`);
            lines.push('');
            lines.push('Чтобы продлить доступ: /buy');
        } else if (lang === 'uk') {
            lines.push('🔐 *Доступ*');
            lines.push(`• Day Pass: ${leftMs > 0 ? `залишилось ${leftText}` : 'немає'}`);
            lines.push(`• Кредити: ${credits}`);
            lines.push(`• Безкоштовний ліміт: залишилось ${leftFree} із ${FREE_TOTAL_LIMIT} (використано ${used})`);
            lines.push('');
            lines.push('Щоб продовжити доступ: /buy');
        } else {
            lines.push('🔐 *Access*');
            lines.push(`• Day Pass: ${leftMs > 0 ? `left ${leftText}` : 'none'}`);
            lines.push(`• Credits: ${credits}`);
            lines.push(`• Free limit: ${leftFree} of ${FREE_TOTAL_LIMIT} left (used ${used})`);
            lines.push('');
            lines.push('To extend access: /buy');
        }

        await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
    });
}
