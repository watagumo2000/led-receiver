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
  // 点灯時の最大値の記録(ほとんど下がらない)。D2のように、たまにしか点かないLEDの白飛びの判定に使う
  ch.peak = ch.peak === undefined ? v : Math.max(v, ch.peak - 0.0001 * range);
  // 大津の方法(カラーモードのデータLEDで使う):最近の値を覚えておき、30コマごとに
  // 「点灯」と「消灯」の2つのまとまりが一番はっきり分かれる境目を求め直す
  if (ch.otsu) {
    (ch.buf = ch.buf || []).push(v);
    if (ch.buf.length > 900) ch.buf.shift();
    ch.nUpd = (ch.nUpd || 0) + 1;
    if (ch.nUpd % 30 === 0 && ch.buf.length >= 60) ch.thr = otsuThreshold(ch.buf);
  }
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

(window.LOADED = window.LOADED || {})["channel.js"] = "20261106-1200b";   // 版の確認用(index.html の最後で確かめる)

// 大津の方法:値を2つの組に分けたとき、2つの組の平均の差が一番大きくなる(組の間の分散が最大になる)境目
function otsuThreshold(values) {
  const xs = values.slice().sort((a, b) => a - b), n = xs.length;
  let total = 0; for (const x of xs) total += x;
  let sum0 = 0, best = -1, thr = xs[0];
  for (let i = 1; i < n; i++) {
    sum0 += xs[i - 1];
    if (xs[i] === xs[i - 1]) continue;
    const w0 = i / n, m0 = sum0 / i, m1 = (total - sum0) / (n - i), v = w0 * (1 - w0) * (m0 - m1) ** 2;
    if (v > best) { best = v; thr = (xs[i - 1] + xs[i]) / 2; }
  }
  return thr;
}
