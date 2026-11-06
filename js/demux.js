// ============================================================
// demux.js : MP4 / MOV の読み取り
// 動画ファイルの中から、映像の各コマの位置・時刻・圧縮形式を取り出す。
// 取り出したコマはブラウザのデコーダ(WebCodecs)で画像に戻す。
// ============================================================

// ---- MP4 / MOV の中身を読み、映像の1コマずつの位置と設定を取り出す ----
function str4(u8, p) { return String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]); }
function boxList(u8, start, end) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = [];
  let p = start;
  while (p + 8 <= end) {
    let s = dv.getUint32(p), h = 8;
    const t = str4(u8, p + 4);
    if (s === 1) { s = Number(dv.getBigUint64(p + 8)); h = 16; } else if (s === 0) s = end - p;
    if (s < h || p + s > end) break;
    out.push({ type: t, start: p, cs: p + h, end: p + s });
    p += s;
  }
  return out;
}
function boxPath(u8, box, ...types) {
  let b = box;
  for (const t of types) { b = boxList(u8, b.cs, b.end).find((x) => x.type === t); if (!b) return null; }
  return b;
}
function hex2(n) { return n.toString(16).padStart(2, "0"); }
function codecString(entry, cfgType, c) {
  if (cfgType === "avcC") return entry + "." + hex2(c[1]) + hex2(c[2]) + hex2(c[3]);
  // hvcC
  const space = c[1] >> 6, tier = (c[1] >> 5) & 1, prof = c[1] & 0x1f;
  let compat = ((c[2] << 24) | (c[3] << 16) | (c[4] << 8) | c[5]) >>> 0, rev = 0;
  for (let i = 0; i < 32; i++) { rev = ((rev << 1) | (compat & 1)) >>> 0; compat >>>= 1; }
  let s = entry + "." + ["", "A", "B", "C"][space] + prof + "." + rev.toString(16) + "." + (tier ? "H" : "L") + c[12];
  const cons = Array.from(c.subarray(6, 12));
  while (cons.length && cons[cons.length - 1] === 0) cons.pop();
  for (const b of cons) s += "." + b.toString(16);
  return s;
}
// read(offset, length) は Uint8Array を返す Promise
async function demuxMp4(read, size) {
  let pos = 0, moov = null;
  while (pos + 8 <= size) {
    const h = await read(pos, Math.min(16, size - pos));
    const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
    let s = dv.getUint32(0);
    const t = str4(h, 4);
    if (s === 1) s = Number(dv.getBigUint64(8)); else if (s === 0) s = size - pos;
    if (s < 8) throw new Error("動画ファイルの形式を読み取れませんでした");
    if (t === "moov") { moov = await read(pos, s); break; }
    pos += s;
  }
  if (!moov) throw new Error("動画の目次(moov)が見つかりませんでした");
  const top = boxList(moov, 0, moov.length)[0];
  const dv = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  for (const trak of boxList(moov, top.cs, top.end).filter((b) => b.type === "trak")) {
    const hdlr = boxPath(moov, trak, "mdia", "hdlr");
    if (!hdlr || str4(moov, hdlr.cs + 8) !== "vide") continue;
    const mdhd = boxPath(moov, trak, "mdia", "mdhd");
    const timescale = dv.getUint32(mdhd.cs + (moov[mdhd.cs] === 1 ? 20 : 12));
    // 回転(縦撮り)の情報
    const tkhd = boxPath(moov, trak, "tkhd");
    let rot = 0;
    if (tkhd) {
      const m = tkhd.cs + (moov[tkhd.cs] === 1 ? 52 : 40);
      const a = dv.getInt32(m), b = dv.getInt32(m + 4), c = dv.getInt32(m + 12), d = dv.getInt32(m + 16);
      if (a === 0 && b > 0 && c < 0) rot = 90; else if (a < 0 && d < 0) rot = 180; else if (a === 0 && b < 0 && c > 0) rot = 270;
    }
    const stbl = boxPath(moov, trak, "mdia", "minf", "stbl");
    const stsd = boxPath(moov, stbl, "stsd");
    const e = stsd.cs + 8, eSize = dv.getUint32(e), entry = str4(moov, e + 4);
    const width = dv.getUint16(e + 32), height = dv.getUint16(e + 34);
    const cfg = boxList(moov, e + 86, e + eSize).find((x) => x.type === "avcC" || x.type === "hvcC");
    if (!cfg) throw new Error("この動画の形式(" + entry + ")には対応していません。H.264かHEVCで撮影してください");
    const description = moov.slice(cfg.cs, cfg.end);
    const codec = codecString(entry, cfg.type, description);
    const tbl = (t) => boxPath(moov, stbl, t);
    // コマの大きさ
    const stsz = tbl("stsz"), fixed = dv.getUint32(stsz.cs + 4), count = dv.getUint32(stsz.cs + 8);
    const sizes = new Array(count);
    for (let i = 0; i < count; i++) sizes[i] = fixed || dv.getUint32(stsz.cs + 12 + 4 * i);
    // チャンクの位置
    const stco = tbl("stco"), co64 = tbl("co64"), chunkOff = [];
    if (stco) { const n = dv.getUint32(stco.cs + 4); for (let i = 0; i < n; i++) chunkOff.push(dv.getUint32(stco.cs + 8 + 4 * i)); }
    else { const n = dv.getUint32(co64.cs + 4); for (let i = 0; i < n; i++) chunkOff.push(Number(dv.getBigUint64(co64.cs + 8 + 8 * i))); }
    const stsc = tbl("stsc"), nsc = dv.getUint32(stsc.cs + 4), offsets = new Array(count);
    let si = 0;
    for (let j = 0; j < nsc && si < count; j++) {
      const first = dv.getUint32(stsc.cs + 8 + 12 * j), spc = dv.getUint32(stsc.cs + 12 + 12 * j);
      const next = j + 1 < nsc ? dv.getUint32(stsc.cs + 8 + 12 * (j + 1)) : chunkOff.length + 1;
      for (let ch = first; ch < next && si < count; ch++) {
        let off = chunkOff[ch - 1];
        for (let k = 0; k < spc && si < count; k++) { offsets[si] = off; off += sizes[si]; si++; }
      }
    }
    // 時刻
    const stts = tbl("stts"), nst = dv.getUint32(stts.cs + 4), dts = new Array(count);
    let t = 0; si = 0;
    for (let j = 0; j < nst; j++) {
      const n = dv.getUint32(stts.cs + 8 + 8 * j), dl = dv.getUint32(stts.cs + 12 + 8 * j);
      for (let k = 0; k < n && si < count; k++) { dts[si++] = t; t += dl; }
    }
    while (si < count) dts[si++] = t;
    const cts = dts.slice(), ctts = tbl("ctts");
    if (ctts) {
      const n = dv.getUint32(ctts.cs + 4); si = 0;
      for (let j = 0; j < n; j++) {
        const c = dv.getUint32(ctts.cs + 8 + 8 * j), o = dv.getInt32(ctts.cs + 12 + 8 * j);
        for (let k = 0; k < c && si < count; k++) cts[si++] += o;
      }
    }
    const stss = tbl("stss"), sync = new Array(count).fill(!stss);
    if (stss) { const n = dv.getUint32(stss.cs + 4); for (let j = 0; j < n; j++) sync[dv.getUint32(stss.cs + 8 + 4 * j) - 1] = true; }
    const samples = [];
    for (let i = 0; i < count; i++) samples.push({ offset: offsets[i], size: sizes[i], dts: dts[i], cts: cts[i], sync: sync[i] });
    const dur = (t || 1) / timescale;
    return { codec, description, cfgType: cfg.type, width, height, timescale, rot, samples, fps: count / dur, duration: dur,
      config: { codec, description, codedWidth: width, codedHeight: height } };
  }
  throw new Error("動画の映像トラックが見つかりませんでした");
}
