// ============================================================
// decode-serial.js : 直列方式(optical_tx)の復号
// D1(クロック)が切り替わった瞬間のD3を1ビットとして読み、
// 7E・文字数・文字・チェックサムのフレームを組み立てる。
// ============================================================

// ================= 直列の復号:クロックが切り替わった瞬間のデータを1ビットとして読む =================
function makeDecoder(onFrame) {
  return { clk: makeChannel(), dat: makeChannel(), prevC: null, sh: 0, mode: "hunt", bitsIn: 0, len: 0, buf: [],
    bitTimes: [], totalBits: 0, ok: 0, ng: 0, recent: "", onFrame };
}
function feed(dec, t, cv, dv) {
  const c = updateChannel(dec.clk, cv);
  const d = updateChannel(dec.dat, dv);
  let bit = null;
  if (dec.clk.valid && dec.prevC !== null && c !== dec.prevC) { bit = d; pushBit(dec, d, t); }
  if (dec.clk.valid) dec.prevC = c;
  return { c, d, bit };
}
function pushBit(dec, b, t) {
  dec.totalBits++;
  dec.bitTimes.push(t); if (dec.bitTimes.length > 41) dec.bitTimes.shift();
  dec.recent = (dec.recent + b).slice(-120);
  dec.sh = ((dec.sh << 1) | b) & 0xFF;
  if (dec.mode === "hunt") {
    if (dec.sh === 0x7E) { dec.mode = "len"; dec.bitsIn = 0; dec.buf = []; }
    return;
  }
  if (++dec.bitsIn < 8) return;
  dec.bitsIn = 0;
  const byte = dec.sh;
  if (dec.mode === "len") {
    if (byte < 1 || byte > 64) { dec.mode = "hunt"; return; }
    dec.len = byte; dec.mode = "data"; return;
  }
  if (dec.mode === "data") { dec.buf.push(byte); if (dec.buf.length === dec.len) dec.mode = "sum"; return; }
  if (dec.mode === "sum") {
    let x = dec.len; for (const v of dec.buf) x ^= v;
    const ok = x === byte;
    if (ok) dec.ok++; else dec.ng++;
    const bytes = [0x7E, dec.len, ...dec.buf, byte];
    dec.mode = "hunt";
    if (dec.onFrame) dec.onFrame({ ok, t, bytes, text: String.fromCharCode(...dec.buf) });
  }
}
function estimateBps(dec) { return medianRate(dec.bitTimes); }

(window.LOADED = window.LOADED || {})["decode-serial.js"] = "20261106-1130";   // 版の確認用(index.html の最後で確かめる)
