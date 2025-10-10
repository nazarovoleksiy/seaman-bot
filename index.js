import 'dotenv/config';
import express from 'express';
import { setupBot } from './bot/setupBot.js';

const app = express();
app.use(express.json());

app.get('/', (_, res) => res.send('NovaLearn OK'));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('⚙️ HTTP on', PORT));

const bot = setupBot(app);

// корректное завершение
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
