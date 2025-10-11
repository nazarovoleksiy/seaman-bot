// bot/handlers/buy.js
import { createCheckout } from '../../payments/stripe.js';

export function registerBuyHandler(bot) {
    bot.command('buy', async (ctx) => {
        const lang = (ctx.from.language_code || '').toLowerCase();
        const t = (ru, uk, en) => lang.startsWith('ru') ? ru : lang.startsWith('uk') ? uk : en;

        await ctx.reply(
            t('💳 Выбери пакет:', '💳 Оберіть пакет:', '💳 Choose a package:'),
            {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '100 credits — $1.99', callback_data: 'buy:credits100' },
                            { text: '300 credits — $4.99', callback_data: 'buy:credits300' },
                        ],
                        [
                            { text: '1-Day Pass — $1.99', callback_data: 'buy:daypass1' },
                            { text: '5-Day Pass — $6.99', callback_data: 'buy:daypass5' },
                        ]
                    ]
                }
            }
        );
    });

    bot.on('callback_query', async (ctx) => {
        const data = ctx.callbackQuery?.data || '';
        if (!data.startsWith('buy:')) return;

        const uid = ctx.from.id;
        const productKey = data.split(':')[1];

        try {
            const url = await createCheckout(uid, productKey);
            await ctx.reply('✅ Pay with card:', {
                reply_markup: { inline_keyboard: [[{ text: '💳 Pay now', url }]] }
            });
        } catch (e) {
            console.error('Stripe checkout error:', e);
            await ctx.reply('⚠️ Payment creation failed. Try again later.');
        }
    });
}
