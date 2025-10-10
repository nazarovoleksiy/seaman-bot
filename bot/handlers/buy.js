// bot/handlers/buy.js
import {
    getLang,
    FREE_TOTAL_LIMIT,
    totalUsage,
    myCreditsLeft,
    myTimePassUntil,
    grantTimePass,      // (uid, hours)
    grantCredits,       // (uid, count)
    logPayment          // (uid, amount, currency, planId, providerChargeId, tgChargeId)
} from '../../db/database.js';

// ───────── helpers: время в ч/м ─────────
function leftMsFromSqlite(utcSql) {
    if (!utcSql) return 0;
    const t = new Date(utcSql.replace(' ', 'T') + 'Z').getTime();
    return Math.max(t - Date.now(), 0);
}
function formatHM(ms, lang) {
    if (ms <= 0) return lang === 'ru' ? 'нет' : lang === 'uk' ? 'немає' : 'none';
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (lang === 'ru') {
        const hL = h === 1 ? 'час' : (h >= 2 && h <= 4 ? 'часа' : 'часов');
        const mL = m === 1 ? 'минута' : (m >= 2 && m <= 4 ? 'минуты' : 'минут');
        return h > 0 && m > 0 ? `${h} ${hL} ${m} ${mL}` : h > 0 ? `${h} ${hL}` : `${m} ${mL}`;
    } else if (lang === 'uk') {
        return h > 0 && m > 0 ? `${h} год ${m} хв` : h > 0 ? `${h} год` : `${m} хв`;
    } else {
        const hL = h === 1 ? 'hour' : 'hours';
        const mL = m === 1 ? 'min' : 'mins';
        return h > 0 && m > 0 ? `${h} ${hL} ${m} ${mL}` : h > 0 ? `${h} ${hL}` : `${m} ${mL}`;
    }
}

// ───────── планы (цена в центах валюты) ─────────
const PLANS = {
    day_1: { title: '1-Day Access', hours: 24,  priceCents: 199 },
    day_3: { title: '3-Day Access', hours: 72,  priceCents: 399 },
    day_7: { title: '7-Day Access', hours: 168, priceCents: 699 },
    c100:  { title: '100 credits',  credits: 100, priceCents: 199 },
    c300:  { title: '300 credits',  credits: 300, priceCents: 499 },
};

// токен от BotFather → Payments → выбранный провайдер (Test/Live)
const PROVIDER_TOKEN = process.env.PAYMENT_PROVIDER_TOKEN;
const CURRENCY       = process.env.PAYMENT_CURRENCY || 'USD';

// ───────── i18n ─────────
function t(lang, key, args = []) {
    const L = lang === 'ru' ? 'RU' : lang === 'uk' ? 'UK' : 'EN';
    const dict = {
        RU: {
            choose: 'Выбери доступ',
            desc:   'Оплата через Telegram. Доступ начислится автоматически.',
            noProv: 'Платёжный провайдер не настроен. Свяжись с администратором.',
            paid:   '✅ Оплата прошла успешно!',
            summary: (dayLeft, credits, used, freeLeft, freeTotal) =>
                `🔐 Доступ обновлён:\n` +
                `• Day Pass: ${dayLeft}\n` +
                `• Кредиты: ${credits}\n` +
                `• Бесплатный лимит: осталось ${freeLeft} из ${freeTotal} (использовано ${used})\n\n` +
                `Команда: /access`,
            btns: {
                day1: '1 день — $1.99',
                day3: '3 дня — $3.99',
                day7: '7 дней — $6.99',
                c100: '100 кредитов — $1.99',
                c300: '300 кредитов — $4.99'
            }
        },
        UK: {
            choose: 'Оберіть доступ',
            desc:   'Оплата через Telegram. Доступ буде нараховано автоматично.',
            noProv: 'Платіжний провайдер не налаштований. Звʼяжіться з адміністратором.',
            paid:   '✅ Оплату успішно проведено!',
            summary: (dayLeft, credits, used, freeLeft, freeTotal) =>
                `🔐 Доступ оновлено:\n` +
                `• Day Pass: ${dayLeft}\n` +
                `• Кредити: ${credits}\n` +
                `• Безкоштовний ліміт: залишилось ${freeLeft} із ${freeTotal} (використано ${used})\n\n` +
                `Команда: /access`,
            btns: {
                day1: '1 день — $1.99',
                day3: '3 дні — $3.99',
                day7: '7 днів — $6.99',
                c100: '100 кредитів — $1.99',
                c300: '300 кредитів — $4.99'
            }
        },
        EN: {
            choose: 'Choose a plan',
            desc:   'Pay via Telegram. Access is credited automatically.',
            noProv: 'Payment provider is not configured. Contact the admin.',
            paid:   '✅ Payment successful!',
            summary: (dayLeft, credits, used, freeLeft, freeTotal) =>
                `🔐 Access updated:\n` +
                `• Day Pass: ${dayLeft}\n` +
                `• Credits: ${credits}\n` +
                `• Free limit: ${freeLeft} of ${freeTotal} left (used ${used})\n\n` +
                `Command: /access`,
            btns: {
                day1: '1 Day — $1.99',
                day3: '3 Days — $3.99',
                day7: '7 Days — $6.99',
                c100: '100 credits — $1.99',
                c300: '300 credits — $4.99'
            }
        }
    };
    const v = dict[L][key];
    if (typeof v === 'function') return v(...args);
    return v;
}

// ───────── регистрация хендлеров ─────────
export function registerBuyHandler(bot) {
    // /buy — вывести кнопки тарифов
    bot.command('buy', async (ctx) => {
        const lang = getLang(ctx.from.id);
        if (!PROVIDER_TOKEN) {
            return ctx.reply(t(lang, 'noProv'));
        }
        await ctx.reply(t(lang, 'choose'), {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: t(lang, 'btns').day1, callback_data: 'buy:day_1' },
                        { text: t(lang, 'btns').day3, callback_data: 'buy:day_3' }
                    ],
                    [
                        { text: t(lang, 'btns').day7, callback_data: 'buy:day_7' }
                    ],
                    [
                        { text: t(lang, 'btns').c100, callback_data: 'buy:c100' },
                        { text: t(lang, 'btns').c300, callback_data: 'buy:c300' }
                    ]
                ]
            }
        });
    });

    // выбор плана → отправка инвойса
    bot.action(/^buy:(.+)$/, async (ctx) => {
        try { await ctx.answerCbQuery(); } catch {}
        const planId = ctx.match[1];
        const plan = PLANS[planId];
        const lang = getLang(ctx.from.id);
        if (!plan) return;
        if (!PROVIDER_TOKEN) return ctx.reply(t(lang, 'noProv'));

        try {
            await ctx.replyWithInvoice({
                provider_token: PROVIDER_TOKEN,
                currency: CURRENCY,
                title: plan.title,
                description: t(lang, 'desc'),
                payload: `plan:${planId}`,
                prices: [{ label: plan.title, amount: plan.priceCents }],
                start_parameter: `buy_${planId}`,
                need_name: false,
                need_phone_number: false,
                need_email: false,
                need_shipping_address: false,
                is_flexible: false
            });
        } catch (e) {
            console.error('replyWithInvoice error:', e);
            await ctx.reply(t(lang, 'noProv'));
        }
    });

    // обязательный ACK — чтобы не было жёлтой ошибки у пользователя
    bot.on('pre_checkout_query', async (ctx) => {
        try {
            await ctx.answerPreCheckoutQuery(true);
        } catch (e) {
            // даже если ошибка — не падаем
            console.error('pre_checkout_query error:', e);
            try { await ctx.answerPreCheckoutQuery(false, 'Temporary error. Try again.'); } catch {}
        }
    });

    // успешная оплата
    bot.on('message', async (ctx, next) => {
        const sp = ctx.message?.successful_payment;
        if (!sp) return next();

        const uid  = ctx.from.id;
        const lang = getLang(uid);

        // какой план
        const payload = sp.invoice_payload || '';           // 'plan:day_1'
        const planId  = payload.startsWith('plan:') ? payload.slice(5) : null;
        const plan    = planId ? PLANS[planId] : null;

        // страховка: если план не распознался — просто «успешно»
        if (!plan) {
            await ctx.reply(t(lang, 'paid'));
            return;
        }

        // начисления
        try {
            if (plan.hours)   await grantTimePass(uid, plan.hours);  // суммируется к текущему
            if (plan.credits) await grantCredits(uid, plan.credits);
        } catch (e) {
            console.error('grant access error:', e);
        }

        // лог платежа
        try {
            const amount   = (sp.total_amount || 0) / 100;
            const currency = sp.currency || CURRENCY;
            const provId   = sp.provider_payment_charge_id || null;
            const tgId     = sp.telegram_payment_charge_id || null;
            await logPayment(uid, amount, currency, planId, provId, tgId);
        } catch (e) {
            console.error('logPayment error:', e);
        }

        // сводка доступа после начисления
        const used     = totalUsage(uid);
        const freeLeft = Math.max(FREE_TOTAL_LIMIT - used, 0);
        const credits  = myCreditsLeft(uid);
        const passMs   = leftMsFromSqlite(myTimePassUntil(uid));
        const passStr  = passMs > 0
            ? (lang==='ru' ? `осталось ${formatHM(passMs, lang)}`
                : lang==='uk' ? `залишилось ${formatHM(passMs, lang)}`
                    : `left ${formatHM(passMs, lang)}`)
            : (lang==='ru' ? 'нет' : lang==='uk' ? 'немає' : 'none');

        await ctx.reply(t(lang, 'paid'));
        await ctx.reply(
            t(lang, 'summary', [passStr, credits, used, freeLeft, FREE_TOTAL_LIMIT])
        );
    });
}
