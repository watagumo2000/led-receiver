// ============================================================
// app.js : 操作と表示の更新
// LEDの位置指定、受信結果・波形の表示、ボタンの設定。最後に読み込み、ここで動き始める。
// ============================================================

// ---------- LEDの位置指定 ----------
view.addEventListener("click", (e) => {
  const rc = view.getBoundingClientRect();
  const p = { x: (e.clientX - rc.left) / rc.width, y: (e.clientY - rc.top) / rc.height };
  if (mode === "ser") {
    pts[picking] = p; picking = 1 - picking;
  } else {
    const fix = +$("fixSel").value;
    if (fix >= 0 && ready()) { pts[fix] = p; $("fixSel").value = "-1"; }
    else if (placeStep === 0) { pts = [p, null, null, null, null, null, null, null, null, null]; placeStep = 1; }
    else { pts = lineOf(pts[0], p); placeStep = 0; }
  }
  setPickUI();
  if (!analyzing) resetDecoder();
  if (fileInfo && !analyzing) drawView(still);
});
$("pickClk").onclick = () => { picking = 0; setPickUI(); };
$("pickDat").onclick = () => { picking = 1; setPickUI(); };
$("placeLine").onclick = () => { placeStep = 0; $("fixSel").value = "-1"; setPickUI(); };
$("autoFind").onclick = () => {
  const found = findLeds(fileInfo ? smallAll : ring);
  if (!found) { showErr("点滅しているLEDを見つけられませんでした。数秒待つか、手動でタップして指定してください。"); return; }
  $("err").hidden = true; pts = found; placeStep = 0; resetDecoder();
  if (fileInfo && !analyzing) drawView(still);
  $("hint").textContent = "点滅の様子から位置を決めました。ずれていたら指定し直してください。";
};

// ---------- 表示の更新 ----------
function renderMsg() {
  const el = $("msg"), vt = dec && dec.voted, vEl = $("vote");
  const text = lastMsg !== null ? lastMsg : vt && vt.ok ? vt.text : null;
  if (text === null) { el.textContent = "受信待ち…"; el.classList.add("wait"); }
  else { el.textContent = text; el.classList.remove("wait"); }
  vEl.hidden = !vt;
  if (vt) {
    vEl.textContent = "";
    const head = document.createTextNode(`繰り返し受信の多数決(${vt.n}回分):`);
    const b = document.createElement("b"); b.textContent = vt.text;
    const mark = document.createElement("span"); mark.className = vt.ok ? "ok" : "ng"; mark.textContent = vt.ok ? " チェックサム一致" : " チェックサム不一致";
    vEl.append(head, b, mark);
  } else vEl.textContent = "";
}
function hex(a) { return a.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" "); }
function renderLog() {
  const ul = $("log"); ul.textContent = "";
  if (!frames.length) { const li = document.createElement("li"); li.className = "empty"; li.style.cssText = "display:block;border:0"; li.textContent = "まだありません"; ul.append(li); renderMsg(); return; }
  for (const f of frames) {
    const li = document.createElement("li");
    const t = document.createElement("span"); t.textContent = f.t.toFixed(1) + "s";
    const s = document.createElement("span"); s.className = f.ok ? "ok" : "ng"; s.textContent = f.ok ? "成功" : "失敗";
    const body = document.createElement("span"); body.textContent = JSON.stringify(f.text);
    const hx = document.createElement("span"); hx.className = "hex";
    hx.textContent = hex(f.bytes) + (f.perr ? `(パリティ誤り ${f.perr}個)` : ""); body.append(hx);
    li.append(t, s, body); ul.append(li);
  }
  renderMsg();
}
function symLabel(s) {
  if (s === SYNC_SYM) return "S";
  const b = s >> 1;
  return b >= 32 && b < 127 ? String.fromCharCode(b) : b.toString(16).toUpperCase().padStart(2, "0");
}
function renderStats() {
  $("stFrames").textContent = dec.ok + " / " + dec.ng;
  const tm = timing();
  const rate = ten() ? (precise() ? (tm.locked ? 1 / tm.T : null) : medianRate(dec.symTimes)) : estimateBps(dec);
  $("stBps").textContent = !rate ? "–" : ten() ? `${rate.toFixed(1)}回/秒・${(rate * (mode === "col" ? 16 : 8)).toFixed(0)}bps` : `${rate.toFixed(1)} bps`;
  let fps = fileInfo ? fileInfo.fps : null;
  if (!fps && fpsTimes.length > 5) fps = (fpsTimes.length - 1) / (fpsTimes[fpsTimes.length - 1] - fpsTimes[0]);
  $("stFps").textContent = fps ? fps.toFixed(0) + " fps" : "–";
  const part = $("partial");
  if (mode === "col") {
    $("stPerr").textContent = `${dec.parityErr}(訂正${dec.fixed})`;
    renderMsg();
    $("bits").textContent = dec.recent.length ? dec.recent.map((s) => s.sync ? "[S]" : hex([s.b1, s.b2]).replace(" ", "") + (s.fixed ? "*" : "")).join(" ") : "—";
    const receiving = dec.mode === "data";
    part.hidden = !receiving;
    part.textContent = receiving ? "受信中:" + dec.partial + "▍" : "";
  } else if (mode === "par") {
    $("stPerr").textContent = precise() ? `${dec.parityErr}(訂正${dec.fixed})` : dec.parityErr;
    renderMsg();
    $("bits").textContent = dec.recent.length ? dec.recent.map((s) => {
      const bad = s !== SYNC_SYM && parity8(s >> 1) !== (s & 1);
      return symLabel(s) === "S" ? "[S]" : hex([s >> 1]) + (bad ? "!" : "");
    }).join(" ") : "—";
    const receiving = dec.mode === "data" || dec.mode === "sum";
    part.hidden = !receiving;
    part.textContent = receiving ? "受信中:" + dec.partial + "▍" : "";
  } else {
    $("bits").textContent = dec.recent || "—"; part.hidden = true;
  }
  const v = $("verdict");
  if (!ready()) { v.className = "verdict"; v.textContent = "LEDの位置を指定すると判定を始めます。"; return; }
  if (!scopeBuf.length) { v.className = "verdict"; v.textContent = "解析を待っています。"; return; }
  const clkOk = ten() ? tm.ch[0].valid : dec.clk.valid;
  if (clkOk && precise() && !tm.locked) { v.className = "verdict"; v.textContent = "クロックのリズム(周期と位相)を推定しています…"; return; }
  if (!clkOk) { v.className = "verdict bad"; v.textContent = "クロックLED(D1)の点滅が見えません。位置か読み取る範囲を調整してください。"; return; }
  if (rate && fps) {
    const per = fps / rate, unit = ten() ? "1シンボル" : "1ビット";
    if (precise() && per >= 2 && per < 3) { v.className = "verdict good"; v.textContent = `${unit}あたり約${per.toFixed(1)}コマ。高精度受信なら読める速さです(余裕は少なめ)。`; return; }
    if (per < (precise() ? 2 : 3)) { v.className = "verdict bad"; v.textContent = `${unit}あたり約${per.toFixed(1)}コマ。速すぎて取りこぼす可能性があります。`; return; }
    v.className = "verdict good"; v.textContent = `${unit}あたり約${per.toFixed(1)}コマ。カメラが追いつける速さです。`; return;
  }
  v.className = "verdict"; v.textContent = "データを集めています…";
}
function drawScope() {
  const cv = $("scope"), dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = 190;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const line = css("--line"), muted = css("--muted");
  const L0 = ten() ? 34 : 0, PW = W - L0;
  g.strokeStyle = line; g.lineWidth = 1;
  for (let i = 0; i <= 6; i++) { const x = L0 + PW * i / 6; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  g.font = "11px IBM Plex Mono, monospace";
  if (ten()) for (let i = 0; i < 10; i++) { g.fillStyle = muted; g.fillText("D" + (i + 1), 0, 8 + i * 15 + 11); }
  if (scopeBuf.length < 2) return;
  const tEnd = scopeBuf[scopeBuf.length - 1].t, tStart = tEnd - 6, X = (t) => L0 + (t - tStart) / 6 * PW;
  if (ten()) {
    // ロジックアナライザのように、10個のLEDの点灯を並べる(カラーモードは上半分=赤、下半分=緑)
    const red = css("--red"), grn = css("--grn");
    for (let i = 0; i < 10; i++) {
      const y = 8 + i * 15;
      for (let k = 0; k < scopeBuf.length - 1; k++) {
        const x0 = X(scopeBuf[k].t), x1 = X(scopeBuf[k + 1].t), w = Math.max(1, x1 - x0);
        if (scopeBuf[k].col) {
          const [a, b] = scopeBuf[k].col[i];
          if (a) { g.fillStyle = red; g.fillRect(x0, y + 2, w, 5); }
          if (b) { g.fillStyle = grn; g.fillRect(x0, y + 7, w, 5); }
        } else if (scopeBuf[k].st[i] === 1) {
          g.fillStyle = markerStyle(i).col; g.fillRect(x0, y + 2, w, 10);
        }
      }
    }
    for (const s of scopeSyms) {
      if (s.t < tStart) continue;
      const x = X(s.t); g.strokeStyle = muted; g.beginPath(); g.moveTo(x, 6); g.lineTo(x, 160); g.stroke();
      g.fillStyle = s.bad ? css("--ng") : s.fixed ? css("--par") : css("--ink");
      const lb = s.label !== undefined ? s.label : symLabel(s.sym); g.fillText(lb, x - g.measureText(lb).width / 2, 180);
    }
    return;
  }
  const lanes = [{ k: "cv", ch: dec.clk, col: css("--clk"), y0: 10, h: 65 }, { k: "dv", ch: dec.dat, col: css("--led"), y0: 92, h: 65 }];
  for (const Ln of lanes) {
    const lo = Ln.ch.lo ?? 0, hi = Ln.ch.hi ?? 1, rg = Math.max(1, hi - lo);
    const Y = (v) => Ln.y0 + Ln.h - Math.max(0, Math.min(1, (v - lo) / rg)) * Ln.h;
    g.setLineDash([4, 4]); g.strokeStyle = muted; g.beginPath(); g.moveTo(0, Y((hi + lo) / 2)); g.lineTo(W, Y((hi + lo) / 2)); g.stroke(); g.setLineDash([]);
    g.strokeStyle = Ln.col; g.lineWidth = 1.8; g.beginPath();
    scopeBuf.forEach((s, i) => { const x = X(s.t), y = Y(s[Ln.k]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
  }
  g.fillStyle = css("--ink");
  for (const s of scopeBuf) if (s.bit !== null) {
    const x = X(s.t); g.strokeStyle = muted; g.lineWidth = 1; g.beginPath(); g.moveTo(x, 8); g.lineTo(x, 162); g.stroke();
    g.fillText(String(s.bit), x - 3, 180);
  }
}
let uiLast = 0;
function uiLoop(now) {
  if (now - uiLast > 100) { uiLast = now; renderStats(); drawScope(); renderDiag(); }
  requestAnimationFrame(uiLoop);
}

// ---------- ボタン ----------
$("srcDemo").onclick = startDemo;
$("srcCam").onclick = startCamera;
$("modePar").onclick = () => setMode("par");
$("modeSer").onclick = () => setMode("ser");
$("modeCol").onclick = () => setMode("col");
$("fileIn").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) startVideoFile(f); };
$("replay").onclick = () => {
  if (fileInfo) { analyzeFile(); return; }
  resetDecoder(); vid.currentTime = 0; playVideo();
};
$("speed").onchange = () => { vid.playbackRate = +$("speed").value; };
$("resetDec").onclick = resetDecoder;
$("precise").onchange = () => { resetDecoder(); if (fileInfo && !analyzing) analyzeFile(); };

setModeUI(); resetDecoder(); startDemo(); requestAnimationFrame(uiLoop);
