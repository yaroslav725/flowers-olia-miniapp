
const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ORDERS_CHAT_ID = process.env.ORDERS_CHAT_ID;
const WEB_APP_URL = process.env.WEB_APP_URL;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Проверка авторизации Telegram
function verifyTelegram(initData) {
  if (!BOT_TOKEN) {
    console.error("ОШИБКА: BOT_TOKEN не найден в Environment");
    return false;
  }

  if (!initData || typeof initData !== "string") {
    console.error("ОШИБКА: initData не получен");
    return false;
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");

    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
      console.error("ОШИБКА: некорректный hash");
      return false;
    }

    params.delete("hash");

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    const received = Buffer.from(hash, "hex");
    const calculated = Buffer.from(calculatedHash, "hex");

    if (received.length !== calculated.length) {
      console.error("ОШИБКА: длина hash не совпадает");
      return false;
    }

    return crypto.timingSafeEqual(received, calculated);

  } catch (error) {
    console.error("Ошибка проверки Telegram:", error.message);
    return false;
  }
}

// Команда /start
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.message;

    if (message && message.text === "/start") {
      const keyboard = {
        keyboard: [[
          {
            text: "🌸 Открыть каталог",
            web_app: { url: WEB_APP_URL }
          }
        ]],
        resize_keyboard: true
      };

      const response = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: message.chat.id,
            text: "Добро пожаловать в Flowers_olia! 🌷\nЦветы, которые сохраняют любовь.",
            reply_markup: keyboard
          })
        }
      );

      const result = await response.json();
      if (!result.ok) console.error("Ошибка /start:", result.description);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Ошибка webhook:", error.message);
    res.sendStatus(500);
  }
});

// Приём заказов
app.post("/api/order", async (req, res) => {
  console.log("ПОЛУЧЕН ЗАПРОС НА ЗАКАЗ");

  try {
    const { initData, items, customer, phone, comment } = req.body;

    console.log("BOT_TOKEN настроен:", Boolean(BOT_TOKEN));
    console.log("Длина initData:", typeof initData === "string" ? initData.length : 0);

    if (!verifyTelegram(initData)) {
      console.error("Ошибка проверки Telegram initData");
      return res.status(401).json({
        error: "Не удалось подтвердить авторизацию Telegram. Откройте каталог через профиль бота."
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Корзина пуста" });
    }

    if (!ORDERS_CHAT_ID) {
      console.error("ORDERS_CHAT_ID не настроен");
      return res.status(500).json({ error: "Не настроен чат для заказов" });
    }

    const text = [
      "🌸 НОВЫЙ ЗАКАЗ — Flowers_olia",
      "",
      `👤 Имя: ${String(customer || "Не указано").slice(0, 100)}`,
      `📞 Телефон: ${String(phone || "Не указан").slice(0, 50)}`,
      "",
      "🛍 Заказ:",
      ...items.slice(0, 30).map(item =>
        `• ${String(item.name || "Товар").slice(0, 100)} × ${Math.max(1, Math.min(99, Number(item.quantity) || 1))}`
      ),
      "",
      `💌 Комментарий: ${String(comment || "Нет").slice(0, 500)}`
    ].join("\n");

    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: ORDERS_CHAT_ID,
          text
        })
      }
    );

    const result = await response.json();

    if (!result.ok) {
      console.error("Telegram не принял заказ:", result.description);
      return res.status(502).json({ error: "Telegram не принял заказ" });
    }

    console.log("ЗАКАЗ УСПЕШНО ОТПРАВЛЕН");
    res.json({ success: true });

  } catch (error) {
    console.error("Ошибка обработки заказа:", error.message);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`Flowers_olia запущен на ${PORT}`);

  if (!BOT_TOKEN || !WEB_APP_URL) {
    console.error("Не настроен BOT_TOKEN или WEB_APP_URL");
    return;
  }

  try {
    const url = `${WEB_APP_URL.replace(/\/$/, "")}/webhook`;

    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      }
    );

    const result = await response.json();
    console.log("Webhook:", result);

  } catch (error) {
    console.error("Ошибка подключения webhook:", error.message);
  }
});
