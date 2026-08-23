/* ボールなしドリブル練習：シーンの組み立て。SStory.frame(ctx, t) が動画 1 コマ。
   t 以外の入力を持たないので、何コマ目から描いても同じ絵になる（動画書き出しの前提）。 */
var SStory = (function () {
  "use strict";
  var D = SDraw, C = D.C, S = SScene, M = SMove;
  var W = D.W, H = D.H, CX = S.CX, GY = S.GY, ST = S.ST;

  function stageFrame(ctx) {
    D.rr(ctx, ST.x, ST.y, ST.w, ST.h, 36);
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(32,49,61,0.10)"; ctx.stroke();
  }
  function clipStage(ctx) {
    D.rr(ctx, ST.x, ST.y, ST.w, ST.h, 36); ctx.clip();
  }

  /* まばたきは絶対時刻から。数秒に一度、二度打ちで生きた顔に見せる */
  function blinkAt(t) {
    var u = (t % 4.3);
    if (u < 0.13) return Math.sin((u / 0.13) * Math.PI);
    if (u > 0.24 && u < 0.35) return Math.sin(((u - 0.24) / 0.11) * Math.PI);
    return 0;
  }

  /* カメラ。練習中はゆっくり寄り、ダッシュ・急停止で小さく揺れる */
  function camera(ctx, st, p, t) {
    var z = 1, ox = 0, oy = 0;
    if (st.phase === "go") z += 0.045 * D.ease(st.tRel / 7);
    if (st.phase === "demo") z += 0.03 * (1 - D.ease(st.tRel / 1.2));
    if (p.dash) {
      z += p.dash * 0.035;
      ox += Math.sin(t * 61) * p.dash * 3.4;
      oy += Math.cos(t * 67) * p.dash * 2.6;
    }
    if (p.stop && p.stopK < 0.55) {
      var s = 1 - p.stopK / 0.55;
      ox += Math.sin(t * 84) * s * 5; oy += Math.cos(t * 77) * s * 4;
    }
    var px = CX, py = ST.y + ST.h * 0.56;
    ctx.translate(px + ox, py + oy);
    ctx.scale(z, z);
    ctx.translate(-px, -py);
  }

  /* 指を N 本立てた手 */
  function hand(ctx, x, y, n, t) {
    ctx.save();
    ctx.translate(x, y + Math.sin(t * 2.4) * 4);
    ctx.rotate(Math.sin(t * 1.7) * 0.04);
    D.shadow(ctx, 4, 64, 42, 10, 0.16, 0);
    for (var i = 0; i < 5; i++) {
      var up = i < n, fx = -46 + i * 23;
      D.rr(ctx, fx - 9, up ? -74 : -14, 18, up ? 78 : 24, 9);
      ctx.fillStyle = up ? C.skin : C.skinD;
      ctx.fill();
    }
    ctx.fillStyle = C.skin;
    D.rr(ctx, -52, -18, 104, 74, 26); ctx.fill();
    ctx.fillStyle = C.skinD;
    D.rr(ctx, 40, 6, 30, 22, 11); ctx.fill();
    ctx.restore();
  }

  function bubble(ctx, x, y, s, dir, pop) {
    dir = dir || 1;
    ctx.save();
    ctx.translate(x, y); ctx.scale(pop || 1, pop || 1); ctx.translate(-x, -y);
    D.shadow(ctx, x, y + 46, 82, 12, 0.14, 0);
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

  /* 速い足に残像を置く（同じ pose 関数を少し前の拍で評価するだけ） */
  function footTrail(ctx, d, st, p) {
    if (st.phase !== "go") return;
    [0.075, 0.15].forEach(function (back, i) {
      var q = M.pose(d, { beat: Math.max(0, st.beat - back), rep: st.rep });
      ctx.save();
      ctx.globalAlpha = 0.16 - i * 0.07;
      [["fR", 1], ["fL", -1]].forEach(function (o) {
        var a = p[o[0]], b = q[o[0]];
        if (Math.hypot(a.x - b.x, a.y - b.y) < 16) return;
        D.shoe(ctx, b.x, b.y - 4, b.ang || 0, o[1]);
      });
      ctx.restore();
    });
  }

  /* 練習中、背景にうすく回数を出す（数えやすさのため） */
  function repGhost(ctx, st, d) {
    if (st.phase !== "go") return;
    var per = d.countPer || 1;
    var n = Math.floor(st.rep / per) + 1;
    var u = (st.beat % (d.beatsPerRep * per)) / (d.beatsPerRep * per);
    var gx = ST.x + 96, gy = ST.y + ST.h - 44;
    ctx.save();
    ctx.globalAlpha = 0.42 * (1 - u * 0.35);
    var sc = 1 + (1 - D.easeOut(Math.min(1, u * 5))) * 0.3;
    ctx.translate(gx, gy); ctx.scale(sc, sc); ctx.translate(-gx, -gy);
    D.txt(ctx, String(n), gx, gy, 92, "#ffffff");
    ctx.restore();
  }

  /* ---------- 正面ビューの練習 ---------- */
  function front(ctx, d, st, t) {
    var still = st.phase === "count" || st.phase === "done";
    var p = still ? M.pose(d, { beat: 0, rep: 0 }) : M.pose(d, st);
    var prev = still ? p : M.pose(d, { beat: Math.max(0, st.beat - 0.1), rep: st.rep });
    var lagSrc = (p.bob || 0) - (prev.bob || 0);

    ctx.save();
    clipStage(ctx);
    camera(ctx, st, p, t);
    S.frontStage(ctx, p.scroll || 0, p.dash || 0);
    repGhost(ctx, st, d);

    var hipX = CX + (p.dx || 0);
    var hipY = GY - 212 + (p.crouch || 0);
    var cheer = st.phase === "done" ? 0.6 + Math.sin(st.tRel * 9) * 0.4 : 0;
    var a = M.arms(hipX, hipY, { swing: p.swing || 0, pump: p.pump || 0, cheer: cheer });

    D.ghostBall(ctx, p.ball.x, p.ball.y, p.ball.r, p.ball.a, p.ballSquash || 0);
    if (p.contact && st.phase === "go") D.impact(ctx, p.contact.x, p.contact.y, p.contact.age);
    footTrail(ctx, d, st, p);

    D.kidFront(ctx, {
      hipX: hipX, hipY: hipY, fL: p.fL, fR: p.fR,
      bob: cheer ? -16 - cheer * 8 : (p.bob || 0), lean: p.lean || 0,
      look: cheer ? -1 : p.look, armL: a.armL, armR: a.armR,
      squash: cheer ? -0.35 : (p.squash || 0),
      headLag: D.clamp(lagSrc * 0.8, -7, 7),
      hairLag: D.clamp(lagSrc * 1.6, -12, 12),
      blink: still ? 0 : blinkAt(t),
      mouth: cheer ? 1 : (p.mouth !== undefined ? p.mouth : (p.effort || 0) > 0.55 ? 1 : 0),
      brow: cheer ? 1 : (p.effort || 0),
    });

    if (d.key === "lookup" && !still) {
      var hx = ST.x + ST.w - 132, hy = ST.y + 252;
      ctx.save();
      ctx.setLineDash([9, 9]); ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(32,49,61,0.26)";
      ctx.beginPath(); ctx.moveTo(CX + 34, hipY - 214); ctx.lineTo(hx - 58, hy - 26); ctx.stroke();
      ctx.restore();
      hand(ctx, hx, hy, p.fingers, t);
      if (p.answer) {
        bubble(ctx, CX - 152, ST.y + 236, p.fingers + "ほん！", 1,
          D.easeElastic(D.clamp(((st.beat % 4) - 1.4) * 4, 0, 1)));
      }
    }
    ctx.restore();

    S.vignette(ctx);
    stageFrame(ctx);

    if (d.key === "outside" && st.phase === "go") {
      S.pill(ctx, CX, ST.y + 52, p.foot > 0 ? "みぎあし で" : "ひだりあし で", "rgba(255,255,255,0.94)", C.ink, 32);
    }
    if (d.key === "steps" && p.dash > 0.5) {
      S.pill(ctx, CX, ST.y + 52, "ダッシュ！", C.pink, "#fff", 38, D.easeElastic(D.clamp((p.dash - 0.5) * 4, 0, 1)));
    }
    if (d.key === "scissors" && !still) {
      if (p.over) S.pill(ctx, CX, ST.y + 52, "またぐ", C.blue, "#fff", 38);
      else if (p.dash > 0.4) S.pill(ctx, CX, ST.y + 52, "ダッシュ！", C.pink, "#fff", 38);
    }
  }

  /* ---------- 真上ビューの練習 ---------- */
  function top(ctx, d, st, t) {
    var still = st.phase === "count" || st.phase === "done";
    var p = still ? M.pose(d, { beat: 0, rep: 0 }) : M.pose(d, st);

    ctx.save();
    clipStage(ctx);
    camera(ctx, st, p, t);
    S.topStage(ctx, p.scrollY || 0);

    if (d.key === "zigzag") {
      ctx.save();
      ctx.setLineDash([12, 12]); ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(255,255,255,0.42)";
      ctx.beginPath();
      for (var r = p.repf - 1.4; r <= p.repf + 3.4; r += 0.06) {
        var xx = CX + Math.cos(Math.PI * r) * 118, yy = p.ZY + (p.repf - r) * p.D;
        if (r <= p.repf - 1.4) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
      ctx.restore();
      var k0 = Math.floor(p.repf) - 1;
      for (var k = k0; k <= k0 + 5; k++) {
        var cy = p.ZY + (p.repf - k) * p.D;
        var passed = k <= p.repf;
        ctx.save();
        if (passed) ctx.globalAlpha = 0.75;
        S.cone(ctx, CX, cy, 1.5);
        ctx.restore();
      }
    } else {
      [p.lo + 34, p.hi - 34].forEach(function (y) {
        ctx.save();
        ctx.setLineDash([16, 14]); ctx.lineWidth = 6;
        ctx.strokeStyle = "rgba(255,255,255,0.62)";
        ctx.beginPath(); ctx.moveTo(ST.x + 84, y); ctx.lineTo(ST.x + ST.w - 84, y); ctx.stroke();
        ctx.restore();
        S.cone(ctx, ST.x + 84, y, 1.3);
        S.cone(ctx, ST.x + ST.w - 84, y, 1.3);
      });
    }

    S.trail(ctx, p.trail);
    if (p.contact && st.phase === "go") {
      D.impact(ctx, p.contact.x, p.contact.y, p.contact.age, "rgba(255,255,255,0.95)");
    }
    D.ghostBall(ctx, p.ball.x, p.ball.y, p.ball.r, p.ball.a, 0);
    D.kidTop(ctx, p.x, p.y, p.dir, p.step, 1.95);

    if (d.key === "stopturn" && p.stop) {
      var k2 = p.stopK;
      ctx.save();
      ctx.globalAlpha = 1 - k2 * 0.4;
      S.pill(ctx, p.x + 152, p.y, "ピタッ！", C.yellow, C.ink, 34, D.easeElastic(D.clamp(k2 * 2.4, 0, 1)));
      ctx.restore();
    }
    ctx.restore();

    S.vignette(ctx);
    stageFrame(ctx);

    if (d.key === "stopturn" && st.phase === "go") {
      for (var i = 0; i < 3; i++) {
        ctx.fillStyle = i < p.stepsDone ? "#fff" : "rgba(255,255,255,0.35)";
        ctx.beginPath(); ctx.arc(ST.x + 60 + i * 40, ST.y + 52, 13, 0, 7); ctx.fill();
      }
      D.txt(ctx, "ぽ", ST.x + 196, ST.y + 64, 28, "rgba(255,255,255,0.95)", { align: "left" });
    }
  }

  function drill(ctx, seg, local, t) {
    var d = seg.drill, st = SD.drillState(seg, local);
    S.header(ctx, d, st);
    if (d.view === "front") front(ctx, d, st, t); else top(ctx, d, st, t);
    S.stageChips(ctx, st, d);
    S.countdown(ctx, st);
    S.doneBurst(ctx, st);
    S.panel(ctx, d, st);
  }

  /* ---------- タイトル ---------- */
  function title(ctx, t) {
    var g = ctx.createLinearGradient(0, 862, 0, 1012);
    g.addColorStop(0, C.grass); g.addColorStop(1, C.grassD);
    ctx.fillStyle = g; ctx.fillRect(0, 862, W, 150);
    ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fillRect(0, 858, W, 5);

    ctx.save();
    var p1 = D.easeBack(D.clamp(t / 0.5, 0, 1));
    ctx.translate(CX, 150); ctx.scale(p1, p1); ctx.translate(-CX, -150);
    S.pill(ctx, CX, 150, "ボールが なくても うまくなる", C.orange, "#fff", 30);
    ctx.restore();

    var p2 = D.easeBack(D.clamp((t - 0.18) / 0.55, 0, 1));
    ctx.save();
    ctx.translate(CX, 282); ctx.scale(p2, p2); ctx.translate(-CX, -282);
    D.txt(ctx, "ドリブル", CX, 282, 96, C.greenD, { stroke: 14 });
    ctx.restore();
    var p3 = D.easeBack(D.clamp((t - 0.34) / 0.55, 0, 1));
    ctx.save();
    ctx.translate(CX, 380); ctx.scale(p3, p3); ctx.translate(-CX, -380);
    D.txt(ctx, "れんしゅう ８つ", CX, 380, 62, C.ink, { stroke: 12 });
    ctx.restore();

    var bounce = Math.abs(Math.sin(t * 2.2));
    var hipY = 862 - 212;
    var a = M.arms(CX, hipY, { cheer: bounce });
    ctx.save();
    ctx.translate(CX, 862); ctx.scale(0.92, 0.92); ctx.translate(-CX, -862);
    D.ghostBall(ctx, CX + 172, 862 - 34 - bounce * 130, 34, 1,
      Math.max(0, 1 - Math.abs(Math.sin(t * 2.2)) * 6));
    D.kidFront(ctx, {
      hipX: CX, hipY: hipY, fL: { x: CX - 54, y: 862 }, fR: { x: CX + 54, y: 862 },
      bob: -bounce * 14, look: -1, armL: a.armL, armR: a.armR,
      squash: (1 - bounce) * 0.5 - bounce * 0.3, blink: blinkAt(t), mouth: 0.7, brow: 0.4,
    });
    ctx.restore();

    var chips = ["しょうがく １ねんせい", "サッカー １かげつめ", "3ぷん20びょう"];
    var xs = [190, 500, 360], ys = [1064, 1064, 1140];
    chips.forEach(function (s, i) {
      var k = D.clamp((t - 0.7 - i * 0.16) / 0.4, 0, 1);
      ctx.save(); ctx.globalAlpha = k;
      S.pill(ctx, xs[i], ys[i] + (1 - D.easeBack(k)) * 18, s, "#fff", C.greenD, 28);
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
      var k = D.clamp((t - 0.3 - i * 0.45) / 0.5, 0, 1);
      ctx.save();
      ctx.globalAlpha = D.ease(k);
      ctx.translate((1 - D.easeBack(k)) * 60, 0);
      D.shadow(ctx, 360, y + 172, 300, 10, 0.12, 0);
      D.rr(ctx, 40, y, 640, 176, 30);
      ctx.fillStyle = C.card; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = C.line; ctx.stroke();

      var ix = 132, iy = y + 88;
      if (r.icon === "ball") {
        D.ghostBall(ctx, ix, iy - 6 - Math.abs(Math.sin(t * 2.6)) * 10, 42, 1, 0);
      } else if (r.icon === "sock") {
        [-30, 30].forEach(function (dx, j) {
          ctx.save();
          ctx.translate(ix + dx, iy); ctx.rotate(j ? 0.3 : -0.3);
          ctx.fillStyle = j ? C.blue : C.pink;
          D.rr(ctx, -16, -40, 32, 58, 14); ctx.fill();
          D.rr(ctx, -16, 4, 46, 30, 15); ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.55)";
          D.rr(ctx, -16, -40, 32, 12, 6); ctx.fill();
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
    var k2 = D.clamp((t - 2.1) / 0.5, 0, 1);
    ctx.save(); ctx.globalAlpha = k2;
    S.pill(ctx, 360, 940, "いっしょに やってみよう！", C.green, "#fff", 38, D.easeElastic(k2));
    ctx.restore();
    D.txt(ctx, "おうちの方へ： 8 種目を続けて約 3 分。回数はめやすです。", 360, 1216, 23, C.sub, { w: 500, max: 640 });
  }

  /* ---------- まとめ ---------- */
  function outro(ctx, t) {
    D.txt(ctx, "きょうの メニュー", 360, 116, 56, C.ink);
    SD.DRILLS.forEach(function (d, i) {
      var col = i % 2, row = (i / 2) | 0;
      var x = 40 + col * 330, y = 160 + row * 92;
      var k = D.clamp((t - 0.2 - i * 0.1) / 0.4, 0, 1);
      ctx.save();
      ctx.globalAlpha = D.ease(k);
      ctx.translate(0, (1 - D.easeBack(k)) * 22);
      D.rr(ctx, x, y, 310, 78, 22);
      ctx.fillStyle = C.card; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = C.line; ctx.stroke();
      ctx.fillStyle = C.green;
      ctx.beginPath(); ctx.arc(x + 42, y + 39, 24, 0, 7); ctx.fill();
      D.txt(ctx, String(d.no), x + 42, y + 48, 26, "#fff");
      D.txt(ctx, d.name, x + 78, y + 48, 26, C.ink, { align: "left", max: 216 });
      ctx.restore();
    });

    var k3 = D.clamp((t - 1.3) / 0.5, 0, 1);
    ctx.save(); ctx.globalAlpha = D.ease(k3);
    S.pill(ctx, 360, 590, "まいにち ５ふん つづけよう！", C.orange, "#fff", 40, D.easeElastic(k3));
    ctx.restore();

    for (var i2 = 0; i2 < 30; i2++) {
      var seed = i2 * 37.7;
      var xx = ((seed * 13) % W);
      var fall = ((t * (90 + (seed % 60)) + seed * 9) % (H + 200)) - 100;
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.translate(xx, fall);
      ctx.rotate(t * 2 + seed);
      ctx.fillStyle = [C.yellow, C.orange, C.green, C.pink, C.blue][i2 % 5];
      ctx.fillRect(-8, -8, 16, 16 * Math.abs(Math.cos(t * 3 + seed)));
      ctx.restore();
    }

    var bounce = Math.abs(Math.sin(t * 3));
    var hipY = 1010 - 212;
    var a = M.arms(CX, hipY, { cheer: 0.6 + bounce * 0.6 });
    ctx.save();
    ctx.translate(CX, 1010); ctx.scale(0.66, 0.66); ctx.translate(-CX, -1010);
    D.kidFront(ctx, {
      hipX: CX, hipY: hipY, fL: { x: CX - 54, y: 1010 }, fR: { x: CX + 54, y: 1010 },
      bob: -bounce * 16, look: -1, armL: a.armL, armR: a.armR,
      squash: (1 - bounce) * 0.5 - bounce * 0.35, blink: blinkAt(t), mouth: 1, brow: 0.6,
    });
    ctx.restore();
    D.txt(ctx, "つづけると ドリブルが うまくなる！", 360, 1210, 30, C.greenD);
  }

  /* 区切りのワイプ。t の関数なので、前後どちらのコマから描いても連続する */
  function wipe(ctx, t) {
    var b = null;
    for (var i = 1; i < SD.SEGS.length; i++) {
      if (Math.abs(t - SD.SEGS[i].start) < 0.3) { b = SD.SEGS[i].start; break; }
    }
    if (b === null) return;
    var k = D.clamp((t - b + 0.3) / 0.6, 0, 1);
    [[0.0, "#ffc93c"], [0.1, C.green]].forEach(function (o) {
      var kk = D.ease(D.clamp((k - o[0]) / (1 - o[0]), 0, 1));
      var x0 = D.lerp(W + 160, -(W + 620), kk);
      ctx.save();
      ctx.fillStyle = o[1];
      ctx.beginPath();
      ctx.moveTo(x0 + 130, 0);
      ctx.lineTo(x0 + W + 560, 0);
      ctx.lineTo(x0 + W + 430, H);
      ctx.lineTo(x0, H);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
  }

  function frame(ctx, t) {
    var st = SD.segAt(t);
    S.bg(ctx);
    if (st.seg.kind === "title") title(ctx, st.local);
    else if (st.seg.kind === "howto") howto(ctx, st.local);
    else if (st.seg.kind === "drill") drill(ctx, st.seg, st.local, t);
    else outro(ctx, st.local);
    D.grain(ctx);
    wipe(ctx, t);
    S.progressBar(ctx, t);
  }

  return { frame: frame };
})();
