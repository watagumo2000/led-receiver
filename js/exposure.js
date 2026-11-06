// ============================================================
// exposure.js : カメラの露出(明るさ)の調整
// LEDが明るすぎると中心が白く飛び、色や点灯/消灯の差が分からなくなる。
// ブラウザが対応していれば(主にAndroidのChrome)、カメラの露出をページから下げる。
// iPhoneのSafariなど対応していない場合は、FPGAのPB3長押しでLEDを暗くする。
// ============================================================

let camTrack = null, clipShown = -1;

// カメラが動き出したら呼ぶ。使える設定だけ、つまみを作る
function setupExposure(track) {
  camTrack = track;
  const box = $("camCtl");
  box.textContent = "";
  box.hidden = false;
  let caps = {};
  try { caps = track.getCapabilities ? track.getCapabilities() : {}; } catch (e) { caps = {}; }
  const modes = caps.exposureMode || [];
  const canManual = modes.includes("manual") && caps.exposureTime;
  const canComp = !!caps.exposureCompensation;
  const canIso = canManual && !!caps.iso;

  const title = document.createElement("span");
  title.className = "label"; title.textContent = "カメラの露出";
  box.append(title);

  if (!canManual && !canComp) {
    const p = document.createElement("span");
    p.className = "hint inline-hint";
    p.textContent = "この端末・ブラウザでは、ページから露出を変えられません(iPhoneなど)。白飛びするときは、FPGAのPB3を長押ししてLEDを暗くしてください。";
    box.append(p, clipLabel());
    return;
  }

  // 「暗くする」:手動の露出時間が使えれば短くし、使えなければ露出補正を一番下げる
  const dark = document.createElement("button");
  dark.id = "expDark"; dark.textContent = "暗くする(白飛び対策)";
  dark.onclick = () => {
    if (canManual) {
      const t = Math.max(caps.exposureTime.min, Math.min(caps.exposureTime.max, 10));   // 10 × 100µs = 1/1000秒
      const iso = canIso ? caps.iso.min : undefined;
      applyExp({ exposureMode: "manual", exposureTime: t, ...(iso !== undefined ? { iso } : {}) });
      if ($("expTime")) $("expTime").value = t;
      if ($("expIso") && iso !== undefined) $("expIso").value = iso;
    } else {
      applyExp({ exposureMode: "continuous", exposureCompensation: caps.exposureCompensation.min });
      if ($("expComp")) $("expComp").value = caps.exposureCompensation.min;
    }
  };
  const auto = document.createElement("button");
  auto.id = "expAuto"; auto.textContent = "自動に戻す";
  auto.onclick = () => {
    const c = { exposureMode: "continuous" };
    if (canComp) { c.exposureCompensation = 0; if ($("expComp")) $("expComp").value = 0; }
    applyExp(c);
  };
  box.append(dark, auto);

  if (canComp) {
    const r = caps.exposureCompensation;
    box.append(slider("expComp", "露出補正", r.min, r.max, r.step || 0.1, 0, (v) => applyExp({ exposureMode: "continuous", exposureCompensation: v }), (v) => (v > 0 ? "+" : "") + v.toFixed(1)));
  }
  if (canManual) {
    const r = caps.exposureTime;
    const start = Math.min(r.max, Math.max(r.min, 100));
    box.append(slider("expTime", "露出時間", r.min, Math.min(r.max, 333), r.step || 1, start, (v) => applyExp({ exposureMode: "manual", exposureTime: v }), (v) => "1/" + Math.round(10000 / v) + "秒"));
  }
  if (canIso) {
    const r = caps.iso;
    box.append(slider("expIso", "ISO", r.min, r.max, r.step || 1, r.min, (v) => applyExp({ exposureMode: "manual", iso: v }), (v) => String(Math.round(v))));
  }
  box.append(clipLabel());
}

function slider(id, name, min, max, step, value, onChange, fmt) {
  const lab = document.createElement("label");
  const txt = document.createElement("span"); txt.textContent = name;
  const inp = document.createElement("input");
  inp.type = "range"; inp.id = id; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
  const out = document.createElement("span"); out.className = "expval"; out.textContent = fmt(+inp.value);
  inp.oninput = () => { out.textContent = fmt(+inp.value); };
  inp.onchange = () => onChange(+inp.value);
  lab.append(txt, inp, out);
  return lab;
}
function clipLabel() {
  const s = document.createElement("span");
  s.id = "clipInfo"; s.className = "expval"; s.textContent = "白飛び:–";
  return s;
}

// 設定をカメラに送る。明るさが大きく変わるので、受信は判定をやり直す(LEDの位置はそのまま)
async function applyExp(c) {
  if (!camTrack) return;
  try {
    await camTrack.applyConstraints({ advanced: [c] });
    $("err").hidden = true;
    if (typeof resetDecoder === "function") resetDecoder();
  } catch (e) {
    showErr("カメラがこの設定を受け付けませんでした(" + (e && e.message ? e.message : e) + ")。別のつまみを試すか、FPGAのPB3長押しでLEDを暗くしてください。");
  }
}

// 点いているLEDの読み取り範囲のうち、白く飛んでいる(R,G,Bすべて250以上の)画素の割合
function updateClip(img, pts, r, states) {
  const el = $("clipInfo");
  if (!el) return;
  const W = img.width, H = img.height, d = img.data;
  let n = 0, c = 0;
  pts.forEach((m, k) => {
    if (!m || states[k] !== 1) return;
    const cx = m.x * W, cy = m.y * H;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        const i = (y * W + x) * 4; n++;
        if (d[i] >= 250 && d[i + 1] >= 250 && d[i + 2] >= 250) c++;
      }
  });
  if (!n) return;
  const pct = Math.round(100 * c / n);
  if (pct === clipShown) return;
  clipShown = pct;
  el.textContent = `白飛び:${pct}%` + (pct > 30 ? "(多い。暗くしてください)" : pct > 5 ? "(少しあり)" : "(良好)");
}

function stopExposure() {
  camTrack = null; clipShown = -1;
  const box = $("camCtl"); if (box) { box.hidden = true; box.textContent = ""; }
}

(window.LOADED = window.LOADED || {})["exposure.js"] = "20261106-1200b";   // 版の確認用(index.html の最後で確かめる)
