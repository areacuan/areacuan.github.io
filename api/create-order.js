// ================================================================
//
//   CREATE ORDER + QRIS PAYMENT
//   Pakasir Payment Gateway Integration
//
//   Endpoint : POST /api/create-order
//   Version  : 2.0.0
//
//   Features:
//   - Product catalog management
//   - Order creation with validation
//   - QRIS generation via Pakasir API
//   - In-memory order store
//   - Rate limiting per email
//   - Stock management
//   - Comprehensive logging
//
// ================================================================

const crypto = require("crypto");

// ================================================================
//  1. CONFIGURATION
// ================================================================

/** Pakasir API configuration */
const PAKASIR = {
    SLUG: process.env.PROJECT_SLUG || "cupzyyy",
    KEY: process.env.API_KEY || "x5ex44h3cexOAvi37EOEKMlFvRPsGa3f",
    BASE_URL: "https://app.pakasir.com/api",
    TIMEOUT: 30000
};

/** Order configuration */
const ORDER_CONFIG = {
    MIN_AMOUNT: 1000,
    MAX_AMOUNT: 10000000,
    MIN_QTY: 1,
    MAX_QTY: 99,
    MAX_NAME_LENGTH: 100,
    MAX_EMAIL_LENGTH: 200,
    ORDER_PREFIX: "ORD",
    RATE_LIMIT_WINDOW: 60000,
    RATE_LIMIT_MAX: 10
};

/** Email validation regex */
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// ================================================================
//  2. PRODUCT CATALOG
// ================================================================

/**
 * Product database.
 * In production, this would come from a real database.
 * Each product has: id, name, desc, price, icon, color, category, stock, popular
 */
const PRODUCTS = [
    {
        id: "vip-1d",
        name: "VIP 1 Hari",
        desc: "Akses premium selama 1 hari penuh dengan semua fitur",
        price: 5000,
        icon: "crown",
        color: "#f59e0b",
        category: "membership",
        stock: 999,
        popular: false,
        created_at: "2025-01-01T00:00:00.000Z"
    },
    {
        id: "vip-7d",
        name: "VIP 7 Hari",
        desc: "Akses premium selama 7 hari, hemat lebih banyak",
        price: 25000,
        icon: "gem",
        color: "#8b5cf6",
        category: "membership",
        stock: 999,
        popular: true,
        created_at: "2025-01-01T00:00:00.000Z"
    },
    {
        id: "vip-30d",
        name: "VIP 30 Hari",
        desc: "Akses premium 1 bulan penuh, pilihan terbaik",
        price: 75000,
        icon: "diamond",
        color: "#ec4899",
        category: "membership",
        stock: 999,
        popular: true,
        created_at: "2025-01-01T00:00:00.000Z"
    },
    {
        id: "coin-100",
        name: "100 Koin",
        desc: "Tambah 100 koin ke akun kamu secara instan",
        price: 10000,
        icon: "coins",
        color: "#eab308",
        category: "topup",
        stock: 999,
        popular: false,
        created_at: "2025-01-01T00:00:00.000Z"
    },
    {
        id: "coin-500",
        name: "500 Koin",
        desc: "Paket 500 koin dengan bonus ekstra",
        price: 45000,
        icon: "sack-dollar",
        color: "#22c55e",
        category: "topup",
        stock: 999,
        popular: true,
        created_at: "2025-01-01T00:00:00.000Z"
    },
    {
        id: "coin-1k",
        name: "1000 Koin",
        desc: "Paket koin terbesar dan paling hemat",
        price: 80000,
        icon: "trophy",
        color: "#f97316",
        category: "topup",
        stock: 999,
        popular: false,
        created_at: "2025-01-01T00:00:00.000Z"
    },
    {
        id: "bot-basic",
        name: "Script Bot Basic",
        desc: "Bot auto farming edisi basic untuk pemula",
        price: 50000,
        icon: "robot",
        color: "#06b6d4",
        category: "digital",
        stock: 50,
        popular: false,
        created_at: "2025-01-01T00:00:00.000Z"
    },
    {
        id: "bot-pro",
        name: "Script Bot Pro",
        desc: "Bot professional dengan fitur lengkap dan support",
        price: 150000,
        icon: "rocket",
        color: "#6366f1",
        category: "digital",
        stock: 30,
        popular: true,
        created_at: "2025-01-01T00:00:00.000Z"
    },
    {
        id: "ebook",
        name: "E-Book Trading",
        desc: "Panduan trading lengkap dari nol sampai profit",
        price: 35000,
        icon: "book-open",
        color: "#14b8a6",
        category: "digital",
        stock: 100,
        popular: false,
        created_at: "2025-01-01T00:00:00.000Z"
    },
    {
        id: "vcr-50k",
        name: "Voucher Game 50K",
        desc: "Voucher game senilai Rp 50.000 all platform",
        price: 52000,
        icon: "gamepad",
        color: "#e11d48",
        category: "voucher",
        stock: 200,
        popular: true,
        created_at: "2025-01-01T00:00:00.000Z"
    },
    {
        id: "pulsa-10k",
        name: "Pulsa 10.000",
        desc: "Pulsa all operator Rp 10.000 instant",
        price: 12000,
        icon: "mobile-screen",
        color: "#0ea5e9",
        category: "pulsa",
        stock: 500,
        popular: false,
        created_at: "2025-01-01T00:00:00.000Z"
    },
    {
        id: "pulsa-25k",
        name: "Pulsa 25.000",
        desc: "Pulsa all operator Rp 25.000 instant",
        price: 27000,
        icon: "mobile-screen-button",
        color: "#3b82f6",
        category: "pulsa",
        stock: 500,
        popular: false,
        created_at: "2025-01-01T00:00:00.000Z"
    }
];

// ================================================================
//  3. DATA STORES
// ================================================================

/** In-memory order store */
const orderStore = new Map();

/** Rate limit tracker: email -> { count, resetAt } */
const rateLimitStore = new Map();

/** Order statistics */
const stats = {
    total_created: 0,
    total_paid: 0,
    total_failed: 0,
    total_revenue: 0,
    last_order_at: null
};

// ================================================================
//  4. HELPER FUNCTIONS
// ================================================================

/**
 * Generate unique order ID
 * Format: ORD-{timestamp}-{random_hex}
 * @returns {string} Unique order ID
 */
function generateOrderId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString("hex").toUpperCase();
    return `${ORDER_CONFIG.ORDER_PREFIX}-${timestamp}-${random}`;
}

/**
 * Extract valid QRIS string from Pakasir response.
 * Pakasir sometimes prepends extra data before the QRIS payload.
 * Valid QRIS always starts with "00020101".
 *
 * @param {string} raw - Raw payment_number from Pakasir
 * @returns {string|null} Valid QRIS string or null
 */
function extractQris(raw) {
    // Null / undefined check
    if (!raw || typeof raw !== "string") {
        console.log("  [QRIS] Input is null/empty");
        return null;
    }

    // Trim whitespace
    const trimmed = raw.trim();

    // Already valid QRIS
    if (trimmed.startsWith("00020101")) {
        console.log("  [QRIS] Valid QRIS found at start, length:", trimmed.length);
        return trimmed;
    }

    // Search for QRIS marker within string
    const markerIndex = trimmed.indexOf("00020101");
    if (markerIndex >= 0) {
        const extracted = trimmed.substring(markerIndex);
        console.log(`  [QRIS] Found marker at index ${markerIndex}, extracted length: ${extracted.length}`);
        return extracted;
    }

    // No valid QRIS found
    console.log("  [QRIS] No valid QRIS marker found in string of length:", trimmed.length);
    return null;
}

/**
 * Sanitize string input.
 * Removes HTML tags and special characters.
 *
 * @param {*} input - Input to sanitize
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} Sanitized string
 */
function sanitize(input, maxLength = 200) {
    if (input === null || input === undefined) return "";
    if (typeof input !== "string") input = String(input);

    return input
        .replace(/<[^>]*>/g, "")       // Remove HTML tags
        .replace(/[<>"'&\\]/g, "")     // Remove dangerous chars
        .replace(/\s+/g, " ")          // Normalize whitespace
        .trim()
        .substring(0, maxLength);
}

/**
 * Validate email format.
 *
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid
 */
function isValidEmail(email) {
    if (!email || typeof email !== "string") return false;
    const trimmed = email.trim().toLowerCase();
    if (trimmed.length < 5 || trimmed.length > ORDER_CONFIG.MAX_EMAIL_LENGTH) return false;
    return EMAIL_REGEX.test(trimmed);
}

/**
 * Format number to Indonesian Rupiah string.
 *
 * @param {number} amount - Amount to format
 * @returns {string} Formatted Rupiah string
 */
function formatRupiah(amount) {
    return "Rp " + Number(amount).toLocaleString("id-ID");
}

/**
 * Find product by ID.
 *
 * @param {string} productId - Product ID to find
 * @returns {object|null} Product object or null
 */
function findProduct(productId) {
    if (!productId || typeof productId !== "string") return null;
    return PRODUCTS.find(p => p.id === productId) || null;
}

/**
 * Check rate limit for an email.
 *
 * @param {string} email - Email to check
 * @returns {boolean} True if rate limited
 */
function isRateLimited(email) {
    const now = Date.now();
    const key = email.toLowerCase().trim();

    // Clean expired entries
    for (const [k, v] of rateLimitStore.entries()) {
        if (now > v.resetAt) {
            rateLimitStore.delete(k);
        }
    }

    // Check current limit
    const entry = rateLimitStore.get(key);
    if (!entry) {
        rateLimitStore.set(key, {
            count: 1,
            resetAt: now + ORDER_CONFIG.RATE_LIMIT_WINDOW
        });
        return false;
    }

    if (now > entry.resetAt) {
        rateLimitStore.set(key, {
            count: 1,
            resetAt: now + ORDER_CONFIG.RATE_LIMIT_WINDOW
        });
        return false;
    }

    entry.count++;
    if (entry.count > ORDER_CONFIG.RATE_LIMIT_MAX) {
        console.log(`  [RATE] Email ${key} rate limited: ${entry.count}/${ORDER_CONFIG.RATE_LIMIT_MAX}`);
        return true;
    }

    return false;
}

/**
 * Log order event with consistent formatting.
 *
 * @param {string} event - Event type
 * @param {string} orderId - Order ID
 * @param {object} data - Additional data
 */
function logOrder(event, orderId, data = {}) {
    const timestamp = new Date().toISOString();
    const icon = {
        CREATE: "📦",
        SUCCESS: "✅",
        ERROR: "❌",
        VALIDATE: "🔍",
        PAKASIR: "🔗",
        QRIS: "📱"
    }[event] || "ℹ️";

    console.log(`${icon} [${event}] ${orderId || "-"} | ${JSON.stringify(data).substring(0, 200)}`);
}

/**
 * Create response object with consistent format.
 *
 * @param {boolean} ok - Success status
 * @param {object} data - Response data
 * @returns {object} Response object
 */
function createResponse(ok, data = {}) {
    return { ok, ...data, timestamp: new Date().toISOString() };
}

/**
 * Validate order input comprehensively.
 *
 * @param {object} body - Request body
 * @returns {object} { valid: boolean, error?: string, data?: object }
 */
function validateOrderInput(body) {
    // Product ID
    const productId = sanitize(body.product_id, 50);
    if (!productId) {
        return { valid: false, error: "Pilih produk terlebih dahulu" };
    }

    // Email
    const email = sanitize(body.buyer_email, ORDER_CONFIG.MAX_EMAIL_LENGTH);
    if (!email) {
        return { valid: false, error: "Email wajib diisi" };
    }
    if (!isValidEmail(email)) {
        return { valid: false, error: "Format email tidak valid" };
    }

    // Name (optional)
    const name = sanitize(body.buyer_name, ORDER_CONFIG.MAX_NAME_LENGTH) || "Guest";

    // Quantity
    let quantity = parseInt(body.quantity);
    if (isNaN(quantity) || quantity < ORDER_CONFIG.MIN_QTY) {
        quantity = ORDER_CONFIG.MIN_QTY;
    }
    if (quantity > ORDER_CONFIG.MAX_QTY) {
        return { valid: false, error: `Maksimal pembelian ${ORDER_CONFIG.MAX_QTY} item` };
    }

    // Find product
    const product = findProduct(productId);
    if (!product) {
        return { valid: false, error: "Produk tidak ditemukan atau sudah dihapus" };
    }

    // Check stock
    if (product.stock <= 0) {
        return { valid: false, error: `Maaf, ${product.name} sudah habis` };
    }
    if (product.stock < quantity) {
        return { valid: false, error: `Stok ${product.name} tersisa ${product.stock} item` };
    }

    // Calculate total
    const totalAmount = product.price * quantity;

    // Validate amount range
    if (totalAmount < ORDER_CONFIG.MIN_AMOUNT) {
        return { valid: false, error: `Minimal pembayaran ${formatRupiah(ORDER_CONFIG.MIN_AMOUNT)}` };
    }
    if (totalAmount > ORDER_CONFIG.MAX_AMOUNT) {
        return { valid: false, error: `Maksimal pembayaran ${formatRupiah(ORDER_CONFIG.MAX_AMOUNT)}` };
    }

    // Rate limit check
    if (isRateLimited(email)) {
        return { valid: false, error: "Terlalu banyak permintaan. Coba lagi dalam 1 menit." };
    }

    return {
        valid: true,
        data: {
            productId,
            email: email.toLowerCase().trim(),
            name,
            quantity,
            product,
            totalAmount
        }
    };
}

/**
 * Call Pakasir API to create QRIS payment.
 *
 * @param {string} orderId - Order ID
 * @param {number} amount - Payment amount
 * @returns {Promise<object>} Pakasir response
 */
async function callPakasirCreateQris(orderId, amount) {
    const url = `${PAKASIR.BASE_URL}/transactioncreate/qris`;

    const payload = {
        project: PAKASIR.SLUG,
        order_id: orderId,
        amount: amount,
        api_key: PAKASIR.KEY
    };

    logOrder("PAKASIR", orderId, {
        url: url,
        slug: PAKASIR.SLUG,
        amount: amount,
        hasKey: !!PAKASIR.KEY
    });

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PAKASIR.TIMEOUT);

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "AutoStore/2.0"
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeout);

        // Parse response text first for better error handling
        const responseText = await response.text();
        let responseJson;

        try {
            responseJson = JSON.parse(responseText);
        } catch (parseError) {
            console.error("  [PAKASIR] JSON parse error:", responseText.substring(0, 200));
            return {
                success: false,
                error: "Invalid response from payment gateway"
            };
        }

        logOrder("PAKASIR", orderId, {
            status: response.status,
            hasPayment: !!responseJson.payment,
            preview: JSON.stringify(responseJson).substring(0, 150)
        });

        // Check for payment object
        if (!responseJson.payment) {
            return {
                success: false,
                error: "No payment data in response",
                raw: responseJson
            };
        }

        const payment = responseJson.payment;

        // Check for payment number (QRIS string)
        if (!payment.payment_number) {
            return {
                success: false,
                error: "No QRIS data in payment",
                raw: responseJson
            };
        }

        // Extract and validate QRIS
        const qris = extractQris(payment.payment_number);
        if (!qris) {
            return {
                success: false,
                error: "Could not extract valid QRIS",
                raw: payment.payment_number.substring(0, 50)
            };
        }

        return {
            success: true,
            qris: qris,
            totalPayment: payment.total_payment || amount,
            fee: payment.fee || 0,
            expiredAt: payment.expired_at || null,
            raw: responseJson
        };

    } catch (fetchError) {
        if (fetchError.name === "AbortError") {
            console.error("  [PAKASIR] Request timeout after", PAKASIR.TIMEOUT, "ms");
            return { success: false, error: "Payment gateway timeout" };
        }

        console.error("  [PAKASIR] Fetch error:", fetchError.message);
        return { success: false, error: "Cannot connect to payment gateway" };
    }
}

/**
 * Build order data object.
 *
 * @param {string} orderId - Generated order ID
 * @param {object} validData - Validated input data
 * @param {object} pakasirResult - Pakasir API result
 * @returns {object} Complete order object
 */
function buildOrderData(orderId, validData, pakasirResult) {
    const { product, email, name, quantity, totalAmount } = validData;

    return {
        order_id: orderId,
        product_id: product.id,
        product_name: product.name,
        product_desc: product.desc,
        product_icon: product.icon,
        product_color: product.color,
        product_category: product.category,
        quantity: quantity,
        unit_price: product.price,
        total_amount: totalAmount,
        total_payment: pakasirResult.totalPayment,
        fee: pakasirResult.fee,
        buyer_email: email,
        buyer_name: name,
        qris: pakasirResult.qris,
        status: "pending",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        expired_at: pakasirResult.expiredAt,
        paid_at: null,
        delivered_at: null,
        delivery_code: null,
        delivery_message: null,
        ip_address: null,
        user_agent: null
    };
}

// ================================================================
//  5. MAIN HANDLER
// ================================================================

/**
 * POST /api/create-order
 *
 * Creates a new order and generates QRIS payment via Pakasir.
 *
 * Request body:
 * {
 *   product_id: string (required),
 *   buyer_email: string (required),
 *   buyer_name: string (optional),
 *   quantity: number (optional, default: 1)
 * }
 *
 * Success response:
 * {
 *   ok: true,
 *   order_id: string,
 *   product_name: string,
 *   product_icon: string,
 *   product_color: string,
 *   quantity: number,
 *   unit_price: number,
 *   total_amount: number,
 *   total_payment: number,
 *   fee: number,
 *   qris: string,
 *   expired_at: string|null
 * }
 *
 * Error response:
 * {
 *   ok: false,
 *   error: string
 * }
 */
async function handler(req, res) {
    // -------- Method check --------
    if (req.method !== "POST") {
        return res.status(405).json(
            createResponse(false, { error: "Method not allowed. Use POST." })
        );
    }

    const startTime = Date.now();

    try {
        // -------- Log incoming request --------
        console.log("");
        console.log("╔══════════════════════════════════════════╗");
        console.log("║         📦 NEW ORDER REQUEST              ║");
        console.log("╚══════════════════════════════════════════╝");

        const clientIp = req.headers["x-forwarded-for"] || req.ip || "unknown";
        const userAgent = (req.headers["user-agent"] || "unknown").substring(0, 100);

        logOrder("CREATE", null, {
            ip: clientIp,
            body: JSON.stringify(req.body).substring(0, 200)
        });

        // -------- Validate input --------
        const validation = validateOrderInput(req.body || {});

        if (!validation.valid) {
            logOrder("VALIDATE", null, { error: validation.error });
            return res.json(createResponse(false, { error: validation.error }));
        }

        const { productId, email, name, quantity, product, totalAmount } = validation.data;

        logOrder("VALIDATE", null, {
            product: product.name,
            qty: quantity,
            total: formatRupiah(totalAmount),
            email: email
        });

        // -------- Generate Order ID --------
        const orderId = generateOrderId();
        logOrder("CREATE", orderId, { step: "ID generated" });

        // -------- Call Pakasir API --------
        const pakasirResult = await callPakasirCreateQris(orderId, totalAmount);

        if (!pakasirResult.success) {
            logOrder("ERROR", orderId, {
                step: "Pakasir failed",
                error: pakasirResult.error
            });
            return res.json(createResponse(false, {
                error: pakasirResult.error || "Gagal membuat pembayaran QRIS. Silakan coba lagi."
            }));
        }

        logOrder("QRIS", orderId, {
            qrisLength: pakasirResult.qris.length,
            fee: pakasirResult.fee,
            totalPayment: pakasirResult.totalPayment
        });

        // -------- Build & save order --------
        const orderData = buildOrderData(orderId, validation.data, pakasirResult);
        orderData.ip_address = clientIp;
        orderData.user_agent = userAgent;

        orderStore.set(orderId, orderData);

        // Update stats
        stats.total_created++;
        stats.last_order_at = new Date().toISOString();

        const elapsed = Date.now() - startTime;

        logOrder("SUCCESS", orderId, {
            product: product.name,
            qty: quantity,
            total: formatRupiah(totalAmount),
            email: email,
            elapsed: elapsed + "ms"
        });

        console.log(`  ✅ Order created in ${elapsed}ms`);
        console.log("");

        // -------- Return success response --------
        return res.json(createResponse(true, {
            order_id: orderId,
            product_name: product.name,
            product_icon: product.icon,
            product_color: product.color,
            quantity: quantity,
            unit_price: product.price,
            total_amount: totalAmount,
            total_payment: pakasirResult.totalPayment,
            fee: pakasirResult.fee,
            qris: pakasirResult.qris,
            expired_at: pakasirResult.expiredAt
        }));

    } catch (error) {
        // -------- Global error handler --------
        const elapsed = Date.now() - startTime;

        console.error("");
        console.error("❌ CREATE ORDER FATAL ERROR");
        console.error("   Message:", error.message);
        console.error("   Stack:", error.stack);
        console.error("   Elapsed:", elapsed + "ms");
        console.error("");

        return res.json(createResponse(false, {
            error: "Terjadi kesalahan server. Silakan coba beberapa saat lagi."
        }));
    }
}

// ================================================================
//  6. UTILITY EXPORTS
// ================================================================

/**
 * Get all products.
 * @returns {Array} Product list
 */
function getProducts() {
    return [...PRODUCTS];
}

/**
 * Get order by ID.
 * @param {string} orderId
 * @returns {object|null}
 */
function getOrder(orderId) {
    return orderStore.get(orderId) || null;
}

/**
 * Get all orders as array.
 * @returns {Array}
 */
function getAllOrders() {
    return Array.from(orderStore.values());
}

/**
 * Get order statistics.
 * @returns {object}
 */
function getStats() {
    return { ...stats };
}

// ================================================================
//  7. MODULE EXPORTS
// ================================================================

module.exports = {
    handler,
    orderStore,
    PRODUCTS,
    findProduct,
    extractQris,
    generateOrderId,
    formatRupiah,
    sanitize,
    isValidEmail,
    getProducts,
    getOrder,
    getAllOrders,
    getStats,
    stats
};