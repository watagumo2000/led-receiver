// ============================================================
// channel.js : 明るさ → 0/1 の判定
// LEDごとに明るさの最小・最大を追いかけ、その真ん中を境目にして点灯/消灯を決める。
// medianRate は時刻の列から「1秒に何回か」を求める。
// ============================================================

// ================= 明るさ → 0/1 の判定 =================
// 明暗の幅に自動で追従し、ヒステリシス(行ったり来たり防止の幅)付きで判定する
function makeChannel() { return { lo: null, hi: null, state: 0, valid: false }; }
function updateChannel(ch, v) {
  if (ch.lo === null) { ch.lo = v; ch.hi = v; }
  const r0 = ch.hi - ch.lo;
  ch.hi = Math.max(v, ch.hi - 0.002 * r0);
  ch.lo = Math.min(v, ch.lo + 0.002 * r0);
  const range = ch.hi - ch.lo;
  ch.valid = range > 12;
  const mid = (ch.hi + ch.lo) / 2, h = range * 0.12;
  if (v > mid + h) ch.state = 1; else if (v < mid - h) ch.state = 0;
  return ch.state;
}
function medianRate(ts) {
  if (ts.length < 6) return null;
  const d = []; for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
  d.sort((a, b) => a - b);
  const m = d[Math.floor(d.length / 2)];
  return m > 0 ? 1 / m : null;
}
