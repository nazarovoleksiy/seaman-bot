import { Telegraf } from 'telegraf';
import { registerLanguageHandlers } from './handlers/language.js';
import { registerPhotoHandler } from './handlers/photo.js';
import { registerFeedbackHandler } from './handlers/feedback.js';
import { registerLimitCommand } from './handlers/limit.js';
import { registerStatsCommand } from './handlers/stats.js';


export function setupBot(app) {
    const bot = new Telegraf(process.env.BOT_TOKEN);

    // handlers
    registerFeedbackHandler(bot);
    registerLanguageHandlers(bot);
    registerLimitCommand(bot);
    registerPhotoHandler(bot);
    registerStatsCommand(bot);

    // webhook (или polling локально)
    const BASE_URL  = process.env.BASE_URL;   // https://<service>.onrender.com
    const WH_SECRET = process.env.WH_SECRET;  // длинная строка
    const WEBHOOK_PATH = '/tg/webhook';

    if (BASE_URL) {
        const url = `${BASE_URL.replace(/\/+$/, '')}${WEBHOOK_PATH}`;

        app.post(WEBHOOK_PATH, (req, res) => {
            const headerSecret = req.get('x-telegram-bot-api-secret-token');
            if (!WH_SECRET || headerSecret === WH_SECRET) {
                bot.handleUpdate(req.body);
                return res.sendStatus(200);
            }
            return res.sendStatus(401);
        });

        bot.telegram.setWebhook(url, { secret_token: WH_SECRET })
            .then(() => console.log('✅ Webhook set to', url))
            .catch(err => console.error('❌ Webhook set error:', err));
    } else {
        bot.launch().then(() => console.log('✅ Bot polling (local mode)'));
    }

    return bot;
}
