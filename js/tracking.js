// ============================================================
// tracking.js : 手ブレ補正
// クロックLEDの光の重心を追いかけ、読み取る位置を一緒に動かす(カメラ使用時)。
// ============================================================

// ================= 手ブレ補正 =================
// クロックLED(pts[0])が点いている間、その光の重心を追いかけて、全部の印を一緒に動かす
// img は {width, height, data(RGBA)}、印の座標は 0〜1、r は読み取り半径(img の画素)
// tr は追跡用の記憶 { peak }(印を置き直したら新しく作る)
function trackStep(img, pts, tr, r) {
  const W = img.width, H = img.height, d = img.data, c0 = pts[0], cx = c0.x * W, cy = c0.y * H;
  let sep = Infinity;
  for (let i = 1; i < pts.length; i++) sep = Math.min(sep, Math.hypot((c0.x - pts[i].x) * W, (c0.y - pts[i].y) * H));
  const R = Math.max(4, Math.min(r * 3, sep * 0.45));
  let max = 0, sum = 0, n = 0;
  const lum = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(W - 1, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(H - 1, Math.ceil(cy + R));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const v = lum((y * W + x) * 4); if (v > max) max = v; sum += v; n++; }
  // 探す範囲の中で一番明るい点が、最近の最大値に近く、背景よりはっきり明るいとき = クロックLEDが点灯中
  tr.peak = Math.max(max, (tr.peak || 0) * 0.995);
  if (!n || max < tr.peak * 0.7 || max - sum / n < 30) return null;
  const th = max * 0.75;
  let sw = 0, sx = 0, sy = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
    const v = lum((y * W + x) * 4) - th;
    if (v > 0) { sw += v; sx += v * x; sy += v * y; }
  }
  if (sw <= 0) return null;
  const dx = (sx / sw - cx) * 0.5 / W, dy = (sy / sw - cy) * 0.5 / H;
  return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

(window.LOADED = window.LOADED || {})["tracking.js"] = "20261106-1130";   // 版の確認用(index.html の最後で確かめる)
