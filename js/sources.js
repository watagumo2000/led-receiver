// ============================================================
// sources.js : 動画ファイルとカメラ
// 動画ファイルは2回読む(1回目でLEDを探し、2回目で復号)。カメラはコマが届くたびに処理する。
// ============================================================

// ---------- 動画ファイル ----------
// まずブラウザ内のデコーダ(WebCodecs)で1コマずつ取り出す。使えないときだけ <video> で再生する
async function startVideoFile(file) {
  stopAll(); source = "video"; curRot = 0; setSourceUI();
  pts = []; placeStep = 0; picking = 0; setPickUI();
  resetDecoder(); ring = []; smallAll = []; fileInfo = null; fileObj = file;
  const job = fileJob = { cancelled: false };
  $("badge").textContent = "動画を読み込んでいます…";
  let reason = "";
  if ("VideoDecoder" in window) {
    try {
      const read = (o, l) => file.slice(o, o + l).arrayBuffer().then((b) => new Uint8Array(b));
      const info = await demuxMp4(read, file.size);
      const sup = await VideoDecoder.isConfigSupported(info.config);
      if (!sup.supported) throw new Error("このブラウザはこの動画の形式(" + info.codec + ")を読めません");
      if (job.cancelled) return;
      await scanFile(file, info, job);
      return;
    } catch (e) {
      if (job.cancelled) return;
      reason = e && e.message ? e.message : String(e);
    }
  } else {
    reason = "このブラウザには動画を1コマずつ読む機能(WebCodecs)がありません";
  }
  startVideoElement(file, reason);
}
// 1回目:動画全体をざっと読み、LEDの場所を自動で探す
async function scanFile(file, info, job) {
  curRot = info.rot; $("speedWrap").hidden = true;
  const keepAt = Math.min(info.samples.length - 1, Math.floor(info.fps * 1.5));
  let n = 0;
  await decodeFile(file, info, job, (f) => {
    const img = grab(f); if (!img) return;
    if (smallAll.length < SCAN_MAX) smallAll.push(computeSmall(img));
    if (n++ === keepAt || n === 1) { still.width = f.displayWidth; still.height = f.displayHeight; sctx.drawImage(f, 0, 0); }
    if (n % 15 === 0) drawView(f);
  }, (p) => { $("badge").textContent = `LEDを探しています ${p}%`; });
  if (job.cancelled) return;
  fileInfo = info;
  drawView(still);
  const found = findLeds(smallAll);
  if (found) {
    pts = found; drawView(still);
    $("hint").textContent = "LEDの位置を自動で決めました。違っていたらタップで直して「最初から解析」を押してください。";
    await analyzeFile();
  } else {
    $("badge").textContent = `${info.codec} / ${info.fps.toFixed(0)}fps / ${info.duration.toFixed(1)}秒`;
    setPickUI();
    $("hint").textContent = "LEDを自動で見つけられませんでした。" + $("hint").textContent + " 指定したら「最初から解析」を押してください。";
  }
}
// 2回目:指定した位置の明るさを全コマで読み、復号する
async function analyzeFile() {
  if (!fileInfo || !fileObj || analyzing) return;
  if (!ready()) { const f = findLeds(smallAll); if (f) pts = f; }
  if (!ready()) { showErr("先にLEDの位置を指定してください。"); return; }
  $("err").hidden = true;
  analyzing = true; resetDecoder(); fpsTimes = [];
  const job = fileJob;
  try {
    await decodeFile(fileObj, fileInfo, job, (f, t) => processFrame(f, t),
      (p) => { $("badge").textContent = `解析中 ${p}%`; });
    if (!job.cancelled) $("badge").textContent = `解析完了:成功 ${dec.ok} / 失敗 ${dec.ng}`;
  } catch (e) {
    if (!job.cancelled) showErr("解析の途中で止まりました:" + (e.message || e));
  } finally { analyzing = false; }
}
async function decodeFile(file, info, job, onFrame, onProgress) {
  let err = null;
  const S = info.samples, total = S.length;
  const vd = new VideoDecoder({
    output: (f) => { try { if (!job.cancelled) onFrame(f, f.timestamp / 1e6); } finally { f.close(); } },
    error: (e) => { err = e; }
  });
  vd.configure(info.config);
  for (let i = 0; i < total && !err && !job.cancelled;) {
    // 近くにあるコマをまとめて読み込む
    let j = i, lo = S[i].offset, hi = S[i].offset + S[i].size;
    while (j + 1 < total && j - i < 59) {
      const s = S[j + 1], nlo = Math.min(lo, s.offset), nhi = Math.max(hi, s.offset + s.size);
      if (nhi - nlo > 8e6) break;
      lo = nlo; hi = nhi; j++;
    }
    const buf = new Uint8Array(await file.slice(lo, hi).arrayBuffer());
    for (let k = i; k <= j && !err; k++) {
      const s = S[k];
      vd.decode(new EncodedVideoChunk({ type: s.sync ? "key" : "delta", timestamp: Math.round(s.cts * 1e6 / info.timescale),
        data: buf.subarray(s.offset - lo, s.offset - lo + s.size) }));
    }
    i = j + 1;
    while (vd.decodeQueueSize > 30 && !err && !job.cancelled) await new Promise((r) => setTimeout(r, 4));
    onProgress(Math.round(100 * i / total));
  }
  if (!err && !job.cancelled) await vd.flush().catch((e) => { err = e; });
  if (vd.state !== "closed") vd.close();
  if (err) throw err;
}
// <video> で再生しながら読む方法(予備)
function startVideoElement(file, reason) {
  curRot = 0; $("speedWrap").hidden = false; fileInfo = null;
  vid.srcObject = null; vid.src = URL.createObjectURL(file); vid.loop = false;
  let loaded = false;
  vid.onloadeddata = () => { loaded = true; vid.currentTime = 0; playVideo(); };
  vid.onended = () => { $("badge").textContent = "動画の最後まで解析しました"; };
  vid.onerror = () => fail();
  const fail = () => {
    $("badge").textContent = "動画を読み込めませんでした";
    showErr("この画面ではこの動画を読み込めませんでした。" + (reason ? "(" + reason + ")" : "") +
      " 受信ページのHTMLファイルをPCに保存してChromeで開き、そこから動画を読み込むと確実です。");
  };
  setTimeout(() => { if (!loaded && source === "video" && !fileInfo) fail(); }, 5000);
  $("badge").textContent = file.name;
}
function playVideo() {
  lastMediaTime = -1;
  vid.playbackRate = +$("speed").value;
  vid.play().catch(() => showErr("再生を始められませんでした。もう一度「最初から解析」を押してください。"));
  loopVideo(false);
}
// live=true(カメラ)のときは、映像の時刻ではなくコマが届いた時刻を使う
function loopVideo(live) {
  if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
    const cb = (now, meta) => {
      const t = live ? (meta.captureTime || meta.expectedDisplayTime || now) / 1000 : meta.mediaTime;
      const key = live ? meta.presentedFrames : meta.mediaTime;
      if (key !== lastMediaTime) { lastMediaTime = key; processFrame(vid, t); }
      if (!vid.paused && !vid.ended) rvfcId = vid.requestVideoFrameCallback(cb);
    };
    rvfcId = vid.requestVideoFrameCallback(cb);
  } else {
    const cb = (now) => {
      if (vid.currentTime !== lastMediaTime) { lastMediaTime = vid.currentTime; processFrame(vid, live ? now / 1000 : vid.currentTime); }
      if (!vid.paused && !vid.ended) rvfcId = requestAnimationFrame(cb);
    };
    rvfcId = requestAnimationFrame(cb);
  }
}

// ---------- カメラ ----------
async function startCamera() {
  stopAll(); curRot = 0;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    startDemo(); showErr("この画面ではカメラを使えません。https:// のページで開くか、動画を撮影して読み込んでください。"); return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } }, audio: false });
  } catch (e) {
    startDemo();
    showErr(location.protocol === "https:"
      ? "カメラを使えませんでした。claude.ai上のページや、カメラを許可しなかった場合は使えません。GitHub Pagesなどに置いたページで開くか、動画を撮影して読み込んでください。"
      : "カメラを使えませんでした。スマホのカメラは https:// で始まるページでしか使えません。GitHub Pagesなどに置いて開いてください。");
    return;
  }
  source = "camera"; setSourceUI();
  pts = []; placeStep = 0; picking = 0; setPickUI(); resetDecoder(); ring = [];
  vid.removeAttribute("src"); vid.srcObject = stream; await vid.play().catch(() => {});
  $("badge").textContent = "カメラ:LEDを探しています…";
  loopVideo(true);
  // 露出のつまみ(カメラが動き出してから設定を読む)
  const camStream = stream;
  setTimeout(() => { if (stream === camStream) setupExposure(stream.getVideoTracks()[0]); }, 600);
  // LEDの位置が決まるまで、1秒ごとに自動で探す
  camFindTimer = setInterval(() => {
    if (source !== "camera") return;
    if (ready()) { $("badge").textContent = "カメラ"; return; }
    if (pts.some(Boolean)) return;   // 手で指定している途中
    if (ring.length < (ten() ? 150 : 60)) return;   // 点滅の少ないLEDも映るよう、数秒分たまるまで待つ
    const found = findLeds(ring);
    if (found) { pts = found; resetDecoder(); $("badge").textContent = "カメラ";
      $("hint").textContent = "LEDを見つけました。番号がずれていたら、D1とD10をタップし直してください。"; }
  }, 1000);
}

function stopAll() {
  clearInterval(demoTimer); demoTimer = null;
  clearInterval(camFindTimer); camFindTimer = null;
  if (fileJob) fileJob.cancelled = true;
  fileInfo = null; analyzing = false;
  vid.pause(); vid.onerror = null;
  if (stream) { stream.getTracks().forEach((tr) => tr.stop()); stream = null; }
  stopExposure();
  $("err").hidden = true; fpsTimes = [];
}
function showErr(s) { $("err").textContent = s; $("err").hidden = false; }
function setSourceUI() {
  $("srcDemo").setAttribute("aria-pressed", source === "demo");
  $("srcCam").setAttribute("aria-pressed", source === "camera");
  $("demoCtl").hidden = source !== "demo";
  $("videoCtl").hidden = source !== "video";
  $("trackWrap").hidden = source !== "camera";
  if (source === "demo") $("badge").textContent = "デモ信号(実機ではありません)";
}
function setModeUI() {
  $("modePar").setAttribute("aria-pressed", mode === "par");
  $("modeSer").setAttribute("aria-pressed", mode === "ser");
  $("modeCol").setAttribute("aria-pressed", mode === "col");
  $("parPick").hidden = !ten();
  $("serPick").hidden = ten();
  $("stPerrWrap").hidden = !ten();
  $("preciseWrap").hidden = mode !== "par";
  $("bitsTitle").textContent = mode === "col" ? "受け取ったシンボル(赤と緑の2バイト。*=パリティで訂正)" : ten() ? "受け取ったシンボル(新しい順に右へ)" : "受け取ったビット(新しい順に右へ)";
  const lg = $("legend");
  lg.innerHTML = mode === "col"
    ? '<span><span class="sw red"></span> 赤が点灯</span><span><span class="sw grn"></span> 緑が点灯</span><span>各LEDの上半分=赤、下半分=緑。下の文字:各シンボルで読んだ2文字(S=フレームの始まり)</span>'
    : mode === "par"
    ? '<span><span class="sw clk"></span> D1 クロック</span><span><span class="sw dat"></span> D2〜D9 データ</span><span><span class="sw par"></span> D10 パリティ</span><span>下の文字:各シンボルで読んだ内容(S=フレームの始まり、赤=パリティ誤り、紫=パリティで訂正)</span>'
    : '<span><span class="sw clk"></span> クロックLEDの明るさ</span><span><span class="sw dat"></span> データLEDの明るさ</span><span>縦線と数字:クロックが切り替わった瞬間に読んだビット</span>';
  fillDemoRates();
  setPickUI();
}
function setPickUI() {
  if (mode === "ser") {
    $("pickClk").setAttribute("aria-pressed", picking === 0);
    $("pickDat").setAttribute("aria-pressed", picking === 1);
    $("hint").textContent = picking === 0 ? "映像の上をタップして、クロックLED(D1)の位置を指定します。" : "映像の上をタップして、データLED(D3)の位置を指定します。";
  } else {
    $("hint").textContent = placeStep === 0
      ? "映像の上で、まずD1(クロック)をタップし、次にD10(パリティ)をタップします。間の8個は等間隔に並べます。"
      : "次にD10(パリティ)をタップしてください。";
  }
}
function setMode(m) {
  if (mode === m) return;
  mode = m; setModeUI();
  pts = source === "demo" ? demoPositions() : []; placeStep = 0; picking = 0;
  resetDecoder();
  if (fileInfo && !analyzing) { const f = findLeds(smallAll); if (f) pts = f; drawView(still); }
}

(window.LOADED = window.LOADED || {})["sources.js"] = "20261106-1200b";   // 版の確認用(index.html の最後で確かめる)
