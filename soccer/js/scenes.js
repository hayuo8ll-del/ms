/* ボールなしドリブル練習：各シーンの組み立て。
   SScene.frame(ctx, t) が 1 フレーム。drills.js（時刻）と draw.js（部品）だけに依存する。 */
var SScene = (function () {
  "use strict";
  var D = SDraw, C = D.C;
  var W = D.W, H = D.H;

  var CX = 360;          /* 正面ビューの中心 */
  var GY = 790;          /* 正面ビューの地面 */
  var ST = { x: 30, y: 190, w: 660, h: 672 };  /* ステージ */

  /* ---------- 共通パーツ ---------- */
  function bg(ctx) {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.fillStyle = "rgba(22,163,93,0.055)";
    for (var y = 0; y < H; y += 46) {
      for (var x = (y / 46) % 2 ? 23 : 0; x < W; x += 46) {
        ctx.beginPath(); ctx.arc(x, y, 3.4, 0, 7); ctx.fill();
      }
    }
    ctx.restore();
  }

  function progressBar(ctx, t) {
    ctx.fillStyle = "rgba(32,49,61,0.10)";
    ctx.fillRect(0, 0, W, 8);
    ctx.fillStyle = C.green;
    ctx.fillRect(0, 0, W * D.clamp(t / SD.TOTAL, 0, 1), 8);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    SD.SEGS.forEach(function (s) {
      if (s.kind === "drill") ctx.fillRect(W * (s.start / SD.TOTAL) - 1, 0, 2, 8);
    });
  }

  function header(ctx, d) {
    D.txt(ctx, "ボールなし ドリブルれんしゅう", 30, 62, 24, C.sub, { align: "left", w: 700 });
    D.txt(ctx, d.no + " ／ " + SD.DRILLS.length, 690, 62, 24, C.sub, { align: "right", w: 700 });
    /* のこり回数は stageChips がこの行の右側に上書きする */
    ctx.fillStyle = C.green;
    ctx.beginPath(); ctx.arc(76, 118, 44, 0, 7); ctx.fill();
    D.txt(ctx, String(d.no), 76, 134, 46, "#fff");
    D.txt(ctx, d.name, 140, 136, 50, C.ink, { align: "left", max: 550 });
  }

  function pill(ctx, x, y, label, bgc, fg, size) {
    size = size || 28;
    ctx.save();
    ctx.font = "800 " + size + "px " + D.FONT;
    var w = ctx.measureText(label).width + 40, h = size + 24;
    D.rr(ctx, x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fillStyle = bgc; ctx.fill();
    ctx.restore();
    D.txt(ctx, label, x, y + size * 0.36, size, fg);
    return w;
  }

  function panel(ctx, d, s) {
    D.rr(ctx, 30, 886, 660, 258, 34);
    ctx.fillStyle = C.card; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = C.line; ctx.stroke();
    D.txt(ctx, d.lines[0], 360, 962, 52, C.ink, { max: 600 });
    D.txt(ctx, d.lines[1], 360, 1034, 52, C.ink, { max: 600 });
    pill(ctx, 360, 1094, "◎ " + d.cue, "rgba(22,163,93,0.13)", C.greenD, 30);

    var lines = D.wrap(ctx, "おうちの方へ： " + d.tip, 23, "500", 640);
    lines.slice(0, 2).forEach(function (l, i) {
      D.txt(ctx, l, 360, 1184 + i * 32, 23, C.sub, { w: 500 });
    });
  }

  /* ステージ内の表示。左上＝モード、右下＝のこり回数、下中央＝拍のランプ。
     キャラクターの頭（ステージ上部中央）と重ならない位置に置くこと。 */
  function stageChips(ctx, s, d) {
    if (s.phase === "demo") pill(ctx, ST.x + 106, ST.y + 52, "おてほん", C.orange, "#fff", 30);
    if (s.phase === "go" || s.phase === "done") {
      var per = d.countPer || 1;
      var label = "のこり " + Math.ceil(s.left / per) + (d.unit || "かい");
      ctx.fillStyle = C.bg;
      ctx.fillRect(430, 26, 260, 62);
      pill(ctx, 592, 58, label, "rgba(32,49,61,0.78)", "#fff", 26);
    }
    if (s.phase === "go") {
      var b = Math.floor(s.beat) % 4, u = s.beat - Math.floor(s.beat);
      for (var i = 0; i < 4; i++) {
        var on = i === b;
        ctx.fillStyle = on ? "rgba(255,255,255," + (1 - u * 0.5) + ")" : "rgba(255,255,255,0.3)";
        ctx.beginPath();
        ctx.arc(CX - 60 + i * 40, ST.y + ST.h - 26, on ? 12 - u * 3 : 8, 0, 7);
        ctx.fill();
      }
    }
  }

  function countdown(ctx, s) {
    if (s.phase !== "count") return;
    var rem = SD.COUNTDOWN - s.tRel;      /* 3.0 → 0.0 */
    var k = 1 - (rem - Math.floor(rem));  /* 数字ごとに 0→1 */
    ctx.save();
    ctx.globalAlpha = 0.92;
    var r = 96 + (1 - k) * 26;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath(); ctx.arc(CX, ST.y + ST.h / 2, r, 0, 7); ctx.fill();
    ctx.lineWidth = 10; ctx.strokeStyle = C.green; ctx.stroke();
    D.txt(ctx, String(s.count), CX, ST.y + ST.h / 2 + 44, 130, C.green);
    ctx.restore();
    D.txt(ctx, "よーい…", CX, ST.y + ST.h / 2 + 170, 40, C.greenD);
  }

  function doneBurst(ctx, s) {
    if (s.phase !== "done") return;
    var k = D.clamp(s.tRel / 0.5, 0, 1);
    ctx.save();
    ctx.globalAlpha = D.clamp(1.6 - s.tRel, 0, 1);
    for (var i = 0; i < 12; i++) {
      var a = (i / 12) * Math.PI * 2, r = 90 + k * 130;
      ctx.fillStyle = [C.yellow, C.orange, C.green, C.pink][i % 4];
      ctx.save();
      ctx.translate(CX + Math.cos(a) * r, ST.y + ST.h / 2 + Math.sin(a) * r * 0.8);
      ctx.rotate(a + k * 3);
      ctx.fillRect(-9, -9, 18, 18);
      ctx.restore();
    }
    ctx.restore();
    pill(ctx, CX, ST.y + 130, "できた！", C.green, "#fff", 46);
  }

  /* ---------- 正面ビューの背景 ---------- */
  function frontStage(ctx, scroll, dash) {
    ctx.save();
    D.rr(ctx, ST.x, ST.y, ST.w, ST.h, 36); ctx.clip();
    var g = ctx.createLinearGradient(0, ST.y, 0, GY);
    g.addColorStop(0, "#eaf6ef"); g.addColorStop(1, "#dcefe1");
    ctx.fillStyle = g; ctx.fillRect(ST.x, ST.y, ST.w, ST.h);

    ctx.fillStyle = C.grass;
    ctx.fillRect(ST.x, GY, ST.w, ST.y + ST.h - GY);
    ctx.fillStyle = C.grassD;
    var p = ((scroll || 0) % 120 + 120) % 120;
    for (var x = ST.x - p; x < ST.x + ST.w; x += 120) ctx.fillRect(x, GY, 60, ST.h);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(ST.x, GY - 4, ST.w, 4);

    if (dash) {
      ctx.strokeStyle = "rgba(255,255,255," + 0.55 * dash + ")";
      ctx.lineWidth = 7; ctx.lineCap = "round";
      for (var i = 0; i < 6; i++) {
        var yy = ST.y + 120 + i * 92, off = ((scroll * 2.4 + i * 70) % 320);
        ctx.beginPath();
        ctx.moveTo(ST.x + ST.w - off, yy);
        ctx.lineTo(ST.x + ST.w - off - 90, yy);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function topStage(ctx, scrollY) {
    ctx.save();
    D.rr(ctx, ST.x, ST.y, ST.w, ST.h, 36); ctx.clip();
    ctx.fillStyle = C.grass; ctx.fillRect(ST.x, ST.y, ST.w, ST.h);
    ctx.fillStyle = C.grassD;
    var p = ((scrollY || 0) % 160 + 160) % 160;
    for (var y = ST.y - p; y < ST.y + ST.h; y += 160) ctx.fillRect(ST.x, y, ST.w, 80);
    ctx.restore();
  }

  function cone(ctx, x, y, sc) {
    sc = sc === undefined ? 1 : sc;
    ctx.save();
    ctx.translate(x, y); ctx.scale(sc, sc);
    D.shadow(ctx, 2, 6, 22, 10, 0.2);
    ctx.fillStyle = C.orange;
    ctx.beginPath();
    ctx.moveTo(0, -30); ctx.lineTo(19, 12); ctx.lineTo(-19, 12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillRect(-13, -6, 26, 7);
    ctx.fillStyle = "#e0762f";
    ctx.beginPath(); ctx.ellipse(0, 12, 23, 8, 0, 0, 7); ctx.fill();
    ctx.restore();
  }

  function trail(ctx, pts) {
    ctx.save();
    pts.forEach(function (p, i) {
      ctx.globalAlpha = 0.5 * (1 - i / pts.length);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(p.x, p.y, 14 - i * 0.6, 0, 7); ctx.fill();
    });
    ctx.restore();
  }

  return {
    CX: CX, GY: GY, ST: ST,
    bg: bg, progressBar: progressBar, header: header, panel: panel, pill: pill,
    stageChips: stageChips, countdown: countdown, doneBurst: doneBurst,
    frontStage: frontStage, topStage: topStage, cone: cone, trail: trail,
  };
})();
