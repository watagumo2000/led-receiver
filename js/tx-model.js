// ============================================================
// tx-model.js : 送信側のモデル
// FPGA(optical_tx / optical_par)と同じ動きを、時刻の関数として書いたもの。
// デモ信号の生成と、テスト(シミュレーション)で使う。
// ============================================================

// ================= 送信側のモデル(VHDLと同じ動き) =================
// ---- 直列(optical_tx):D1=クロック、D3=データ1ビット ----
function makeFrameBytes(msg) {
  const f = [0x7E, msg.length];
  let sum = msg.length;
  for (const ch of msg) { const b = ch.charCodeAt(0) & 0xFF; f.push(b); sum ^= b; }
  f.push(sum);
  return f;
}
function makeFrameBits(msg) {
  const bits = [];
  for (const b of makeFrameBytes(msg)) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  return bits;
}
// 時刻 t 秒でのLEDの状態。データはビットの始まりで変わり、クロックはビットの真ん中で反転する
function txState(t, bps, bits) {
  const T = 1 / bps;
  const n = Math.floor(t / T);
  const d = bits[((n % bits.length) + bits.length) % bits.length];
  const toggles = Math.floor((t - T / 2) / T) + 1;
  return { c: ((toggles % 2) + 2) % 2, d };
}
// ---- 並列(optical_par):D1=クロック、D2〜D9=1バイト、D10=パリティ ----
const SYNC_SYM = 0x1FF;   // D2〜D10 全点灯
function parity8(b) { let p = 0; for (let i = 0; i < 8; i++) p ^= (b >> i) & 1; return p; }
function makeFrameSymbols(msg) {
  const body = [msg.length];
  let sum = msg.length;
  for (const ch of msg) { const b = ch.charCodeAt(0) & 0xFF; body.push(b); sum ^= b; }
  body.push(sum);
  return [SYNC_SYM, ...body.map((b) => (b << 1) | parity8(b))];
}
function txParState(t, rate, syms) {
  const T = 1 / rate, n = Math.floor(t / T);
  const s = syms[((n % syms.length) + syms.length) % syms.length];
  const toggles = Math.floor((t - T / 2) / T) + 1;
  return { c: ((toggles % 2) + 2) % 2, s };
}
// k番目のLED(0=D1 … 9=D10)が点いているか
function ledOn(st, k) { return k === 0 ? st.c : (st.s >> (9 - k)) & 1; }

// ---- カラーモード(optical_par2 の PB3):D2〜D9 の赤=1バイト目、緑=2バイト目、D10 は赤と緑それぞれのパリティ ----
// シンボルは [赤の9ビット, 緑の9ビット]。先頭は同期(全部オレンジ)。バイト数が奇数なら最後に 00 を足す
function makeColorSymbols(msg) {
  const body = [msg.length];
  let sum = msg.length;
  for (const ch of msg) { const b = ch.charCodeAt(0) & 0xFF; body.push(b); sum ^= b; }
  body.push(sum);
  if (body.length % 2) body.push(0);
  const sym = (b) => (b << 1) | parity8(b);
  const out = [[SYNC_SYM, SYNC_SYM]];
  for (let i = 0; i < body.length; i += 2) out.push([sym(body[i]), sym(body[i + 1])]);
  return out;
}
function txColorState(t, rate, syms) {
  const T = 1 / rate, n = Math.floor(t / T);
  const s = syms[((n % syms.length) + syms.length) % syms.length];
  const toggles = Math.floor((t - T / 2) / T) + 1;
  return { c: ((toggles % 2) + 2) % 2, r: s[0], g: s[1] };
}
// k番目のLED(0=D1 … 9=D10)の [赤が点いているか, 緑が点いているか]。D1 はクロックで両方
function ledColor(st, k) { return k === 0 ? [st.c, st.c] : [(st.r >> (9 - k)) & 1, (st.g >> (9 - k)) & 1]; }
