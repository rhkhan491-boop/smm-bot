const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// ===== ENV CONFIG =====
const token = process.env.8708018037:AAFaa6lYSM3fhVH0P701AcXMixpJhueuZq4;
const API_KEY = process.env.IHTVNZILGtLel3e6Z5RrTB05RVNl3DBagsCEs6XqgFjFgCQQAw6de7tRb2BCGgt1;
const ADMIN_ID = process.env.6034840006;

const API_URL = "https://indiansmmprovider.in/api/v2";

// ===== START BOT =====
if (!token) {
    console.error("❌ BOT TOKEN MISSING");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

console.log("✅ Bot started...");

// ===== BASIC MEMORY (NO FILES) =====
let users = {};
let userState = {};

// ===== FUNCTIONS =====
function getUser(id) {
    if (!users[id]) users[id] = { balance: 0 };
    return users[id];
}

function price(rate) {
    return parseFloat(rate) * 1.4;
}

async function api(params) {
    try {
        const res = await axios.post(API_URL, null, { params });
        return res.data;
    } catch (err) {
        console.log("API ERROR:", err.response?.data || err.message);
        return null;
    }
}

// ===== START =====
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "🚀 RAHI PANEL BOT", {
        reply_markup: {
            keyboard: [
                ["📦 Services"],
                ["👛 Balance"]
            ],
            resize_keyboard: true
        }
    });
});

// ===== BALANCE =====
bot.on('message', (msg) => {
    if (msg.text === "👛 Balance") {
        let user = getUser(msg.chat.id);
        bot.sendMessage(msg.chat.id, `💰 Balance: ₹${user.balance}`);
    }
});

// ===== SERVICES =====
bot.on('message', async (msg) => {
    if (msg.text === "📦 Services") {
        let services = await api({
            key: API_KEY,
            action: "services"
        });

        if (!services) {
            return bot.sendMessage(msg.chat.id, "❌ API Error");
        }

        let text = "📦 Services:\n\n";

        services.slice(0, 20).forEach(s => {
            text += `🆔 ${s.service}\n${s.name}\n₹${price(s.rate).toFixed(2)}\n\n`;
        });

        text += "👉 Use /buy ID";

        bot.sendMessage(msg.chat.id, text);
    }
});

// ===== BUY =====
bot.onText(/\/buy (.+)/, (msg, match) => {
    let id = parseInt(match[1]);
    if (isNaN(id)) return bot.sendMessage(msg.chat.id, "❌ Invalid ID");

    userState[msg.chat.id] = { step: "link", service: id };
    bot.sendMessage(msg.chat.id, "🔗 Send link:");
});

// ===== ORDER FLOW =====
bot.on('message', async (msg) => {
    let state = userState[msg.chat.id];
    if (!state) return;

    if (state.step === "link") {
        state.link = msg.text.split("?")[0];
        state.step = "qty";
        return bot.sendMessage(msg.chat.id, "📊 Enter quantity:");
    }

    if (state.step === "qty") {
        let qty = parseInt(msg.text);
        if (isNaN(qty)) return bot.sendMessage(msg.chat.id, "❌ Invalid");

        let services = await api({ key: API_KEY, action: "services" });
        let s = services.find(x => x.service == state.service);

        if (!s) return bot.sendMessage(msg.chat.id, "❌ Service not found");

        let total = (price(s.rate) / 1000) * qty;

        state.qty = qty;
        state.total = total;
        state.name = s.name;

        state.step = "confirm";

        bot.sendMessage(msg.chat.id,
            `🧾 Order:\n${s.name}\nQty: ${qty}\n₹${total.toFixed(2)}`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "✅ Confirm", callback_data: "confirm" }],
                        [{ text: "❌ Cancel", callback_data: "cancel" }]
                    ]
                }
            }
        );
    }
});

// ===== CALLBACK =====
bot.on('callback_query', async (q) => {
    let chatId = q.message.chat.id;
    let state = userState[chatId];

    if (!state) return;

    if (q.data === "confirm") {
        let res = await api({
            key: API_KEY,
            action: "add",
            service: state.service,
            link: state.link,
            quantity: state.qty
        });

        if (!res || res.error) {
            console.log("ORDER ERROR:", res);
            return bot.sendMessage(chatId, "❌ Order failed");
        }

        bot.sendMessage(chatId, `✅ Order placed\nID: ${res.order}`);
        delete userState[chatId];
    }

    if (q.data === "cancel") {
        delete userState[chatId];
        bot.sendMessage(chatId, "❌ Cancelled");
    }
});
