// ============================================================
// diag.js : 診断表示とログの記録
// LEDごとに「今どう判定したか」「測った明るさ」「明暗の差(点滅が見えているか)」
// 「パリティで訂正した回数」を並べ、どこが読めていないかを見えるようにする。
// ログはコマごとの測定値をCSVに保存する(あとで原因を調べるため)。
// ============================================================
let logRows = null, logStart = 0;
const LOG_MAX = 36000;   // 60fpsで10分ぶん

function diagReset() { /* 受信をやり直したとき。表示は次の更新で作り直す */ }

// 受信方式ごとに、LED i の判定に使っているチャンネル(明暗の幅を追いかけている箱)を返す
function diagChannels(i) {
  if (!dec) return [];
  if (mode === "ser") return [i === 0 ? dec.clk : dec.dat];
  if (mode === "col") return i === 0 ? [dec.subR.ch[0]] : [dec.subR.ch[i], dec.subG.ch[i]];
  return [dec.ch[i]];
}
function rangeOf(ch) { return ch && ch.lo !== null ? ch.hi - ch.lo : 0; }

function renderDiag() {
  if (!$("diagOn").checked) return;
  const tbl = $("diagTable"), sum = $("diagSum");
  if (!ready() || !dec) { sum.textContent = "LEDの位置が決まると表示します。"; tbl.textContent = ""; return; }
  const n = ten() ? 10 : 2;
  const names = ten() ? Array.from({ length: 10 }, (_, i) => "D" + (i + 1)) : ["D1(クロック)", "D3(データ)"];
  const clockRange = rangeOf(diagChannels(0)[0]);
  const gate = Math.max(12, 0.4 * clockRange);   // これより明暗の差が小さいLEDは「消灯」とみなされる
  const fixedAt = mode === "col" ? null : dec.fixedAt;

  const rows = { state: [], value: [], range: [], seen: [], fixed: [] };
  let worst = null;
  for (let i = 0; i < n; i++) {
    // 判定
    let st;
    if (mode === "col" && lastColor[i]) {
      const [a, b] = lastColor[i];
      st = i === 0 ? (a ? ["on", "点"] : ["", "消"]) : a && b ? ["o", "橙"] : a ? ["r", "赤"] : b ? ["g", "緑"] : ["", "消"];
    } else st = lastStates[i] === 1 ? ["on", "点"] : ["", "消"];
    rows.state.push(`<span class="chip ${st[0]}">${st[1]}</span>`);
    // 測った値
    if (mode === "col" && i > 0 && lastRG[i]) rows.value.push(`R${Math.round(lastRG[i][0])} G${Math.round(lastRG[i][1])}`);
    else rows.value.push(lastVals[i] !== undefined ? String(Math.round(lastVals[i])) : "–");
    // 明暗の差と、点滅が見えているか
    const chs = diagChannels(i), rgs = chs.map(rangeOf);
    rows.range.push(rgs.map((x) => Math.round(x)).join(" / "));
    const seen = rgs.map((x) => (i === 0 ? x > 12 : x > gate));
    rows.seen.push(seen.map((ok) => (ok ? "○" : '<span class="bad">×</span>')).join(" / "));
    // 訂正回数
    let fx = "–";
    if (i > 0 && ten()) {
      if (mode === "col") {
        const a = dec.fixedAtR[i - 1], b = dec.fixedAtG[i - 1];
        fx = `${a} / ${b}`;
        if (!worst || a + b > worst.n) worst = { n: a + b, name: names[i] + (a >= b ? "の赤" : "の緑") };
      } else if (fixedAt) {
        fx = String(fixedAt[i - 1]);
        if (!worst || fixedAt[i - 1] > worst.n) worst = { n: fixedAt[i - 1], name: names[i] };
      }
    }
    rows.fixed.push(fx);
  }
  // 訂正が多いLEDは強調
  const maxFx = worst ? worst.n : 0;
  const head = `<tr><th></th>${names.map((x) => `<th>${x}</th>`).join("")}</tr>`;
  const line = (label, arr, hot) => `<tr><td>${label}</td>${arr.map((x, i) => `<td${hot && hot(i) ? ' class="hot"' : ""}>${x}</td>`).join("")}</tr>`;
  const cl = mode === "col";
  tbl.innerHTML = head +
    line("いまの判定", rows.state) +
    line(cl ? "明るさ(赤 / 緑)" : "明るさ", rows.value) +
    line(cl ? "明暗の差(赤 / 緑)" : "明暗の差", rows.range) +
    line("点滅が見えるか", rows.seen) +
    (ten() && precise() ? line(cl ? "訂正回数(赤 / 緑)" : "訂正回数", rows.fixed, (i) => {
      if (i === 0 || maxFx < 3) return false;
      const v = cl ? dec.fixedAtR[i - 1] + dec.fixedAtG[i - 1] : fixedAt[i - 1];
      return v === maxFx;
    }) : "");

  // まとめ
  const tm = timing(), msgs = [];
  if (!diagChannels(0)[0] || !diagChannels(0)[0].valid) msgs.push('<span class="warn">クロック(D1)の点滅が見えていません。</span>D1の位置を確認してください。');
  else if (ten() && precise() && !tm.locked) msgs.push("クロックのリズムを推定中です。");
  else if (ten() && precise()) {
    let fps = fileInfo ? fileInfo.fps : null;
    if (!fps && fpsTimes.length > 5) fps = (fpsTimes.length - 1) / (fpsTimes[fpsTimes.length - 1] - fpsTimes[0]);
    const rate = 1 / tm.T;
    msgs.push(`クロック:<b>${rate.toFixed(2)}回/秒</b>をつかめています` + (fps ? `(1シンボルあたり<b>${(fps / rate).toFixed(1)}</b>コマ)` : "") + "。");
  }
  const unseen = [];
  for (let i = 1; i < n; i++) {
    const chs = diagChannels(i);
    chs.forEach((c, j) => { if (rangeOf(c) <= gate) unseen.push(names[i] + (cl ? (j ? "の緑" : "の赤") : "")); });
  }
  if (unseen.length) msgs.push(`点滅が見えていないLED:<b>${unseen.join("、")}</b>(まだ一度も点いていないだけのこともあります。D2の赤・緑は同期のときしか点きません)。`);
  if (worst && worst.n >= 3) msgs.push(`<span class="warn">読み間違いが一番多いのは${worst.name}(訂正${worst.n}回)。</span>そのLEDの印の位置や、隣のLEDの光のにじみを確認してください。`);
  if (ten()) msgs.push(`フレーム 成功 <b>${dec.ok}</b> / 失敗 <b>${dec.ng}</b>、パリティ誤り <b>${dec.parityErr || 0}</b>。`);
  const clip = $("clipInfo");
  if (clip && source === "camera") msgs.push(clip.textContent + "。");
  sum.innerHTML = msgs.join(" ");
}

// ---------- ログ ----------
function diagLog(t) {
  if (!logRows) return;
  if (logRows.length >= LOG_MAX) { stopLog(); return; }
  const n = ten() ? 10 : 2, row = [(t - logStart).toFixed(4)];
  for (let i = 0; i < n; i++) row.push(lastVals[i] !== undefined ? lastVals[i].toFixed(1) : "");
  if (mode === "col") for (let i = 1; i < 10; i++) row.push(lastRG[i] ? lastRG[i][0].toFixed(1) : "", lastRG[i] ? lastRG[i][1].toFixed(1) : "");
  for (let i = 0; i < n; i++) {
    if (mode === "col" && lastColor[i]) { const [a, b] = lastColor[i]; row.push(a && b ? "O" : a ? "R" : b ? "G" : "-"); }
    else row.push(lastStates[i] === 1 ? "1" : "0");
  }
  logRows.push(row.join(","));
  if (logRows.length % 30 === 0) $("logInfo").textContent = `記録中 ${logRows.length}コマ`;
}
function logHeader() {
  const n = ten() ? 10 : 2, names = ten() ? Array.from({ length: 10 }, (_, i) => "D" + (i + 1)) : ["D1", "D3"];
  const h = ["t"];
  names.forEach((x) => h.push(x + "_明るさ"));
  if (mode === "col") for (let i = 2; i <= 10; i++) h.push(`D${i}_R`, `D${i}_G`);
  names.forEach((x) => h.push(x + "_判定"));
  return h.join(",");
}
function startLog() {
  logRows = []; logStart = fpsTimes.length ? fpsTimes[fpsTimes.length - 1] : 0;
  $("logBtn").textContent = "記録を止めて保存"; $("logInfo").textContent = "記録中…";
}
function stopLog() {
  const rows = logRows; logRows = null;
  $("logBtn").textContent = "ログを記録";
  if (!rows || !rows.length) { $("logInfo").textContent = "記録したコマがありません"; return; }
  const info = [`# 方式=${mode}`, `# 映像=${source}`, `# 日時=${new Date().toISOString()}`,
    `# LEDの位置=${pts.map((p) => p ? p.x.toFixed(3) + ":" + p.y.toFixed(3) : "-").join(" ")}`];
  const csv = "﻿" + info.join("\n") + "\n" + logHeader() + "\n" + rows.join("\n") + "\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `led-log-${mode}-${Date.now()}.csv`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  $("logInfo").textContent = `${rows.length}コマを保存しました`;
}
$("logBtn").onclick = () => (logRows ? stopLog() : startLog());
$("diagOn").onchange = () => { if (!$("diagOn").checked) { $("diagTable").textContent = ""; $("diagSum").textContent = "表示を止めています。"; } };
