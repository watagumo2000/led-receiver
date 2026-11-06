// ============================================================
// view.js : 映像の取り込み・描画・デモ信号
// 画面全体で使う変数、1コマぶんの処理、読み取り位置の明るさの計算、
// 映像と印の描画、デモ信号の生成。
// ============================================================

// ================= ここから画面まわり =================
const $ = (id) => document.getElementById(id);
const view = $("view"), vctx = view.getContext("2d");
const proc = document.createElement("canvas"); proc.width = 320; proc.height = 240;
const pctx = proc.getContext("2d", { willReadFrequently: true });
const demoCv = document.createElement("canvas"); demoCv.width = 640; demoCv.height = 480;
const dctx = demoCv.getContext("2d");
const still = document.createElement("canvas"), sctx = still.getContext("2d");
const vid = $("vid");

const DEMO_SER_MSG = "HI FPGA";
const DEMO_PAR_MSG = "HELLO! THIS TEXT CAME FROM THE FPGA BY LIGHT.";
const DEMO_BITS = makeFrameBits(DEMO_SER_MSG);
const DEMO_SYMS = makeFrameSymbols(DEMO_PAR_MSG);
const DEMO_COL = Array.from({ length: 10 }, (_, k) => ({ x: 0.5, y: 0.1 + k * 0.09 }));   // 拡張ボードと同じ縦1列
const RATES = { par: [2, 5, 8, 10], ser: [5, 10, 15, 20] };

let mode = "par";                // "par"=並列(10個) / "ser"=直列(2個)
let source = "demo";
let pts = [];                    // LEDの位置(0〜1)。並列:[D1…D10]、直列:[クロック, データ]
let placeStep = 0;               // 並列:0=次のタップはD1、1=次はD10
let picking = 0;                 // 直列:0=クロック、1=データ
let dec, scopeBuf = [], scopeSyms = [], frames = [], lastMsg = null, lastStates = [];
let fpsTimes = [], demoTimer = null, rvfcId = null, stream = null, lastMediaTime = -1;
let curRot = 0, camFindTimer = null, trk = { peak: 0 };
let fileJob = null, fileInfo = null, fileObj = null, analyzing = false;
const SMALL_W = 160, SMALL_H = 120, RING = 240, SCAN_MAX = 900;   // RING:自動検出に使う直近のコマ数(約10秒分)
let ring = [], smallAll = [];

function resetDecoder() {
  trk = { peak: 0 };
  const onFrame = (f) => { frames.unshift(f); frames = frames.slice(0, 8); if (f.ok) lastMsg = f.text; renderLog(); };
  dec = mode === "par" ? (precise() ? makeParDecoder2(onFrame) : makeParDecoder(onFrame)) : makeDecoder(onFrame);
  scopeBuf = []; scopeSyms = []; frames = []; lastMsg = null; lastStates = []; renderLog(); renderMsg();
}
function precise() { return mode === "par" && $("precise").checked; }
function ready() { return mode === "par" ? pts.length === 10 && pts.every(Boolean) : !!(pts[0] && pts[1]); }
function demoPositions() { return mode === "par" ? DEMO_COL.map((p) => ({ ...p })) : [{ ...DEMO_COL[0] }, { ...DEMO_COL[2] }]; }
function findLeds(list) { return mode === "par" ? findParallel(list, SMALL_W, SMALL_H) : findSerial(list, SMALL_W, SMALL_H); }

// ---------- 映像の大きさと描画(回転を考慮) ----------
function srcSize(src) {
  const w = src.displayWidth || src.videoWidth || src.width, h = src.displayHeight || src.videoHeight || src.height;
  return curRot % 180 ? [h, w] : [w, h];
}
function drawSrc(ctx, src, W, H) {
  if (!curRot) { ctx.drawImage(src, 0, 0, W, H); return; }
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(curRot * Math.PI / 180);
  const w0 = curRot % 180 ? H : W, h0 = curRot % 180 ? W : H;
  ctx.drawImage(src, -w0 / 2, -h0 / 2, w0, h0); ctx.restore();
}
function grab(src) {
  const [sw, sh] = srcSize(src);
  if (!sw || !sh) return null;
  const ph = Math.round(320 * sh / sw);
  if (proc.height !== ph) proc.height = ph;
  drawSrc(pctx, src, 320, ph);
  return pctx.getImageData(0, 0, 320, ph);
}
// 読み取る半径(画素)。隣のLEDと重ならないよう、印どうしの距離の45%までに抑える
function effRadius(W, H) {
  let r = +$("radius").value * W / 640, m = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++)
    if (pts[i] && pts[j]) m = Math.min(m, Math.hypot((pts[i].x - pts[j].x) * W, (pts[i].y - pts[j].y) * H));
  return Math.max(1.5, Math.min(r, m * 0.45));
}

// ---------- 1コマぶんの処理 ----------
function processFrame(src, t) {
  const img = grab(src);
  if (!img) return;
  if (ready()) {
    const r = effRadius(img.width, img.height);
    const vals = pts.map((p) => sampleAt(img, p, r));
    if (mode === "par") {
      if (precise()) {
        const res = feedPar2(dec, t, vals);
        lastStates = res.states; scopeBuf.push({ t, st: res.states });
        scopeSyms.push(...res.syms);
      } else {
        const res = feedPar(dec, t, vals);
        lastStates = res.states; scopeBuf.push({ t, st: res.states });
        if (res.sym !== null) scopeSyms.push({ t, sym: res.sym, bad: res.sym !== SYNC_SYM && parity8(res.sym >> 1) !== (res.sym & 1) });
      }
      while (scopeSyms.length && scopeSyms[0].t < t - 6) scopeSyms.shift();
    } else {
      const res = feed(dec, t, vals[0], vals[1]);
      lastStates = [res.c, res.d]; scopeBuf.push({ t, cv: vals[0], dv: vals[1], bit: res.bit });
    }
    while (scopeBuf.length && scopeBuf[0].t < t - 6) scopeBuf.shift();
    if (source === "camera" && $("track").checked) {
      const moved = trackStep(img, pts, trk, r);
      if (moved) pts = moved;
    }
  }
  ring.push(computeSmall(img)); if (ring.length > RING) ring.shift();
  fpsTimes.push(t); if (fpsTimes.length > 31) fpsTimes.shift();
  drawView(src);
}
function sampleAt(img, m, r) {
  const W = img.width, H = img.height, cx = m.x * W, cy = m.y * H, d = img.data;
  let s = 0, n = 0;
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++)
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = (y * W + x) * 4; s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++;
    }
  return n ? s / n : 0;
}
function computeSmall(img) {
  const W = img.width, H = img.height, d = img.data, out = new Uint8ClampedArray(SMALL_W * SMALL_H);
  for (let y = 0; y < SMALL_H; y++) for (let x = 0; x < SMALL_W; x++) {
    const sx = Math.floor((x + 0.5) * W / SMALL_W), sy = Math.floor((y + 0.5) * H / SMALL_H), i = (sy * W + sx) * 4;
    out[y * SMALL_W + x] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }
  return out;
}
function markerStyle(i) {
  if (mode === "ser") return { col: css(i === 0 ? "--clk" : "--led"), label: i === 0 ? "C" : "D" };
  return { col: css(i === 0 ? "--clk" : i === 9 ? "--par" : "--led"), label: String(i + 1) };
}
function drawView(src) {
  const [sw, sh] = srcSize(src);
  if (!sw || !sh) return;
  const W = 640, H = Math.round(640 * sh / sw);
  if (view.height !== H) view.height = H;
  view.parentElement.style.aspectRatio = W + " / " + H;
  drawSrc(vctx, src, W, H);
  const r = effRadius(W, H);
  vctx.font = "600 13px IBM Plex Mono, monospace";
  pts.forEach((m, i) => {
    if (!m) return;
    const { col, label } = markerStyle(i), x = m.x * W, y = m.y * H;
    vctx.lineWidth = 2; vctx.strokeStyle = col;
    vctx.beginPath(); vctx.arc(x, y, r, 0, Math.PI * 2); vctx.stroke();
    if (lastStates[i] === 1) { vctx.globalAlpha = 0.35; vctx.fillStyle = col; vctx.fill(); vctx.globalAlpha = 1; }
    vctx.fillStyle = col; vctx.fillText(label, x + r + 4, y + 4);
  });
}
function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

// ---------- デモ信号:拡張ボードを真似た映像を作る ----------
function drawDemo(t) {
  const W = 640, H = 480, rate = +$("demoRate").value, fps = +$("demoFps").value;
  dctx.fillStyle = "#16301f"; dctx.fillRect(0, 0, W, H);
  dctx.fillStyle = "#1d3b28"; dctx.fillRect(250, 20, 140, 440);
  dctx.fillStyle = "#c9b98a"; dctx.font = "13px monospace";
  // 露光時間ぶんの平均をとる(カメラは一瞬ではなく少しの時間ためて撮る)
  const exp = 0.6 / fps, sub = 6, lit = new Array(10).fill(0);
  for (let k = 0; k < sub; k++) {
    const tt = t - exp * k / sub;
    if (mode === "par") { const s = txParState(tt, rate, DEMO_SYMS); for (let i = 0; i < 10; i++) lit[i] += ledOn(s, i) / sub; }
    else { const s = txState(tt, rate, DEMO_BITS); lit[0] += s.c / sub; lit[2] += s.d / sub; }
  }
  DEMO_COL.forEach((p, i) => {
    const x = p.x * W, y = p.y * H, a = lit[i] * (0.85 + Math.random() * 0.15);
    dctx.fillStyle = "#c9b98a"; dctx.fillText("D" + (i + 1), x - 52, y + 5);
    dctx.fillStyle = "#d8d2c4"; dctx.fillRect(x - 10, y - 7, 20, 14);
    if (a > 0.02) {
      const g = dctx.createRadialGradient(x, y, 2, x, y, 20);
      g.addColorStop(0, `rgba(255,236,190,${a})`); g.addColorStop(0.4, `rgba(255,150,40,${a * 0.85})`); g.addColorStop(1, "rgba(255,120,20,0)");
      dctx.fillStyle = g; dctx.fillRect(x - 22, y - 22, 44, 44);
    }
  });
  dctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let k = 0; k < 120; k++) dctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
}
function fillDemoRates() {
  const sel = $("demoRate"); sel.textContent = "";
  for (const r of RATES[mode]) { const o = document.createElement("option"); o.textContent = r; sel.append(o); }
  sel.value = "5"; $("demoUnit").textContent = mode === "par" ? "回/秒" : "bps";
}
function startDemo() {
  stopAll(); source = "demo"; curRot = 0; setSourceUI();
  pts = demoPositions(); placeStep = 0;
  resetDecoder();
  const t0 = performance.now() / 1000;
  const tick = () => { const t = performance.now() / 1000 - t0 + 0.37; drawDemo(t); processFrame(demoCv, t); };
  const restart = () => { clearInterval(demoTimer); demoTimer = setInterval(tick, 1000 / +$("demoFps").value); };
  restart();
  $("demoFps").onchange = () => { resetDecoder(); restart(); };
  $("demoRate").onchange = () => resetDecoder();
}
