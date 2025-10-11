// payments/stripe.js
import Stripe from 'stripe';
import express from 'express';
import bodyParser from 'body-parser';
import {
    grantCredits,
    grantTimePass,
    logPayment,
} from '../db/database.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
export const stripeRouter = express.Router();

// ---- Продукты ----
export const PRODUCTS = {
    credits100: { name: '100 Credits', amount: 199, type: 'credits', count: 100 },
    credits300: { name: '300 Credits', amount: 499, type: 'credits', count: 300 },
    daypass1:   { name: '1-Day Pass',  amount: 199, type: 'pass',    hours: 24 },
    daypass5:   { name: '5-Day Pass',  amount: 699, type: 'pass',    hours: 120 },
};

// ---- Создание сессии оплаты ----
export async function createCheckout(uid, productKey) {
    const product = PRODUCTS[productKey];
    if (!product) throw new Error('Unknown product key');

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        line_items: [{
            price_data: {
                currency: 'usd',
                product_data: { name: product.name },
                unit_amount: product.amount,
            },
            quantity: 1,
        }],
        success_url: `${process.env.BASE_URL}/stripe/success?uid=${uid}`,
        cancel_url: `${process.env.BASE_URL}/stripe/cancel`,
        metadata: {
            uid: String(uid),
            type: product.type,
            count: product.count || 0,
            hours: product.hours || 0,
            productKey,
        },
    });

    return session.url;
}

// ---- Webhook Stripe ----
stripeRouter.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('❌ Stripe webhook verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const { uid, type, count, hours, productKey } = session.metadata || {};
        const amount = session.amount_total || 0;

        try {
            if (type === 'credits') {
                grantCredits(uid, Number(count));
            } else if (type === 'pass') {
                grantTimePass(uid, Number(hours));
            }
            logPayment(uid, amount / 100, 'USD', productKey, session.id, null);

            // уведомим пользователя
            if (process.env.BOT_TOKEN) {
                const msg = type === 'credits'
                    ? `✅ Payment successful!\n+${count} credits added.`
                    : `✅ Payment successful!\nDay Pass extended by ${hours / 24} day(s).`;
                await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: uid, text: msg }),
                });
            }
            console.log(`✅ Payment processed for uid=${uid}, type=${type}`);
        } catch (e) {
            console.error('Payment processing error:', e);
        }
    }

    res.json({ received: true });
});

// ---- Страницы успеха / отмены ----
stripeRouter.get('/success', (req, res) => {
    res.send('✅ Payment successful. You can return to Telegram.');
});
stripeRouter.get('/cancel', (req, res) => {
    res.send('❌ Payment canceled.');
});
