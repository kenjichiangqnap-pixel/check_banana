"use strict";

/* ===== 密碼保護（僅為避免連結外流被隨意瀏覽，非銀行等級加密）=====
   要更換密碼：在瀏覽器主控台執行
   crypto.subtle.digest('SHA-256', new TextEncoder().encode('你的新密碼')).then(b=>console.log(Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('')))
   把結果貼到下面 PASSWORD_HASH。
*/
const PASSWORD_HASH = "0f14089313b20c1723ec1d660b0aaa4f473cf5b321cd370f2d48b7bcf9a7b234";

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function initGate() {
  const gate = document.getElementById("gate");
  const app = document.getElementById("app");
  const form = document.getElementById("gate-form");
  const input = document.getElementById("gate-password");
  const err = document.getElementById("gate-error");

  const unlock = () => {
    gate.hidden = true;
    app.hidden = false;
    startDashboard();
  };

  if (sessionStorage.getItem("authed") === "1") {
    unlock();
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const hash = await sha256Hex(input.value);
    if (hash === PASSWORD_HASH) {
      sessionStorage.setItem("authed", "1");
      err.hidden = true;
      unlock();
    } else {
      err.hidden = false;
      input.value = "";
    }
  });
}

/* ===== 策略參數（對應 check.py 目前實際運行的「方案B」）===== */
const CONFIG = {
  symbol: "BTCUSDT",
  interval: "4h",
  initialUsdt: 250 / 0.25, // money / pa = 1000
  ADX_LEN: 14,
  ADX_THRESH: 20,
  DCH_LEN: 20,
  EMA_TREND_LEN: 200,
  ATR_LEN: 14,
  ATR_STOP: 2.0,
  ATR_TRAIL: 9.0,
  ATR_TP: 100.0,
  RISK_PCT: 0.08,
  MAX_LEVERAGE: 10.0,
  FEE_RATE: 0.0005,
  ALLOW_SHORT: true,
  KLINE_LIMIT: 1500,
};

/* ===== 指標計算 ===== */
function ema(values, span) {
  const alpha = 2 / (span + 1);
  const out = new Array(values.length).fill(NaN);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) out[i] = (1 - alpha) * out[i - 1] + alpha * values[i];
  return out;
}

function wilderATR(high, low, close, period) {
  const n = high.length;
  const tr = new Array(n).fill(NaN);
  tr[0] = high[0] - low[0];
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
  }
  const alpha = 1 / period;
  const atr = new Array(n).fill(NaN);
  atr[0] = tr[0];
  for (let i = 1; i < n; i++) atr[i] = (1 - alpha) * atr[i - 1] + alpha * tr[i];
  return atr;
}

function donchian(values, len, mode) {
  const n = values.length;
  const out = new Array(n).fill(NaN);
  for (let i = len; i < n; i++) {
    const slice = values.slice(i - len, i);
    out[i] = mode === "max" ? Math.max(...slice) : Math.min(...slice);
  }
  return out;
}

// 標準 Wilder ADX/DI（暖機期夠長時，數值會收斂到與 python `ta` 套件一致）
function computeADX(high, low, close, period) {
  const n = high.length;
  const tr = new Array(n).fill(NaN);
  const plusDM = new Array(n).fill(NaN);
  const minusDM = new Array(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    const upMove = high[i] - high[i - 1];
    const downMove = low[i - 1] - low[i];
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
  }
  const trN = new Array(n).fill(NaN);
  const pDM = new Array(n).fill(NaN);
  const mDM = new Array(n).fill(NaN);
  let trSum = 0, pSum = 0, mSum = 0;
  for (let i = 1; i <= period; i++) {
    trSum += tr[i]; pSum += plusDM[i]; mSum += minusDM[i];
  }
  trN[period] = trSum; pDM[period] = pSum; mDM[period] = mSum;
  for (let i = period + 1; i < n; i++) {
    trN[i] = trN[i - 1] - trN[i - 1] / period + tr[i];
    pDM[i] = pDM[i - 1] - pDM[i - 1] / period + plusDM[i];
    mDM[i] = mDM[i - 1] - mDM[i - 1] / period + minusDM[i];
  }
  const plusDI = new Array(n).fill(NaN);
  const minusDI = new Array(n).fill(NaN);
  const dx = new Array(n).fill(NaN);
  for (let i = period; i < n; i++) {
    plusDI[i] = trN[i] === 0 ? 0 : (100 * pDM[i]) / trN[i];
    minusDI[i] = trN[i] === 0 ? 0 : (100 * mDM[i]) / trN[i];
    const sum = plusDI[i] + minusDI[i];
    dx[i] = sum === 0 ? 0 : (100 * Math.abs(plusDI[i] - minusDI[i])) / sum;
  }
  const adx = new Array(n).fill(NaN);
  let dxSum = 0;
  for (let i = period; i < period * 2; i++) dxSum += dx[i];
  adx[period * 2 - 1] = dxSum / period;
  for (let i = period * 2; i < n; i++) adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
  return { adx, plusDI, minusDI };
}

/* ===== 抓取 K 線 ===== */
async function fetchKlines() {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${CONFIG.symbol}&interval=${CONFIG.interval}&limit=${CONFIG.KLINE_LIMIT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API 錯誤: HTTP ${res.status}`);
  const rows = await res.json();
  return rows.map((r) => ({
    openTime: r[0],
    open: parseFloat(r[1]),
    high: parseFloat(r[2]),
    low: parseFloat(r[3]),
    close: parseFloat(r[4]),
    closeTime: r[6],
  }));
}

/* ===== 模擬（完全對應 check.py signal() 的「方案B」分支）===== */
function runSimulation(bars, ind) {
  const { close, high, low, adx, ema_trend, atr_b, dch_hi, dch_lo } = ind;
  const n = bars.length;

  let usdt = CONFIG.initialUsdt;
  let position = 0, signal = "";
  let buy_price = 0, sell_price = 0, stop_price = 0, take_price = 0, trail_extreme = 0;
  let qty = 0, entry_fee = 0, entry_total_u = 0;
  let total = 0, w = 0, l = 0, count = 0, count_w = 0, count_l = 0;
  let topM = 0, downM = 0, topTime = null, downFromTime = null, downToTime = null, downFromValue = 0;
  let cdcount = 0, cdwcount = 0, pdcount = 0, pdwcount = 0;
  const trades = [];

  for (let i = 1; i < n; i++) {
    const ADX = adx[i], emaT = ema_trend[i], dh = dch_hi[i], dl = dch_lo[i], atrb = atr_b[i];
    const closeNow = close[i], highNow = high[i], lowNow = low[i];

    if (usdt > topM) { topM = usdt; topTime = bars[i].openTime; }
    if (topM > 0 && (topM - usdt) / topM > downM) {
      downFromTime = topTime; downToTime = bars[i].openTime; downM = (topM - usdt) / topM; downFromValue = topM;
    }

    if (position === 1 && signal === "buy") {
      if (highNow > trail_extreme) trail_extreme = highNow;
      const newStop = trail_extreme - CONFIG.ATR_TRAIL * atrb;
      if (newStop > stop_price) stop_price = newStop;
      const shortSig = CONFIG.ALLOW_SHORT && ADX > CONFIG.ADX_THRESH && closeNow < emaT && closeNow < dl;
      let exitPrice = null;
      if (lowNow <= stop_price) exitPrice = stop_price;
      else if (highNow >= take_price) exitPrice = take_price;
      else if (shortSig) exitPrice = closeNow;
      if (exitPrice !== null) {
        const raw = (exitPrice - buy_price) * qty;
        const feeOut = CONFIG.FEE_RATE * exitPrice * qty;
        usdt += raw - feeOut;
        const b = raw - feeOut - entry_fee;
        total += b;
        const reason = usdt <= 0 ? "爆倉" : b > 0 ? "停利" : "停損";
        if (b > 0) { w += b; count_w++; } else { l += b; if (reason === "爆倉") count_l++; }
        cdcount++; if (b > 0) cdwcount++;
        count++;
        trades.push({ time: bars[i].openTime, side: "多", action: "賣出", price: exitPrice, note: reason, pnl: b, pnlPct: entry_total_u > 0 ? (b / entry_total_u) * 100 : 0, usdtAfter: usdt });
        position = 0; signal = "";
      }
    } else if (position === 1 && signal === "sell") {
      if (lowNow < trail_extreme) trail_extreme = lowNow;
      const newStop = trail_extreme + CONFIG.ATR_TRAIL * atrb;
      if (newStop < stop_price) stop_price = newStop;
      const longSig = ADX > CONFIG.ADX_THRESH && closeNow > emaT && closeNow > dh;
      let exitPrice = null;
      if (highNow >= stop_price) exitPrice = stop_price;
      else if (lowNow <= take_price) exitPrice = take_price;
      else if (longSig) exitPrice = closeNow;
      if (exitPrice !== null) {
        const raw = (sell_price - exitPrice) * qty;
        const feeOut = CONFIG.FEE_RATE * exitPrice * qty;
        usdt += raw - feeOut;
        const b = raw - feeOut - entry_fee;
        total += b;
        const reason = usdt <= 0 ? "爆倉" : b > 0 ? "停利" : "停損";
        if (b > 0) { w += b; count_w++; } else { l += b; if (reason === "爆倉") count_l++; }
        pdcount++; if (b > 0) pdwcount++;
        count++;
        trades.push({ time: bars[i].openTime, side: "空", action: "買回", price: exitPrice, note: reason, pnl: b, pnlPct: entry_total_u > 0 ? (b / entry_total_u) * 100 : 0, usdtAfter: usdt });
        position = 0; signal = "";
      }
    }

    if (position === 0 && signal === "") {
      const longSig = ADX > CONFIG.ADX_THRESH && closeNow > emaT && closeNow > dh;
      const shortSig = CONFIG.ALLOW_SHORT && ADX > CONFIG.ADX_THRESH && closeNow < emaT && closeNow < dl;
      const ready = !isNaN(atrb) && atrb > 0 && !isNaN(emaT) && !isNaN(dh) && !isNaN(dl);
      if (ready && (longSig || shortSig)) {
        const stopDist = CONFIG.ATR_STOP * atrb;
        const riskAmt = CONFIG.RISK_PCT * usdt;
        qty = riskAmt / stopDist;
        let notional = qty * closeNow;
        if (notional > CONFIG.MAX_LEVERAGE * usdt) {
          qty = (CONFIG.MAX_LEVERAGE * usdt) / closeNow;
          notional = qty * closeNow;
        }
        const eq0 = usdt;
        entry_fee = CONFIG.FEE_RATE * notional;
        usdt -= entry_fee;
        entry_total_u = eq0;
        const levNow = eq0 > 0 ? notional / eq0 : 0;
        if (longSig) {
          position = 1; signal = "buy"; buy_price = closeNow; trail_extreme = highNow;
          stop_price = buy_price - stopDist; take_price = buy_price + CONFIG.ATR_TP * atrb;
          trades.push({ time: bars[i].openTime, side: "多", action: "買入", price: buy_price, note: `名目${Math.round(notional)}U 槓桿${levNow.toFixed(2)}倍`, pnl: null, pnlPct: null, usdtAfter: usdt });
        } else {
          position = 1; signal = "sell"; sell_price = closeNow; trail_extreme = lowNow;
          stop_price = sell_price + stopDist; take_price = sell_price - CONFIG.ATR_TP * atrb;
          trades.push({ time: bars[i].openTime, side: "空", action: "賣出", price: sell_price, note: `名目${Math.round(notional)}U 槓桿${levNow.toFixed(2)}倍`, pnl: null, pnlPct: null, usdtAfter: usdt });
        }
      }
    }
  }

  return {
    usdt, position, signal, buy_price, sell_price, stop_price, take_price, trail_extreme, qty, entry_total_u,
    total, w, l, count, count_w, count_l, topM, downM, topTime, downFromTime, downToTime, downFromValue,
    cdcount, cdwcount, pdcount, pdwcount, trades,
  };
}

/* ===== 畫面渲染 ===== */
function fmt(n, digits = 0) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtTime(ms) {
  return new Date(ms).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
}

function statBox(label, value, cls = "") {
  return `<div class="stat"><div class="label">${label}</div><div class="value ${cls}">${value}</div></div>`;
}

function renderQuickStatus(result, lastClose) {
  const box = document.getElementById("quick-status");
  if (result.position === 0) {
    box.innerHTML = `
      <div class="qs-side flat">目前空手，無持倉</div>
      <div class="qs-grid qs-grid-1">
        <div class="qs-item"><div class="qs-label">目前價</div><div class="qs-value">${fmt(lastClose, 2)}</div></div>
      </div>
    `;
    return;
  }
  const isLong = result.signal === "buy";
  const entry = isLong ? result.buy_price : result.sell_price;
  box.innerHTML = `
    <div class="qs-side ${isLong ? "long" : "short"}">${isLong ? "做多" : "做空"} BTCUSDT</div>
    <div class="qs-grid">
      <div class="qs-item"><div class="qs-label">進場價</div><div class="qs-value">${fmt(entry, 2)}</div></div>
      <div class="qs-item"><div class="qs-label">停損價</div><div class="qs-value">${fmt(result.stop_price, 2)}</div></div>
      <div class="qs-item"><div class="qs-label">目前價</div><div class="qs-value">${fmt(lastClose, 2)}</div></div>
    </div>
  `;
}

function renderStatus(result, lastBar, ind, n) {
  const box = document.getElementById("status-card");
  const lastClose = ind.close[n - 1];

  if (result.position === 0) {
    box.innerHTML = `
      <div class="status-title flat">目前空手，等待進場訊號</div>
      <p>最新收盤價：${fmt(lastClose, 2)} U（K棒時間：${fmtTime(lastBar.openTime)}，若為最新一根可能尚未收線）</p>
      <p>策略條件：唐奇安20突破 + 站上/跌破 EMA200 + ADX &gt; ${CONFIG.ADX_THRESH}。目前尚未觸發，請持續關注。</p>
    `;
    return;
  }

  const isLong = result.signal === "buy";
  const entry = isLong ? result.buy_price : result.sell_price;
  const unrealized = isLong
    ? (lastClose - entry) * result.qty - 0
    : (entry - lastClose) * result.qty - 0;
  const unrealizedPct = result.entry_total_u > 0 ? (unrealized / result.entry_total_u) * 100 : 0;
  const notional = result.qty * entry;
  const leverage = result.entry_total_u > 0 ? notional / result.entry_total_u : 0;

  box.innerHTML = `
    <div class="status-title ${isLong ? "long" : "short"}">目前持倉：${isLong ? "做多" : "做空"} BTCUSDT</div>
    <div class="grid">
      ${statBox("進場價", fmt(entry, 2))}
      ${statBox("目前價", fmt(lastClose, 2))}
      ${statBox("目前停損價（吊燈）", fmt(result.stop_price, 2))}
      ${statBox("數量 (BTC)", fmt(result.qty, 4))}
      ${statBox("名目價值", fmt(notional, 0) + " U")}
      ${statBox("槓桿", leverage.toFixed(2) + " 倍")}
      ${statBox("未實現損益", fmt(unrealized, 0) + " U", unrealized >= 0 ? "up" : "down")}
      ${statBox("未實現報酬率", unrealizedPct.toFixed(2) + " %", unrealizedPct >= 0 ? "up" : "down")}
    </div>
    <p style="margin-top:12px;color:var(--muted);font-size:13px;">
      若價格${isLong ? "跌破" : "漲破"}停損價 <strong>${fmt(result.stop_price, 2)}</strong>，請手動平倉。
      停損為吊燈式移動停損，每根K棒收盤後會自動往有利方向移動，請以本頁最新數字為準，重新整理即可更新。
    </p>
  `;
}

function renderIndicators(ind, n, lastBar) {
  const grid = document.getElementById("indicators-grid");
  grid.innerHTML = [
    statBox("K棒時間", fmtTime(lastBar.openTime)),
    statBox("收盤價", fmt(ind.close[n - 1], 2)),
    statBox("ADX(14)", fmt(ind.adx[n - 1], 2)),
    statBox("EMA200", fmt(ind.ema_trend[n - 1], 2)),
    statBox("唐奇安20高", fmt(ind.dch_hi[n - 1], 2)),
    statBox("唐奇安20低", fmt(ind.dch_lo[n - 1], 2)),
    statBox("ATR(14)", fmt(ind.atr_b[n - 1], 2)),
  ].join("");
}

function renderStats(r) {
  const grid = document.getElementById("stats-grid");
  const winRate = r.count > 0 ? (r.count_w / r.count) * 100 : 0;
  const payoffRatio = r.l !== 0 ? (-1 * r.w) / r.l : 0;
  const totalReturnPct = (r.total * 100) / CONFIG.initialUsdt;
  const maxReturnPct = ((r.topM - CONFIG.initialUsdt) * 100) / CONFIG.initialUsdt;

  grid.innerHTML = [
    statBox("進場次數", `${r.count} 次（多 ${r.cdcount} / 空 ${r.pdcount}）`),
    statBox("勝率", winRate.toFixed(1) + " %"),
    statBox("盈虧比", payoffRatio.toFixed(2)),
    statBox("爆倉次數", r.count_l + " 次"),
    statBox("目前總U", fmt(r.usdt, 0) + " U"),
    statBox("目前總盈虧", fmt(r.total, 0) + " U", r.total >= 0 ? "up" : "down"),
    statBox("總報酬率", totalReturnPct.toFixed(2) + " %", totalReturnPct >= 0 ? "up" : "down"),
    statBox("最大總資產", fmt(r.topM, 0) + " U（" + (r.topTime ? fmtTime(r.topTime) : "-") + "）"),
    statBox("最大報酬率", maxReturnPct.toFixed(2) + " %"),
    statBox("最大回落", (r.downM * 100).toFixed(1) + " %"),
  ].join("");
}

function renderTrades(trades) {
  const tbody = document.querySelector("#trades-table tbody");
  const rows = trades.slice().reverse().slice(0, 50).map((t) => {
    const pnlCls = t.pnl === null ? "" : t.pnl >= 0 ? "pnl-pos" : "pnl-neg";
    return `<tr>
      <td>${fmtTime(t.time)}</td>
      <td>${t.side}</td>
      <td>${t.action}</td>
      <td>${fmt(t.price, 2)}</td>
      <td>${t.note}</td>
      <td class="${pnlCls}">${t.pnl === null ? "-" : fmt(t.pnl, 0)}</td>
      <td class="${pnlCls}">${t.pnlPct === null ? "-" : t.pnlPct.toFixed(2) + "%"}</td>
      <td>${fmt(t.usdtAfter, 0)}</td>
    </tr>`;
  });
  tbody.innerHTML = rows.join("");
}

function showError(msg) {
  const box = document.getElementById("error-box");
  box.hidden = false;
  box.textContent = msg;
}

function clearError() {
  document.getElementById("error-box").hidden = true;
}

/* ===== 主流程 ===== */
async function loadAndRender() {
  clearError();
  const btn = document.getElementById("refresh-btn");
  btn.disabled = true;
  btn.textContent = "更新中...";
  try {
    const bars = await fetchKlines();
    const high = bars.map((b) => b.high);
    const low = bars.map((b) => b.low);
    const close = bars.map((b) => b.close);

    const { adx } = computeADX(high, low, close, CONFIG.ADX_LEN);
    const ema_trend = ema(close, CONFIG.EMA_TREND_LEN);
    const atr_b = wilderATR(high, low, close, CONFIG.ATR_LEN);
    const dch_hi = donchian(high, CONFIG.DCH_LEN, "max");
    const dch_lo = donchian(low, CONFIG.DCH_LEN, "min");

    const ind = { high, low, close, adx, ema_trend, atr_b, dch_hi, dch_lo };
    const result = runSimulation(bars, ind);
    const n = bars.length;

    renderQuickStatus(result, ind.close[n - 1]);
    renderStatus(result, bars[n - 1], ind, n);
    renderIndicators(ind, n, bars[n - 1]);
    renderStats(result);
    renderTrades(result.trades);

    document.getElementById("last-updated").textContent = "資料更新於：" + new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
  } catch (e) {
    console.error(e);
    showError("讀取或計算失敗：" + e.message + "（若持續發生，可能是 Binance API 暫時無法從瀏覽器直接存取，請稍後重試）");
  } finally {
    btn.disabled = false;
    btn.textContent = "重新整理";
  }
}

function startDashboard() {
  document.getElementById("refresh-btn").addEventListener("click", loadAndRender);
  loadAndRender();
}

initGate();
