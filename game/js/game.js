/* ===== GRAVIX — 状態機械・ループ・画面 =====
   ここだけが requestAnimationFrame / DOM / 時計を扱う。
   world.js は「1 ティック進める」以外を知らない。 */

(function () {
  "use strict";
  const C = G.Cfg;
  const S = G.Store;

  const TITLE = "GRAVIX";      // タイトル文字列はここと index.html / manifest の 3 か所

  /* ---------- ループ ---------- */
  const FIXED = 1000 / 60;     // シムの 1 ティック（ミリ秒）。world.js の C.DT と対
  const MAX_FRAME = 250;       // これを超える間隔は「1 フレームぶん」として扱う
  const MAX_STEPS = 5;         // 追いつけないときに無限ループしないための上限

  let last = 0, acc = 0, rafId = 0;
  let running = false, needsTimeReset = true;

  let state = "title";         // title | playing | paused | count | over
  let world = null;
  let wrap = null, ui = null, canvasEl = null;
  let countdown = 0, countShown = -1;
  let debugOn = false, seedParam = null;

  // 自動画質調整用
  let slowFrames = 0, fpsAcc = 0, fpsN = 0, fpsText = "";

  const params = new URLSearchParams(location.search);

  /* ---------- 画面（DOM オーバーレイ）---------- */
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function show(html, active) {
    ui.innerHTML = html;
    ui.className = active === false ? "" : "active";
  }
  function hide() { ui.innerHTML = ""; ui.className = ""; }
  function on(id, fn) {
    const el = document.getElementById(id);
    if (el) el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); G.Audio.unlock(); G.Audio.ui(); fn(); };
  }

  function showTitle() {
    state = "title";
    running = true;                 // タイトルの裏でも世界は流しておく（アトラクト表示）
    startAttract();
    const d = S.data;
    const hint = d.seen.silentHint ? "" :
      '<p class="hint">音が出ないときは、本体の<b>サイレントスイッチ</b>を確認してください。</p>';
    show(
      '<div class="panel">' +
      '<h1 class="logo">' + TITLE + '</h1>' +
      '<p class="tagline">重力反転ランナー</p>' +
      (d.best > 0
        ? '<div class="stats">' +
        '<div class="stat"><b>' + Math.floor(d.best) + '</b><span>BEST</span></div>' +
        '<div class="stat"><b>' + Math.floor(d.bestDistance) + '</b><span>DISTANCE</span></div>' +
        '<div class="stat"><b>' + d.bestCombo + '</b><span>MAX GRAZE</span></div>' +
        '</div>'
        : '<p class="hint">画面をタップすると <b>重力が反転</b> します。<br>ぶつからずに、できるだけ遠くへ。</p>') +
      '<button class="btn" id="bStart">タップして スタート</button>' +
      '<div class="row">' +
      '<button class="btn ghost" id="bHow">あそびかた</button>' +
      '<button class="btn ghost" id="bSet">せってい</button>' +
      '</div>' +
      hint +
      '<p class="rotate-hint">縦向きのほうが遊びやすいです</p>' +
      '</div>');
    on("bStart", startRun);
    on("bHow", showHow);
    on("bSet", showSettings);
    if (!d.seen.silentHint) { d.seen.silentHint = true; S.touch(); }
  }

  function showHow() {
    state = "title";
    show(
      '<div class="panel">' +
      '<h2 class="headline">あそびかた</h2>' +
      '<ul class="howto">' +
      '<li><b>タップ</b>で重力が上下に反転します。操作はこれだけ。</li>' +
      '<li>ピンクのブロックに当たると終わり。<b>床か天井のどちらか</b>は必ず通れます。</li>' +
      '<li>黄色のバーは面沿いの道を塞ぎません。<b>飛んでいる最中だけ</b>危険です。</li>' +
      '<li>当たらずに<b>すれすれを通る</b>と GRAZE。倍率が上がり、しばらく途切れなければ伸び続けます。</li>' +
      '<li>安全に避けるだけではスコアは伸びません。<b>どこまで攻めるか</b>がこのゲームです。</li>' +
      '<li>キーボードでは <b>スペース</b> でも操作できます。</li>' +
      '</ul>' +
      '<button class="btn" id="bBack">もどる</button>' +
      '</div>');
    on("bBack", showTitle);
  }

  function showSettings() {
    state = "title";
    const st = S.data.settings;
    const motionLabel = st.motion === null ? "自動（端末の設定に従う）" : st.motion ? "通常" : "控えめ";
    show(
      '<div class="panel">' +
      '<h2 class="headline">せってい</h2>' +
      '<button class="opt" id="oSound"><span>サウンド</span>' +
      '<span class="val' + (st.sound ? "" : " off") + '">' + (st.sound ? "ON" : "OFF") + '</span></button>' +
      '<button class="opt" id="oMotion"><span>演出<small>揺れ・粒子の量</small></span>' +
      '<span class="val">' + esc(motionLabel) + '</span></button>' +
      '<button class="opt" id="oFps"><span>フレーム表示</span>' +
      '<span class="val' + (st.showFps ? "" : " off") + '">' + (st.showFps ? "ON" : "OFF") + '</span></button>' +
      '<p class="hint">記録はこの端末のブラウザにだけ保存されます。<br>' +
      'iOS では、しばらく開かないと自動的に消えることがあります。<br>' +
      'ホーム画面に追加しておくと消えにくくなります。</p>' +
      '<button class="btn" id="bBack">もどる</button>' +
      '<button class="btn ghost" id="bReset">記録を消す</button>' +
      '</div>');
    on("oSound", () => { st.sound = !st.sound; G.Audio.setMuted(!st.sound); S.save(); showSettings(); });
    on("oMotion", () => {
      st.motion = st.motion === null ? true : st.motion === true ? false : null;
      applyMotion(); S.save(); showSettings();
    });
    on("oFps", () => { st.showFps = !st.showFps; S.save(); showSettings(); });
    on("bBack", showTitle);
    on("bReset", () => {
      const d = S.fresh();
      d.seen = S.data.seen;
      d.settings = S.data.settings;
      S.data = d; S.save();
      showTitle();
    });
  }

  function showResult() {
    state = "over";
    const d = S.data;
    const score = Math.floor(world.score);
    const isBest = score > 0 && score >= Math.floor(d.best);
    show(
      '<div class="panel">' +
      '<div class="score-label">SCORE</div>' +
      '<div class="score-big">' + score + '</div>' +
      (isBest ? '<div class="newbest">★ NEW BEST ★</div>'
        : '<p class="hint">BEST ' + Math.floor(d.best) + '</p>') +
      '<div class="stats">' +
      '<div class="stat"><b>' + Math.floor(world.distance) + 'm</b><span>DISTANCE</span></div>' +
      '<div class="stat"><b>' + world.grazes + '</b><span>GRAZE</span></div>' +
      '<div class="stat"><b>×' + (1 + Math.min(world.maxCombo, C.COMBO_CAP) * C.MULT_STEP).toFixed(2) + '</b><span>BEST MULT</span></div>' +
      '</div>' +
      '<button class="btn" id="bAgain">もういちど</button>' +
      '<button class="btn ghost" id="bTitle">タイトルへ</button>' +
      '</div>');
    on("bAgain", startRun);
    on("bTitle", showTitle);
  }

  function showPause() {
    show(
      '<div class="panel">' +
      '<h2 class="headline">ちょっと休憩</h2>' +
      '<p class="hint">戻ってきました。<br>準備ができたらタップしてください。</p>' +
      '<button class="btn" id="bResume">つづける</button>' +
      '<button class="btn ghost" id="bGiveUp">やめる</button>' +
      '</div>');
    on("bResume", beginCountdown);
    on("bGiveUp", () => { finishRun(); showResult(); });
  }

  /* ---------- ラン制御 ---------- */
  function newSeed() {
    if (seedParam !== null) return seedParam;
    return (Math.random() * 0x7fffffff) >>> 0;
  }

  function startAttract() {
    world = world || G.World.create();
    G.World.reset(world, newSeed());
    world.invuln = 1e9;             // タイトル裏では死なせない
    G.Render.clearTrail();
  }

  function startRun() {
    hide();
    G.Audio.unlock();
    G.World.reset(world, newSeed());
    G.Render.clearTrail();
    G.Input.clear();                // 開始のタップが反転として消費されないように
    countdown = 0;
    state = "playing";
    running = true;
    needsTimeReset = true;
  }

  function finishRun() {
    running = false;
    const d = S.data;
    const score = Math.floor(world.score);
    d.runs++;
    d.lastScore = score;
    d.totalScore += score;
    d.totalGrazes += world.grazes;
    if (world.maxCombo > d.bestCombo) d.bestCombo = world.maxCombo;
    if (world.grazes > d.bestGraze) d.bestGraze = world.grazes;
    if (world.distance > d.bestDistance) d.bestDistance = Math.floor(world.distance);
    const newBest = score > d.best;
    if (newBest) d.best = score;
    S.save();                       // プレイ中には書かない。ここで 1 回だけ。
    if (newBest && score > 0) G.Audio.best();
  }

  function pauseRun() {
    if (state !== "playing" && state !== "count") return;
    running = false;
    state = "paused";
    G.Input.clear();
    G.Audio.suspend();
    showPause();
  }

  function beginCountdown() {
    state = "count";
    countdown = 3 * 60;
    countShown = -1;
    running = false;
    needsTimeReset = true;
    G.Audio.resume();
    G.Input.clear();
    show('<div class="panel" style="background:none;border:0;box-shadow:none;backdrop-filter:none">' +
      '<div class="score-big" id="cd">3</div></div>', false);
  }

  function tickCountdown() {
    countdown--;
    const n = Math.ceil(countdown / 60);
    if (n !== countShown) {
      countShown = n;
      const el = document.getElementById("cd");
      if (el) el.textContent = n > 0 ? String(n) : "GO";
      if (n > 0) G.Audio.ui();
    }
    if (countdown <= 0) {
      hide();
      state = "playing";
      running = true;
      world.invuln = Math.max(world.invuln, C.INVULN_START);
      needsTimeReset = true;
    }
  }

  /* ---------- 画面タップ（ボタン以外） ---------- */
  function onScreenTap(e) {
    if (e.target && e.target.closest && e.target.closest("button")) return;
    if (state === "title") { startRun(); return; }
    if (state === "paused") { beginCountdown(); return; }
    // 死んだ直後の暴発でリスタートしないよう、少し待つ
    if (state === "over" && world && world.deadTicks > 36) { startRun(); return; }
  }

  /* ---------- 演出設定 ---------- */
  let mq = null;
  function applyMotion() {
    const s = S.data.settings.motion;
    const reduce = mq ? mq.matches : false;
    G.Render.setMotion(s === null ? !reduce : s);
  }

  /* ---------- フレーム ---------- */
  function frame(t) {
    rafId = requestAnimationFrame(frame);

    if (needsTimeReset) { last = t; acc = 0; needsTimeReset = false; }
    let delta = t - last;
    last = t;
    if (delta < 0) delta = 0;
    /* 長い中断（通知バナー・アプリ切り替え・GC）は「1 フレームぶん」に丸める。
       MAX_FRAME まで追いつかせると、見ていないあいだに進んで理不尽に死ぬ。 */
    if (delta > MAX_FRAME) delta = FIXED;

    // 実フレーム時間の観測（自動画質調整とデバッグ表示）
    fpsAcc += delta; fpsN++;
    if (fpsN >= 30) {
      const mean = fpsAcc / fpsN;
      if (S.data.settings.showFps || debugOn) {
        fpsText = "frame " + mean.toFixed(1) + "ms  obs " + (world ? world.nObs : 0) +
          "  q" + G.Render.getQuality() + "  tick " + (world ? world.tick : 0);
      }
      // 2 秒ぶん連続で遅ければ、解像度と粒子を一段落とす（一度だけ・戻さない）
      if (mean > FIXED * 1.25) slowFrames += fpsN; else slowFrames = 0;
      if (slowFrames >= 120 && G.Render.getQuality() === 1) { G.Render.setQuality(.75); slowFrames = 0; }
      fpsAcc = 0; fpsN = 0;
    }

    if (state === "count") tickCountdown();

    if (running && world) {
      acc += delta;
      let n = 0;
      while (acc >= FIXED && n < MAX_STEPS) {
        const input = G.Input.beginTick();
        // タイトル裏のアトラクト表示では入力を捨てる（タップはスタートに使う）
        G.World.step(world, state === "playing" ? input : null);
        G.Render.react(world);
        acc -= FIXED;
        n++;
        if (world.dead) break;
      }
      if (n === MAX_STEPS) acc = 0;            // 追いつけないぶんは捨てる

      if (state === "title" && world.distance > 900) startAttract();   // アトラクトを繰り返す
      if (world.dead && state === "playing") {
        finishRun();
        showResult();
      }
    }

    if (world) {
      G.Render.draw(world, running ? G.clamp(acc / FIXED, 0, 1) : 0,
        state === "playing" || state === "count" || state === "paused",
        (S.data.settings.showFps || debugOn) ? fpsText : null);
    }
  }

  /* ---------- 起動 ---------- */
  function boot() {
    wrap = document.getElementById("wrap");
    ui = document.getElementById("ui");
    canvasEl = document.getElementById("canvas");

    debugOn = params.get("debug") === "1";
    const sp = params.get("seed");
    if (sp !== null && sp !== "" && isFinite(+sp)) seedParam = (+sp) >>> 0;

    S.load();
    G.Render.init(canvasEl);
    G.Audio.setMuted(!S.data.settings.sound);

    try { mq = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch (e) {}
    if (mq) {
      if (mq.addEventListener) mq.addEventListener("change", applyMotion);
      else if (mq.addListener) mq.addListener(applyMotion);
    }
    applyMotion();

    G.Input.attach(wrap);
    wrap.addEventListener("pointerdown", onScreenTap, { passive: false });

    // リサイズは連射されるので rAF で 1 回にまとめる
    let pending = false;
    const onResize = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; G.Render.resize(); });
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize);

    // 中断と復帰。iOS では blur と visibilitychange が両方来るので冪等にしてある。
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { pauseRun(); S.flush(); }
      else G.Audio.resume();
    });
    window.addEventListener("blur", pauseRun);
    window.addEventListener("pagehide", () => { pauseRun(); S.flush(); });
    window.addEventListener("pageshow", () => { needsTimeReset = true; });

    // デバッグ／ヘッドレス検証用のフック
    if (debugOn || seedParam !== null) {
      window.__gravix = {
        world: () => world,
        state: () => state,
        cfg: C,
        hash: () => G.World.hash(world),
        // n ティック分だけ即座に進める（画面を待たずに状況を作れる）
        stepN(n, press) {
          for (let i = 0; i < n; i++) {
            G.World.step(world, { pressed: !!(press && press(i)), released: false, held: false });
            G.Render.react(world);
          }
        },
        start: startRun,
      };
    }

    showTitle();
    rafId = requestAnimationFrame(frame);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // Service Worker はゲーム専用のもの。相対パスなのでスコープは /ms/game/ になる。
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
