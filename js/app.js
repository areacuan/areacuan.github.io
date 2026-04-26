(function () {
    "use strict";

    var API = window.location.origin;
    var POLL_MS = 3000;
    var POLL_MAX = 300;
    var CD_SEC = 900;
    var LS_KEY = "autostore_h2";
    var HIST_MAX = 60;
    var QR1 = "https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=";
    var QR2 = "https://quickchart.io/qr?size=300&margin=2&text=";
    var OK_ST = ["paid", "delivered", "success", "settlement"];
    var BAD_ST = ["expired", "failed", "cancelled"];

    var S = {
        products: [],
        sel: null,
        cat: "all",
        order: null,
        pollId: null,
        cdId: null,
        cdSec: CD_SEC,
        hist: [],
        busy: false,
        pollN: 0
    };

    function $(id) { return document.getElementById(id); }
    function $$(s) { return document.querySelectorAll(s); }
    function txt(id, v) { var e = $(id); if (e) e.textContent = v; }
    function rp(n) { return "Rp " + Number(n).toLocaleString("id-ID"); }

    function fmtDate(iso) {
        try {
            return new Date(iso).toLocaleString("id-ID", {
                day: "numeric", month: "short", year: "numeric",
                hour: "2-digit", minute: "2-digit"
            });
        } catch (e) { return iso; }
    }

    function haptic(ms) {
        try { if (navigator.vibrate) navigator.vibrate(ms || 10); } catch (e) { }
    }

    async function api(path, opts) {
        opts = opts || {};
        var url = API + path;
        var o = {
            headers: { "Content-Type": "application/json", "Accept": "application/json" }
        };
        if (opts.method) o.method = opts.method;
        if (opts.body) {
            o.method = o.method || "POST";
            o.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
        }
        var r = await fetch(url, o);
        return await r.json();
    }

    // ==================== TOAST ====================
    window.showToast = function (msg, type, dur) {
        type = type || "info";
        dur = dur || 3500;
        var t = $("toast");
        if (!t) return;
        var ic = type === "success" ? "circle-check" : type === "error" ? "circle-exclamation" : "circle-info";
        t.className = "toast " + type;
        t.innerHTML = '<i class="fa-solid fa-' + ic + ' mr-2"></i>' + msg;
        void t.offsetHeight;
        t.classList.add("show");
        clearTimeout(window._tt);
        window._tt = setTimeout(function () { t.classList.remove("show"); }, dur);
        haptic(15);
    };

    // ==================== INIT ====================
    document.addEventListener("DOMContentLoaded", function () {
        console.log("🛒 AutoStore v2.0 | API:", API);
        loadHist();
        pingServer();
        loadProducts();
    });

    async function pingServer() {
        try {
            var d = await api("/api/ping");
            if (d.ok) console.log("✅ Server OK");
        } catch (e) {
            console.error("❌ Server down:", e.message);
            showToast("Server tidak terhubung", "error");
        }
    }

    // ==================== PRODUCTS ====================
    async function loadProducts() {
        try {
            var d = await api("/api/products");
            if (d.ok && d.products && d.products.length > 0) {
                S.products = d.products;
                renderProducts(S.products);
                console.log("📦 Loaded", d.products.length, "products");
            } else {
                console.error("❌ No products in response:", JSON.stringify(d));
                showToast("Gagal memuat produk", "error");
                setTimeout(loadProducts, 3000);
            }
        } catch (e) {
            console.error("❌ Load fail:", e.message);
            showToast("Gagal memuat produk", "error");
            setTimeout(loadProducts, 4000);
        }
    }

    function renderProducts(list) {
        var grid = $("pGrid");
        var empty = $("pEmpty");
        if (!grid) {
            console.error("❌ pGrid element not found!");
            return;
        }

        txt("pCount", list.length + " produk");

        if (!list || list.length === 0) {
            grid.innerHTML = "";
            if (empty) empty.style.display = "block";
            return;
        }

        if (empty) empty.style.display = "none";

        var html = "";
        for (var i = 0; i < list.length; i++) {
            var p = list[i];
            var iconName = p.icon || "box";
            var iconColor = p.color || "#6366f1";
            var description = p.desc || p.description || "";
            var delay = (i * 0.05).toFixed(2);

            html += '<div class="p-card fade-up" ';
            html += 'style="animation-delay:' + delay + 's" ';
            html += 'onclick="pickProd(\'' + p.id + '\')" ';
            html += 'id="c-' + p.id + '">';

            // Popular badge
            if (p.popular) {
                html += '<div class="badge-hot">';
                html += '<i class="fa-solid fa-fire" style="font-size:9px;margin-right:3px"></i>POPULER';
                html += '</div>';
            }

            // Card content
            html += '<div style="display:flex;align-items:flex-start;gap:14px">';

            // Icon
            html += '<div class="icon-circle" style="background:' + iconColor + '20">';
            html += '<i class="fa-solid fa-' + iconName + '" style="color:' + iconColor + '"></i>';
            html += '</div>';

            // Text
            html += '<div style="flex:1;min-width:0">';
            html += '<h4 style="font-weight:700;color:#fff;font-size:13px;line-height:1.3">' + p.name + '</h4>';
            html += '<p style="font-size:11px;color:rgba(255,255,255,.3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + description + '</p>';
            html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px">';
            html += '<span style="font-size:14px;font-weight:800;background:linear-gradient(135deg,#818cf8,#c084fc);-webkit-background-clip:text;-webkit-text-fill-color:transparent">' + rp(p.price) + '</span>';
            html += '<span style="font-size:9px;color:rgba(255,255,255,.15)">Stok: ' + p.stock + '</span>';
            html += '</div>';
            html += '</div></div>';

            // Footer
            html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.04);display:flex;align-items:center;justify-content:space-between">';
            html += '<span style="font-size:9px;color:rgba(255,255,255,.15);text-transform:uppercase;letter-spacing:1px;font-weight:600">' + p.category + '</span>';
            html += '<span style="font-size:11px;font-weight:600;color:rgba(99,102,241,.7)">';
            html += '<i class="fa-solid fa-arrow-right" style="font-size:9px"></i>';
            html += '</span></div>';

            html += '</div>';
        }

        grid.innerHTML = html;
        console.log("✅ Rendered", list.length, "cards");
    }

    // ==================== FILTER ====================
    window.doFilter = function () {
        var q = ($("searchBox") ? $("searchBox").value : "").toLowerCase().trim();
        var list = [];

        for (var i = 0; i < S.products.length; i++) {
            var p = S.products[i];
            if (S.cat !== "all" && p.category !== S.cat) continue;
            if (q) {
                var name = (p.name || "").toLowerCase();
                var desc = (p.desc || p.description || "").toLowerCase();
                if (name.indexOf(q) < 0 && desc.indexOf(q) < 0) continue;
            }
            list.push(p);
        }

        renderProducts(list);
    };

    window.pickCat = function (cat, el) {
        S.cat = cat;
        var pills = $$(".pill");
        for (var i = 0; i < pills.length; i++) pills[i].classList.remove("on");
        if (el) el.classList.add("on");
        haptic(8);
        doFilter();
    };

    // ==================== SELECT PRODUCT ====================
    window.pickProd = function (id) {
        var p = null;
        for (var i = 0; i < S.products.length; i++) {
            if (S.products[i].id === id) { p = S.products[i]; break; }
        }
        if (!p) { console.error("Product not found:", id); return; }

        S.sel = p;
        haptic(12);

        var cards = $$(".p-card");
        for (var j = 0; j < cards.length; j++) cards[j].classList.remove("sel");
        var card = $("c-" + id);
        if (card) card.classList.add("sel");

        // Fill modal
        var icWrap = $("selIcWrap");
        var ic = $("selIc");
        if (icWrap) icWrap.style.background = (p.color || "#6366f1") + "20";
        if (ic) {
            ic.className = "fa-solid fa-" + (p.icon || "box");
            ic.style.color = p.color || "#6366f1";
        }
        txt("selNm", p.name);
        txt("selDs", p.desc || p.description || "");
        txt("selPr", rp(p.price));

        var qtyInp = $("oQty");
        if (qtyInp) qtyInp.value = 1;

        uTotal();
        resetSteps();
        openM("orderModal");
    };

    // ==================== QTY & TOTAL ====================
    window.cQty = function (d) {
        var inp = $("oQty");
        if (!inp) return;
        var v = parseInt(inp.value) || 1;
        v = Math.max(1, Math.min(99, v + d));
        inp.value = v;
        haptic(5);
        uTotal();
    };

    window.uTotal = function () {
        if (!S.sel) return;
        var q = parseInt($("oQty") ? $("oQty").value : 1) || 1;
        var t = S.sel.price * q;
        txt("subTx", rp(S.sel.price));
        txt("qTx", String(q));
        txt("tTx", rp(t));
    };

    // ==================== SUBMIT ORDER ====================
    window.doOrder = async function () {
        if (S.busy) return;
        if (!S.sel) { showToast("Pilih produk dulu", "error"); return; }

        var email = ($("bEm") ? $("bEm").value : "").trim();
        var name = ($("bNm") ? $("bNm").value : "").trim();
        var qty = parseInt($("oQty") ? $("oQty").value : 1) || 1;

        if (!email || email.indexOf("@") < 0 || email.indexOf(".") < 0) {
            showToast("Email tidak valid", "error");
            if ($("bEm")) $("bEm").focus();
            return;
        }

        S.busy = true;
        haptic(15);
        var btn = $("goBtn");
        var btx = $("goTx");
        if (btn) btn.disabled = true;
        if (btx) btx.innerHTML = '<div class="spin" style="margin:0 auto"></div>';

        try {
            var d = await api("/api/create-order", {
                method: "POST",
                body: {
                    product_id: S.sel.id,
                    buyer_email: email,
                    buyer_name: name,
                    quantity: qty
                }
            });

            if (!d.ok) {
                showToast(d.error || "Gagal membuat order", "error");
                resetBtn();
                return;
            }

            S.order = d;

            // Payment UI
            var payIcW = $("payIcW");
            var payIc = $("payIc");
            if (payIcW) payIcW.style.background = (d.product_color || "#6366f1") + "20";
            if (payIc) {
                payIc.className = "fa-solid fa-" + (d.product_icon || "box");
                payIc.style.color = d.product_color || "#6366f1";
            }
            txt("payNm", d.product_name + " x" + qty);
            txt("payOid", d.order_id);
            txt("payAmt", rp(d.total_payment || d.total_amount));

            var img = $("qrImg");
            if (img) {
                img.src = QR1 + encodeURIComponent(d.qris);
                img.onerror = function () { this.src = QR2 + encodeURIComponent(d.qris); };
            }

            goStep(2);
            startCD();
            startPoll(d.order_id);

            saveHistEntry({
                order_id: d.order_id,
                product_name: S.sel.name,
                product_icon: S.sel.icon,
                product_color: S.sel.color,
                amount: d.total_amount,
                status: "pending",
                created_at: new Date().toISOString()
            });

            showToast("QRIS berhasil dibuat!", "success");
            haptic(20);

        } catch (e) {
            console.error("Order error:", e);
            showToast("Gagal terhubung server", "error");
        }

        resetBtn();
    };

    function resetBtn() {
        S.busy = false;
        var btn = $("goBtn");
        var btx = $("goTx");
        if (btn) btn.disabled = false;
        if (btx) btx.innerHTML = '<i class="fa-solid fa-qrcode mr-2"></i>Bayar dengan QRIS';
    }

    // ==================== STEPS ====================
    function resetSteps() {
        show("st1"); hide("st2"); hide("st3");
        setDot("d1", "on"); setDot("d2", "off"); setDot("d3", "off");
        setLine("l1", ""); setLine("l2", "");
    }

    function goStep(n) {
        n === 1 ? show("st1") : hide("st1");
        n === 2 ? show("st2") : hide("st2");
        n === 3 ? show("st3") : hide("st3");

        setDot("d1", n === 1 ? "on" : "ok");
        if (n >= 2) { setDot("d2", n === 2 ? "on" : "ok"); setLine("l1", "on"); }
        if (n >= 3) { setDot("d3", "ok"); setLine("l2", "ok"); }
    }

    function setDot(id, cls) { var e = $(id); if (e) e.className = "dot " + cls; }
    function setLine(id, cls) { var e = $(id); if (e) e.className = "step-line" + (cls ? " " + cls : ""); }
    function show(id) { var e = $(id); if (e) e.style.display = "block"; }
    function hide(id) { var e = $(id); if (e) e.style.display = "none"; }

    // ==================== COUNTDOWN ====================
    function startCD() {
        S.cdSec = CD_SEC;
        stopCD();
        updCD();
        S.cdId = setInterval(function () {
            S.cdSec--;
            updCD();
            if (S.cdSec <= 0) {
                stopCD(); stopPoll();
                showToast("Waktu pembayaran habis", "error");
                if (S.order) updHistSt(S.order.order_id, "expired");
            }
        }, 1000);
    }

    function stopCD() { if (S.cdId) { clearInterval(S.cdId); S.cdId = null; } }

    function updCD() {
        var m = Math.floor(S.cdSec / 60);
        var s = S.cdSec % 60;
        var str = (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
        var el = $("cdTm");
        if (!el) return;
        el.textContent = str;
        el.style.color = S.cdSec <= 60 ? "#ef4444" : S.cdSec <= 120 ? "#f97316" : "#f59e0b";
    }

    // ==================== POLLING ====================
    function startPoll(oid) {
        stopPoll();
        S.pollN = 0;
        console.log("[POLL] Start:", oid);

        S.pollId = setInterval(async function () {
            S.pollN++;
            try {
                var d = await api("/api/check-status", { method: "POST", body: { order_id: oid } });
                var st = d.status || "pending";
                console.log("[POLL #" + S.pollN + "] " + st);

                if (OK_ST.indexOf(st) >= 0) {
                    stopPoll(); stopCD();
                    showOK(d.order || { order_id: oid });
                    updHistSt(oid, "paid");
                    showToast("Pembayaran berhasil! 🎉", "success", 5000);
                    haptic(30);
                    boom();
                    return;
                }
                if (BAD_ST.indexOf(st) >= 0) {
                    stopPoll(); stopCD();
                    showToast("Pembayaran " + st, "error");
                    updHistSt(oid, st);
                    return;
                }
            } catch (e) {
                console.error("[POLL] err:", e.message);
            }
            if (S.pollN >= POLL_MAX) stopPoll();
        }, POLL_MS);
    }

    function stopPoll() {
        if (S.pollId) { clearInterval(S.pollId); S.pollId = null; }
    }

    // ==================== SUCCESS ====================
    function showOK(order) {
        goStep(3);
        txt("okOid", order.order_id || "-");
        txt("okProd", order.product_name || (S.sel ? S.sel.name : "-"));
        txt("okAmt", rp(order.total_amount || (S.order ? S.order.total_amount : 0)));
        txt("okCode", order.delivery_code || genCode());
    }

    function genCode() {
        var c = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        var r = "LIC-";
        for (var i = 0; i < 16; i++) r += c.charAt(Math.floor(Math.random() * c.length));
        return r;
    }

    // ==================== COPY ====================
    window.doCopy = function () {
        var el = $("okCode");
        if (!el) return;
        var code = el.textContent;

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(code).then(function () {
                showToast("Disalin!", "success");
            }).catch(function () { fbCopy(code); });
        } else {
            fbCopy(code);
        }
        haptic(10);
    };

    function fbCopy(t) {
        var ta = document.createElement("textarea");
        ta.value = t;
        ta.style.cssText = "position:fixed;left:-9999px;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); showToast("Disalin!", "success"); }
        catch (e) { showToast("Gagal copy", "error"); }
        document.body.removeChild(ta);
    }

    // ==================== CANCEL & RESET ====================
    window.doCancel = function () {
        stopPoll(); stopCD();
        if (S.order) updHistSt(S.order.order_id, "cancelled");
        closeM("orderModal");
        doFullReset();
        showToast("Pesanan dibatalkan", "info");
    };

    window.doFullReset = function () {
        S.sel = null; S.order = null; S.busy = false;
        stopPoll(); stopCD();
        var cards = $$(".p-card");
        for (var i = 0; i < cards.length; i++) cards[i].classList.remove("sel");
        if ($("bEm")) $("bEm").value = "";
        if ($("bNm")) $("bNm").value = "";
        if ($("oQty")) $("oQty").value = 1;
        resetSteps();
    };

    // Alias for HTML onclick
    window.doReset = window.doFullReset;

    // ==================== HISTORY ====================
    function loadHist() {
        try { S.hist = JSON.parse(localStorage.getItem(LS_KEY) || "[]"); }
        catch (e) { S.hist = []; }
    }

    function saveHistEntry(o) {
        S.hist.unshift(o);
        if (S.hist.length > HIST_MAX) S.hist.length = HIST_MAX;
        try { localStorage.setItem(LS_KEY, JSON.stringify(S.hist)); } catch (e) { }
    }

    function updHistSt(oid, st) {
        for (var i = 0; i < S.hist.length; i++) {
            if (S.hist[i].order_id === oid) { S.hist[i].status = st; break; }
        }
        try { localStorage.setItem(LS_KEY, JSON.stringify(S.hist)); } catch (e) { }
    }

    window.showHist = function () {
        var el = $("histList");
        if (!el) return;

        if (!S.hist.length) {
            el.innerHTML = '<div style="text-align:center;padding:40px 0"><i class="fa-solid fa-inbox" style="font-size:28px;color:rgba(255,255,255,.06);display:block;margin-bottom:12px"></i><p style="color:rgba(255,255,255,.2);font-size:12px">Belum ada riwayat</p></div>';
            openM("histModal");
            return;
        }

        var html = "";
        for (var i = 0; i < S.hist.length; i++) {
            var o = S.hist[i];
            var sc = "st-pend", st = "Menunggu";
            if (o.status === "paid" || o.status === "delivered") { sc = "st-ok"; st = "Berhasil"; }
            else if (o.status === "expired") { sc = "st-err"; st = "Expired"; }
            else if (o.status === "cancelled") { sc = "st-err"; st = "Batal"; }
            else if (o.status === "failed") { sc = "st-err"; st = "Gagal"; }

            var ic = o.product_icon || "box";
            var icol = o.product_color || "#6366f1";

            html += '<div class="glass" style="border-radius:16px;padding:14px;margin-bottom:10px">';
            html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">';
            html += '<div style="width:36px;height:36px;border-radius:12px;background:' + icol + '20;display:flex;align-items:center;justify-content:center;flex-shrink:0">';
            html += '<i class="fa-solid fa-' + ic + '" style="color:' + icol + ';font-size:13px"></i></div>';
            html += '<div style="flex:1;min-width:0">';
            html += '<p style="font-weight:600;color:#fff;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (o.product_name || "-") + '</p>';
            html += '<p style="font-size:9px;color:rgba(255,255,255,.18);font-family:monospace;margin-top:2px">' + (o.order_id || "-") + '</p>';
            html += '</div>';
            html += '<span class="st-pill ' + sc + '" style="font-size:9px">' + st + '</span>';
            html += '</div>';
            html += '<div style="display:flex;justify-content:space-between;padding-top:10px;border-top:1px solid rgba(255,255,255,.04)">';
            html += '<span style="font-size:10px;color:rgba(255,255,255,.18)">' + (o.created_at ? fmtDate(o.created_at) : "-") + '</span>';
            html += '<span style="font-size:12px;font-weight:700;color:#fff">' + rp(o.amount || 0) + '</span>';
            html += '</div></div>';
        }

        el.innerHTML = html;
        openM("histModal");
        haptic(8);
    };

    // ==================== MODAL ====================
    window.openM = function (id) {
        var m = $(id);
        if (m) { m.classList.add("show"); document.body.style.overflow = "hidden"; }
    };

    window.closeM = function (id) {
        var m = $(id);
        if (m) { m.classList.remove("show"); document.body.style.overflow = ""; }
    };

    window.outClick = function (e, id) {
        if (id === "orderModal" && S.pollId) return;
        if (e.target === $(id)) closeM(id);
    };

    // ==================== CONFETTI ====================
    function boom() {
        var cols = ["#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#22c55e", "#14b8a6", "#f59e0b", "#3b82f6"];
        for (var i = 0; i < 50; i++) {
            (function (idx) {
                setTimeout(function () {
                    var el = document.createElement("div");
                    el.className = "cnf";
                    el.style.left = Math.random() * 100 + "vw";
                    el.style.width = (Math.random() * 8 + 4) + "px";
                    el.style.height = (Math.random() * 8 + 4) + "px";
                    el.style.background = cols[Math.floor(Math.random() * cols.length)];
                    el.style.borderRadius = Math.random() > .5 ? "50%" : "2px";
                    el.style.animationDuration = (Math.random() * 2 + 2) + "s";
                    document.body.appendChild(el);
                    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 5000);
                }, idx * 25);
            })(i);
        }
    }

    // ==================== DEBUG ====================
    window._S = S;
    window._API = API;

})();
