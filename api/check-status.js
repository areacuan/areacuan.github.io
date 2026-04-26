// ================================================================
//
//   CHECK PAYMENT STATUS
//   Pakasir Payment Gateway Polling
//
//   Endpoint : POST /api/check-status
//   Version  : 2.0.0
//
//   Features:
//   - Real-time payment status checking
//   - Auto delivery on payment confirmation
//   - License/voucher code generation
//   - Stock management on delivery
//   - Status normalization from multiple formats
//   - Caching for final states
//   - Comprehensive error handling
//
// ================================================================

const crypto = require("crypto");

// ================================================================
//  1. IMPORTS & CONFIGURATION
// ================================================================

/** Import shared data from create-order */
const { orderStore, PRODUCTS, findProduct, formatRupiah, stats } = require("./create-order");

/** Pakasir API configuration */
const PAKASIR = {
    SLUG: process.env.PROJECT_SLUG || "cupzyyy",
    KEY: process.env.API_KEY || " x5ex44h3cexOAvi37EOEKMlFvRPsGa3f",
    BASE_URL: "https://app.pakasir.com/api",
    TIMEOUT: 15000
};

/** Delivery configuration */
const DELIVERY_CONFIG = {
    /** Delay before auto delivery (ms) */
    DELIVERY_DELAY: 1500,

    /** License code prefix by category */
    CODE_PREFIX: {
        membership: "VIP",
        topup: "TOP",
        digital: "DIG",
        voucher: "VCH",
        pulsa: "PLS"
    },

    /** Default license code prefix */
    DEFAULT_PREFIX: "LIC",

    /** License code random bytes */
    CODE_BYTES: 8,

    /** Delivery messages by category */
    MESSAGES: {
        membership: "Akses VIP telah diaktifkan ke akun Anda",
        topup: "Koin telah ditambahkan ke akun Anda",
        digital: "Produk digital telah dikirim ke email Anda",
        voucher: "Kode voucher telah dikirim ke email Anda",
        pulsa: "Pulsa akan diproses dalam 1-5 menit"
    }
};

/** Status check statistics */
const checkStats = {
    total_checks: 0,
    total_paid_found: 0,
    total_still_pending: 0,
    total_expired_found: 0,
    total_errors: 0,
    last_check_at: null
};

/** Delivery log */
const deliveryLog = [];
const MAX_DELIVERY_LOG = 200;

// ================================================================
//  2. STATUS NORMALIZATION
// ================================================================

/**
 * Normalize payment status from various Pakasir response formats.
 *
 * Pakasir may return different status strings depending on the
 * payment method and transaction state. This function normalizes
 * them to a consistent set of statuses.
 *
 * Normalized statuses:
 * - "pending"    : Payment not yet received
 * - "paid"       : Payment confirmed
 * - "expired"    : Payment window expired
 * - "failed"     : Payment failed
 * - "cancelled"  : Payment cancelled by user
 * - "refunded"   : Payment refunded
 *
 * @param {string} rawStatus - Raw status from Pakasir
 * @returns {string} Normalized status
 */
function normalizeStatus(rawStatus) {
    if (!rawStatus || typeof rawStatus !== "string") {
        return "pending";
    }

    const status = rawStatus.toLowerCase().trim();

    // ---- Paid variants ----
    if (status === "paid") return "paid";
    if (status === "success") return "paid";
    if (status === "settlement") return "paid";
    if (status === "completed") return "paid";
    if (status === "settled") return "paid";
    if (status === "captured") return "paid";
    if (status === "accepted") return "paid";

    // ---- Expired variants ----
    if (status === "expired") return "expired";
    if (status === "expire") return "expired";
    if (status === "timeout") return "expired";
    if (status === "timed_out") return "expired";

    // ---- Failed variants ----
    if (status === "failed") return "failed";
    if (status === "fail") return "failed";
    if (status === "error") return "failed";
    if (status === "denied") return "failed";
    if (status === "rejected") return "failed";

    // ---- Cancelled variants ----
    if (status === "cancel") return "cancelled";
    if (status === "cancelled") return "cancelled";
    if (status === "canceled") return "cancelled";
    if (status === "void") return "cancelled";
    if (status === "voided") return "cancelled";

    // ---- Refunded variants ----
    if (status === "refund") return "refunded";
    if (status === "refunded") return "refunded";

    // ---- Pending variants ----
    if (status === "pending") return "pending";
    if (status === "waiting") return "pending";
    if (status === "waiting_payment") return "pending";
    if (status === "processing") return "pending";
    if (status === "created") return "pending";
    if (status === "initiated") return "pending";

    // ---- Unknown - default to pending ----
    console.log(`  [STATUS] Unknown status: "${rawStatus}" -> defaulting to "pending"`);
    return "pending";
}

/**
 * Check if a status is a final state (no more changes expected).
 *
 * @param {string} status - Normalized status
 * @returns {boolean} True if final
 */
function isFinalStatus(status) {
    return ["paid", "delivered", "expired", "failed", "cancelled", "refunded"].includes(status);
}

/**
 * Check if a status means payment was successful.
 *
 * @param {string} status - Normalized status
 * @returns {boolean} True if paid
 */
function isPaidStatus(status) {
    return ["paid", "delivered"].includes(status);
}

/**
 * Check if a status means payment failed/expired.
 *
 * @param {string} status - Normalized status
 * @returns {boolean} True if negative final
 */
function isNegativeStatus(status) {
    return ["expired", "failed", "cancelled", "refunded"].includes(status);
}

// ================================================================
//  3. AUTO DELIVERY SYSTEM
// ================================================================

/**
 * Generate a unique license/voucher code.
 *
 * @param {string} category - Product category for prefix
 * @returns {string} License code (e.g., "VIP-A1B2C3D4E5F6G7H8")
 */
function generateLicenseCode(category) {
    const prefix = DELIVERY_CONFIG.CODE_PREFIX[category] || DELIVERY_CONFIG.DEFAULT_PREFIX;
    const random = crypto.randomBytes(DELIVERY_CONFIG.CODE_BYTES).toString("hex").toUpperCase();
    return `${prefix}-${random}`;
}

/**
 * Generate delivery message based on product category.
 *
 * @param {object} order - Order object
 * @returns {string} Delivery message
 */
function generateDeliveryMessage(order) {
    const baseMessage = DELIVERY_CONFIG.MESSAGES[order.product_category] ||
        "Produk telah dikirim ke email Anda";

    return `${baseMessage}. Order: ${order.order_id}, Produk: ${order.product_name} x${order.quantity}`;
}

/**
 * Process automatic delivery for a paid order.
 *
 * This function:
 * 1. Generates a unique license code
 * 2. Updates order status to "delivered"
 * 3. Decreases product stock
 * 4. Updates delivery timestamps
 * 5. Logs the delivery event
 *
 * In production, this would also:
 * - Send email to buyer
 * - Activate the product/service
 * - Notify admin
 *
 * @param {string} orderId - Order ID to deliver
 * @returns {boolean} True if delivery was successful
 */
function processAutoDelivery(orderId) {
    // Get order from store
    const order = orderStore.get(orderId);

    // Safety checks
    if (!order) {
        console.log(`  [DELIVER] Order ${orderId} not found`);
        return false;
    }

    if (order.status === "delivered") {
        console.log(`  [DELIVER] Order ${orderId} already delivered`);
        return false;
    }

    if (order.status !== "paid") {
        console.log(`  [DELIVER] Order ${orderId} status is "${order.status}", not "paid"`);
        return false;
    }

    console.log("");
    console.log("╔══════════════════════════════════════════╗");
    console.log("║         🚀 AUTO DELIVERY                  ║");
    console.log("╚══════════════════════════════════════════╝");

    try {
        // Generate license code
        const licenseCode = generateLicenseCode(order.product_category);

        // Generate delivery message
        const deliveryMessage = generateDeliveryMessage(order);

        // Update order
        order.status = "delivered";
        order.delivered_at = new Date().toISOString();
        order.updated_at = new Date().toISOString();
        order.delivery_code = licenseCode;
        order.delivery_message = deliveryMessage;

        // Update product stock
        const product = findProduct(order.product_id);
        if (product) {
            const oldStock = product.stock;
            product.stock = Math.max(0, product.stock - order.quantity);
            console.log(`  [STOCK] ${product.name}: ${oldStock} → ${product.stock}`);
        }

        // Save updated order
        orderStore.set(orderId, order);

        // Update global stats
        stats.total_paid++;
        stats.total_revenue += order.total_amount;

        // Log delivery
        const logEntry = {
            order_id: orderId,
            product: order.product_name,
            quantity: order.quantity,
            amount: order.total_amount,
            code: licenseCode,
            email: order.buyer_email,
            delivered_at: order.delivered_at
        };

        deliveryLog.unshift(logEntry);
        if (deliveryLog.length > MAX_DELIVERY_LOG) {
            deliveryLog.length = MAX_DELIVERY_LOG;
        }

        console.log(`  Order    : ${orderId}`);
        console.log(`  Product  : ${order.product_name} x${order.quantity}`);
        console.log(`  Amount   : ${formatRupiah(order.total_amount)}`);
        console.log(`  Code     : ${licenseCode}`);
        console.log(`  Email    : ${order.buyer_email}`);
        console.log(`  ✅ Delivery complete`);
        console.log("");

        return true;

    } catch (error) {
        console.error(`  ❌ Delivery failed for ${orderId}:`, error.message);
        return false;
    }
}

/**
 * Schedule auto delivery with delay.
 *
 * @param {string} orderId - Order ID
 * @param {number} delay - Delay in milliseconds
 */
function scheduleDelivery(orderId, delay) {
    const actualDelay = delay || DELIVERY_CONFIG.DELIVERY_DELAY;
    console.log(`  [DELIVER] Scheduled for ${orderId} in ${actualDelay}ms`);
    setTimeout(() => {
        processAutoDelivery(orderId);
    }, actualDelay);
}

// ================================================================
//  4. PAKASIR STATUS CHECK
// ================================================================

/**
 * Call Pakasir API to check transaction status.
 *
 * @param {string} orderId - Order ID
 * @param {number} amount - Transaction amount
 * @returns {Promise<object>} { success, status, raw }
 */
async function callPakasirCheckStatus(orderId, amount) {
    const url = new URL(`${PAKASIR.BASE_URL}/transactiondetail`);
    url.searchParams.set("project", PAKASIR.SLUG);
    url.searchParams.set("amount", String(amount));
    url.searchParams.set("order_id", orderId);
    url.searchParams.set("api_key", PAKASIR.KEY);

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PAKASIR.TIMEOUT);

        const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
                "Accept": "application/json",
                "User-Agent": "AutoStore/2.0"
            },
            signal: controller.signal
        });

        clearTimeout(timeout);

        const text = await response.text();
        let json;

        try {
            json = JSON.parse(text);
        } catch (parseError) {
            console.error("  [PAKASIR] Parse error:", text.substring(0, 100));
            return { success: false, status: "pending", error: "Parse error" };
        }

        const transaction = json.transaction || json;
        const rawStatus = transaction.status || "pending";
        const normalized = normalizeStatus(rawStatus);

        return {
            success: true,
            status: normalized,
            rawStatus: rawStatus,
            raw: json
        };

    } catch (error) {
        if (error.name === "AbortError") {
            console.error("  [PAKASIR] Check timeout");
            return { success: false, status: "pending", error: "Timeout" };
        }

        console.error("  [PAKASIR] Check error:", error.message);
        return { success: false, status: "pending", error: error.message };
    }
}

// ================================================================
//  5. MAIN HANDLER
// ================================================================

/**
 * POST /api/check-status
 *
 * Checks the payment status of an order.
 * If the order is still pending, queries Pakasir API.
 * If payment is confirmed, triggers auto delivery.
 *
 * Request body:
 * {
 *   order_id: string (required)
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   status: "pending" | "paid" | "delivered" | "expired" | "failed" | "cancelled",
 *   order: { ...orderData }
 * }
 */
async function handler(req, res) {
    // Method check
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "POST only" });
    }

    try {
        // Parse order ID
        const orderId = (req.body.order_id || "").trim();

        if (!orderId) {
            return res.json({ ok: false, error: "order_id is required" });
        }

        // Update stats
        checkStats.total_checks++;
        checkStats.last_check_at = new Date().toISOString();

        // Get order from store
        const order = orderStore.get(orderId);

        if (!order) {
            return res.json({
                ok: false,
                status: "not_found",
                error: "Order tidak ditemukan"
            });
        }

        // ---- Return cached final states ----

        // Already delivered (final success)
        if (order.status === "delivered") {
            return res.json({ ok: true, status: "delivered", order: order });
        }

        // Already paid, trigger delivery if not yet
        if (order.status === "paid") {
            scheduleDelivery(orderId, 800);
            return res.json({ ok: true, status: "paid", order: order });
        }

        // Negative final states
        if (isNegativeStatus(order.status)) {
            return res.json({ ok: true, status: order.status, order: order });
        }

        // ---- Status is pending, check with Pakasir ----

        const pakasirResult = await callPakasirCheckStatus(orderId, order.total_amount);
        const newStatus = pakasirResult.status;

        console.log(`[CHECK] ${orderId} → ${newStatus} (raw: ${pakasirResult.rawStatus || "?"})`);

        // ---- Handle paid ----
        if (newStatus === "paid") {
            order.status = "paid";
            order.paid_at = new Date().toISOString();
            order.updated_at = new Date().toISOString();
            orderStore.set(orderId, order);

            checkStats.total_paid_found++;

            console.log(`  💰 PAID! ${orderId} | ${formatRupiah(order.total_amount)}`);

            scheduleDelivery(orderId, DELIVERY_CONFIG.DELIVERY_DELAY);

            return res.json({ ok: true, status: "paid", order: order });
        }

        // ---- Handle negative states ----
        if (isNegativeStatus(newStatus)) {
            order.status = newStatus;
            order.updated_at = new Date().toISOString();
            orderStore.set(orderId, order);

            if (newStatus === "expired") checkStats.total_expired_found++;

            console.log(`  ⚠️ ${newStatus.toUpperCase()}: ${orderId}`);

            return res.json({ ok: true, status: newStatus, order: order });
        }

        // ---- Still pending ----
        checkStats.total_still_pending++;
        return res.json({ ok: true, status: "pending", order: order });

    } catch (error) {
        checkStats.total_errors++;
        console.error("❌ CHECK ERROR:", error.message);
        // Never return error for polling — always return pending
        return res.json({ ok: true, status: "pending" });
    }
}

// ================================================================
//  6. MODULE EXPORTS
// ================================================================

module.exports = {
    handler,
    processAutoDelivery,
    scheduleDelivery,
    normalizeStatus,
    isFinalStatus,
    isPaidStatus,
    isNegativeStatus,
    generateLicenseCode,
    checkStats,
    deliveryLog
};
