/* ボールなしドリブル練習：ステージと HUD。
   ここは「背景と情報表示」だけ。キャラクターの動きは moves.js、組み立ては story.js。 */
var SScene = (function () {
  "use strict";
  var D = SDraw, C = D.C;
  var W = D.W, H = D.H;

  var CX = 360;          /* 正面ビューの中心 */
  var GY = 790;          /* 正面ビューの地面 */
  var ST = { x: 30, y: 190, w: 660, h: 672 };  /* ステージ */

  /* ---------- 全体の下地 ---------- */
  function bg(ctx) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#fdf9f0"); g.addColorStop(1, "#f6efe0");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.fillStyle = "rgba(22,163,93,0.05)";
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
    var w = W * D.clamp(t / SD.TOTAL, 0, 1);
    var g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, C.green); g.addColorStop(1, "#3ec97f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, 8);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    SD.SEGS.forEach(function (s) {
      if (s.kind === "drill") ctx.fillRect(W * (s.start / SD.TOTAL) - 1, 0, 2, 8);
    });
  }

  function header(ctx, d, st) {
    D.txt(ctx, "ボールなし ドリブルれんしゅう", 30, 62, 24, C.sub, { align: "left", w: 700 });
    /* この行の右側は、練習中は「のこり◯かい」に譲る */
    if (!st || (st.phase !== "go" && st.phase !== "done")) {
      D.txt(ctx, d.no + " ／ " + SD.DRILLS.length, 690, 62, 24, C.sub, { align: "right", w: 700 });
    }
    D.shadow(ctx, 76, 126, 40, 12, 0.16, 0);
    var g = ctx.createLinearGradient(32, 74, 120, 162);
    g.addColorStop(0, "#22b96c"); g.addColorStop(1, C.greenD);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(76, 118, 44, 0, 7); ctx.fill();
    D.txt(ctx, String(d.no), 76, 134, 46, "#fff");
    D.txt(ctx, d.name, 140, 136, 50, C.ink, { align: "left", max: 550 });
  }

  function pill(ctx, x, y, label, bgc, fg, size, pop) {
    size = size || 28;
    ctx.save();
    if (pop) { ctx.translate(x, y); ctx.scale(pop, pop); ctx.translate(-x, -y); }
    ctx.font = "800 " + size + "px " + D.FONT;
    var w = ctx.measureText(label).width + 40, h = size + 24;
    D.shadow(ctx, x, y + h / 2 - 4, w / 2 - 6, 7, 0.14, 0);
    D.rr(ctx, x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fillStyle = bgc; ctx.fill();
    D.txt(ctx, label, x, y + size * 0.36, size, fg);
    ctx.restore();
    return w;
  }

  function panel(ctx, d, s) {
    D.shadow(ctx, 360, 1146, 322, 12, 0.13, 0);
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

  /* ステージ内の表示。左上＝モード、ヘッダー右＝のこり回数、下中央＝拍のランプ。
     キャラクターの頭（ステージ上部中央）と重ならない位置に置くこと。 */
  function stageChips(ctx, s, d) {
    if (s.phase === "demo") {
      pill(ctx, ST.x + 106, ST.y + 52, "おてほん", C.orange, "#fff", 30,
        1 + Math.max(0, 0.16 - s.tRel * 0.4));
    }
    if (s.phase === "go" || s.phase === "done") {
      var per = d.countPer || 1;
      var label = "のこり " + Math.ceil(s.left / per) + (d.unit || "かい");
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
    var cy = ST.y + ST.h / 2;
    ctx.save();
    ctx.globalAlpha = 0.94;
    var r = 96 + (1 - D.easeOut(k)) * 30;
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.beginPath(); ctx.arc(CX, cy, r, 0, 7); ctx.fill();
    /* 残り時間を円弧で見せる */
    ctx.lineWidth = 10; ctx.strokeStyle = "rgba(22,163,93,0.2)";
    ctx.beginPath(); ctx.arc(CX, cy, r, 0, 7); ctx.stroke();
    ctx.strokeStyle = C.green; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(CX, cy, r, -Math.PI / 2, -Math.PI / 2 + (1 - k) * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    var sc = 1 + (1 - D.easeOut(Math.min(1, k * 3))) * 0.35;
    ctx.translate(CX, cy); ctx.scale(sc, sc); ctx.translate(-CX, -cy);
    D.txt(ctx, String(s.count), CX, cy + 44, 130, C.greenD);
    ctx.restore();
    D.txt(ctx, "よーい…", CX, cy + 176, 40, C.greenD);
  }

  function doneBurst(ctx, s) {
    if (s.phase !== "done") return;
    var k = D.clamp(s.tRel / 0.5, 0, 1);
    ctx.save();
    ctx.globalAlpha = D.clamp(1.6 - s.tRel, 0, 1);
    for (var i = 0; i < 14; i++) {
      var a = (i / 14) * Math.PI * 2, r = 90 + D.easeOut(k) * 150;
      ctx.fillStyle = [C.yellow, C.orange, C.green, C.pink][i % 4];
      ctx.save();
      ctx.translate(CX + Math.cos(a) * r, ST.y + ST.h / 2 + Math.sin(a) * r * 0.8);
      ctx.rotate(a + k * 3.4);
      ctx.fillRect(-9, -9, 18, 18);
      ctx.restore();
    }
    ctx.restore();
    pill(ctx, CX, ST.y + 120, "できた！", C.green, "#fff", 46,
      D.easeElastic(D.clamp(s.tRel / 0.5, 0, 1)));
  }

  /* ---------- 正面ビューの背景 ---------- */
  var PAD = 96;   /* カメラで寄せても背景の端が見えないよう、枠より外まで描く */
  function frontStage(ctx, scroll, dash) {
    scroll = scroll || 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ST.x - PAD, ST.y - PAD, ST.w + PAD * 2, ST.h + PAD * 2); ctx.clip();

    var g = ctx.createLinearGradient(0, ST.y, 0, GY);
    g.addColorStop(0, "#f0f8f3"); g.addColorStop(0.6, "#e2f0e6"); g.addColorStop(1, "#d3e9db");
    ctx.fillStyle = g; ctx.fillRect(ST.x - PAD, ST.y - PAD, ST.w + PAD * 2, ST.h + PAD * 2);
    var sun = ctx.createRadialGradient(CX + 110, ST.y + 40, 10, CX + 110, ST.y + 40, 300);
    sun.addColorStop(0, "rgba(255,255,255,0.85)"); sun.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sun; ctx.fillRect(ST.x - PAD, ST.y - PAD, ST.w + PAD * 2, ST.h + PAD * 2);

    /* 遠景（ゆっくり流れる＝奥行き） */
    var far = -scroll * 0.16;
    ctx.fillStyle = "#a8dcbd";
    for (var i = -1; i < 7; i++) {
      var bx = ST.x + ((i * 190 + (far % 190) + 1900) % 1900) - 100;
      ctx.beginPath();
      ctx.arc(bx, GY - 46, 46, Math.PI, 0); ctx.arc(bx + 52, GY - 46, 34, Math.PI, 0);
      ctx.arc(bx - 46, GY - 46, 28, Math.PI, 0);
      ctx.fill();
    }
    /* 遠くのゴール */
    var gx = ST.x + 84 + ((-scroll * 0.3) % 1400 + 1400) % 1400 - 40;
    if (gx > ST.x - 220 && gx < ST.x + ST.w + 40) {
      ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 7; ctx.lineCap = "round";
      ctx.strokeRect(gx, GY - 118, 176, 74);
      ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 2;
      for (var n = 1; n < 8; n++) {
        ctx.beginPath(); ctx.moveTo(gx + n * 22, GY - 118); ctx.lineTo(gx + n * 22, GY - 44); ctx.stroke();
      }
    }
    ctx.fillStyle = "rgba(47,125,90,0.18)";
    ctx.fillRect(ST.x - PAD, GY - 46, ST.w + PAD * 2, 46);

    /* 地面 */
    ctx.fillStyle = C.grass;
    ctx.fillRect(ST.x - PAD, GY, ST.w + PAD * 2, ST.h);
    ctx.fillStyle = C.grassD;
    var p = ((scroll % 120) + 120) % 120;
    for (var x = ST.x - PAD - p; x < ST.x + ST.w + PAD; x += 120) ctx.fillRect(x, GY, 60, ST.h);
    var gg = ctx.createLinearGradient(0, GY, 0, GY + 80);
    gg.addColorStop(0, "rgba(20,70,45,0.22)"); gg.addColorStop(1, "rgba(20,70,45,0)");
    ctx.fillStyle = gg; ctx.fillRect(ST.x - PAD, GY, ST.w + PAD * 2, 80);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(ST.x - PAD, GY - 4, ST.w + PAD * 2, 4);

    if (dash) {
      ctx.strokeStyle = "rgba(255,255,255," + 0.6 * dash + ")";
      ctx.lineWidth = 7; ctx.lineCap = "round";
      for (var j = 0; j < 7; j++) {
        var yy = ST.y + 110 + j * 88, off = ((Math.abs(scroll) * 2.4 + j * 70) % 340);
        var dir = scroll < 0 ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(dir > 0 ? ST.x + ST.w - off : ST.x + off, yy);
        ctx.lineTo(dir > 0 ? ST.x + ST.w - off - 96 : ST.x + off + 96, yy);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function topStage(ctx, scrollY) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(ST.x - PAD, ST.y - PAD, ST.w + PAD * 2, ST.h + PAD * 2); ctx.clip();
    ctx.fillStyle = C.grass;
    ctx.fillRect(ST.x - PAD, ST.y - PAD, ST.w + PAD * 2, ST.h + PAD * 2);
    ctx.fillStyle = C.grassD;
    var p = ((scrollY || 0) % 160 + 160) % 160;
    for (var y = ST.y - PAD - p; y < ST.y + ST.h + PAD; y += 160) {
      ctx.fillRect(ST.x - PAD, y, ST.w + PAD * 2, 80);
    }
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    for (var y2 = ST.y - PAD - p; y2 < ST.y + ST.h + PAD; y2 += 160) {
      ctx.fillRect(ST.x - PAD, y2, ST.w + PAD * 2, 12);
    }
    ctx.restore();
  }

  function vignette(ctx) {
    var v = ctx.createRadialGradient(CX, ST.y + ST.h / 2, ST.h * 0.32, CX, ST.y + ST.h / 2, ST.h * 0.78);
    v.addColorStop(0, "rgba(20,45,35,0)");
    v.addColorStop(1, "rgba(20,45,35,0.16)");
    ctx.fillStyle = v;
    ctx.fillRect(ST.x, ST.y, ST.w, ST.h);
  }

  function cone(ctx, x, y, sc) {
    sc = sc === undefined ? 1 : sc;
    ctx.save();
    ctx.translate(x, y); ctx.scale(sc, sc);
    D.shadow(ctx, 6, 8, 20, 8, 0.24, 0);
    var g = ctx.createLinearGradient(-19, 0, 19, 0);
    g.addColorStop(0, C.orangeD); g.addColorStop(0.45, C.orange); g.addColorStop(1, "#ffa763");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -32); ctx.quadraticCurveTo(4, -30, 19, 11);
    ctx.lineTo(-19, 11); ctx.quadraticCurveTo(-4, -30, 0, -32);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(-12.5, -8, 25, 7);
    ctx.fillStyle = C.orangeD;
    ctx.beginPath(); ctx.ellipse(0, 12, 23, 8, 0, 0, 7); ctx.fill();
    ctx.restore();
  }

  function trail(ctx, pts) {
    ctx.save();
    pts.forEach(function (p, i) {
      var k = 1 - i / pts.length;
      ctx.globalAlpha = 0.42 * k;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(p.x, p.y, 4 + 10 * k, 0, 7); ctx.fill();
    });
    ctx.restore();
  }

  return {
    CX: CX, GY: GY, ST: ST,
    bg: bg, progressBar: progressBar, header: header, panel: panel, pill: pill,
    stageChips: stageChips, countdown: countdown, doneBurst: doneBurst,
    frontStage: frontStage, topStage: topStage, cone: cone, trail: trail, vignette: vignette,
  };
})();
