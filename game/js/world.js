/* ===== GRAVIX — シミュレーション層 =====

   このファイルの鉄の掟：
   - document / window / Date / performance / Math.random / requestAnimationFrame を使わない
   - 時間は「ティック数」だけ。step() は引数に dt を取らない
   → だから 60Hz でも 120Hz でも低電力モードの 30Hz でも、まったく同じ難易度になる。
     そして Node でそのまま評価してテストできる（scripts/test-game.mjs）。

   乱数はすべて world.rng（mulberry32）。同じシード＋同じ入力＝同じ結果。 */

(function () {
  "use strict";

  /* ---------- 論理ワールド（画面解像度から独立）----------
     端末が縦長でもプレイフィールドは常に 360×640。
     背の高い端末ほど広くて有利、という不公平を作らないため。
     iOS は manifest の orientation を無視するので、横向きはこの比率のまま
     レターボックス表示にして対応する（render.js）。 */
  const C = {
    /* 通路の高さ 350u は「1 往復にかかる時間」から決めている。
       ここを高くすると渡りきるのに 0.5 秒以上かかり、そのあいだ何も起きない
       スカスカな間が生まれる。350u なら約 0.45 秒で、テンポが途切れない。 */
    W: 360, H: 460,
    CEIL_Y: 55,            // 天井面（この下が可動域）
    FLOOR_Y: 405,          // 床面（この上が可動域）
    /* プレイヤーを左に寄せるほど「先が見える時間」が伸びる。
       W - PLAYER_X = 304u が視界。最高速 420u/s でも 0.72 秒先まで見えるので、
       いちばん高い柱（190u ＝ 登るのに 0.34 秒）でも 0.38 秒の反応猶予が残る。
       この関係は scripts/test-game.mjs が検証している（見てから間に合うか）。 */
    PLAYER_X: 56,
    R: 11,                 // プレイヤー半径

    DT: 1 / 60,            // 固定ステップ。step() はこれを暗黙の前提にする
    GRAV: 3300,            // u/s^2
    MAX_VY: 1500,          // switchDist() の見積もりが速度上限で崩れない値にしておく
    FLIP_KICK: 90,         // 反転した瞬間に新しい重力方向へ与える初速（キレを出す）
    ROLL: 0.055,           // 見た目の回転量／進行距離

    GRAZE: 17,             // これより近くを無傷で通ればグレイズ成立
    MID_CLEAR: 95,         // 中空バーが床・天井から必ず空ける距離（＝面沿いの道は塞がない）
    /* 面を乗り換える助走に必ず上乗せする反応時間。
       人間の反応は 0.2〜0.25 秒なので、そこを下回ると「見えていたのに間に合わない」
       という理不尽が生まれる。0.24 秒はその実測レンジの上側から取っている。 */
    REACTION: 0.24,
    SAFETY: 1.15,          // 到着時には速度が上がっているぶんの安全率

    DIST_DIV: 12,          // scrollX → メートル
    COMBO_TICKS: 132,      // グレイズが途切れてから倍率が落ちるまで（2.2秒）
    COMBO_CAP: 32,
    MULT_STEP: 0.115,
    GRAZE_SCORE: 20,

    INVULN_START: 42,      // 開始直後・再開直後の無敵ティック
    HITSTOP: 7,
    MAX_OBS: 48,
    START_GAP: 300,
  };
  C.CORRIDOR = C.FLOOR_Y - C.CEIL_Y;
  C.MID_Y = (C.CEIL_Y + C.FLOOR_Y) / 2;
  C.TOP_Y = C.CEIL_Y + C.R;                   // 天井に接しているときの中心 y
  C.BOT_Y = C.FLOOR_Y - C.R;                  // 床に接しているときの中心 y
  C.MULT_MAX = 1 + C.COMBO_CAP * C.MULT_STEP;

  /* ---------- 難易度ティア ----------
     速度はティア間で線形補間する（段差で急に速くならない）。
     gap は現在ティアの値を使う。pats は出現しうるパターン。 */
  const BASE = ["fs", "cs"];
  const T2 = BASE.concat(["fl", "cl"]);
  const T3 = T2.concat(["zz"]);
  const T4 = T3.concat(["mb", "pl", "pu"]);
  const T5 = T4.concat(["db", "gt", "gt2"]);
  const T6 = T5.concat(["zz3"]);

  /* 速度の頭打ち（420）は視界から逆算した値で、飾りではない。
     これ以上速くすると switchDist が視界 304u を超え、
     「見えてから反応しても間に合わない」配置が生まれてしまう。
     速度ではなく、配置の詰まり方とパターンの厳しさで難易度を上げていく。 */
  const TIERS = [
    { d: 0,    speed: 292, gapMin: 205, gapMax: 275, pats: BASE },
    { d: 220,  speed: 316, gapMin: 192, gapMax: 254, pats: T2 },
    { d: 520,  speed: 340, gapMin: 180, gapMax: 236, pats: T3 },
    { d: 950,  speed: 360, gapMin: 169, gapMax: 220, pats: T4 },
    { d: 1500, speed: 379, gapMin: 159, gapMax: 206, pats: T5 },
    { d: 2200, speed: 394, gapMin: 151, gapMax: 194, pats: T6 },
    { d: 3100, speed: 407, gapMin: 144, gapMax: 184, pats: T6 },
    { d: 4200, speed: 415, gapMin: 138, gapMax: 176, pats: T6 },
    { d: 5600, speed: 420, gapMin: 133, gapMax: 169, pats: T6 },
  ];

  /* 面を乗り換えるのに最低限必要な走行距離。
     高さ h ぶん上がる（下がる）のに要する時間＋反応時間ぶん、必ず助走を空ける。
     反転時に FLIP_KICK の初速が付くので、この式は常に「多め」に見積もっている。
     これがあるおかげで「初見で絶対に避けられない配置」が構造的に生まれない。 */
  function switchDist(h, speed) {
    return speed * C.SAFETY * (Math.sqrt(2 * h / C.GRAV) + C.REACTION);
  }
  const opp = (s) => (s === "floor" ? "ceil" : "floor");
  function rectFor(side, dx, w, h) {
    return { dx: dx, y: side === "floor" ? C.FLOOR_Y - h : C.CEIL_Y, w: w, h: h };
  }

  /* ---------- 障害物パターン ----------
     不変条件：どのパターンも、床沿いの道か天井沿いの道の「どちらか一方」しか塞がない。
     中空バーは MID_CLEAR ぶん必ず離すので、面沿いの道は塞がない。
     → scripts/test-game.mjs がこの 2 つを全パターン・全ティアで検証する。 */
  function surf(w, side, ww, hh) {
    const safe = opp(side);
    return {
      rects: [rectFor(side, 0, ww, hh)],
      span: ww, needSurface: safe, needHeight: hh, endSurface: safe,
    };
  }
  function bar(w, dx, y) {
    return { dx: dx, y: y, w: 78, h: 24 };
  }

  const PATTERNS = {
    fs: (w) => surf(w, "floor", 46, 100),
    cs: (w) => surf(w, "ceil", 46, 100),
    fl: (w) => surf(w, "floor", 120, 84),
    cl: (w) => surf(w, "ceil", 120, 84),
    // 柱の高さ 190 は「視界に助走が収まる」上限。上げると理不尽になる（テストが落ちる）
    pl: (w) => surf(w, "floor", 58, 190),
    pu: (w) => surf(w, "ceil", 58, 190),

    // 交互に 2 枚。内側の間隔も switchDist で決めるので速くなっても破綻しない。
    zz: (w) => {
      const h = 104, ww = 50;
      const d = switchDist(h, w.speed);
      const a = w.rng() < .5 ? "floor" : "ceil", b = opp(a);
      return {
        rects: [rectFor(a, 0, ww, h), rectFor(b, ww + d, ww, h)],
        span: ww + d + ww, needSurface: opp(a), needHeight: h, endSurface: opp(b),
      };
    },
    // 交互に 3 枚
    zz3: (w) => {
      const h = 96, ww = 44;
      const d = switchDist(h, w.speed);
      const s0 = w.rng() < .5 ? "floor" : "ceil";
      const s = [s0, opp(s0), s0];
      const rects = [];
      let dx = 0;
      for (let i = 0; i < 3; i++) { rects.push(rectFor(s[i], dx, ww, h)); dx += ww + d; }
      return { rects: rects, span: dx - d, needSurface: opp(s0), needHeight: h, endSurface: opp(s[2]) };
    },

    // 中空バー：面沿いの道は塞がないので、飛んでいる最中だけを咎める
    mb: (w) => {
      const lo = C.CEIL_Y + C.MID_CLEAR, hi = C.FLOOR_Y - C.MID_CLEAR - 24;
      return {
        rects: [bar(w, 0, lo + w.rng() * (hi - lo))],
        span: 78, needSurface: "any", needHeight: 0, endSurface: w.curSurface,
      };
    },
    // 上下 2 本。真ん中に細い道が残る（sep の上限は MID_CLEAR から決まる）
    db: (w) => {
      const sep = 48 + w.rng() * 20;
      return {
        rects: [bar(w, 0, C.MID_Y - sep - 12), bar(w, 0, C.MID_Y + sep - 12)],
        span: 78, needSurface: "any", needHeight: 0, endSurface: w.curSurface,
      };
    },
    // 面ブロック → 戻り道にバー。急いで面に戻ると引っかかる
    gt: (w) => {
      const ww = 50, h = 108, d = 96;
      return {
        rects: [rectFor("floor", 0, ww, h), bar(w, ww + d, C.FLOOR_Y - C.MID_CLEAR - 24)],
        span: ww + d + 78, needSurface: "ceil", needHeight: h, endSurface: "ceil",
      };
    },
    gt2: (w) => {
      const ww = 50, h = 108, d = 96;
      return {
        rects: [rectFor("ceil", 0, ww, h), bar(w, ww + d, C.CEIL_Y + C.MID_CLEAR)],
        span: ww + d + 78, needSurface: "floor", needHeight: h, endSurface: "floor",
      };
    },
  };

  /* ---------- ワールド ---------- */
  function create() {
    const w = {
      seed: 1, rng: null, tick: 0,
      dead: false, deadTicks: 0,
      scrollX: 0, distance: 0, score: 0,
      speed: TIERS[0].speed, tier: 0,
      combo: 0, comboTicks: 0, maxCombo: 0, grazes: 0,
      hitstop: 0, invuln: 0, trauma: 0, flash: 0,
      curSurface: "floor", lastSpan: 0, spawnLeft: 0, pending: null,
      obs: new Array(C.MAX_OBS), nObs: 0,
      player: { x: C.PLAYER_X, y: C.BOT_Y, px: C.PLAYER_X, py: C.BOT_Y, vy: 0, grav: 1, onSurface: true, rot: 0, prot: 0 },
      // 1 ティック分のイベント（毎ティック false に戻す。配列を作らないので GC しない）
      evFlip: false, evGraze: 0, evDie: false, evTier: false, evLand: false,
    };
    for (let i = 0; i < C.MAX_OBS; i++) {
      w.obs[i] = { active: false, x: 0, y: 0, w: 0, h: 0, grazed: false, kind: 0, born: 0 };
    }
    return w;
  }

  function reset(w, seed) {
    w.seed = seed >>> 0;
    w.rng = G.rngFrom(w.seed);
    w.tick = 0; w.dead = false; w.deadTicks = 0;
    w.scrollX = 0; w.distance = 0; w.score = 0;
    w.tier = 0; w.speed = TIERS[0].speed;
    w.combo = 0; w.comboTicks = 0; w.maxCombo = 0; w.grazes = 0;
    w.hitstop = 0; w.invuln = C.INVULN_START; w.trauma = 0; w.flash = 0;
    w.curSurface = "floor"; w.lastSpan = 0;
    for (let i = 0; i < C.MAX_OBS; i++) w.obs[i].active = false;
    w.nObs = 0;
    const p = w.player;
    p.x = C.PLAYER_X; p.y = C.BOT_Y; p.px = p.x; p.py = p.y;
    p.vy = 0; p.grav = 1; p.onSurface = true; p.rot = 0; p.prot = 0;
    w.evFlip = false; w.evGraze = 0; w.evDie = false; w.evTier = false; w.evLand = false;
    // 最初のパターンを予約
    w.pending = null;
    choosePending(w);
    w.spawnLeft = Math.max(C.START_GAP, w.spawnLeft);
    return w;
  }

  function addObstacle(w, x, y, ow, oh, kind) {
    for (let i = 0; i < C.MAX_OBS; i++) {
      const o = w.obs[i];
      if (o.active) continue;
      o.active = true; o.x = x; o.y = y; o.w = ow; o.h = oh;
      o.grazed = false; o.kind = kind; o.born = w.tick;
      w.nObs++;
      return o;
    }
    return null;   // プールが尽きたら黙って捨てる（配置間隔的に起こらない）
  }

  function choosePending(w) {
    const T = TIERS[w.tier];
    const key = T.pats[(w.rng() * T.pats.length) | 0];
    const b = PATTERNS[key](w);
    b.key = key;
    let gap = T.gapMin + w.rng() * (T.gapMax - T.gapMin);
    if (b.needSurface !== "any" && b.needSurface !== w.curSurface) {
      gap = Math.max(gap, switchDist(b.needHeight, w.speed));
    }
    w.pending = b;
    w.spawnLeft = w.lastSpan + gap;
  }

  function place(w, b) {
    for (let i = 0; i < b.rects.length; i++) {
      const r = b.rects[i];
      const onFloor = r.y + r.h >= C.FLOOR_Y - .5;
      const onCeil = r.y <= C.CEIL_Y + .5;
      // 0 = 面から生えたブロック / 1 = 中空バー / 2 = 背の高い柱（見た目の出し分け用）
      const k = (!onFloor && !onCeil) ? 1 : (r.h >= 180 ? 2 : 0);
      addObstacle(w, C.W + 20 + r.dx, r.y, r.w, r.h, k);
    }
    w.lastSpan = b.span;
    w.curSurface = b.endSurface;
  }

  function multOf(w) {
    return 1 + Math.min(w.combo, C.COMBO_CAP) * C.MULT_STEP;
  }

  function updateTier(w) {
    let t = w.tier;
    while (t + 1 < TIERS.length && w.distance >= TIERS[t + 1].d) t++;
    if (t !== w.tier) {
      w.tier = t;
      w.evTier = true;
      w.trauma = Math.min(1, w.trauma + .22);
      w.flash = 16;
    }
    const T = TIERS[w.tier], N = TIERS[w.tier + 1];
    if (N) {
      const u = G.clamp((w.distance - T.d) / (N.d - T.d), 0, 1);
      w.speed = G.lerp(T.speed, N.speed, u);
    } else {
      w.speed = T.speed;
    }
  }

  function kill(w) {
    if (w.dead) return;
    w.dead = true;
    w.deadTicks = 0;
    w.evDie = true;
    w.hitstop = C.HITSTOP;
    w.trauma = 1;
    w.flash = 10;
    w.player.vy = 0;
  }

  /* ---------- 1 ティック進める ----------
     引数に dt は取らない（取れないようにしてある）。
     input は { pressed, released, held } か null。 */
  function step(w, input) {
    w.evFlip = false; w.evGraze = 0; w.evDie = false; w.evTier = false; w.evLand = false;
    w.tick++;

    if (w.trauma > 0) w.trauma = Math.max(0, w.trauma - .026);
    if (w.flash > 0) w.flash--;

    // ヒットストップ：演出のために数ティック世界を止める。
    // アキュムレータではなくシム内で止めるので、決定性は壊れない。
    if (w.hitstop > 0) { w.hitstop--; return; }
    if (w.dead) { w.deadTicks++; return; }

    const p = w.player;
    p.px = p.x; p.py = p.y; p.prot = p.rot;

    // --- 入力：重力反転 ---
    if (input && input.pressed) {
      p.grav = -p.grav;
      p.onSurface = false;
      p.vy = p.grav * C.FLIP_KICK;   // 直前の勢いは捨てる。そのほうが確実に効く
      w.evFlip = true;
    }

    // --- 重力 ---
    p.vy += p.grav * C.GRAV * C.DT;
    if (p.vy > C.MAX_VY) p.vy = C.MAX_VY; else if (p.vy < -C.MAX_VY) p.vy = -C.MAX_VY;
    p.y += p.vy * C.DT;

    if (p.y >= C.BOT_Y) {
      p.y = C.BOT_Y;
      if (p.vy > 120) w.evLand = true;
      p.vy = 0; p.onSurface = true;
    } else if (p.y <= C.TOP_Y) {
      p.y = C.TOP_Y;
      if (p.vy < -120) w.evLand = true;
      p.vy = 0; p.onSurface = true;
    } else {
      p.onSurface = false;
    }

    // --- 進行 ---
    updateTier(w);
    const moved = w.speed * C.DT;
    w.scrollX += moved;
    w.distance = w.scrollX / C.DIST_DIV;
    p.rot += moved * C.ROLL * (p.grav > 0 ? 1 : -1);

    // --- 障害物：移動・当たり・グレイズ ---
    const mult = multOf(w);
    for (let i = 0; i < C.MAX_OBS; i++) {
      const o = w.obs[i];
      if (!o.active) continue;
      o.x -= moved;
      if (o.x + o.w < -80) { o.active = false; w.nObs--; continue; }
      // 明らかに遠いものは距離計算をしない
      if (o.x > p.x + 80 || o.x + o.w < p.x - 80) continue;

      const d = G.distToRect(p.x, p.y, C.R, o.x, o.y, o.w, o.h);
      if (d <= 0) {
        if (w.invuln <= 0) { kill(w); return; }
      } else if (d < C.GRAZE && !o.grazed) {
        o.grazed = true;
        w.grazes++;
        w.combo++;
        if (w.combo > w.maxCombo) w.maxCombo = w.combo;
        w.comboTicks = C.COMBO_TICKS;
        w.score += C.GRAZE_SCORE * mult;
        w.evGraze++;
        w.trauma = Math.min(1, w.trauma + .09);
      }
    }

    // --- 配置 ---
    w.spawnLeft -= moved;
    if (w.spawnLeft <= 0) {
      place(w, w.pending);
      choosePending(w);
    }

    // --- スコアとコンボ減衰 ---
    w.score += (moved / C.DIST_DIV) * mult;
    if (w.comboTicks > 0) {
      w.comboTicks--;
      if (w.comboTicks === 0) w.combo = 0;
    }
    if (w.invuln > 0) w.invuln--;
  }

  /* テスト用：ワールド状態の指紋。決定性の検証に使う。 */
  function hash(w) {
    let h = 2166136261;
    const put = (v) => {
      const n = Math.round(v * 1000) | 0;
      h ^= n; h = Math.imul(h, 16777619);
    };
    put(w.tick); put(w.scrollX); put(w.score); put(w.combo); put(w.grazes);
    put(w.player.y); put(w.player.vy); put(w.player.grav); put(w.dead ? 1 : 0);
    for (let i = 0; i < C.MAX_OBS; i++) {
      const o = w.obs[i];
      put(o.active ? 1 : 0); put(o.x); put(o.y); put(o.w); put(o.h);
    }
    return h >>> 0;
  }

  G.Cfg = C;
  G.Tiers = TIERS;
  G.Patterns = PATTERNS;
  G.World = {
    create: create,
    reset: reset,
    step: step,
    hash: hash,
    multOf: multOf,
    switchDist: switchDist,
    maxMult: C.MULT_MAX,
  };
})();
