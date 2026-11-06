// ============================================================
// decode-color.js : カラーモード(optical_par2 の PB3)の復号
// D2〜D10 の赤と緑を、それぞれ別の「並列の高精度受信」に入れて9ビットずつ読む。
// クロック(D1)の明るさは両方に同じものを入れるので、2つは同じ時刻にシンボルを出す。
// それを組にして、赤=1バイト目、緑=2バイト目として並べ、フレームを組み立てる。
// ============================================================
function makeColorDecoder(onFrame) {
  const dec = { subR: makeParDecoder2(null), subG: makeParDecoder2(null), qR: [], qG: [],
    mode: "hunt", bytes: [], len: 0, perr: 0, ok: 0, ng: 0, parityErr: 0, fixed: 0,
    fixedAtR: new Array(9).fill(0), fixedAtG: new Array(9).fill(0),
    partial: "", recent: [], votes: new Map(), voted: null, onFrame };
  dec.subR.pushFn = (s, c, conf) => dec.qR.push({ s, c, conf });
  dec.subG.pushFn = (s, c, conf) => dec.qG.push({ s, c, conf });
  return dec;
}
// lum0:D1の明るさ、rv / gv:D2〜D10 の赤 / 緑の明るさ(9個ずつ)
function feedColor(dec, t, lum0, rv, gv) {
  const a = feedPar2(dec.subR, t, [lum0, ...rv]);
  const b = feedPar2(dec.subG, t, [lum0, ...gv]);
  const out = [];
  const T = dec.subR.T || 1;
  while (dec.qR.length && dec.qG.length) {
    const r = dec.qR[0], g = dec.qG[0];
    if (Math.abs(r.c - g.c) > 0.25 * T) { (r.c < g.c ? dec.qR : dec.qG).shift(); continue; }   // 組にならない方を捨てる
    dec.qR.shift(); dec.qG.shift();
    out.push(pushColorSym(dec, r, g));
  }
  // LEDごとの色の判定:[赤, 緑](D1 は明るさ)
  const states = a.states.map((sr, i) => (i === 0 ? [sr, sr] : [sr, b.states[i]]));
  return { states, syms: out };
}
// パリティが合わなければ、一番自信のないビットを反転する(どちらの色の何番目か記録する)
function fixParity(dec, x, at) {
  if (parity8(x.s >> 1) === (x.s & 1)) return { s: x.s, fixed: false };
  dec.parityErr++; dec.perr++;
  let k = 0; for (let i = 1; i < 9; i++) if (x.conf[i] < x.conf[k]) k = i;
  at[k]++; dec.fixed++;
  return { s: x.s ^ (1 << (8 - k)), fixed: true };
}
function pushColorSym(dec, r, g) {
  const t = r.c;
  // 同期:赤も緑も、9個中8個以上が点灯
  if (popcount(r.s) >= 8 && popcount(g.s) >= 8) {
    dec.recent.push({ sync: true }); if (dec.recent.length > 16) dec.recent.shift();
    dec.mode = "len"; dec.bytes = []; dec.perr = 0; dec.partial = "";
    return { t, sync: true };
  }
  const fr = fixParity(dec, r, dec.fixedAtR), fg = fixParity(dec, g, dec.fixedAtG);
  const b1 = fr.s >> 1, b2 = fg.s >> 1;
  dec.recent.push({ b1, b2, fixed: fr.fixed || fg.fixed }); if (dec.recent.length > 16) dec.recent.shift();
  if (dec.mode === "hunt") return { t, b1, b2, fixed: fr.fixed || fg.fixed };
  dec.bytes.push(b1, b2);
  const L = dec.bytes[0];
  if (L < 1 || L > 64) { dec.mode = "hunt"; return { t, b1, b2 }; }
  dec.mode = "data";
  dec.partial = String.fromCharCode(...dec.bytes.slice(1, 1 + L));
  if (dec.bytes.length >= L + 2) {
    const data = dec.bytes.slice(1, 1 + L), sum = dec.bytes[1 + L];
    let x = L; for (const v of data) x ^= v;
    const ok = x === sum;
    if (ok) dec.ok++; else dec.ng++;
    dec.mode = "hunt";
    addVote(dec, L, data, sum);
    if (dec.onFrame) dec.onFrame({ ok, t, perr: dec.perr, bytes: [L, ...data, sum], text: String.fromCharCode(...data) });
  }
  return { t, b1, b2, fixed: fr.fixed || fg.fixed };
}

(window.LOADED = window.LOADED || {})["decode-color.js"] = "20261106-1130";   // 版の確認用(index.html の最後で確かめる)
