import { Telegraf } from 'telegraf';
import { registerLanguageHandlers } from './handlers/language.js';
import { registerPhotoHandler } from './handlers/photo.js';
import { registerFeedbackHandler } from './handlers/feedback.js';
import { registerLimitCommand } from './handlers/limit.js';
import { registerStatsCommand } from './handlers/stats.js';
import { registerBuyHandler } from './handlers/buy.js';
import { registerAdminHandlers } from './handlers/admin.js';
import { registerAccessCommand } from './handlers/access.js';
import { registerHelpHandler } from './handlers/help.js';

export function setupBot(app){
    const bot = new Telegraf(process.env.BOT_TOKEN);

    // handlers
    registerFeedbackHandler(bot);
    registerLanguageHandlers(bot);
    registerLimitCommand(bot);
    registerPhotoHandler(bot);
    registerStatsCommand(bot);
    registerBuyHandler(bot);
    registerAdminHandlers(bot);
    registerAccessCommand(bot);
    registerHelpHandler(bot);


    // webhook
    const BASE_URL  = process.env.BASE_URL;
    const WH_SECRET = process.env.WH_SECRET;
    const WEBHOOK_PATH = '/tg/webhook';

    if (BASE_URL) {
        const url = `${BASE_URL.replace(/\/+$/,'')}${WEBHOOK_PATH}`;

        app.post(WEBHOOK_PATH, (req,res) => {
            const headerSecret = req.get('x-telegram-bot-api-secret-token');
            if (!WH_SECRET || headerSecret === WH_SECRET) {
                bot.handleUpdate(req.body);
                return res.sendStatus(200);
            }
            return res.sendStatus(401);
        });

        bot.telegram.setWebhook(url, { secret_token: WH_SECRET })
            .then(()=>console.log('✅ Webhook set to', url))
            .catch(err=>console.error('❌ Webhook set error:', err));
    } else {
        bot.launch().then(()=>console.log('✅ Bot polling (local mode)'));
    }

    return bot;
}
