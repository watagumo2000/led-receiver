// ============================================================
// detect.js : LEDの場所の自動検出
// 「1コマで明るさが急に変わる回数」が多い場所をLEDとみなす(手ブレで動く物の縁と区別できる)。
// 並列方式では「10個が1列に等間隔」という形を使って並びを決める。
// ============================================================

// ================= LEDの場所を自動で探す =================
// list: 縮小した明るさ画像(幅sw×高さsh)の並び。点滅の大きい所を探す
// 1コマで明るさが急に変わった回数を数える。LEDは1コマで点いたり消えたりするが、
// 手ブレで動く明るい物の縁はじわじわ変わるだけなので、ここで区別できる(実際の動画で確認)
function jumpMap(list, P) {
  const N = list.length, mn = new Float32Array(P).fill(255), mx = new Float32Array(P), cnt = new Float32Array(P);
  for (const f of list) for (let p = 0; p < P; p++) { if (f[p] < mn[p]) mn[p] = f[p]; if (f[p] > mx[p]) mx[p] = f[p]; }
  for (let k = 1; k < N; k++) {
    const a = list[k - 1], b = list[k];
    for (let p = 0; p < P; p++) {
      const th = Math.max(25, 0.5 * (mx[p] - mn[p]));
      if (Math.abs(b[p] - a[p]) > th) cnt[p]++;
    }
  }
  return cnt;
}
// 山の周りの重みつき重心で、位置を細かく合わせる
function refine(v, sw, sh, q, rad) {
  let s = 0, sx = 0, sy = 0;
  for (let y = q.y - rad; y <= q.y + rad; y++) for (let x = q.x - rad; x <= q.x + rad; x++) {
    if (x < 0 || y < 0 || x >= sw || y >= sh) continue;
    const w = v[y * sw + x] ** 2; s += w; sx += w * x; sy += w * y;
  }
  return s > 0 ? { x: sx / s, y: sy / s, p: q.p, val: q.val } : q;
}
function topPeaks(v, sw, sh, maxN, sup, minVal) {
  const peaks = [], a = v.slice();
  for (let k = 0; k < maxN; k++) {
    let best = -1, bi = 0;
    for (let p = 0; p < a.length; p++) if (a[p] > best) { best = a[p]; bi = p; }
    if (best < minVal) break;
    const bx = bi % sw, by = Math.floor(bi / sw);
    peaks.push({ x: bx, y: by, p: bi, val: v[bi] });
    for (let y = by - sup; y <= by + sup; y++) for (let x = bx - sup; x <= bx + sup; x++)
      if (x >= 0 && y >= 0 && x < sw && y < sh) a[y * sw + x] = -1;
  }
  return peaks;
}
// 直列:急変の多い2か所。急変がより多いほうをクロックにする
function findSerial(list, sw, sh) {
  if (list.length < 30) return null;
  const v = jumpMap(list, sw * sh), minVal = Math.max(4, 0.02 * list.length);
  const pk = topPeaks(v, sw, sh, 2, Math.round(sw / 13), minVal).map((q) => refine(v, sw, sh, q, 2));
  if (pk.length < 2) return null;
  const ci = pk[0].val >= pk[1].val ? 0 : 1;
  const n = (q) => ({ x: (q.x + 0.5) / sw, y: (q.y + 0.5) / sh });
  return [n(pk[ci]), n(pk[1 - ci])];
}
// 並列:「10個が1列に等間隔で並ぶ」ことを使って探す(実際の動画で、明るいLEDのにじみや映り込みに強いことを確認)
//  1) 急変の多い点から、一番多くの点が乗る直線を選ぶ(D1のにじみなど、列から外れた点は無視される)
//  2) その直線に沿って、画面の端から端まで急変回数の分布を作る
//  3) 列の両端(D1とD10)の重心を求め、間を10等分する。急変が多い端がD1(クロック)
//  4) 10個をそれぞれ近くの急変の中心に寄せて、等間隔の直線に当てはめ直す
function findParallel(list, sw, sh) {
  if (list.length < 30) return null;
  const v = jumpMap(list, sw * sh), minVal = Math.max(4, 0.02 * list.length);
  const pk = topPeaks(v, sw, sh, 24, 2, minVal);
  if (pk.length < 3) return null;
  const at = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi < 0 || yi < 0 || xi >= sw || yi >= sh ? 0 : v[yi * sw + xi]; };
  // 1) 直線
  let best = null;
  for (let i = 0; i < pk.length; i++) for (let j = i + 1; j < pk.length; j++) {
    const a = pk[i], b = pk[j], L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 6) continue;
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    let sc = 0; for (const q of pk) if (Math.abs(-(q.x - a.x) * uy + (q.y - a.y) * ux) <= 1.5) sc += Math.sqrt(q.val);
    if (!best || sc > best.sc) best = { sc, a, ux, uy };
  }
  if (!best) return null;
  const inl = pk.filter((q) => Math.abs(-(q.x - best.a.x) * best.uy + (q.y - best.a.y) * best.ux) <= 1.5);
  if (inl.length < 3) return null;
  let mx = 0, my = 0, sw2 = 0; for (const q of inl) { mx += q.val * q.x; my += q.val * q.y; sw2 += q.val; } mx /= sw2; my /= sw2;
  let sxx = 0, syy = 0, sxy = 0;
  for (const q of inl) { sxx += q.val * (q.x - mx) ** 2; syy += q.val * (q.y - my) ** 2; sxy += q.val * (q.x - mx) * (q.y - my); }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang);
  // 2) 直線に沿った分布(画面の端から端まで、0.5マスきざみ。直線から±2マスの範囲の最大値)
  const Lmax = Math.hypot(sw, sh), s0 = -Lmax, ds = 0.5, prof = [];
  for (let t = -Lmax; t <= Lmax; t += ds) {
    let m = 0;
    for (let o = -2; o <= 2; o += 0.5) m = Math.max(m, at(mx + t * ux - o * uy, my + t * uy + o * ux));
    prof.push(m);
  }
  // 3) 一番急変の多いかたまり(D1)を含む、ひと続きの区間を列とみなす。
  //    D2のように点滅の少ないLEDは隙間になるので、D1のかたまりの幅の2.6倍まで(LED2個分ほど)の隙間はつなぐ
  const mxp = Math.max(...prof), thr = 0.15 * mxp, im = prof.indexOf(mxp);
  let c0 = im, c1 = im;
  while (c0 > 0 && prof[c0 - 1] >= thr) c0--;
  while (c1 < prof.length - 1 && prof[c1 + 1] >= thr) c1++;
  const gapMax = Math.max(6 / ds, 2.6 * (c1 - c0 + 1));
  const extend = (i, dir) => {
    let end = i, gap = 0;
    for (let k = i + dir; k >= 0 && k < prof.length; k += dir) {
      if (prof[k] >= thr) { end = k; gap = 0; } else if (++gap > gapMax) break;
    }
    return end;
  };
  const first = extend(c0, -1), last = extend(c1, 1);
  if (last - first < 9 * 2.5 / ds) return null;
  const w = Math.max(2, Math.round(0.6 * (last - first) / 9));
  const cen = (i0, i1) => { let s = 0, sx = 0, m = 0; for (let k = i0; k <= i1; k++) { s += prof[k]; sx += prof[k] * k; m = Math.max(m, prof[k]); } return { k: sx / s, m }; };
  const e1 = cen(first, first + w), e2 = cen(last - w, last);
  // 4) 10個それぞれを近くの急変の重心に寄せ、「等間隔」の直線に当てはめ直す(重みつき最小二乗、2回)
  let lo = e1.k, hi = e2.k;
  for (let it = 0; it < 2; it++) {
    const pitch = (hi - lo) / 9, r = Math.max(1, Math.round(0.35 * pitch));
    let S = 0, Sk = 0, Skk = 0, Sy = 0, Sky = 0;
    for (let k = 0; k < 10; k++) {
      const c = Math.round(lo + k * pitch), i0 = Math.max(0, c - r), i1 = Math.min(prof.length - 1, c + r);
      let s = 0, sx = 0; for (let q = i0; q <= i1; q++) { s += prof[q]; sx += prof[q] * q; }
      if (s <= 0) continue;
      const y = sx / s; S += s; Sk += s * k; Skk += s * k * k; Sy += s * y; Sky += s * k * y;
    }
    const den = S * Skk - Sk * Sk;
    if (den <= 0) break;
    const B = (S * Sky - Sk * Sy) / den, A = (Sy - B * Sk) / S;
    if (!(B > 0)) break;
    lo = A; hi = A + 9 * B;
  }
  const P = (k) => { const t = s0 + k * ds; return { x: mx + t * ux, y: my + t * uy }; };
  let a = P(hi), b = P(lo);
  if (e1.m > e2.m) [a, b] = [b, a];   // 急変が多い端がD1(クロック)
  return lineOf({ x: (a.x + 0.5) / sw, y: (a.y + 0.5) / sh }, { x: (b.x + 0.5) / sw, y: (b.y + 0.5) / sh });
}
function lineOf(a, b) { return Array.from({ length: 10 }, (_, k) => ({ x: a.x + (b.x - a.x) * k / 9, y: a.y + (b.y - a.y) * k / 9 })); }
