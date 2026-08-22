/* ボールなしドリブル練習：シーンの割り当て。SStory.frame(ctx, t) が動画 1 フレーム。 */
var SStory = (function () {
  "use strict";
  var D = SDraw, C = D.C, S = SScene, M = SMove;
  var W = D.W, H = D.H, CX = S.CX, GY = S.GY, ST = S.ST;

  function stageFrame(ctx) {
    D.rr(ctx, ST.x, ST.y, ST.w, ST.h, 36);
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(32,49,61,0.10)"; ctx.stroke();
  }

  /* 指を N 本立てた手（かおを あげて タッチ で使う） */
  function hand(ctx, x, y, n) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = C.skinD;
    for (var i = 0; i < 5; i++) {
      var up = i < n;
      var fx = -46 + i * 23;
      D.rr(ctx, fx - 9, up ? -74 : -14, 18, up ? 78 : 24, 9);
      ctx.fillStyle = up ? C.skin : C.skinD;
      ctx.fill();
    }
    ctx.fillStyle = C.skin;
    D.rr(ctx, -52, -18, 104, 74, 26); ctx.fill();
    ctx.restore();
  }

  function bubble(ctx, x, y, s, dir) {
    dir = dir || 1;   /* しっぽの向き（1=右下、-1=左下） */
    ctx.save();
    ctx.fillStyle = "#fff";
    D.rr(ctx, x - 92, y - 54, 184, 96, 30); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + dir * 76, y + 34); ctx.lineTo(x + dir * 108, y + 74); ctx.lineTo(x + dir * 44, y + 40);
    ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = C.line;
    D.rr(ctx, x - 92, y - 54, 184, 96, 30); ctx.stroke();
    ctx.restore();
    D.txt(ctx, s, x, y + 16, 54, C.ink);
  }

  /* ---------- 正面ビューの練習 ---------- */
  function front(ctx, d, st) {
    var p;
    if (st.phase === "count") p = M.pose(d, { beat: 0, rep: 0 });
    else if (st.phase === "done") p = M.pose(d, { beat: 0, rep: 0 });
    else p = M.pose(d, st);

    S.frontStage(ctx, p.scroll || 0, p.dash || 0);
    stageFrame(ctx);

    var hipX = CX + (p.dx || 0);
    var hipY = GY - 212 + (p.crouch || 0);
    var cheer = st.phase === "done" ? 1 + Math.sin(st.tRel * 9) * 0.5 : 0;
    var a = M.arms(hipX, hipY, p.swing || 0, cheer);

    D.ghostBall(ctx, p.ball.x, p.ball.y, p.ball.r, p.ball.a);

    D.kidFront(ctx, {
      hipX: hipX, hipY: hipY, fL: p.fL, fR: p.fR,
      bob: cheer ? -14 - cheer * 6 : (p.bob || 0), lean: p.lean || 0,
      look: cheer ? -1 : p.look, armL: a.armL, armR: a.armR,
    });

    if (d.key === "lookup" && st.phase !== "count") {
      var hx = ST.x + ST.w - 132, hy = ST.y + 252;
      ctx.save();
      ctx.setLineDash([9, 9]); ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(32,49,61,0.28)";
      ctx.beginPath(); ctx.moveTo(CX + 34, hipY - 214); ctx.lineTo(hx - 58, hy - 26); ctx.stroke();
      ctx.restore();
      hand(ctx, hx, hy, p.fingers);
      if (p.answer) bubble(ctx, CX - 152, ST.y + 236, p.fingers + "ほん！", 1);
    }
    if (d.key === "outside" && st.phase === "go") {
      S.pill(ctx, CX, ST.y + 52, p.foot > 0 ? "みぎあし で" : "ひだりあし で", "rgba(255,255,255,0.92)", C.ink, 32);
    }
    if (d.key === "steps" && p.dash > 0.5) S.pill(ctx, CX, ST.y + 52, "ダッシュ！", C.pink, "#fff", 38);
    if (d.key === "scissors" && st.phase !== "count") {
      if (p.over) S.pill(ctx, CX, ST.y + 52, "またぐ", C.blue, "#fff", 38);
      else if (p.dash > 0.4) S.pill(ctx, CX, ST.y + 52, "ダッシュ！", C.pink, "#fff", 38);
    }
  }

  /* ---------- 真上ビューの練習 ---------- */
  function top(ctx, d, st) {
    var p = (st.phase === "count" || st.phase === "done") ? M.pose(d, { beat: 0, rep: 0 }) : M.pose(d, st);
    S.topStage(ctx, p.scrollY || 0);
    ctx.save();
    D.rr(ctx, ST.x, ST.y, ST.w, ST.h, 36); ctx.clip();

    if (d.key === "zigzag") {
      /* 走るコースを点線で見せる */
      ctx.save();
      ctx.setLineDash([12, 12]); ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath();
      for (var r = p.repf - 1.4; r <= p.repf + 3.4; r += 0.06) {
        var xx = CX + Math.cos(Math.PI * r) * 118, yy = p.ZY + (p.repf - r) * p.D;
        if (r <= p.repf - 1.4) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
      ctx.restore();
      var k0 = Math.floor(p.repf) - 1;
      for (var k = k0; k <= k0 + 5; k++) {
        S.cone(ctx, CX, p.ZY + (p.repf - k) * p.D, 1.5);
      }
    } else {
      [p.lo + 34, p.hi - 34].forEach(function (y) {
        ctx.save();
        ctx.setLineDash([16, 14]); ctx.lineWidth = 6;
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.beginPath(); ctx.moveTo(ST.x + 84, y); ctx.lineTo(ST.x + ST.w - 84, y); ctx.stroke();
        ctx.restore();
        S.cone(ctx, ST.x + 84, y, 1.3);
        S.cone(ctx, ST.x + ST.w - 84, y, 1.3);
      });
      if (st.phase === "go") {
        for (var i = 0; i < 3; i++) {
          ctx.fillStyle = i < p.stepsDone ? "#fff" : "rgba(255,255,255,0.35)";
          ctx.beginPath(); ctx.arc(ST.x + 60 + i * 40, ST.y + 52, 13, 0, 7); ctx.fill();
        }
        D.txt(ctx, "ぽ", ST.x + 196, ST.y + 64, 28, "rgba(255,255,255,0.95)", { align: "left" });
      }
    }

    S.trail(ctx, p.trail);
    D.ghostBall(ctx, p.ball.x, p.ball.y, p.ball.r, p.ball.a);
    D.kidTop(ctx, p.x, p.y, p.dir, p.step, 1.95);

    if (d.key === "stopturn" && p.stop) {
      var k2 = p.stopK;
      ctx.save();
      ctx.globalAlpha = 1 - k2 * 0.5;
      S.pill(ctx, p.x + 150, p.y, "ピタッ！", C.yellow, C.ink, 34);
      ctx.strokeStyle = "rgba(255,255,255," + (1 - k2) + ")"; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(p.x, p.y, 44 + k2 * 46, 0, 7); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    stageFrame(ctx);
  }

  function drill(ctx, seg, local) {
    var d = seg.drill, st = SD.drillState(seg, local);
    S.header(ctx, d);
    if (d.view === "front") front(ctx, d, st); else top(ctx, d, st);
    S.stageChips(ctx, st, d);
    S.countdown(ctx, st);
    S.doneBurst(ctx, st);
    S.panel(ctx, d, st);
  }

  /* ---------- タイトル ---------- */
  function title(ctx, t) {
    var g = ctx.createLinearGradient(0, 700, 0, 1000);
    g.addColorStop(0, C.grass); g.addColorStop(1, C.grassD);
    ctx.fillStyle = g; ctx.fillRect(0, 862, W, 150);
    ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fillRect(0, 858, W, 5);

    var pop = D.easeOut(t / 0.5);
    ctx.save();
    ctx.translate(CX, 300); ctx.scale(pop, pop); ctx.translate(-CX, -300);
    S.pill(ctx, CX, 150, "ボールが なくても うまくなる", C.orange, "#fff", 30);
    D.txt(ctx, "ドリブル", CX, 282, 96, C.greenD, { stroke: 14 });
    D.txt(ctx, "れんしゅう ８つ", CX, 380, 62, C.ink, { stroke: 12 });
    ctx.restore();

    var bounce = Math.abs(Math.sin(t * 2.2));
    var hipY = GY - 212 + 74 - bounce * 10;
    var a = M.arms(CX, hipY, 0.3, bounce);
    ctx.save();
    ctx.translate(CX, 862); ctx.scale(0.92, 0.92); ctx.translate(-CX, -862);
    D.ghostBall(ctx, CX + 168, 862 - 34 - bounce * 120, 34, 1);
    D.kidFront(ctx, {
      hipX: CX, hipY: 862 - 212, fL: { x: CX - 56, y: 862 }, fR: { x: CX + 56, y: 862 },
      bob: -bounce * 12, look: -1, armL: a.armL, armR: a.armR,
    });
    ctx.restore();

    var chips = ["しょうがく １ねんせい", "サッカー １かげつめ", "3ぷん20びょう"];
    var xs = [190, 500, 360], ys = [1064, 1064, 1140];
    chips.forEach(function (s, i) {
      var d2 = D.clamp((t - 0.6 - i * 0.18) / 0.35, 0, 1);
      ctx.save(); ctx.globalAlpha = d2;
      S.pill(ctx, xs[i], ys[i] + (1 - d2) * 14, s, "#fff", C.greenD, 28);
      ctx.restore();
    });
    D.txt(ctx, "おうちの方へ： 用意するものは くつ下 2 足だけ。1 畳ほどのスペースでできます。",
      360, 1226, 23, C.sub, { w: 500, max: 640 });
  }

  /* ---------- やりかた ---------- */
  function howto(ctx, t) {
    D.txt(ctx, "やりかた", 360, 130, 62, C.ink);
    var rows = [
      { icon: "ball", a: "ボールは そうぞうで OK", b: "「ここに ある」と おもって あしを うごかす" },
      { icon: "sock", a: "くつしたを おくと もっと いい", b: "ジグザグは くつ下や ペットボトルを 1m ごとに" },
      { icon: "space", a: "たたみ 1じょうの ひろさ", b: "おへやでも こうえんでも できる" },
    ];
    rows.forEach(function (r, i) {
      var y = 240 + i * 210;
      var k = D.clamp((t - 0.3 - i * 0.5) / 0.5, 0, 1);
      ctx.save();
      ctx.globalAlpha = D.ease(k);
      ctx.translate((1 - D.ease(k)) * 40, 0);
      D.rr(ctx, 40, y, 640, 176, 30);
      ctx.fillStyle = C.card; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = C.line; ctx.stroke();

      var ix = 132, iy = y + 88;
      if (r.icon === "ball") {
        D.ghostBall(ctx, ix, iy, 42, 1);
      } else if (r.icon === "sock") {
        [-30, 30].forEach(function (dx, j) {
          ctx.save();
          ctx.translate(ix + dx, iy); ctx.rotate(j ? 0.3 : -0.3);
          ctx.fillStyle = j ? C.blue : C.pink;
          D.rr(ctx, -16, -40, 32, 58, 14); ctx.fill();
          D.rr(ctx, -16, 4, 46, 30, 15); ctx.fill();
          ctx.restore();
        });
      } else {
        ctx.fillStyle = "rgba(22,163,93,0.15)";
        D.rr(ctx, ix - 54, iy - 40, 108, 80, 12); ctx.fill();
        ctx.setLineDash([8, 7]); ctx.lineWidth = 4; ctx.strokeStyle = C.greenD;
        D.rr(ctx, ix - 54, iy - 40, 108, 80, 12); ctx.stroke();
        ctx.setLineDash([]);
        D.txt(ctx, "1じょう", ix, iy + 8, 26, C.greenD);
      }
      D.txt(ctx, r.a, 214, y + 76, 38, C.ink, { align: "left", max: 442 });
      D.txt(ctx, r.b, 214, y + 126, 25, C.sub, { align: "left", w: 500, max: 442 });
      ctx.restore();
    });
    var k2 = D.clamp((t - 2.2) / 0.5, 0, 1);
    ctx.save(); ctx.globalAlpha = k2;
    S.pill(ctx, 360, 940, "いっしょに やってみよう！", C.green, "#fff", 38);
    ctx.restore();
    D.txt(ctx, "おうちの方へ： 8 種目を続けて約 3 分。回数はめやすです。", 360, 1216, 23, C.sub, { w: 500, max: 640 });
  }

  /* ---------- まとめ ---------- */
  function outro(ctx, t) {
    D.txt(ctx, "きょうの メニュー", 360, 116, 56, C.ink);
    SD.DRILLS.forEach(function (d, i) {
      var col = i % 2, row = (i / 2) | 0;
      var x = 40 + col * 330, y = 160 + row * 92;
      var k = D.clamp((t - 0.2 - i * 0.12) / 0.4, 0, 1);
      ctx.save(); ctx.globalAlpha = D.ease(k);
      D.rr(ctx, x, y, 310, 78, 22);
      ctx.fillStyle = C.card; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = C.line; ctx.stroke();
      ctx.fillStyle = C.green;
      ctx.beginPath(); ctx.arc(x + 42, y + 39, 24, 0, 7); ctx.fill();
      D.txt(ctx, String(d.no), x + 42, y + 48, 26, "#fff");
      D.txt(ctx, d.name, x + 78, y + 48, 26, C.ink, { align: "left", max: 216 });
      ctx.restore();
    });

    var k3 = D.clamp((t - 1.4) / 0.5, 0, 1);
    ctx.save(); ctx.globalAlpha = D.ease(k3);
    S.pill(ctx, 360, 590, "まいにち ５ふん つづけよう！", C.orange, "#fff", 40);
    ctx.restore();

    /* 紙ふぶき */
    for (var i2 = 0; i2 < 26; i2++) {
      var seed = i2 * 37.7;
      var xx = ((seed * 13) % W);
      var fall = ((t * (90 + (seed % 60)) + seed * 9) % (H + 200)) - 100;
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.translate(xx, fall);
      ctx.rotate(t * 2 + seed);
      ctx.fillStyle = [C.yellow, C.orange, C.green, C.pink, C.blue][i2 % 5];
      ctx.fillRect(-8, -8, 16, 16);
      ctx.restore();
    }

    var bounce = Math.abs(Math.sin(t * 3));
    var hipY = 1010 - 212;
    var a = M.arms(CX, hipY, 0, 0.6 + bounce * 0.6);
    ctx.save();
    ctx.translate(CX, 1010); ctx.scale(0.66, 0.66); ctx.translate(-CX, -1010);
    D.kidFront(ctx, {
      hipX: CX, hipY: hipY, fL: { x: CX - 56, y: 1010 }, fR: { x: CX + 56, y: 1010 },
      bob: -bounce * 14, look: -1, armL: a.armL, armR: a.armR,
    });
    ctx.restore();
    D.txt(ctx, "つづけると ドリブルが うまくなる！", 360, 1210, 30, C.greenD);
  }

  function frame(ctx, t) {
    var st = SD.segAt(t);
    S.bg(ctx);
    if (st.seg.kind === "title") title(ctx, st.local);
    else if (st.seg.kind === "howto") howto(ctx, st.local);
    else if (st.seg.kind === "drill") drill(ctx, st.seg, st.local);
    else outro(ctx, st.local);
    S.progressBar(ctx, t);
  }

  return { frame: frame };
})();
