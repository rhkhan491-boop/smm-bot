const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');

// ===== ENV =====
const token = process.env.BOT_TOKEN;
const API_KEY = process.env.XhOzeKbAWU0IuMHkV5wzYNHSJjLYIltAhGUAmbsiqhs1bjKym6geDscASuiznJ0h;

if (!token) {
    console.log("❌ BOT TOKEN MISSING");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// ===== CONFIG =====
const API_URL = "https://indiansmmprovider.in/api/v2";
const ADMIN_ID = 6034840006;

// ===== DATA =====
let users = {};
try {
    users = JSON.parse(fs.readFileSync('./users.json'));
} catch {
    users = {};
}

let userState = {};
let cachedServices = [];

// ===== SAVE =====
function saveUsers() {
    fs.writeFileSync('./users.json', JSON.stringify(users, null, 2));
}

// ===== USER =====
function getUser(id) {
    if (!users[id]) users[id] = { balance: 0 };
    return users[id];
}

// ===== PRICE =====
function getPrice(rate) {
    return parseFloat(rate) * 1.4;
}

// ===== API =====
async function loadServices() {
    try {
        const res = await axios.post(API_URL, null, {
            params: { key: API_KEY, action: "services" }
        });

        cachedServices = res.data.slice(0, 50);
        console.log("✅ Services Loaded:", cachedServices.length);
    } catch (e) {
        console.log("API ERROR", e.message);
    }
}

// ===== START =====
bot.onText(/\/start/, async (msg) => {
    await loadServices();

    bot.sendMessage(msg.chat.id, "🚀 RAHI PANEL", {
        reply_markup: {
            keyboard: [
                ["📦 Services", "🔍 Search"],
                ["👛 Balance"]
            ],
            resize_keyboard: true
        }
    });
});

// ===== SHOW SERVICES =====
function showServices(chatId, page = 0, list = cachedServices) {
    let start = page * 10;
    let services = list.slice(start, start + 10);

    let buttons = services.map(s => ([{
        text: `${s.name || "Service"} - ₹${getPrice(s.rate).toFixed(2)}`,
        callback_data: `service_${s.service}`
    }]));

    let nav = [];
    if (page > 0) nav.push({ text: "⬅️ Back", callback_data: `page_${page - 1}` });
    if ((page + 1) * 10 < list.length) nav.push({ text: "➡️ Next", callback_data: `page_${page + 1}` });

    if (nav.length) buttons.push(nav);

    bot.sendMessage(chatId, "📦 Select Service:", {
        reply_markup: { inline_keyboard: buttons }
    });
}

// ===== BUTTON HANDLER =====
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;

    // PAGE
    if (data.startsWith("page_")) {
        let page = parseInt(data.split("_")[1]);
        return showServices(chatId, page);
    }

    // SELECT SERVICE
    if (data.startsWith("service_")) {
        let id = data.split("_")[1];
        let s = cachedServices.find(x => x.service == id);

        if (!s) return bot.sendMessage(chatId, "❌ Service not found");

        userState[chatId] = { step: "link", service: s };

        return bot.sendMessage(chatId,
            `📦 ${s.name}
💰 ₹${getPrice(s.rate).toFixed(2)} / 1000
📉 Min: ${s.min}
📈 Max: ${s.max}

🔗 Send link:`
        );
    }

    // CONFIRM
    if (data === "confirm") {
        let state = userState[chatId];

        let res = await axios.post(API_URL, null, {
            params: {
                key: API_KEY,
                action: "add",
                service: state.service.service,
                link: state.link,
                quantity: state.qty
            }
        });

        if (!res.data || res.data.error) {
            return bot.sendMessage(chatId, "❌ Order failed");
        }

        let user = getUser(chatId);
        user.balance -= state.total;
        saveUsers();

        delete userState[chatId];

        return bot.sendMessage(chatId, `✅ Order placed\nID: ${res.data.order}`);
    }

    if (data === "cancel") {
        delete userState[chatId];
        return bot.sendMessage(chatId, "❌ Cancelled");
    }
});

// ===== MESSAGE FLOW =====
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === "📦 Services") {
        return showServices(chatId, 0);
    }

    if (text === "👛 Balance") {
        let user = getUser(chatId);
        return bot.sendMessage(chatId, `💰 ₹${user.balance}`);
    }

    if (text === "🔍 Search") {
        userState[chatId] = { step: "search" };
        return bot.sendMessage(chatId, "Enter service name:");
    }

    let state = userState[chatId];

    // SEARCH
    if (state?.step === "search") {
        let results = cachedServices.filter(s =>
            s.name?.toLowerCase().includes(text.toLowerCase())
        );

        if (!results.length) return bot.sendMessage(chatId, "❌ No results");

        return showServices(chatId, 0, results);
    }

    // LINK
    if (state?.step === "link") {
        state.link = text;
        state.step = "qty";
        return bot.sendMessage(chatId, "Enter quantity:");
    }

    // QTY
    if (state?.step === "qty") {
        let qty = parseInt(text);
        if (isNaN(qty)) return bot.sendMessage(chatId, "❌ Invalid");

        let s = state.service;
        let total = (getPrice(s.rate) / 1000) * qty;

        state.qty = qty;
        state.total = total;
        state.step = "confirm";

        return bot.sendMessage(chatId,
            `Confirm Order

${s.name}
Qty: ${qty}
Total: ₹${total.toFixed(2)}`,
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

console.log("✅ Bot running...");
