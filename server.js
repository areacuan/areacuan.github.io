const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ========== Trust Proxy ==========
app.set("trust proxy", true);

// ========== Middleware ==========
app.use(cors({ origin: "*", methods: "*", allowedHeaders: "*" }));
app.options("*", cors());
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "10mb" }));

// ========== Headers ==========
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    const t = new Date().toLocaleTimeString("id-ID");
    console.log(`[${t}] ${req.method} ${req.originalUrl} | ${req.ip}`);
    next();
});

// ========== Static Files ==========
app.use(express.static(path.join(__dirname), { maxAge: "1h", etag: true, index: "index.html" }));
app.use("/js", express.static(path.join(__dirname, "js")));

// ========== Import API Handlers ==========
const createOrder = require("./api/create-order");
const checkStatus = require("./api/check-status");
const webhookHandler = require("./api/webhook");

// ========== Shared Data ==========
const { orderStore, PRODUCTS } = createOrder;

// ========== API Routes ==========
app.get("/api/ping", (req, res) => {
    res.json({ ok: true, message: "pong", ts: new Date().toISOString(), uptime: Math.floor(process.uptime()) + "s" });
});

app.post("/api/create-order", (req, res) => createOrder.handler(req, res));
app.post("/api/check-status", (req, res) => checkStatus.handler(req, res));
app.post("/api/webhook", (req, res) => webhookHandler.handler(req, res));

app.get("/api/webhook/history", (req, res) => {
    res.json({ ok: true, total: webhookHandler.history.length, history: webhookHandler.history });
});

// ========== Products ==========
app.get("/api/products", (req, res) => {
    let list = [...PRODUCTS];
    const { category, search } = req.query;
    if (category && category !== "all") list = list.filter(p => p.category === category);
    if (search) {
        const q = search.toLowerCase();
        list = list.filter(p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
    }
    res.json({ ok: true, products: list, total: list.length });
});

app.get("/api/products/:id", (req, res) => {
    const p = PRODUCTS.find(x => x.id === req.params.id);
    if (!p) return res.json({ ok: false, error: "Produk tidak ditemukan" });
    res.json({ ok: true, product: p });
});

// ========== Orders ==========
app.get("/api/order/:id", (req, res) => {
    const o = orderStore.get(req.params.id);
    if (!o) return res.json({ ok: false, error: "Order tidak ditemukan" });
    res.json({ ok: true, order: o });
});

app.get("/api/orders", (req, res) => {
    let list = Array.from(orderStore.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (req.query.status) list = list.filter(o => o.status === req.query.status);
    res.json({ ok: true, orders: list, total: list.length });
});

// ========== Stats ==========
app.get("/api/stats", (req, res) => {
    const all = Array.from(orderStore.values());
    const paid = all.filter(o => o.status === "paid" || o.status === "delivered");
    res.json({
        ok: true,
        stats: {
            total_orders: all.length,
            paid_orders: paid.length,
            pending_orders: all.filter(o => o.status === "pending").length,
            expired_orders: all.filter(o => o.status === "expired").length,
            total_revenue: paid.reduce((s, o) => s + o.total_amount, 0),
            total_products: PRODUCTS.length,
            uptime: Math.floor(process.uptime()) + "s"
        }
    });
});

// ========== Pages ==========
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("*", (req, res) => {
    if (req.originalUrl.startsWith("/api/")) return res.status(404).json({ ok: false, error: "Not found" });
    res.sendFile(path.join(__dirname, "index.html"));
});

// ========== Error Handler ==========
app.use((err, req, res, next) => {
    console.error("❌ SERVER ERROR:", err.message);
    res.status(500).json({ ok: false, error: "Server error" });
});

// ========== Start ==========
const server = app.listen(PORT, "0.0.0.0", () => {
    console.log("");
    console.log("╔════════════════════════════════════════════╗");
    console.log("║     🛒  AUTO ORDER SERVER READY            ║");
    console.log("╠════════════════════════════════════════════╣");
    console.log(`║  🌐 http://localhost:${PORT}                    ║`);
    console.log(`║  📦 Products: ${PRODUCTS.length}                          ║`);
    console.log("║  ✅ Status: ONLINE                         ║");
    console.log("╚════════════════════════════════════════════╝");
    console.log("");
});

// ========== Graceful Shutdown ==========
const shutdown = (sig) => {
    console.log(`\n🛑 ${sig} received. Shutting down...`);
    server.close(() => { console.log("✅ Closed."); process.exit(0); });
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (e) => console.error("❌ Uncaught:", e.message));
process.on("unhandledRejection", (r) => console.error("❌ Unhandled:", r));