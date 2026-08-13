/* ===== GRAVIX — 基盤層 =====
   名前空間 G / 数学 / 乱数 / 保存 / 音 / 入力。

   重要：このファイルは読み込み時に document・window・Date・Math.random を
   一切さわらない。DOM に触るのは Audio と Input の関数の中だけ。
   おかげで core.js と world.js は Node で評価してテストできる
   （scripts/test-game.mjs、scripts/build-strokes.mjs と同じ new Function 方式）。 */

const G = {};

/* ---------- 数学・イージング ---------- */
G.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
G.lerp = (a, b, t) => a + (b - a) * t;
G.easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
G.easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
G.easeInOutQuad = (t) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/* 円（プレイヤー）と矩形（障害物）の最短距離。負にはならない。
   0 なら重なっている。当たり判定とグレイズ判定の両方がこれ 1 本で決まる。 */
G.distToRect = function (cx, cy, r, x, y, w, h) {
  const dx = cx < x ? x - cx : cx > x + w ? cx - (x + w) : 0;
  const dy = cy < y ? y - cy : cy > y + h ? cy - (y + h) : 0;
  const d = dx === 0 ? dy : dy === 0 ? dx : Math.sqrt(dx * dx + dy * dy);
  return d - r;
};

/* ---------- 乱数（mulberry32）----------
   ラン単位でシードするので、同じシード＋同じ入力なら地形もスコアも完全に再現できる。
   デバッグ・ヘッドレステスト・将来の「デイリーシード」モードのための土台。 */
G.rngFrom = function (seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/* ---------- 保存（localStorage）----------
   キーは ms_game_v1。学習アプリの natsuyasumi_v1 とは別物。
   github.io は アカウント配下の全リポジトリで オリジンを共有するので、
   パスではなく ms_ という接頭辞が衝突を防いでいる。 */
G.Store = (function () {
  const KEY = "ms_game_v1";
  const SCHEMA = 1;

  function fresh() {
    return {
      v: SCHEMA,
      best: 0, bestDistance: 0, bestCombo: 0, bestGraze: 0,
      lastScore: 0, runs: 0, totalScore: 0, totalGrazes: 0,
      settings: {
        sound: true,
        motion: null,      // null = OS の prefers-reduced-motion に従う / true=通常 / false=控えめ
        showFps: false,
      },
      seen: { tutorial: false, silentHint: false },
    };
  }

  /* 学習アプリの migrate() と同じ契約：fresh() にキーを足したら、
     ここで既存データに埋め戻す。これを怠ると古い記録が壊れる。 */
  function migrate(s) {
    const d = fresh();
    for (const k of Object.keys(d)) if (s[k] === undefined) s[k] = d[k];
    if (typeof s.settings !== "object" || !s.settings) s.settings = d.settings;
    for (const k of Object.keys(d.settings)) if (s.settings[k] === undefined) s.settings[k] = d.settings[k];
    if (typeof s.seen !== "object" || !s.seen) s.seen = d.seen;
    for (const k of Object.keys(d.seen)) if (s.seen[k] === undefined) s.seen[k] = d.seen[k];
    // 数値フィールドが壊れていたら 0 に戻す（手で編集された JSON 対策）
    for (const k of ["best", "bestDistance", "bestCombo", "bestGraze", "lastScore", "runs", "totalScore", "totalGrazes"]) {
      if (typeof s[k] !== "number" || !isFinite(s[k])) s[k] = 0;
    }
    // 将来のスキーマ変更はここに段階的に足す:  if (s.v < 2) { ...; s.v = 2; }
    s.v = SCHEMA;
    return s;
  }

  const api = {
    KEY, SCHEMA, fresh, migrate,
    data: fresh(),
    dirty: false,
    load() {
      try {
        const s = JSON.parse(localStorage.getItem(KEY));
        if (s && typeof s === "object") { api.data = migrate(s); return api.data; }
      } catch (e) {}
      api.data = fresh();
      return api.data;
    },
    /* setItem は同期でメインスレッドを止めるので、プレイ中は呼ばない。
       ゲームオーバー・設定変更・バックグラウンド遷移のときだけ flush する。 */
    touch() { api.dirty = true; },
    flush() {
      if (!api.dirty) return;
      try { localStorage.setItem(KEY, JSON.stringify(api.data)); api.dirty = false; } catch (e) {}
    },
    save() { api.dirty = true; api.flush(); },
  };
  return api;
})();

/* ---------- 音（Web Audio・手続き合成／音声ファイルなし）---------- */
G.Audio = (function () {
  let ac = null, master = null, comp = null, noiseBuf = null;
  let unlocked = false, muted = false;
  let voices = 0, lastAt = Object.create(null);

  function build() {
    comp = ac.createDynamicsCompressor();
    // グレイズ連鎖で音が重なったときのクリップを潰す
    comp.threshold.value = -14; comp.knee.value = 24; comp.ratio.value = 8;
    comp.attack.value = .003; comp.release.value = .18;
    master = ac.createGain();
    master.gain.value = muted ? 0 : .9;
    master.connect(comp); comp.connect(ac.destination);

    const n = Math.floor(ac.sampleRate * 1.5);
    noiseBuf = ac.createBuffer(1, n, ac.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
  }

  /* iOS では AudioContext は「ユーザー操作の中」でしか running にならない。
     必ず pointerdown ハンドラから呼ぶこと。 */
  function unlock() {
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        build();
      }
      if (ac.state !== "running") ac.resume();
      if (!unlocked) {
        // 古い iOS 向けの無音バッファキック
        const b = ac.createBufferSource();
        b.buffer = ac.createBuffer(1, 1, 22050);
        b.connect(ac.destination); b.start(0);
        unlocked = true;
      }
    } catch (e) {}
  }

  function ready() { return !!ac && ac.state === "running" && !muted; }

  /* 同じ音が短時間に殺到するのを防ぐ（グレイズは毎フレーム鳴りうる） */
  function gate(tag, ms) {
    const t = ac.currentTime * 1000;
    if (lastAt[tag] !== undefined && t - lastAt[tag] < ms) return false;
    lastAt[tag] = t;
    return true;
  }
  function voice() {
    if (voices >= 14) return false;
    voices++;
    return true;
  }
  function freeVoice(node, at) {
    node.onended = () => { voices = Math.max(0, voices - 1); };
    // onended が来ない環境向けの保険
    setTimeout(() => { voices = Math.max(0, voices - 1); node.onended = null; }, Math.ceil(at * 1000) + 300);
  }

  function tone(o) {
    if (!ready() || !voice()) return;
    const t0 = ac.currentTime + (o.delay || 0);
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = o.type || "square";
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);
    if (o.detune) osc.detune.value = o.detune;
    const peak = (o.gain === undefined ? .22 : o.gain);
    // 0 へのランプは例外/クリックの原因になるので必ず微小値で止める
    g.gain.setValueAtTime(.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack || .006));
    g.gain.exponentialRampToValueAtTime(.0001, t0 + o.dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + o.dur + .02);
    freeVoice(osc, (o.delay || 0) + o.dur);
  }

  function noise(o) {
    if (!ready() || !voice()) return;
    const t0 = ac.currentTime + (o.delay || 0);
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = o.rate || 1;
    const f = ac.createBiquadFilter();
    f.type = o.type || "bandpass";
    f.frequency.setValueAtTime(o.freq, t0);
    if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.sweepTo), t0 + o.dur);
    f.Q.value = o.q === undefined ? 1 : o.q;
    const g = ac.createGain();
    g.gain.setValueAtTime(.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.gain === undefined ? .3 : o.gain, t0 + .005);
    g.gain.exponentialRampToValueAtTime(.0001, t0 + o.dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + o.dur + .02);
    freeVoice(src, (o.delay || 0) + o.dur);
  }

  // グレイズ音はコンボに応じてペンタトニックを駆け上がる（気持ちよさの中核）
  const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];

  const api = {
    unlock,
    isMuted() { return muted; },
    setMuted(v) {
      muted = !!v;
      if (master && ac) master.gain.setTargetAtTime(muted ? 0 : .9, ac.currentTime, .02);
    },
    suspend() { try { if (ac && ac.state === "running") ac.suspend(); } catch (e) {} },
    resume() { try { if (ac && ac.state !== "running") ac.resume(); } catch (e) {} },
    state() { return ac ? ac.state : "none"; },

    flip() { if (ready()) { tone({ freq: 190, to: 470, type: "square", dur: .1, gain: .16 }); } },
    land() { if (ready() && gate("land", 60)) noise({ freq: 220, sweepTo: 90, type: "lowpass", dur: .09, gain: .16, q: .7 }); },
    graze(combo) {
      if (!ready() || !gate("graze", 45)) return;
      const semi = LADDER[Math.min(combo, LADDER.length - 1)];
      const f = 660 * Math.pow(2, semi / 12);
      tone({ freq: f, type: "triangle", dur: .085, gain: .14 });
      noise({ freq: f * 1.6, type: "bandpass", q: 9, dur: .06, gain: .1 });
    },
    tier() {
      if (!ready()) return;
      tone({ freq: 392, type: "triangle", dur: .16, gain: .12 });
      tone({ freq: 587, type: "triangle", dur: .2, gain: .11, delay: .07 });
      tone({ freq: 784, type: "triangle", dur: .26, gain: .1, delay: .14 });
    },
    die() {
      if (!ready()) return;
      noise({ freq: 1400, sweepTo: 80, type: "lowpass", dur: .5, gain: .34, q: .6 });
      tone({ freq: 300, to: 60, type: "sawtooth", dur: .5, gain: .2 });
    },
    best() {
      if (!ready()) return;
      [523, 659, 784, 1047].forEach((f, i) =>
        tone({ freq: f, type: "triangle", dur: .3, gain: .12, delay: i * .08 }));
    },
    ui() { if (ready()) tone({ freq: 520, to: 700, type: "sine", dur: .06, gain: .1 }); },
  };
  return api;
})();

/* ---------- 入力 ----------
   pointerdown を使う（click は遅延が乗る）。ハンドラの中では
   キューに積むだけで、判定は必ず固定ステップの中で行う。
   こうすると 60Hz でも 120Hz でも「1 タップ = 1 ティック」で同じ挙動になる。 */
G.Input = (function () {
  const down = new Set();       // 押されている pointerId
  const queue = [];             // 1 = 押した, 0 = 離した
  let keyHeld = false;
  let onFirstPress = null;

  // 1 ティック分の入力
  const tick = { pressed: false, released: false, held: false };

  function push(v) { if (queue.length < 32) queue.push(v); }

  function attach(el, firstPressCb) {
    onFirstPress = firstPressCb || null;

    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      down.add(e.pointerId);
      push(1);
      // AudioContext の解錠はこのジェスチャの中でしか行えない
      G.Audio.unlock();
      if (onFirstPress) onFirstPress();
    }, { passive: false });

    const up = (e) => { down.delete(e.pointerId); push(0); };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);   // iOS: コントロールセンター／着信で飛んでくる

    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        if (!e.repeat) { keyHeld = true; push(1); if (onFirstPress) onFirstPress(); }
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") { keyHeld = false; push(0); }
    });

    // --- iOS の余計な挙動を止める ---
    // ピンチズーム：Safari 独自の gesture イベントを潰すのが唯一確実な方法
    ["gesturestart", "gesturechange", "gestureend"].forEach((n) =>
      document.addEventListener(n, (e) => e.preventDefault(), { passive: false }));
    document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    // 引っぱって更新：overscroll-behavior を無視する古い iOS 向けの保険。
    // パネル内（.panel）だけはスクロールさせたいので除外する。
    document.addEventListener("touchmove", (e) => {
      if (e.target && e.target.closest && e.target.closest(".panel")) return;
      e.preventDefault();
    }, { passive: false });

    window.addEventListener("blur", () => { down.clear(); keyHeld = false; push(0); });
  }

  return {
    attach,
    /* 固定ステップの先頭で呼ぶ。キューを 1 ティック分の状態に畳む。 */
    beginTick() {
      tick.pressed = false;
      tick.released = false;
      for (let i = 0; i < queue.length; i++) {
        if (queue[i] === 1) tick.pressed = true; else tick.released = true;
      }
      queue.length = 0;
      tick.held = down.size > 0 || keyHeld;
      return tick;
    },
    state: tick,
    clear() { queue.length = 0; down.clear(); keyHeld = false; tick.pressed = false; tick.released = false; tick.held = false; },
  };
})();
