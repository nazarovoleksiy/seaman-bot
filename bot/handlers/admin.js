// bot/handlers/admin.js
import db from '../../db/database.js';
import {
    trackUser, setLang, getLang,
    totalUsage
} from '../../db/database.js';

const ADMIN_ID = Number(process.env.ADMIN_ID || 0);

// helper
function isAdmin(uid) {
    return ADMIN_ID && Number(uid) === Number(ADMIN_ID);
}

export function registerAdminHandlers(bot) {

    // ===== show own id: /myid =====
    bot.command('myid', async (ctx) => {
        const uid = ctx.from.id;
        if (!isAdmin(uid)) {
            // anyone can call /myid to see their own id (optional)
            return ctx.reply(`Your Telegram id: ${uid}`);
        }
        return ctx.reply(`Admin id (you): ${uid}`);
    });

    // ===== getuser <tgId> - краткая информация о пользователе =====
    bot.command('getuser', async (ctx) => {
        const caller = ctx.from.id;
        if (!isAdmin(caller)) return ctx.reply('❌ Only admin.');

        const text = ctx.message?.text || '';
        const parts = text.split(/\s+/);
        if (parts.length < 2) return ctx.reply('Usage: /getuser <tgId>');

        const target = parts[1].trim();
        try {
            const user = db.prepare('SELECT * FROM users WHERE tg_id = ?').get(String(target));
            const used = db.prepare('SELECT count FROM usage_log WHERE tg_id = ?').get(String(target))?.count || 0;
            const credits = db.prepare('SELECT COALESCE(SUM(credits_left),0) AS c FROM entitlements WHERE tg_id=? AND kind="credits"').get(String(target)).c || 0;
            const timeRow = db.prepare('SELECT expires_at FROM entitlements WHERE tg_id=? AND kind="time" AND expires_at > datetime("now") ORDER BY expires_at DESC LIMIT 1').get(String(target));

            let textOut = `User ${target} info:\n`;
            textOut += `• user row: ${user ? 'yes' : 'no'}\n`;
            textOut += `• username: ${user?.username || 'n/a'}\n`;
            textOut += `• language: ${user?.language || 'n/a'}\n`;
            textOut += `• lifetime used: ${used}\n`;
            textOut += `• credits left: ${credits}\n`;
            textOut += `• time pass until: ${timeRow?.expires_at || 'none'}\n`;

            await ctx.reply(textOut);
        } catch (e) {
            console.error('getuser error', e);
            await ctx.reply('❌ Error reading user.');
        }
    });

    // ===== resetuser <tgId> - удалить все записи по юзеру (с запросом подтверждения) =====
    // схема: /resetuser 12345 -> бот ответит с инструкцией и кнопкой /resetuser_confirm 12345
    bot.command('resetuser', async (ctx) => {
        const caller = ctx.from.id;
        if (!isAdmin(caller)) return ctx.reply('❌ Only admin.');

        const text = ctx.message?.text || '';
        const parts = text.split(/\s+/);
        if (parts.length < 2) return ctx.reply('Usage: /resetuser <tgId>');

        const target = parts[1].trim();
        // отправим инструкцию с подтверждением командой
        await ctx.reply(
            `⚠️ You are about to DELETE all data for user ${target}.\n` +
            `If you are sure, send the confirmation command:\n` +
            `\n/resetuser_confirm ${target}\n\n` +
            `This will delete: users, usage, feedback, entitlements, payments.`
        );
    });

    // ===== resetuser_confirm <tgId> - подтверждение, делает DELETE =====
    bot.command('resetuser_confirm', async (ctx) => {
        const caller = ctx.from.id;
        if (!isAdmin(caller)) return ctx.reply('❌ Only admin.');

        const text = ctx.message?.text || '';
        const parts = text.split(/\s+/);
        if (parts.length < 2) return ctx.reply('Usage: /resetuser_confirm <tgId>');

        const target = parts[1].trim();

        try {
            db.prepare('BEGIN').run();

            db.prepare('DELETE FROM users WHERE tg_id = ?').run(String(target));
            db.prepare('DELETE FROM usage_log WHERE tg_id = ?').run(String(target));
            db.prepare('DELETE FROM feedback WHERE tg_id = ?').run(String(target));
            db.prepare('DELETE FROM entitlements WHERE tg_id = ?').run(String(target));
            db.prepare('DELETE FROM payments WHERE tg_id = ?').run(String(target));

            db.prepare('COMMIT').run();

            await ctx.reply(`✅ Reset done for ${target}`);
        } catch (e) {
            try { db.prepare('ROLLBACK').run(); } catch (_) {}
            console.error('resetuser_confirm error', e);
            await ctx.reply('❌ Error during reset. Check logs.');
        }
    });

    // ===== resetme - самопомощь: админ может сбросить самого себя без указания id =====
    bot.command('resetme', async (ctx) => {
        const caller = ctx.from.id;
        if (!isAdmin(caller)) return ctx.reply('❌ Only admin.');

        const target = String(caller);
        try {
            db.prepare('BEGIN').run();

            db.prepare('DELETE FROM users WHERE tg_id = ?').run(target);
            db.prepare('DELETE FROM usage_log WHERE tg_id = ?').run(target);
            db.prepare('DELETE FROM feedback WHERE tg_id = ?').run(target);
            db.prepare('DELETE FROM entitlements WHERE tg_id = ?').run(target);
            db.prepare('DELETE FROM payments WHERE tg_id = ?').run(target);

            db.prepare('COMMIT').run();

            await ctx.reply(`✅ Your data has been reset (${target}). You can /start to re-register.`);
        } catch (e) {
            try { db.prepare('ROLLBACK').run(); } catch (_) {}
            console.error('resetme error', e);
            await ctx.reply('❌ Error during reset. Check logs.');
        }
    });

    // ===== resetall (confirm flow) - очистка всех данных (dangerous) =====
    bot.command('resetall', async (ctx) => {
        const caller = ctx.from.id;
        if (!isAdmin(caller)) return ctx.reply('❌ Only admin.');
        await ctx.reply('⚠️ Confirm full reset: send /resetall_confirm. This will DELETE ALL DATA.');
    });

    bot.command('resetall_confirm', async (ctx) => {
        const caller = ctx.from.id;
        if (!isAdmin(caller)) return ctx.reply('❌ Only admin.');
        try {
            db.prepare('BEGIN').run();
            db.prepare('DELETE FROM users').run();
            db.prepare('DELETE FROM usage_log').run();
            db.prepare('DELETE FROM feedback').run();
            db.prepare('DELETE FROM entitlements').run();
            db.prepare('DELETE FROM payments').run();
            db.prepare('COMMIT').run();
            await ctx.reply('✅ All data cleared.');
        } catch (e) {
            try { db.prepare('ROLLBACK').run(); } catch (_) {}
            console.error('resetall_confirm error', e);
            await ctx.reply('❌ Error during reset all. Check logs.');
        }
    });
}
