// ============================================================
// decode-parallel.js : 並列方式(optical_par)の復号
// makeParDecoder  … 旧方式。クロックが切り替わったコマでD2〜D10を読む。
// makeParDecoder2 … 高精度受信。クロック再生・複数コマの平均・パリティ訂正・多数決。
// ============================================================

// ================= 並列の復号:クロックが切り替わった瞬間のD2〜D10を9ビットとして読む =================
function makeParDecoder(onFrame) {
  return { ch: Array.from({ length: 10 }, makeChannel), prevC: null, mode: "hunt", len: 0, buf: [], perr: 0,
    symTimes: [], totalSyms: 0, parityErr: 0, ok: 0, ng: 0, partial: "", recent: [], onFrame };
}
function feedPar(dec, t, vals) {
  // データLEDは、自分の明暗の幅がクロックLEDの幅の4割に届くまで「消灯」とみなす
  // (D2のように同期のときしか点かないLEDが、隣の光漏れやノイズで誤判定しないように)
  const st = vals.map((v, i) => updateChannel(dec.ch[i], v));
  const cr = dec.ch[0].hi - dec.ch[0].lo;
  for (let i = 1; i < 10; i++) if (dec.ch[i].hi - dec.ch[i].lo <= Math.max(12, 0.4 * cr)) st[i] = 0;
  let sym = null;
  if (dec.ch[0].valid && dec.prevC !== null && st[0] !== dec.prevC) {
    sym = 0; for (let k = 1; k < 10; k++) sym = (sym << 1) | st[k];
    pushSym(dec, sym, t);
  }
  if (dec.ch[0].valid) dec.prevC = st[0];
  return { states: st, sym };
}
function pushSym(dec, s, t) {
  dec.totalSyms++;
  dec.symTimes.push(t); if (dec.symTimes.length > 41) dec.symTimes.shift();
  dec.recent.push(s); if (dec.recent.length > 24) dec.recent.shift();
  if (s === SYNC_SYM) { dec.mode = "len"; dec.buf = []; dec.perr = 0; dec.partial = ""; return; }
  const b = s >> 1;
  if (parity8(b) !== (s & 1)) { dec.parityErr++; dec.perr++; }
  if (dec.mode === "hunt") return;
  if (dec.mode === "len") {
    if (b < 1 || b > 64) { dec.mode = "hunt"; return; }
    dec.len = b; dec.mode = "data"; return;
  }
  if (dec.mode === "data") {
    dec.buf.push(b); dec.partial += String.fromCharCode(b);
    if (dec.buf.length === dec.len) dec.mode = "sum";
    return;
  }
  if (dec.mode === "sum") {
    let x = dec.len; for (const v of dec.buf) x ^= v;
    const ok = x === b && dec.perr === 0;
    if (ok) dec.ok++; else dec.ng++;
    dec.mode = "hunt";
    if (dec.onFrame) dec.onFrame({ ok, t, perr: dec.perr, bytes: [dec.len, ...dec.buf, b], text: String.fromCharCode(...dec.buf) });
  }
}

// ================= 並列の高精度復号 =================
// 1) クロック再生:クロックLEDの切り替わり時刻から「周期T」と「位相phi」を推定し、
//    シンボルの中心 phi + n*T を予測する。切り替わりを見逃しても、シンボルは抜けない。
// 2) 複数コマの平均:シンボル中心の前後半周期にあるコマを、中心に近いほど重く平均して判定する。
// 3) パリティ訂正:パリティが合わなければ、一番自信のない(境目に近い)ビットを反転する。
// 4) 多数決:繰り返し届くフレームを、文字の位置ごとに多数決する。
function popcount(v) { let n = 0; while (v) { n += v & 1; v >>>= 1; } return n; }
function makeParDecoder2(onFrame) {
  return { ch: Array.from({ length: 10 }, makeChannel), hist: [], prevC: null, prevV: null, prevT: null,
    boot: [], edges: [], T: null, phi: null, locked: false, nextN: null, outl: 0,
    mode: "hunt", len: 0, buf: [], perr: 0, symTimes: [], totalSyms: 0, parityErr: 0, fixed: 0, ok: 0, ng: 0,
    partial: "", recent: [], votes: new Map(), voted: null, fixedAt: new Array(9).fill(0), onFrame };
}
function resetTiming(dec) { dec.boot = []; dec.edges = []; dec.T = null; dec.phi = null; dec.locked = false; dec.nextN = null; dec.outl = 0; }
function fitTiming(dec) {
  const E = dec.edges, n = E.length;
  let sn = 0, st = 0, snn = 0, snt = 0;
  for (const e of E) { sn += e.n; st += e.t; snn += e.n * e.n; snt += e.n * e.t; }
  const den = n * snn - sn * sn;
  if (n < 2 || den === 0) return;
  const T = (n * snt - sn * st) / den;
  if (!(T > 0)) return;
  dec.T = T; dec.phi = (st - T * sn) / n;
}
function addEdge(dec, te) {
  if (!dec.locked) {
    // 立ち上げ:切り替わりを6回集め、間隔の中央値から周期の初期値を決める
    dec.boot.push(te);
    if (dec.boot.length < 6) return;
    const iv = []; for (let i = 1; i < dec.boot.length; i++) iv.push(dec.boot[i] - dec.boot[i - 1]);
    iv.sort((a, b) => a - b);
    const T0 = iv[Math.floor(iv.length / 2)];
    if (!(T0 > 0)) { dec.boot = []; return; }
    dec.edges = dec.boot.map((t) => ({ n: Math.round((t - dec.boot[0]) / T0), t }));
    dec.T = T0; dec.phi = dec.boot[0]; fitTiming(dec);
    dec.locked = true; dec.boot = [];
    return;
  }
  // 予測から外れた切り替わりや、同じシンボルに2回目の切り替わりが来たら「合っていない」と数える。
  // 直近8回のうち4回以上合っていなければ、速度が変わったとみなして推定をやり直す(PB0で速度を変えたときなど)
  const n = Math.round((te - dec.phi) / dec.T), resid = te - (dec.phi + n * dec.T);
  const last = dec.edges[dec.edges.length - 1];
  const bad = Math.abs(resid) > 0.3 * dec.T || (last && last.n === n);
  dec.hits = (dec.hits || []).concat(bad ? 0 : 1).slice(-8);
  if (dec.hits.filter((h) => !h).length >= 4) { resetTiming(dec); dec.hits = []; dec.boot = [te]; return; }
  if (bad) return;
  dec.edges.push({ n, t: te }); if (dec.edges.length > 24) dec.edges.shift();
  fitTiming(dec);
}
function feedPar2(dec, t, vals) {
  const st = vals.map((v, i) => updateChannel(dec.ch[i], v));
  const cr = dec.ch[0].hi - dec.ch[0].lo;
  for (let i = 1; i < 10; i++) if (dec.ch[i].hi - dec.ch[i].lo <= Math.max(12, 0.4 * cr)) st[i] = 0;
  dec.hist.push({ t, v: vals });
  while (dec.hist.length && dec.hist[0].t < t - 4) dec.hist.shift();
  // クロックの切り替わり時刻を、前後のコマの明るさから1コマより細かく推定する
  const c0 = dec.ch[0];
  if (c0.valid && dec.prevC !== null && st[0] !== dec.prevC) {
    const mid = (c0.hi + c0.lo) / 2, v0 = dec.prevV, v1 = vals[0];
    const f = v1 !== v0 ? Math.min(1, Math.max(0, (mid - v0) / (v1 - v0))) : 1;
    addEdge(dec, dec.prevT + f * (t - dec.prevT));
  }
  if (c0.valid) dec.prevC = st[0];
  dec.prevV = vals[0]; dec.prevT = t;
  const out = [];
  if (dec.locked) {
    if (dec.nextN === null) dec.nextN = Math.ceil((dec.hist[0].t - dec.phi) / dec.T + 0.5);
    let guard = 0;
    while (guard++ < 50) {
      const c = dec.phi + dec.nextN * dec.T;
      if (t < c + 0.5 * dec.T) break;
      dec.nextN++;
      if (dec.lastC !== undefined && c < dec.lastC + 0.5 * dec.T) continue;   // 読み直し防止
      dec.lastC = c;
      const s = sampleSymbol(dec, c);
      if (!s) continue;
      if (dec.pushFn) { dec.pushFn(s.sym, c, s.conf); continue; }   // カラーモード:組み立ては decode-color.js が行う
      pushSym2(dec, s.sym, c, s.conf);
      out.push({ t: c, sym: dec.recent[dec.recent.length - 1], fixed: !!dec.lastFixed && dec.recent[dec.recent.length - 1] !== SYNC_SYM });
    }
  }
  return { states: st, syms: out };
}
function sampleSymbol(dec, c) {
  const half = 0.5 * dec.T, sum = new Array(10).fill(0);
  let wsum = 0, near = null, nd = Infinity;
  for (const h of dec.hist) {
    const d = Math.abs(h.t - c);
    if (d < nd) { nd = d; near = h; }
    const w = 1 - d / half;
    if (w <= 0) continue;
    wsum += w; for (let i = 1; i < 10; i++) sum[i] += w * h.v[i];
  }
  if (!near) return null;
  if (wsum <= 0) { for (let i = 1; i < 10; i++) sum[i] = near.v[i]; wsum = 1; }
  const cr = dec.ch[0].hi - dec.ch[0].lo, conf = [];
  let sym = 0;
  for (let i = 1; i < 10; i++) {
    const ch = dec.ch[i], rg = ch.hi - ch.lo;
    let z = -0.5;
    if (rg > Math.max(12, 0.4 * cr)) z = (sum[i] / wsum - (ch.hi + ch.lo) / 2) / rg;
    sym = (sym << 1) | (z > 0 ? 1 : 0);
    conf.push(Math.abs(z));
  }
  return { sym, conf };
}
function pushSym2(dec, s, t, conf) {
  dec.totalSyms++;
  dec.symTimes.push(t); if (dec.symTimes.length > 41) dec.symTimes.shift();
  // 同期:9個中8個以上が点灯(チェックサムを待っている間は同期とみなさない)
  if (dec.mode !== "sum" && popcount(s) >= 8) {
    dec.recent.push(SYNC_SYM); if (dec.recent.length > 24) dec.recent.shift();
    dec.mode = "len"; dec.buf = []; dec.perr = 0; dec.partial = ""; return;
  }
  if (parity8(s >> 1) !== (s & 1)) {
    dec.parityErr++; dec.perr++;
    let k = 0; for (let i = 1; i < 9; i++) if (conf[i] < conf[k]) k = i;
    s ^= 1 << (8 - k); dec.fixed++; dec.lastFixed = true;
    dec.fixedAt[k]++;   // どのLED(k=0 が D2 … 8 が D10)を直したか。診断表示で使う
  } else dec.lastFixed = false;
  dec.recent.push(s); if (dec.recent.length > 24) dec.recent.shift();
  const b = s >> 1;
  if (dec.mode === "hunt") return;
  if (dec.mode === "len") {
    if (b < 1 || b > 64) { dec.mode = "hunt"; return; }
    dec.len = b; dec.mode = "data"; return;
  }
  if (dec.mode === "data") {
    dec.buf.push(b); dec.partial += String.fromCharCode(b);
    if (dec.buf.length === dec.len) dec.mode = "sum";
    return;
  }
  if (dec.mode === "sum") {
    let x = dec.len; for (const v of dec.buf) x ^= v;
    const ok = x === b;
    if (ok) dec.ok++; else dec.ng++;
    dec.mode = "hunt";
    addVote(dec, dec.len, dec.buf, b);
    if (dec.onFrame) dec.onFrame({ ok, t, perr: dec.perr, bytes: [dec.len, ...dec.buf, b], text: String.fromCharCode(...dec.buf) });
  }
}
// 文字数ごとに、位置ごとの「どの値が何回届いたか」を数える
function addVote(dec, len, buf, sum) {
  let v = dec.votes.get(len);
  if (!v) { v = { n: 0, pos: Array.from({ length: len + 1 }, () => new Map()) }; dec.votes.set(len, v); }
  v.n++;
  [...buf, sum].forEach((b, i) => v.pos[i].set(b, (v.pos[i].get(b) || 0) + 1));
  // 表示するのは「今届いた文字数」の多数決(PB2でメッセージを切り替えると文字数が変わるので、別々に数える)
  const best = { L: len, w: v };
  const pick = best.w.pos.map((m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  const data = pick.slice(0, best.L);
  let x = best.L; for (const b of data) x ^= b;
  dec.voted = { n: best.w.n, ok: x === pick[best.L], text: String.fromCharCode(...data) };
}

(window.LOADED = window.LOADED || {})["decode-parallel.js"] = "20261106-1130";   // 版の確認用(index.html の最後で確かめる)
