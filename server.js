
const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.use(express.json());
app.post(`/webhook`, async (req, res) => {
  try {
    const message = req.body.message;

    if (message && message.text === "/start") {
      const keyboard = {
        keyboard: [[
          {
            text: "🌸 Открыть каталог",
            web_app: {
              url: process.env.WEB_APP_URL
            }
          }
        ]],
        resize_keyboard: true
      };

      await fetch(
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
    }

    res.sendStatus(200);
  } catch (error) {
    console.error(error);
    res.sendStatus(500);
  }
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const ORDERS_CHAT_ID = process.env.ORDERS_CHAT_ID;

app.use(express.static(path.join(__dirname, "public")));

function verifyTelegram(initData) {
  if (!BOT_TOKEN || !initData) return false;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return false;

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(calculatedHash, "hex")
  );
}

app.post("/api/order", async (req, res) => {
  try {
    const { initData, items, customer, phone, comment } = req.body;

    if (!verifyTelegram(initData)) {
      return res.status(401).json({ error: "Проверка Telegram не пройдена" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Корзина пуста" });
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
      return res.status(502).json({ error: "Telegram не принял заказ" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`Flowers_olia запущен на ${PORT}`);

  try {
    const url = `${process.env.WEB_APP_URL.replace(/\/$/, "")}/webhook`;

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
    console.error("Ошибка подключения webhook:", error);
  }
});
