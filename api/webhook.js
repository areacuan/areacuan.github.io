// ================================================================
//
//   WEBHOOK RECEIVER
//   Receives payment callbacks from Pakasir
//
//   Endpoint : POST /api/webhook
//   Version  : 2.0.0
//
//   Features:
//   - Receives Pakasir payment notifications
//   - Signature verification (optional)
//   - Auto-updates order status
//   - Triggers auto delivery
//   - Comprehensive logging
//   - Webhook history for debugging
//   - Duplicate detection
//   - IP logging
//
// ================================================================

const crypto = require("crypto");

// ================================================================
//  1. IMPORTS
// ================================================================

const { orderStore, formatRupiah } = require("./create-order");
const { processAutoDelivery, scheduleDelivery, normalizeStatus } = require("./check-status");

// ================================================================
//  2. CONFIGURATION
// ================================================================

const WEBHOOK_CONFIG = {
    /** Project slug for verification */
    SLUG: process.env.PROJECT_SLUG || "cupzyyy",

    /** Webhook secret for signature verification */
    SECRET: process.env.WEBHOOK_SECRET || "",

    /** Maximum webhook history entries */
    MAX_HISTORY: 150,

    /** Duplicate detection window (ms) */
    DEDUP_WINDOW: 60000,

    /** Maximum body size to log */
    MAX_LOG_SIZE: 500,

    /** Allowed IP ranges (empty = allow all) */
    ALLOWED_IPS: []
};

// ================================================================
//  3. DATA STORES
// ================================================================

/** Webhook event history */
const webhookHistory = [];

/** Processed webhook IDs (for dedup) */
const processedWebhooks = new Map();

/** Webhook statistics */
const webhookStats = {
    total_received: 0,
    total_processed: 0,
    total_paid: 0,
    total_ignored: 0,
    total_errors: 0,
    total_duplicates: 0,
    total_invalid: 0,
    last_received_at: null
};

// ================================================================
//  4. HELPER FUNCTIONS
// ================================================================

/**
 * Get client IP address from request.
 *
 * @param {object} req - Express request
 * @returns {string} Client IP
 */
function getClientIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) {
        return forwarded.split(",")[0].trim();
    }
    return req.headers["x-real-ip"] ||
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        "unknown";
}

/**
 * Get User-Agent from request.
 *
 * @param {object} req - Express request
 * @returns {string} User agent string
 */
function getUserAgent(req) {
    return (req.headers["user-agent"] || "unknown").substring(0, 150);
}

/**
 * Verify webhook signature.
 * Uses HMAC-SHA256 if a webhook secret is configured.
 *
 * @param {object} payload - Webhook payload
 * @param {string} signature - Signature from header
 * @returns {boolean} True if valid or no secret configured
 */
function verifySignature(payload, signature) {
    // Skip verification if no secret configured
    if (!WEBHOOK_CONFIG.SECRET) {
        return true;
    }

    // No signature provided
    if (!signature) {
        console.log("  [SIG] No signature provided, rejecting");
        return false;
    }

    try {
        const expectedSignature = crypto
            .createHmac("sha256", WEBHOOK_CONFIG.SECRET)
            .update(typeof payload === "string" ? payload : JSON.stringify(payload))
            .digest("hex");

        // Constant-time comparison to prevent timing attacks
        const sigBuffer = Buffer.from(signature, "utf8");
        const expectedBuffer = Buffer.from(expectedSignature, "utf8");

        if (sigBuffer.length !== expectedBuffer.length) {
            console.log("  [SIG] Length mismatch");
            return false;
        }

        const isValid = crypto.timingSafeEqual(sigBuffer, expectedBuffer);
        console.log(`  [SIG] Verification: ${isValid ? "PASSED ✅" : "FAILED ❌"}`);
        return isValid;

    } catch (error) {
        console.error("  [SIG] Verification error:", error.message);
        return false;
    }
}

/**
 * Check if this webhook event is a duplicate.
 *
 * @param {string} orderId - Order ID
 * @param {string} status - Status
 * @returns {boolean} True if duplicate
 */
function isDuplicate(orderId, status) {
    const key = `${orderId}:${status}`;
    const now = Date.now();

    // Clean expired entries
    for (const [k, v] of processedWebhooks.entries()) {
        if (now - v > WEBHOOK_CONFIG.DEDUP_WINDOW) {
            processedWebhooks.delete(k);
        }
    }

    if (processedWebhooks.has(key)) {
        console.log(`  [DEDUP] Duplicate detected: ${key}`);
        return true;
    }

    processedWebhooks.set(key, now);
    return false;
}

/**
 * Check if IP is allowed (if whitelist is configured).
 *
 * @param {string} ip - Client IP
 * @returns {boolean} True if allowed
 */
function isIpAllowed(ip) {
    if (WEBHOOK_CONFIG.ALLOWED_IPS.length === 0) {
        return true; // No whitelist = allow all
    }
    return WEBHOOK_CONFIG.ALLOWED_IPS.includes(ip);
}

/**
 * Save webhook event to history.
 *
 * @param {object} entry - History entry
 */
function saveHistory(entry) {
    webhookHistory.unshift({
        ...entry,
        id: crypto.randomBytes(4).toString("hex")
    });

    if (webhookHistory.length > WEBHOOK_CONFIG.MAX_HISTORY) {
        webhookHistory.length = WEBHOOK_CONFIG.MAX_HISTORY;
    }
}

/**
 * Extract order information from webhook body.
 * Handles various payload formats from Pakasir.
 *
 * @param {object} body - Webhook body
 * @returns {object} { orderId, status, amount, project }
 */
function extractWebhookData(body) {
    return {
        orderId: body.order_id || body.orderId || body.id || body.external_id || "",
        status: body.status || body.payment_status || body.transaction_status || "",
        amount: parseInt(body.amount || body.total_amount || body.gross_amount || 0),
        project: body.project || body.project_slug || body.merchant || "",
        paymentMethod: body.payment_method || body.payment_type || "",
        transactionId: body.transaction_id || body.trx_id || ""
    };
}

// ================================================================
//  5. WEBHOOK PROCESSING
// ================================================================

/**
 * Process a paid webhook event.
 *
 * @param {object} order - Order from store
 * @param {string} orderId - Order ID
 * @param {object} webhookData - Extracted webhook data
 * @returns {string} Processing result
 */
function processPaidWebhook(order, orderId, webhookData) {
    // Already paid or delivered
    if (order.status === "paid" || order.status === "delivered") {
        console.log(`  [PROCESS] Already ${order.status}, skipping`);
        return "ALREADY_PAID";
    }

    // Not pending - unexpected state
    if (order.status !== "pending") {
        console.log(`  [PROCESS] Status is "${order.status}", not pending. Skipping.`);
        return "INVALID_STATE";
    }

    // Update order to paid
    order.status = "paid";
    order.paid_at = new Date().toISOString();
    order.updated_at = new Date().toISOString();
    orderStore.set(orderId, order);

    console.log("");
    console.log("  ╔════════════════════════════════════════╗");
    console.log("  ║   💰 PAYMENT CONFIRMED VIA WEBHOOK!    ║");
    console.log("  ╚════════════════════════════════════════╝");
    console.log(`  Order    : ${orderId}`);
    console.log(`  Product  : ${order.product_name} x${order.quantity}`);
    console.log(`  Amount   : ${formatRupiah(order.total_amount)}`);
    console.log(`  Email    : ${order.buyer_email}`);

    // Schedule auto delivery
    scheduleDelivery(orderId, 1500);

    return "PAID";
}

/**
 * Process a negative (expired/failed/cancelled) webhook event.
 *
 * @param {object} order - Order from store
 * @param {string} orderId - Order ID
 * @param {string} newStatus - Normalized new status
 * @returns {string} Processing result
 */
function processNegativeWebhook(order, orderId, newStatus) {
    // Already in final state
    if (order.status !== "pending") {
        console.log(`  [PROCESS] Already ${order.status}, ignoring ${newStatus}`);
        return "ALREADY_FINAL";
    }

    order.status = newStatus;
    order.updated_at = new Date().toISOString();
    orderStore.set(orderId, order);

    console.log(`  ⚠️ Order ${orderId} → ${newStatus.toUpperCase()}`);

    return newStatus.toUpperCase();
}

// ================================================================
//  6. MAIN HANDLER
// ================================================================

/**
 * POST /api/webhook
 *
 * Receives payment notifications from Pakasir.
 * Always returns HTTP 200 to prevent retries.
 *
 * Expected payload:
 * {
 *   order_id: string,
 *   status: string,
 *   amount: number,
 *   project: string,
 *   ...
 * }
 *
 * Response:
 * { received: true }
 */
function handler(req, res) {
    // Method check
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "POST only" });
    }

    const receivedAt = new Date().toISOString();
    const clientIp = getClientIp(req);
    const userAgent = getUserAgent(req);
    const body = req.body || {};

    // Update stats
    webhookStats.total_received++;
    webhookStats.last_received_at = receivedAt;

    console.log("");
    console.log("╔══════════════════════════════════════════╗");
    console.log("║         📨 WEBHOOK RECEIVED               ║");
    console.log("╚══════════════════════════════════════════╝");
    console.log(`  Time : ${receivedAt}`);
    console.log(`  IP   : ${clientIp}`);
    console.log(`  UA   : ${userAgent.substring(0, 80)}`);
    console.log(`  Body : ${JSON.stringify(body).substring(0, WEBHOOK_CONFIG.MAX_LOG_SIZE)}`);

    try {
        // ---- IP Whitelist Check ----
        if (!isIpAllowed(clientIp)) {
            console.log(`  ❌ IP not allowed: ${clientIp}`);
            webhookStats.total_invalid++;
            saveHistory({ ts: receivedAt, ip: clientIp, result: "IP_BLOCKED" });
            return res.json({ received: true });
        }

        // ---- Signature Verification ----
        const signature = req.headers["x-webhook-signature"] ||
            req.headers["x-pakasir-signature"] ||
            req.headers["x-signature"] || "";

        if (WEBHOOK_CONFIG.SECRET && !verifySignature(body, signature)) {
            console.log("  ❌ Invalid signature!");
            webhookStats.total_invalid++;
            saveHistory({ ts: receivedAt, ip: clientIp, result: "INVALID_SIGNATURE" });
            return res.json({ received: true });
        }

        // ---- Extract Data ----
        const webhookData = extractWebhookData(body);
        const { orderId, status: rawStatus, project } = webhookData;
        const normalizedStatus = normalizeStatus(rawStatus);

        console.log(`  Order   : ${orderId || "(empty)"}`);
        console.log(`  Status  : "${rawStatus}" → "${normalizedStatus}"`);
        console.log(`  Project : ${project || "(empty)"}`);

        // ---- Verify Project Slug ----
        if (project && project !== WEBHOOK_CONFIG.SLUG) {
            console.log(`  ⚠️ Project mismatch: expected "${WEBHOOK_CONFIG.SLUG}", got "${project}"`);
            webhookStats.total_ignored++;
            saveHistory({
                ts: receivedAt, ip: clientIp,
                order_id: orderId,
                result: "PROJECT_MISMATCH"
            });
            return res.json({ received: true });
        }

        // ---- Check Order ID ----
        if (!orderId) {
            console.log("  ⚠️ No order_id in payload");
            webhookStats.total_ignored++;
            saveHistory({ ts: receivedAt, ip: clientIp, result: "NO_ORDER_ID", body });
            return res.json({ received: true });
        }

        // ---- Duplicate Check ----
        if (isDuplicate(orderId, normalizedStatus)) {
            webhookStats.total_duplicates++;
            saveHistory({
                ts: receivedAt, ip: clientIp,
                order_id: orderId,
                result: "DUPLICATE"
            });
            return res.json({ received: true });
        }

        // ---- Find Order ----
        if (!orderStore.has(orderId)) {
            console.log(`  ⚠️ Order not found: ${orderId}`);
            webhookStats.total_ignored++;
            saveHistory({
                ts: receivedAt, ip: clientIp,
                order_id: orderId,
                result: "ORDER_NOT_FOUND"
            });
            return res.json({ received: true });
        }

        const order = orderStore.get(orderId);
        console.log(`  Current : ${order.status}`);

        // ---- Process Based on Status ----
        let result;

        if (normalizedStatus === "paid") {
            result = processPaidWebhook(order, orderId, webhookData);
            if (result === "PAID") webhookStats.total_paid++;
        } else if (["expired", "failed", "cancelled"].includes(normalizedStatus)) {
            result = processNegativeWebhook(order, orderId, normalizedStatus);
        } else {
            result = "IGNORED_STATUS";
            console.log(`  ℹ️ Status "${normalizedStatus}" - no action needed`);
        }

        webhookStats.total_processed++;

        // Save to history
        saveHistory({
            ts: receivedAt,
            ip: clientIp,
            order_id: orderId,
            old_status: order.status,
            new_status: normalizedStatus,
            result: result,
            amount: order.total_amount
        });

        console.log(`  Result: ${result}`);
        console.log("");

    } catch (error) {
        webhookStats.total_errors++;
        console.error("  ❌ WEBHOOK ERROR:", error.message);
        console.error("  Stack:", error.stack);

        saveHistory({
            ts: receivedAt,
            ip: clientIp,
            result: "ERROR",
            error: error.message
        });
    }

    // Always return 200 to prevent retry flooding
    return res.json({ received: true });
}

// ================================================================
//  7. MODULE EXPORTS
// ================================================================

module.exports = {
    handler,
    history: webhookHistory,
    webhookStats,
    getClientIp,
    verifySignature,
    extractWebhookData,
    saveHistory
};