
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const admin = require("firebase-admin");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ORDERS_CHAT_ID = process.env.ORDERS_CHAT_ID;
const WEB_APP_URL = process.env.WEB_APP_URL;
const JWT_SECRET = process.env.JWT_SECRET;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Подключение Firebase
let db = null;

try {
  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  );

  if (serviceAccount.private_key) {
    serviceAccount.private_key =
      serviceAccount.private_key.replace(/\\n/g, "\n");
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  db = admin.firestore();

  console.log("Firebase успешно подключён");
} catch (error) {
  console.error("Ошибка подключения Firebase:", error.message);
}

// Проверка готовности авторизации
function authReady(res) {
  if (!db || !JWT_SECRET) {
    res.status(503).json({
      error: "Авторизация временно недоступна"
    });
    return false;
  }

  return true;
}

// Нормализация российского номера телефона
function normalizePhone(value) {
  let phone = String(value || "").replace(/[^\d+]/g, "");

  if (/^8\d{10}$/.test(phone)) {
    phone = "+7" + phone.slice(1);
  } else if (/^7\d{10}$/.test(phone)) {
    phone = "+" + phone;
  } else if (/^\d{10}$/.test(phone)) {
    phone = "+7" + phone;
  }

  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    return null;
  }

  return phone;
}

// Создание токена авторизации
function createToken(phone) {
  return jwt.sign(
    { phone },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

// Проверка токена
function requireAuth(req, res, next) {
  if (!authReady(res)) return;

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : "";

  if (!token) {
    return res.status(401).json({
      error: "Необходимо войти в аккаунт"
    });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({
      error: "Сессия закончилась. Войдите снова."
    });
  }
}

// Регистрация
app.post("/api/register", async (req, res) => {
  if (!authReady(res)) return;

  try {
    const name = String(req.body.name || "").trim();
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || "");

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({
        error: "Введите имя от 2 до 100 символов"
      });
    }

    if (!phone) {
      return res.status(400).json({
        error: "Введите корректный номер телефона"
      });
    }

    if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
      return res.status(400).json({
        error: "Пароль должен содержать от 8 символов"
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const userRef = db.collection("users").doc(phone);

    try {
      await userRef.create({
        name,
        phone,
        passwordHash,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      if (error.code === 6 || error.code === "already-exists") {
        return res.status(409).json({
          error: "Этот номер уже зарегистрирован"
        });
      }

      throw error;
    }

    const token = createToken(phone);

    return res.json({
      success: true,
      token,
      user: { name, phone }
    });

  } catch (error) {
    console.error("Ошибка регистрации:", error.message);

    return res.status(500).json({
      error: "Не удалось создать аккаунт"
    });
  }
});

// Вход
app.post("/api/login", async (req, res) => {
  if (!authReady(res)) return;

  try {
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || "");

    if (!phone || !password) {
      return res.status(400).json({
        error: "Введите телефон и пароль"
      });
    }

    const userRef = db.collection("users").doc(phone);
    const snapshot = await userRef.get();

    if (!snapshot.exists) {
      return res.status(401).json({
        error: "Неверный телефон или пароль"
      });
    }

    const user = snapshot.data();

    const passwordMatches = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        error: "Неверный телефон или пароль"
      });
    }

    const token = createToken(phone);

    return res.json({
      success: true,
      token,
      user: {
        name: user.name,
        phone: user.phone
      }
    });

  } catch (error) {
    console.error("Ошибка входа:", error.message);

    return res.status(500).json({
      error: "Не удалось выполнить вход"
    });
  }
});

// Информация о текущем пользователе
app.get("/api/me", requireAuth, async (req, res) => {
  try {
    const snapshot = await db
      .collection("users")
      .doc(req.user.phone)
      .get();

    if (!snapshot.exists) {
      return res.status(404).json({
        error: "Аккаунт не найден"
      });
    }

    const user = snapshot.data();

    return res.json({
      success: true,
      user: {
        name: user.name,
        phone: user.phone
      }
    });

  } catch (error) {
    console.error("Ошибка получения профиля:", error.message);

    return res.status(500).json({
      error: "Не удалось загрузить профиль"
    });
  }
});

// Проверка подлинности Telegram
function verifyTelegram(initData) {
  if (!BOT_TOKEN || !initData || typeof initData !== "string") {
    return false;
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");

    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
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

    return received.length === calculated.length &&
      crypto.timingSafeEqual(received, calculated);

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
      if (!BOT_TOKEN || !WEB_APP_URL) {
        return res.sendStatus(200);
      }

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

      if (!result.ok) {
        console.error("Ошибка /start:", result.description);
      }
    }

    res.sendStatus(200);

  } catch (error) {
    console.error("Ошибка webhook:", error.message);
    res.sendStatus(500);
  }
});

// Приём заказов
app.post("/api/order", async (req, res) => {
  try {
    const bodyInitData = req.body?.initData;
    const headerInitData = req.get("X-Telegram-Init-Data") || "";
    const initData = headerInitData || bodyInitData || "";

    if (initData && !verifyTelegram(initData)) {
      return res.status(401).json({
        error: "Не удалось подтвердить авторизацию Telegram."
      });
    }

    const { items, customer, phone, comment } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "Корзина пуста"
      });
    }

    if (!ORDERS_CHAT_ID || !BOT_TOKEN) {
      return res.status(500).json({
        error: "Не настроена группа для заказов"
      });
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

      return res.status(502).json({
        error: "Telegram не принял заказ"
      });
    }

    return res.json({ success: true });

  } catch (error) {
    console.error("Ошибка обработки заказа:", error.message);

    return res.status(500).json({
      error: "Ошибка сервера"
    });
  }
});

// Главная страница
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Запуск сервера
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

    console.log("Webhook:", await response.json());

  } catch (error) {
    console.error("Ошибка webhook:", error.message);
  }
});
