const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const axios = require('axios');
const QRCode = require('qrcode');

// ===== ENV =====
const token = process.env.BOT_TOKEN;
if (!token) {
    console.error("❌ BOT_TOKEN missing");
    process.exit(1);
}

// ===== BOT =====
const bot = new TelegramBot(token, {
    polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10 }
    }
});

// ===== CONFIG =====
const ADMIN_ID = 6034840006;
const SUPPORT_USERNAME = "@not_your_rahi";
const UPI_ID = "rahikhann@fam";

const API_URL = "https://indiansmmprovider.in/api/v2";
const API_KEY = process.env.API_KEY || "yNjnx92pGXgVBDYfd58PgC1BV5dCbHawdqosI84GsRucBZr18F4YyRpcDLhUxm5o";

// ===== FOLDERS =====
if (!fs.existsSync('./qrs')) fs.mkdirSync('./qrs');

// ===== SAFE JSON LOAD =====
function loadJSON(path) {
    try {
        return JSON.parse(fs.readFileSync(path));
    } catch {
        fs.writeFileSync(path, "{}");
        return {};
    }
}

let users = loadJSON('./users.json');
let userState = {};

// ===== SAVE =====
function saveUsers() {
    try {
        fs.writeFileSync('./users.json', JSON.stringify(users, null, 2));
    } catch (e) {
        console.log("Save error:", e);
    }
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
async function apiRequest(params) {
    try {
        const res = await axios.post(API_URL, null, { params, timeout: 10000 });
        return res.data;
    } catch (err) {
        console.log("API ERROR:", err.message);
        return null;
    }
}

// ===== START =====
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "🚀 RAHI PANEL BOT", {
        reply_markup: {
            keyboard: [
                ["📦 Services", "🔍 Search"],
                ["💰 Add Funds", "👛 Balance"],
                ["📞 Support"]
            ],
            resize_keyboard: true
        }
    });
});

// ===== BASIC COMMANDS =====
bot.on('message', async (msg) => {
    try {
        const text = msg.text;
        const chatId = msg.chat.id;

        if (text === "📞 Support") {
            return bot.sendMessage(chatId, `Contact: ${SUPPORT_USERNAME}`);
        }

        if (text === "👛 Balance") {
            let user = getUser(chatId);
            return bot.sendMessage(chatId, `💰 ₹${user.balance}`);
        }

        if (text === "💰 Add Funds") {
            userState[chatId] = { step: "amount" };
            return bot.sendMessage(chatId, "Enter amount:");
        }

        let state = userState[chatId];

        // ===== ADD FUNDS FLOW =====
        if (state?.step === "amount") {
            let amount = parseFloat(text);
            if (isNaN(amount)) return bot.sendMessage(chatId, "❌ Invalid");

            state.amount = amount;

            let upi = `upi://pay?pa=${UPI_ID}&pn=RAHI&am=${amount}&cu=INR`;
            let file = `./qrs/${chatId}.png`;

            await QRCode.toFile(file, upi);

            state.step = "proof";

            return bot.sendPhoto(chatId, file, {
                caption: `Pay ₹${amount}\nSend screenshot`
            });
        }

        if (state?.step === "proof") {
            if (!msg.photo) return bot.sendMessage(chatId, "❌ Send screenshot");

            let fileId = msg.photo.pop().file_id;

            await bot.sendPhoto(ADMIN_ID, fileId, {
                caption: `Fund Request\nUser: ${chatId}\n₹${state.amount}`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Approve", callback_data: `fund_${chatId}_${state.amount}` }]
                    ]
                }
            });

            bot.sendMessage(chatId, "⏳ Waiting approval");
            delete userState[chatId];
        }

        // ===== SERVICES =====
        if (text === "📦 Services") {
            let services = await apiRequest({ key: API_KEY, action: "services" });
            if (!services) return bot.sendMessage(chatId, "❌ API error");

            let msgText = "📦 Top Services:\n\n";

            services.slice(0, 20).forEach(s => {
                msgText += `🆔 ${s.service}\n${s.name || s.service_name || "No Name"}\n₹${getPrice(s.rate).toFixed(2)}\n\n`;
            });

            return bot.sendMessage(chatId, msgText);
        }

        // ===== ORDER FLOW =====
        if (state?.step === "link") {
            state.link = text;
            state.step = "qty";
            return bot.sendMessage(chatId, "Enter quantity:");
        }

        if (state?.step === "qty") {
            let qty = parseInt(text);
            if (isNaN(qty)) return bot.sendMessage(chatId, "❌ Invalid");

            let services = await apiRequest({ key: API_KEY, action: "services" });
            let s = services?.find(x => x.service == state.service);

            if (!s) return bot.sendMessage(chatId, "❌ Service not found");

            let total = (getPrice(s.rate) / 1000) * qty;
            let user = getUser(chatId);

            if (user.balance < total) {
                delete userState[chatId];
                return bot.sendMessage(chatId, "❌ Low balance");
            }

            state.qty = qty;
            state.total = total;
            state.step = "confirm";

            return bot.sendMessage(chatId,
                `Confirm Order\nQty: ${qty}\n₹${total.toFixed(2)}`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "Confirm", callback_data: "confirm" }],
                            [{ text: "Cancel", callback_data: "cancel" }]
                        ]
                    }
                }
            );
        }

    } catch (err) {
        console.log("MSG ERROR:", err);
    }
});

// ===== BUY COMMAND =====
bot.onText(/\/buy (.+)/, (msg, match) => {
    let id = parseInt(match[1]);
    if (isNaN(id)) return bot.sendMessage(msg.chat.id, "❌ Invalid ID");

    userState[msg.chat.id] = { step: "link", service: id };
    bot.sendMessage(msg.chat.id, "Send link:");
});

// ===== CALLBACK =====
bot.on('callback_query', async (q) => {
    try {
        const chatId = q.message.chat.id;
        const state = userState[chatId];

        if (q.data === "confirm") {
            let res = await apiRequest({
                key: API_KEY,
                action: "add",
                service: state.service,
                link: state.link,
                quantity: state.qty
            });

            if (!res || res.error) {
                return bot.sendMessage(chatId, "❌ Order failed");
            }

            let user = getUser(chatId);
            user.balance -= state.total;
            saveUsers();

            bot.sendMessage(chatId, `✅ Order ID: ${res.order}`);
            delete userState[chatId];
        }

        if (q.data === "cancel") {
            delete userState[chatId];
            bot.sendMessage(chatId, "❌ Cancelled");
        }

        if (q.data.startsWith("fund_")) {
            let [_, id, amount] = q.data.split("_");

            let user = getUser(id);
            user.balance += parseFloat(amount);
            saveUsers();

            bot.sendMessage(id, `✅ ₹${amount} added`);
        }

    } catch (err) {
        console.log("CALLBACK ERROR:", err);
    }
});

// ===== GLOBAL ERROR =====
process.on('uncaughtException', err => console.log("CRASH:", err));
process.on('unhandledRejection', err => console.log("REJECTION:", err));

console.log("✅ Bot running...");
