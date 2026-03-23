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

// ===== DATA =====
let users = {};
try {
    users = JSON.parse(fs.readFileSync('./users.json'));
} catch {
    users = {};
}

let userState = {};
let cachedServices = [];
let userPage = {};

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

// ===== LOAD SERVICES =====
async function loadServices() {
    try {
        const res = await axios.post(API_URL, null, {
            params: { key: API_KEY, action: "services" }
        });

        cachedServices = res.data.slice(0, 50);
        console.log("✅ Services loaded:", cachedServices.length);
    } catch (e) {
        console.log("API ERROR:", e.message);
    }
}

// ===== SHOW PAGE =====
function showPage(chatId) {
    let page = userPage[chatId] || 0;
    let start = page * 10;
    let services = cachedServices.slice(start, start + 10);

    if (!services.length) {
        return bot.sendMessage(chatId, "❌ No services found");
    }

    let msg = `📦 Services (Page ${page + 1})\n\n`;

    services.forEach(s => {
        msg += `🆔 ${s.service}\n`;
        msg += `${s.name || "No Name"}\n`;
        msg += `💰 ₹${getPrice(s.rate).toFixed(2)} /1000\n`;
        msg += `📉 Min: ${s.min} | 📈 Max: ${s.max}\n\n`;
    });

    msg += `\n👉 Use: /buy SERVICE_ID\n`;
    msg += `➡️ /next | ⬅️ /back`;

    bot.sendMessage(chatId, msg);
}

// ===== START =====
bot.onText(/\/start/, async (msg) => {
    await loadServices();

    bot.sendMessage(msg.chat.id,
        "🚀 RAHI PANEL\n\nUse menu:\n📦 Services\n👛 Balance"
    );
});

// ===== COMMANDS =====

// SERVICES
bot.onText(/📦 Services/, async (msg) => {
    if (!cachedServices.length) await loadServices();

    userPage[msg.chat.id] = 0;
    showPage(msg.chat.id);
});

// NEXT
bot.onText(/\/next/, (msg) => {
    let page = userPage[msg.chat.id] || 0;

    if ((page + 1) * 10 >= cachedServices.length) {
        return bot.sendMessage(msg.chat.id, "❌ No more pages");
    }

    userPage[msg.chat.id] = page + 1;
    showPage(msg.chat.id);
});

// BACK
bot.onText(/\/back/, (msg) => {
    let page = userPage[msg.chat.id] || 0;

    if (page === 0) {
        return bot.sendMessage(msg.chat.id, "❌ Already first page");
    }

    userPage[msg.chat.id] = page - 1;
    showPage(msg.chat.id);
});

// BUY
bot.onText(/\/buy (.+)/, (msg, match) => {
    let id = parseInt(match[1]);

    let service = cachedServices.find(s => s.service == id);

    if (!service) {
        return bot.sendMessage(msg.chat.id, "❌ Invalid service ID");
    }

    userState[msg.chat.id] = {
        step: "link",
        service: service
    };

    bot.sendMessage(msg.chat.id,
        `📦 ${service.name}\nSend link:`
    );
});

// MESSAGE FLOW
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === "👛 Balance") {
        let user = getUser(chatId);
        return bot.sendMessage(chatId, `💰 ₹${user.balance}`);
    }

    let state = userState[chatId];

    if (!state) return;

    // LINK
    if (state.step === "link") {
        state.link = text;
        state.step = "qty";
        return bot.sendMessage(chatId, "Enter quantity:");
    }

    // QTY
    if (state.step === "qty") {
        let qty = parseInt(text);
        if (isNaN(qty)) return bot.sendMessage(chatId, "❌ Invalid");

        let s = state.service;
        let total = (getPrice(s.rate) / 1000) * qty;

        state.qty = qty;
        state.total = total;
        state.step = "confirm";

        return bot.sendMessage(chatId,
            `Confirm Order\n\n${s.name}\nQty: ${qty}\nTotal: ₹${total.toFixed(2)}\n\nType YES to confirm`
        );
    }

    // CONFIRM
    if (state.step === "confirm") {
        if (text.toLowerCase() !== "yes") {
            delete userState[chatId];
            return bot.sendMessage(chatId, "❌ Cancelled");
        }

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

        bot.sendMessage(chatId, `✅ Order placed\nID: ${res.data.order}`);
        delete userState[chatId];
    }
});

console.log("✅ Bot running...");
