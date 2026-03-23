const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const axios = require('axios');
const QRCode = require('qrcode');

// ===== ENV =====
const token = process.env.BOT_TOKEN;
const API_KEY = process.env.TPx2ymBmiN3kAv4zWMMEJKralxz55Zp0uuI1EOCWvGI9SwV9NFEQff55vzCTKhZZ;

if (!token) {
    console.log("❌ BOT TOKEN MISSING");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// ===== CONFIG =====
const ADMIN_ID = 6034840006;
const SUPPORT_USERNAME = "@not_your_rahi";
const UPI_ID = "rahikhann@fam";

const API_URL = "https://indiansmmprovider.in/api/v2";

// ===== DATA =====
let users = {};
try {
    users = JSON.parse(fs.readFileSync('./users.json'));
} catch {
    users = {};
}

let userState = {};

// ===== FUNCTIONS =====
function saveUsers() {
    fs.writeFileSync('./users.json', JSON.stringify(users, null, 2));
}

function getUser(id) {
    if (!users[id]) users[id] = { balance: 0 };
    return users[id];
}

function getPrice(rate) {
    return parseFloat(rate) * 1.4;
}

async function apiRequest(params) {
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
                ["📦 Services", "🔍 Search"],
                ["💰 Add Funds", "👛 Balance"],
                ["📞 Support"]
            ],
            resize_keyboard: true
        }
    });
});

// ===== SUPPORT =====
bot.on('message', (msg) => {
    if (msg.text === "📞 Support") {
        bot.sendMessage(msg.chat.id, `Contact support: ${SUPPORT_USERNAME}`);
    }
});

// ===== BALANCE =====
bot.on('message', (msg) => {
    if (msg.text === "👛 Balance") {
        let user = getUser(msg.chat.id);
        bot.sendMessage(msg.chat.id, `💰 Balance: ₹${user.balance}`);
    }
});

// ===== ADD FUNDS =====
bot.on('message', async (msg) => {
    if (msg.text === "💰 Add Funds") {
        userState[msg.chat.id] = { step: "add_amount" };
        return bot.sendMessage(msg.chat.id, "Enter amount:");
    }

    let state = userState[msg.chat.id];

    if (state?.step === "add_amount") {
        let amount = parseFloat(msg.text);
        if (isNaN(amount)) return bot.sendMessage(msg.chat.id, "❌ Invalid");

        state.amount = amount;

        let upiLink = `upi://pay?pa=${UPI_ID}&pn=RAHI&am=${amount}&cu=INR`;
        let filePath = `./qrs/${msg.chat.id}.png`;

        if (!fs.existsSync('./qrs')) fs.mkdirSync('./qrs');

        await QRCode.toFile(filePath, upiLink);

        state.step = "add_payment";

        return bot.sendPhoto(msg.chat.id, filePath, {
            caption: `💰 Pay ₹${amount}\nUPI: ${UPI_ID}\nSend screenshot`
        });
    }

    if (state?.step === "add_payment") {
        if (!msg.photo) return bot.sendMessage(msg.chat.id, "❌ Send screenshot");

        let fileId = msg.photo[msg.photo.length - 1].file_id;

        bot.sendPhoto(ADMIN_ID, fileId, {
            caption: `💰 Add Funds\nUser: ${msg.chat.id}\nAmount: ₹${state.amount}`,
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✅ Approve", callback_data: `fund_${msg.chat.id}_${state.amount}` }]
                ]
            }
        });

        bot.sendMessage(msg.chat.id, "⏳ Waiting for approval...");
        delete userState[msg.chat.id];
    }
});

// ===== SERVICES =====
bot.on('message', async (msg) => {
    if (msg.text === "📦 Services") {
        let services = await apiRequest({
            key: API_KEY,
            action: "services"
        });

        if (!services) return bot.sendMessage(msg.chat.id, "❌ API Error");

        let message = "📦 Services (Top 20):\n\n";

        services.slice(0, 20).forEach(s => {
            message += `🆔 ${s.service}\n${s.name}\n₹${getPrice(s.rate).toFixed(2)}\n\n`;
        });

        message += "👉 /buy ID";

        bot.sendMessage(msg.chat.id, message);
    }
});

// ===== SEARCH =====
bot.onText(/\/search (.+)/, async (msg, match) => {
    let query = match[1].toLowerCase();

    let services = await apiRequest({
        key: API_KEY,
        action: "services"
    });

    let results = services.filter(s => s.name.toLowerCase().includes(query)).slice(0, 10);

    if (results.length === 0) return bot.sendMessage(msg.chat.id, "❌ No results");

    let message = "🔍 Results:\n\n";

    results.forEach(s => {
        message += `🆔 ${s.service}\n${s.name}\n₹${getPrice(s.rate).toFixed(2)}\n\n`;
    });

    bot.sendMessage(msg.chat.id, message);
});

// ===== BUY =====
bot.onText(/\/buy (.+)/, (msg, match) => {
    let id = parseInt(match[1]);
    if (isNaN(id)) return bot.sendMessage(msg.chat.id, "❌ Invalid ID");

    userState[msg.chat.id] = { step: "link", service: id };
    bot.sendMessage(msg.chat.id, "Send link:");
});

// ===== ORDER FLOW =====
bot.on('message', async (msg) => {
    let state = userState[msg.chat.id];
    if (!state) return;

    if (state.step === "link") {
        state.link = msg.text.split("?")[0];
        state.step = "qty";
        return bot.sendMessage(msg.chat.id, "Enter quantity:");
    }

    if (state.step === "qty") {
        let qty = parseInt(msg.text);
        if (isNaN(qty)) return bot.sendMessage(msg.chat.id, "❌ Invalid");

        let services = await apiRequest({ key: API_KEY, action: "services" });
        let s = services.find(x => x.service == state.service);

        if (!s) return bot.sendMessage(msg.chat.id, "❌ Service not found");

        let total = (getPrice(s.rate) / 1000) * qty;

        let user = getUser(msg.chat.id);
        if (user.balance < total) return bot.sendMessage(msg.chat.id, "❌ Low balance");

        state.qty = qty;
        state.total = total;
        state.name = s.name;

        state.step = "confirm";

        bot.sendMessage(msg.chat.id,
            `Order:\n${s.name}\nQty: ${qty}\n₹${total.toFixed(2)}`,
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

    if (q.data === "confirm") {
        let res = await apiRequest({
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

        let user = getUser(chatId);
        user.balance -= state.total;
        saveUsers();

        bot.sendMessage(chatId, `✅ Order placed\nID: ${res.order}`);
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
});
