import { getLang, grantTimePass, grantCredits, logPayment } from '../../db/database.js';

const PLANS = {
    day_1:   { title: {ru:'Доступ на 1 день', uk:'Доступ на 1 день', en:'1-Day Access'}, hours: 24,   amountCents: 199, currency: 'USD', type:'time' },
    day_3:   { title: {ru:'Доступ на 3 дня',  uk:'Доступ на 3 дні',  en:'3-Day Access'}, hours: 24*3, amountCents: 499, currency: 'USD', type:'time' },
    day_7:   { title: {ru:'Доступ на 7 дней', uk:'Доступ на 7 днів', en:'7-Day Access'}, hours: 24*7, amountCents: 799, currency: 'USD', type:'time' },
    pack_100:{ title: {ru:'100 ответов',      uk:'100 відповідей',    en:'100 Answers' }, credits:100, amountCents: 100, currency: 'USD', type:'credits' },
    pack_300:{ title: {ru:'300 ответов',      uk:'300 відповідей',    en:'300 Answers' }, credits:300, amountCents: 250, currency: 'USD', type:'credits' }
};

export function registerBuyHandler(bot){
    bot.command('buy', async (ctx) => {
        const lang = getLang(ctx.from.id);
        const title = lang==='ru' ? 'Выбери план:' : lang==='uk' ? 'Оберіть план:' : 'Choose a plan:';
        await ctx.reply(title, {
            reply_markup: {
                inline_keyboard: [
                    [{ text:'⏳ 1 день — $1.99', callback_data:'buy:day_1' },
                        { text:'⏳ 3 дня — $4.99', callback_data:'buy:day_3' }],
                    [{ text:'⏳ 7 дней — $7.99', callback_data:'buy:day_7' }],
                    [{ text:'🎟 100 — $1', callback_data:'buy:pack_100' },
                        { text:'🎟 300 — $2.5', callback_data:'buy:pack_300' }]
                ]
            }
        });
    });

    bot.action(/^buy:/, async (ctx) => {
        const key = ctx.match.input.split(':')[1];
        const plan = PLANS[key];
        if (!plan) return ctx.answerCbQuery('Unknown plan');
        try { await ctx.answerCbQuery(); } catch {}

        const lang = getLang(ctx.from.id);
        const title = plan.title[lang] || plan.title.en;

        // для Telegram Payments через провайдера:
        // currency — фиат (USD), amount — в ЦЕНТАХ
        await ctx.telegram.sendInvoice(ctx.chat.id, {
            title,
            description: 'NovaLearn access',
            payload: `plan:${key}`,
            currency: plan.currency,
            prices: [{ label: title, amount: plan.amountCents }],
            provider_token: process.env.PAYMENT_PROVIDER_TOKEN, // ✅ вот эта строка — обязательна
            start_parameter: `buy_${key}`
        });
    });

    // подтверждаем pre-checkout
    bot.on('pre_checkout_query', async (ctx) => {
        try { await ctx.answerPreCheckoutQuery(true); }
        catch (e) { console.error('pre_checkout error', e); }
    });

    // успешная оплата
    bot.on('successful_payment', async (ctx) => {
        try {
            const sp = ctx.message.successful_payment;
            const payload = sp.invoice_payload || '';
            const key = payload.replace('plan:', '');
            const plan = PLANS[key];

            if (!plan) {
                await ctx.reply('Payment received, but plan is unknown. Contact support.');
                return;
            }

            // выдаём доступ
            if (plan.type === 'time') grantTimePass(ctx.from.id, plan.hours);
            else grantCredits(ctx.from.id, plan.credits);

            // лог платежа (фиат)
            logPayment({ tgId: ctx.from.id, plan: key, amountCents: sp.total_amount, currency: sp.currency });

            const lang = getLang(ctx.from.id);
            await ctx.reply(lang==='ru' ? '✅ Оплата успешна! Доступ активирован.' :
                lang==='uk' ? '✅ Оплату успішно проведено! Доступ активовано.' :
                    '✅ Payment successful! Access activated.');
        } catch (e) {
            console.error('successful_payment error:', e);
            await ctx.reply('⚠️ Payment processed, but an error occurred. Please contact support.');
        }
    });
}
