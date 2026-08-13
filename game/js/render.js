/* ===== GRAVIX — 描画層 =====

   iOS Safari 向けの描画ルール（守らないと 60fps が出ない）：
   - ctx.shadowBlur / ctx.filter は 1 フレームも使わない（Safari ではソフトウェア処理）
     ネオンの光は「太い半透明ストローク＋細い明るいストローク」の重ね描きで作る
   - グラデーションは resize のときだけ作り、フレーム内では作らない
   - draw() の中でオブジェクト・配列・文字列を作らない（GC の停止が 120Hz では露骨に見える）
   - パーティクルは固定長プール。swap-and-pop で回す

   パーティクルとトレイルは「見た目だけ」なのでシムの外にある。
   ここで Math.random を使ってもリプレイの決定性は壊れない。 */

G.Render = (function () {
  "use strict";
  const C = G.Cfg;

  let canvas = null, ctx = null;
  let cssW = 0, cssH = 0, dpr = 1, scale = 1, ox = 0, oy = 0;
  let wl = 0, wr = 0, wt = 0, wb = 0;        // 画面全体をワールド座標で表した範囲
  let insets = { t: 0, r: 0, b: 0, l: 0 };
  let motion = true;                          // false = 演出控えめ（prefers-reduced-motion）
  let quality = 1;                            // 1 = 通常, .75 = 自動的に落とした状態
  let bgGrad = null, floorGrad = null, ceilGrad = null, glowSprite = null;

  const DPR_CAP = 2;   // iPhone は DPR 3 が多い。3 だと塗り面積が 2.25 倍になり fps が出ない

  /* ---------- 星（パララックス背景）----------
     resize のたびに作り直す固定配列。フレーム内では確保しない。 */
  const LAYERS = [
    { n: 30, rate: .12, r: 1.5, a: .30 },
    { n: 20, rate: .30, r: 2.2, a: .40 },
    { n: 12, rate: .55, r: 3.0, a: .52 },
  ];
  const stars = LAYERS.map(() => ({ x: null, y: null, s: null }));
  function buildStars() {
    const rnd = G.rngFrom(0x5EED);
    const spanW = Math.max(C.W, wr - wl) + 40;
    for (let i = 0; i < LAYERS.length; i++) {
      const n = LAYERS[i].n;
      const L = stars[i];
      L.x = new Float32Array(n); L.y = new Float32Array(n); L.s = new Float32Array(n);
      L.span = spanW;
      for (let k = 0; k < n; k++) {
        L.x[k] = rnd() * spanW;
        L.y[k] = wt + rnd() * (wb - wt);
        L.s[k] = .6 + rnd() * .8;
      }
    }
  }

  /* ---------- パーティクル（固定長プール）---------- */
  const MAX_P = 300;
  const P = new Array(MAX_P);
  for (let i = 0; i < MAX_P; i++) P[i] = { x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, sz: 2, c: 0 };
  let nP = 0;
  function spawn(x, y, vx, vy, life, sz, c) {
    const cap = motion ? MAX_P * quality : MAX_P * .25;
    if (nP >= cap) return;
    const p = P[nP++];
    p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = life; p.sz = sz; p.c = c;
  }
  function burst(x, y, n, spread, life, sz, c) {
    if (!motion) n = Math.max(1, n >> 2);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * spread;
      spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (.6 + Math.random() * .6), sz, c);
    }
  }
  function stepParticles() {
    for (let i = 0; i < nP; i++) {
      const p = P[i];
      p.life--;
      if (p.life <= 0) { const t = P[i]; P[i] = P[--nP]; P[nP] = t; i--; continue; }
      p.x += p.vx; p.y += p.vy;
      p.vx *= .965; p.vy = p.vy * .965 + .10;
    }
  }

  /* ---------- トレイル（プレイヤーの残像）----------
     プレイヤーの x は固定なので、画面座標をそのまま貯めると
     残像が真下に伸びるだけの縦棒になってしまう。
     記録した時点の scrollX を一緒に持っておき、
     描くときにその後スクロールしたぶんだけ左へずらす＝後ろに流れる尾になる。 */
  const TN = 26;
  const tx = new Float32Array(TN), ty = new Float32Array(TN), ts = new Float32Array(TN);
  let tCount = 0, tHead = 0;
  function pushTrail(x, y, scrollX) {
    tx[tHead] = x; ty[tHead] = y; ts[tHead] = scrollX;
    tHead = (tHead + 1) % TN;
    if (tCount < TN) tCount++;
  }
  function clearTrail() { tCount = 0; tHead = 0; nP = 0; }

  /* ---------- 画面シェイク（trauma モデル）---------- */
  let shakeX = 0, shakeY = 0, shakeR = 0;
  function updateShake(trauma) {
    if (!motion || trauma <= 0) { shakeX = shakeY = shakeR = 0; return; }
    const s = trauma * trauma;                 // 2 乗すると弱い揺れが自然に消える
    shakeX = (Math.random() * 2 - 1) * s * 16;
    shakeY = (Math.random() * 2 - 1) * s * 16;
    shakeR = (Math.random() * 2 - 1) * s * .022;
  }

  /* ---------- サイズ調整 ---------- */
  function readInsets() {
    const probe = document.getElementById("safeprobe");
    if (!probe) return;
    const cs = getComputedStyle(probe);
    insets.t = parseFloat(cs.paddingTop) || 0;
    insets.r = parseFloat(cs.paddingRight) || 0;
    insets.b = parseFloat(cs.paddingBottom) || 0;
    insets.l = parseFloat(cs.paddingLeft) || 0;
  }

  function resize() {
    readInsets();
    const vv = window.visualViewport;
    const w = Math.round((vv && vv.width) || window.innerWidth || 360);
    const h = Math.round((vv && vv.height) || window.innerHeight || 640);
    const d = Math.min(window.devicePixelRatio || 1, DPR_CAP) * quality;
    const bw = Math.round(w * d), bh = Math.round(h * d);
    // iOS は URL バーが伸縮するあいだ resize を連射する。実寸が同じなら何もしない。
    if (bw === canvas.width && bh === canvas.height && w === cssW && h === cssH) return;

    cssW = w; cssH = h; dpr = d;
    canvas.width = bw; canvas.height = bh;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";

    /* 論理ワールド 360×640 を min() で収める。
       端末が縦長でも横長でも「見える範囲」は同じ＝スコアが公平になる。
       余った領域は床・天井の材質で埋めるので、黒帯にはならない。 */
    scale = Math.min(cssW / C.W, cssH / C.H);
    ox = (cssW - C.W * scale) / 2;
    oy = (cssH - C.H * scale) / 2;
    wl = -ox / scale; wr = (cssW - ox) / scale;
    wt = -oy / scale; wb = (cssH - oy) / scale;

    bgGrad = ctx.createLinearGradient(0, wt, 0, wb);
    bgGrad.addColorStop(0, "#080b18");
    bgGrad.addColorStop(.5, "#0d1230");
    bgGrad.addColorStop(1, "#080b18");
    floorGrad = ctx.createLinearGradient(0, C.FLOOR_Y, 0, wb);
    floorGrad.addColorStop(0, "#1b2350");
    floorGrad.addColorStop(1, "#070a16");
    ceilGrad = ctx.createLinearGradient(0, wt, 0, C.CEIL_Y);
    ceilGrad.addColorStop(0, "#070a16");
    ceilGrad.addColorStop(1, "#1b2350");

    buildStars();
    buildGlow();
  }

  // 光のにじみ用スプライト。shadowBlur の代わりにこれを drawImage する。
  function buildGlow() {
    const S = 64;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    rg.addColorStop(0, "rgba(255,255,255,.95)");
    rg.addColorStop(.35, "rgba(255,255,255,.35)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
    glowSprite = c;
  }

  /* ---------- 描画部品 ---------- */
  // 疑似ネオン：太く暗いストローク → 細く明るいストローク の 2 度描き
  function neonRect(x, y, w, h, outer, inner, fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = 6;
    ctx.strokeStyle = outer;
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = inner;
    ctx.strokeRect(x, y, w, h);
  }

  function drawBackground(w) {
    ctx.fillStyle = bgGrad;
    ctx.fillRect(wl, wt, wr - wl, wb - wt);

    // 奥行きのある星／粒。層ごとに違う速度で流す
    for (let i = 0; i < LAYERS.length; i++) {
      const L = LAYERS[i], S = stars[i];
      const off = (w.scrollX * L.rate) % S.span;
      ctx.fillStyle = "rgba(150,200,255," + L.a + ")";
      ctx.beginPath();
      for (let k = 0; k < L.n; k++) {
        let x = S.x[k] - off;
        if (x < wl - 8) x += S.span;
        const r = L.r * S.s[k];
        ctx.moveTo(x + r, S.y[k]);
        ctx.arc(x, S.y[k], r, 0, 6.2832);
      }
      ctx.fill();   // 1 レイヤー = 1 回の fill にまとめる
    }
  }

  // 床と天井の材質。画面の端まで伸ばすので、縦長でも横長でも黒帯にならない。
  function drawBands() {
    ctx.fillStyle = floorGrad;
    ctx.fillRect(wl, C.FLOOR_Y, wr - wl, wb - C.FLOOR_Y);
    ctx.fillStyle = ceilGrad;
    ctx.fillRect(wl, wt, wr - wl, C.CEIL_Y - wt);
  }

  // 通路の中身。プレイフィールド 0..W にクリップした状態で呼ぶ。
  function drawTrack(w) {
    const gridSpan = 60;
    const off = w.scrollX % gridSpan;

    ctx.strokeStyle = "rgba(90,130,220,.30)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let x = -off; x < C.W + gridSpan; x += gridSpan) {
      ctx.moveTo(x, C.FLOOR_Y); ctx.lineTo(x, Math.min(wb, C.FLOOR_Y + 44));
      ctx.moveTo(x, C.CEIL_Y); ctx.lineTo(x, Math.max(wt, C.CEIL_Y - 44));
    }
    ctx.stroke();

    // 通路の縁のネオン（にじみ → 本線）
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(53,232,255,.16)";
    ctx.beginPath();
    ctx.moveTo(0, C.FLOOR_Y); ctx.lineTo(C.W, C.FLOOR_Y);
    ctx.moveTo(0, C.CEIL_Y); ctx.lineTo(C.W, C.CEIL_Y);
    ctx.stroke();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = "#35e8ff";
    ctx.beginPath();
    ctx.moveTo(0, C.FLOOR_Y); ctx.lineTo(C.W, C.FLOOR_Y);
    ctx.moveTo(0, C.CEIL_Y); ctx.lineTo(C.W, C.CEIL_Y);
    ctx.stroke();
  }

  /* 画面がプレイフィールドより横に広いとき（＝横向き）に左右を暗く落とす。
     ここを開けたままにすると、横向きの端末だけ先が余分に見えて有利になってしまう。 */
  function drawSides() {
    if (wl > -1 && wr < C.W + 1) return;
    ctx.fillStyle = "rgba(4,6,14,.82)";
    if (wl < 0) ctx.fillRect(wl, wt, -wl, wb - wt);
    if (wr > C.W) ctx.fillRect(C.W, wt, wr - C.W, wb - wt);
    ctx.strokeStyle = "rgba(53,232,255,.22)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, wt); ctx.lineTo(0, wb);
    ctx.moveTo(C.W, wt); ctx.lineTo(C.W, wb);
    ctx.stroke();
  }

  function drawObstacles(w) {
    for (let i = 0; i < C.MAX_OBS; i++) {
      const o = w.obs[i];
      if (!o.active) continue;
      if (o.x > wr + 20 || o.x + o.w < wl - 20) continue;
      if (o.kind === 1) {
        // 中空バー：面沿いの道は塞がないが、飛行中は危ない
        neonRect(o.x, o.y, o.w, o.h, "rgba(255,210,61,.20)", "#ffd23d", "rgba(255,210,61,.13)");
      } else if (o.kind === 2) {
        neonRect(o.x, o.y, o.w, o.h, "rgba(255,61,154,.22)", "#ff6fb5", "rgba(255,61,154,.20)");
      } else {
        neonRect(o.x, o.y, o.w, o.h, "rgba(255,61,154,.20)", "#ff3d9a", "rgba(255,61,154,.15)");
      }
      // かすめ済みの印
      if (o.grazed) {
        ctx.fillStyle = "rgba(53,232,255,.85)";
        ctx.fillRect(o.x + o.w / 2 - 3, o.y + o.h / 2 - 3, 6, 6);
      }
    }
  }

  function drawPlayer(w, px, py, rot) {
    // トレイル：後ろに流れる先細りのポリライン
    if (tCount > 2) {
      ctx.lineCap = "round";
      for (let i = 1; i < tCount; i++) {
        const a = i / tCount;
        const i0 = (tHead - tCount + i - 1 + TN * 2) % TN;
        const i1 = (tHead - tCount + i + TN * 2) % TN;
        ctx.strokeStyle = "rgba(53,232,255," + (a * a * .55).toFixed(3) + ")";
        ctx.lineWidth = 1.5 + a * 13;
        ctx.beginPath();
        ctx.moveTo(tx[i0] - (w.scrollX - ts[i0]), ty[i0]);
        ctx.lineTo(tx[i1] - (w.scrollX - ts[i1]), ty[i1]);
        ctx.stroke();
      }
    }

    // にじみ（shadowBlur ではなくスプライト）
    if (glowSprite) {
      const s = 78;
      ctx.globalAlpha = w.invuln > 0 ? .35 : .55;
      ctx.drawImage(glowSprite, px - s / 2, py - s / 2, s, s);
      ctx.globalAlpha = 1;
    }

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rot);
    const r = C.R;
    // 無敵中は点滅させる（開始直後・再開直後）
    const on = w.invuln <= 0 || ((w.tick >> 2) & 1) === 0;
    ctx.fillStyle = on ? "#eaffff" : "rgba(234,255,255,.35)";
    ctx.beginPath();
    ctx.moveTo(-r, -r * .72); ctx.lineTo(r * .55, -r);
    ctx.lineTo(r, 0); ctx.lineTo(r * .55, r); ctx.lineTo(-r, r * .72);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#35e8ff";
    ctx.stroke();
    // 重力の向きを示す矢
    ctx.fillStyle = "#0a1430";
    ctx.beginPath();
    const d = w.player.grav > 0 ? 1 : -1;
    ctx.moveTo(-3.5, -3.5 * d); ctx.lineTo(3.5, -3.5 * d); ctx.lineTo(0, 4.5 * d);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    for (let i = 0; i < nP; i++) {
      const p = P[i];
      const a = p.life / p.max;
      ctx.fillStyle = p.c === 0 ? "rgba(53,232,255," + a.toFixed(3) + ")"
        : p.c === 1 ? "rgba(255,210,61," + a.toFixed(3) + ")"
          : "rgba(255,61,154," + a.toFixed(3) + ")";
      const s = p.sz * a;
      ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2);
    }
  }

  /* ---------- HUD（画面座標。ワールドの拡大縮小を受けない）---------- */
  let scoreStr = "0", scoreCache = -1;
  let distStr = "0", distCache = -1;

  function drawHud(w) {
    const top = insets.t + 14;
    const cx = cssW / 2;

    const si = Math.floor(w.score);
    if (si !== scoreCache) { scoreCache = si; scoreStr = String(si); }
    const di = Math.floor(w.distance);
    if (di !== distCache) { distCache = di; distStr = di + "m"; }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(255,255,255,.96)";
    ctx.font = "800 40px system-ui, -apple-system, sans-serif";
    ctx.fillText(scoreStr, cx, top);

    ctx.fillStyle = "rgba(139,155,196,.95)";
    ctx.font = "600 14px system-ui, -apple-system, sans-serif";
    ctx.fillText(distStr, cx, top + 46);

    // 倍率とコンボの残り時間バー
    if (w.combo > 0) {
      const mult = G.World.multOf(w);
      const y = top + 68;
      ctx.fillStyle = "#35e8ff";
      ctx.font = "800 20px system-ui, -apple-system, sans-serif";
      ctx.fillText("×" + mult.toFixed(2), cx, y);

      const bw = 116, bh = 4, bx = cx - bw / 2, by = y + 26;
      const k = w.comboTicks / 132;
      ctx.fillStyle = "rgba(255,255,255,.14)";
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = "#35e8ff";
      ctx.fillRect(bx, by, bw * k, bh);
      ctx.fillStyle = "rgba(139,155,196,.9)";
      ctx.font = "700 11px system-ui, -apple-system, sans-serif";
      ctx.fillText("GRAZE " + w.combo, cx, by + 9);
    }
  }

  /* 白フラッシュ（ティア更新・被弾）。3Hz を超えないよう短く 1 回だけ。 */
  function drawFlash(w) {
    if (w.flash <= 0) return;
    const a = (w.flash / 16) * (motion ? .30 : .14);
    ctx.fillStyle = "rgba(255,255,255," + a.toFixed(3) + ")";
    ctx.fillRect(0, 0, cssW, cssH);
  }

  let fpsStr = "";
  function drawDebug(txt) {
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "600 11px ui-monospace, monospace";
    ctx.fillStyle = "rgba(0,0,0,.5)";
    ctx.fillRect(insets.l + 6, cssH - insets.b - 26, 210, 18);
    ctx.fillStyle = "#7dffb0";
    ctx.fillText(txt, insets.l + 10, cssH - insets.b - 23);
  }

  /* ---------- 公開 API ---------- */
  return {
    init(el) {
      canvas = el;
      // 背景が不透明なので alpha:false のほうが合成が速い
      ctx = canvas.getContext("2d", { alpha: false });
      resize();
    },
    resize: resize,
    insets() { return insets; },
    size() { return { w: cssW, h: cssH, scale: scale, ox: ox, oy: oy }; },
    setMotion(v) { motion = !!v; if (!motion) { shakeX = shakeY = shakeR = 0; } },
    getMotion() { return motion; },
    setQuality(q) { if (q !== quality) { quality = q; resize(); } },
    getQuality() { return quality; },
    clearTrail: clearTrail,

    /* ワールドのイベントを見た目に翻訳する。ループから毎ティック呼ぶ。 */
    react(w) {
      const p = w.player;
      if (w.evFlip) burst(p.x, p.y, 10, 2.6, 16, 2.4, 0);
      if (w.evLand) burst(p.x, p.y + (p.grav > 0 ? C.R : -C.R), 8, 2.2, 14, 2.0, 0);
      if (w.evGraze) burst(p.x, p.y, 6 * w.evGraze, 3.4, 20, 2.2, 1);
      if (w.evTier) burst(p.x, p.y, 26, 4.5, 34, 3.0, 0);
      if (w.evDie) burst(p.x, p.y, 64, 6.5, 44, 3.4, 2);
    },

    draw(w, alpha, hud, dbg) {
      if (!ctx) return;
      const p = w.player;
      // 補間して描く（120Hz でも 60Hz のシムが滑らかに見える）
      const px = p.px + (p.x - p.px) * alpha;
      const py = p.py + (p.y - p.py) * alpha;
      const rot = p.prot + (p.rot - p.prot) * alpha;

      stepParticles();
      if (!w.dead && w.hitstop === 0) pushTrail(px, py, w.scrollX);
      updateShake(w.trauma);

      // 画面座標（レターボックスの下地）
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#06070f";
      ctx.fillRect(0, 0, cssW, cssH);

      // ワールド座標へ（シェイクはここに乗せる）
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale,
        dpr * (ox + shakeX * scale), dpr * (oy + shakeY * scale));
      if (shakeR) {
        ctx.translate(C.W / 2, C.H / 2); ctx.rotate(shakeR); ctx.translate(-C.W / 2, -C.H / 2);
      }

      drawBackground(w);
      drawBands();
      // プレイフィールドは常に 0..W。端末が横に広くても見える範囲は変わらない。
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, wt, C.W, wb - wt);
      ctx.clip();
      drawTrack(w);
      drawObstacles(w);
      drawParticles();
      if (!w.dead || w.deadTicks < 6) drawPlayer(w, px, py, rot);
      ctx.restore();
      drawSides();

      // 画面座標へ戻して HUD
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawFlash(w);
      if (hud) drawHud(w);
      if (dbg) drawDebug(dbg);
    },
  };
})();
