const express = require('express');
const rateLimit = require('express-rate-limit');
const fetch = require('node-fetch');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const channelId = process.env.TELEGRAM_CHANNEL_ID;
const allowedHashes = (process.env.ACCESS_CODE_HASHES || '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

if (!botToken || !channelId) {
  console.warn('[auth-service] Не заданы TELEGRAM_BOT_TOKEN или TELEGRAM_CHANNEL_ID. Проверка подписки будет недоступна.');
}

if (!allowedHashes.length) {
  console.warn('[auth-service] Не заданы ACCESS_CODE_HASHES. Проверка кода доступа будет пропускаться.');
}

app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', apiLimiter);

app.post('/api/check-subscription', async (req, res) => {
  const { username, code } = req.body || {};

  if (!username || !code) {
    return res.status(400).json({
      success: false,
      message: 'Не указан Telegram-аккаунт или код доступа.',
    });
  }

  const normalizedCode = String(code).trim();
  const normalizedUsername = String(username).trim();

  try {
    if (allowedHashes.length) {
      const hash = crypto.createHash('sha256').update(normalizedCode).digest('hex');
      if (!allowedHashes.includes(hash)) {
        return res.status(200).json({
          success: false,
          reason: 'invalid_code',
          message: 'Неверный код доступа. Убедитесь, что используете актуальное значение из канала.',
        });
      }
    }

    if (!botToken || !channelId) {
      return res.status(503).json({
        success: false,
        reason: 'service_unavailable',
        message: 'Проверка подписки временно недоступна. Попробуйте позже.',
      });
    }

    const endpoint = new URL(`https://api.telegram.org/bot${botToken}/getChatMember`);
    endpoint.searchParams.set('chat_id', channelId);
    endpoint.searchParams.set('user_id', normalizedUsername);

    const response = await fetch(endpoint.toString(), { timeout: 8000 });
    const data = await response.json();

    if (!data || !data.ok) {
      const errorDescription = data?.description || 'Ошибка обращения к Telegram API.';
      return res.status(200).json({
        success: false,
        reason: 'telegram_error',
        message: `Не удалось подтвердить подписку: ${errorDescription}`,
      });
    }

    const membershipStatus = data.result?.status;
    const allowedStatuses = new Set(['creator', 'administrator', 'member']);

    if (!allowedStatuses.has(membershipStatus)) {
      return res.status(200).json({
        success: false,
        reason: 'not_subscribed',
        message: 'Подписка на канал не подтверждена. Проверьте, что вы подписаны и используете верный аккаунт.',
      });
    }

    const accessToken = crypto.randomBytes(24).toString('hex');
    return res.json({
      success: true,
      accessToken,
      expiresIn: 3600,
    });
  } catch (error) {
    console.error('[auth-service] Ошибка проверки подписки:', error);
    return res.status(500).json({
      success: false,
      reason: 'internal_error',
      message: 'Произошла внутренняя ошибка сервиса проверки. Попробуйте повторить попытку позже.',
    });
  }
});

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

const staticDir = path.join(__dirname);
if (fs.existsSync(path.join(staticDir, 'index.html'))) {
  app.use(express.static(staticDir));
}

app.use((req, res) => {
  res.status(404).json({ message: 'Маршрут не найден.' });
});

app.listen(port, () => {
  console.log(`[auth-service] Сервер запущен на порту ${port}`);
});
