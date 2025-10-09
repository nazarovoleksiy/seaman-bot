import 'dotenv/config';
import express from 'express';
import { setupBot } from './bot/setupBot.js';

const app = express();
app.use(express.json());

// health
app.get('/', (_, res) => res.send('Seaman Assistant OK'));

// сборка бота + webhook/polling
const bot = setupBot(app);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⚙️ HTTP on ${PORT}`));

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));