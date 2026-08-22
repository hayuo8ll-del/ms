/* ボールなしドリブル練習：描画。drills.js の時刻から 1 フレームを描くだけ。
   SDraw.frame(ctx, t) は t 秒の絵を毎回ゼロから描く純関数（前のフレームに依存しない）。
   動画書き出しは 30fps でこれを呼ぶだけなので、状態を持たせないこと。 */
var SDraw = (function () {
  "use strict";

  var W = 720, H = 1280;
  var FONT = '"M PLUS Rounded 1c","Hiragino Maru Gothic ProN","IPAPGothic",sans-serif';

  var C = {
    bg: "#fbf6ea", card: "#fffdf7", ink: "#20313d", sub: "#69808f", line: "#e6dcc6",
    green: "#16a35d", greenD: "#0d7a43", grass: "#3fae6a", grassD: "#37a061",
    orange: "#ff8b3d", blue: "#2f7fd4", blueD: "#1e5fa6", pink: "#ff5f7a", yellow: "#ffc93c",
    skin: "#ffd6ad", skinD: "#f0bd8c", hair: "#3a2a22", shoe: "#ff8b3d", sock: "#ffffff",
  };

  /* ---------- 小道具 ---------- */
  function lerp(a, b, k) { return a + (b - a) * k; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(k) { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); }
  function easeOut(k) { k = clamp(k, 0, 1); return 1 - (1 - k) * (1 - k); }

  /* キーフレーム補間。[[u,x,y],...] を滑らかにつなぐ。足の軌道はほぼこれで作る。 */
  function kf(list, u) {
    if (u <= list[0][0]) return { x: list[0][1], y: list[0][2] };
    for (var i = 1; i < list.length; i++) {
      if (u <= list[i][0]) {
        var a = list[i - 1], b = list[i], k = ease((u - a[0]) / (b[0] - a[0]));
        return { x: lerp(a[1], b[1], k), y: lerp(a[2], b[2], k) };
      }
    }
    var L = list[list.length - 1];
    return { x: L[1], y: L[2] };
  }

  /* 拍にひもづく山（接触の瞬間 delta=0 で 1、±0.5 拍で 0） */
  function beatBump(beat, parity) {
    var k = Math.round(beat);
    if (((k % 2) + 2) % 2 !== parity) k = beat > k ? k + 1 : k - 1;
    var d = beat - k;
    return { k: k, d: d, h: Math.abs(d) < 0.5 ? Math.cos(d * Math.PI) * 0.5 + 0.5 : 0 };
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function txt(ctx, s, x, y, size, color, o) {
    o = o || {};
    ctx.save();
    ctx.font = (o.w || 800) + " " + size + "px " + FONT;
    ctx.fillStyle = color;
    ctx.textAlign = o.align || "center";
    ctx.textBaseline = o.base || "alphabetic";
    if (o.max) { /* 幅に収まるまで縮める */
      var m = ctx.measureText(s).width;
      if (m > o.max) { size = size * (o.max / m); ctx.font = (o.w || 800) + " " + size + "px " + FONT; }
    }
    if (o.stroke) {
      ctx.lineWidth = o.stroke; ctx.lineJoin = "round";
      ctx.strokeStyle = o.strokeColor || "#fff";
      ctx.strokeText(s, x, y);
    }
    ctx.fillText(s, x, y);
    ctx.restore();
    return ctx.measureText(s).width;
  }

  /* 日本語は好きな場所で折り返せるので、幅だけ見て詰める */
  function wrap(ctx, s, size, weight, maxW) {
    ctx.save();
    ctx.font = weight + " " + size + "px " + FONT;
    var out = [], line = "";
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ctx.measureText(line + ch).width > maxW && line.length) { out.push(line); line = ""; }
      line += ch;
    }
    if (line) out.push(line);
    ctx.restore();
    return out;
  }

  function shadow(ctx, x, y, rx, ry, a) {
    ctx.save();
    ctx.fillStyle = "rgba(20,40,30," + (a === undefined ? 0.16 : a) + ")";
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 7); ctx.fill();
    ctx.restore();
  }

  /* そうぞうのボール。点線＝「ここに あるつもり」 */
  function ghostBall(ctx, x, y, r, a) {
    if (a <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = a;
    shadow(ctx, x, y + r * 0.92, r * 0.85, r * 0.3, 0.14);
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
    ctx.fillStyle = "rgba(255,255,255,0.72)"; ctx.fill();
    ctx.setLineDash([9, 8]); ctx.lineWidth = 4; ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(32,49,61,0.55)"; ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(32,49,61,0.16)";
    ctx.beginPath(); ctx.arc(x, y - r * 0.05, r * 0.3, 0, 7); ctx.fill();
    for (var i = 0; i < 3; i++) {
      var an = -1.7 + i * 2.1;
      ctx.beginPath();
      ctx.arc(x + Math.cos(an) * r * 0.6, y + Math.sin(an) * r * 0.6, r * 0.15, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ---------- キャラクター（正面） ---------- */
  function limb(ctx, x1, y1, cx, cy, x2, y2, w, color) {
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.lineWidth = w; ctx.strokeStyle = color;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2); ctx.stroke();
    ctx.restore();
  }

  function shoe(ctx, x, y, ang, side) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = C.shoe;
    ctx.beginPath(); ctx.ellipse(side * 6, 0, 30, 15, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath(); ctx.ellipse(side * 6, 6, 30, 7, 0, 0, 7); ctx.fill();
    ctx.restore();
  }

  /* pose = {hipX,hipY,fL,fR,bob,lean,look,armL,armR,cheer} */
  function kidFront(ctx, p) {
    var hx = p.hipX, hy = p.hipY + (p.bob || 0), lean = p.lean || 0;
    var look = p.look === undefined ? 1 : p.look;   /* 1=ボールを見る -1=前を見る */

    shadow(ctx, hx, p.hipY + 214, 74, 17);

    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(lean * 0.017);
    ctx.translate(-hx, -hy);

    /* 脚（奥＝左から） */
    [["L", p.fL, -1], ["R", p.fR, 1]].forEach(function (o) {
      var f = o[1], side = o[2];
      var hipx = hx + side * 20, hipy = hy;
      var lift = clamp((p.hipY + 200 - f.y) / 120, 0, 1);
      var cxk = lerp(hipx, f.x, 0.35) + side * (16 + lift * 18);
      var cyk = lerp(hipy, f.y, 0.55) + 10;
      limb(ctx, hipx, hipy, cxk, cyk, f.x, f.y - 12, 32, C.skin);
      limb(ctx, lerp(cxk, f.x, 0.74), lerp(cyk, f.y - 12, 0.74), lerp(cxk, f.x, 0.88), lerp(cyk, f.y - 12, 0.88), f.x, f.y - 12, 24, C.sock);
      shoe(ctx, f.x, f.y - 2, (f.ang || 0), side);
    });

    /* ズボン */
    ctx.fillStyle = C.ink;
    rr(ctx, hx - 60, hy - 46, 120, 74, 26); ctx.fill();

    /* シャツ */
    var ty = hy - 172;
    ctx.fillStyle = C.blue;
    rr(ctx, hx - 58, ty, 116, 144, 34); ctx.fill();
    ctx.fillStyle = C.blueD;
    ctx.save(); ctx.beginPath(); rr(ctx, hx - 58, ty, 116, 144, 34); ctx.clip();
    ctx.fillRect(hx - 58, ty + 66, 116, 20);
    ctx.restore();
    txt(ctx, "8", hx, ty + 118, 40, "rgba(255,255,255,0.9)");

    /* 腕 */
    var sh = ty + 22;
    [[p.armL, -1], [p.armR, 1]].forEach(function (o) {
      var a = o[0], side = o[1];
      limb(ctx, hx + side * 52, sh, hx + side * (74 + a.o), sh + a.c, a.x, a.y, 24, C.skin);
      limb(ctx, hx + side * 52, sh, hx + side * 60, sh + 16, hx + side * 66, sh + 30, 30, C.blue);
    });

    /* 頭 */
    var headY = ty - 42, headX = hx + lean * 1.6;
    ctx.fillStyle = C.skin;
    ctx.beginPath(); ctx.ellipse(headX, headY, 50, 47, 0, 0, 7); ctx.fill();
    ctx.fillStyle = C.hair;
    ctx.beginPath();
    ctx.ellipse(headX, headY - 8, 51, 44, 0, Math.PI * 1.02, Math.PI * 1.98);
    ctx.quadraticCurveTo(headX, headY - 4, headX + 51, headY - 12);
    ctx.fill();
    ctx.beginPath(); ctx.ellipse(headX - 6, headY - 40, 26, 16, -0.3, 0, 7); ctx.fill();

    var eyeY = headY + (look > 0 ? 14 : 4);
    ctx.fillStyle = C.ink;
    [-19, 19].forEach(function (dx) {
      ctx.beginPath(); ctx.ellipse(headX + dx, eyeY, 5.5, 7.5, 0, 0, 7); ctx.fill();
    });
    ctx.fillStyle = "rgba(255,140,150,0.4)";
    [-32, 32].forEach(function (dx) {
      ctx.beginPath(); ctx.ellipse(headX + dx, eyeY + 12, 10, 6, 0, 0, 7); ctx.fill();
    });
    ctx.strokeStyle = C.ink; ctx.lineWidth = 4; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(headX, eyeY + 14, 11, 0.25 * Math.PI, 0.75 * Math.PI);
    ctx.stroke();

    ctx.restore();
  }

  /* ---------- キャラクター（真上から） ---------- */
  function kidTop(ctx, x, y, dir, stepPhase, sc) {
    sc = sc || 1;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(dir); ctx.scale(sc, sc);
    shadow(ctx, 4, 8, 36, 32, 0.2);
    /* 足（進行方向は -Y） */
    [-1, 1].forEach(function (side) {
      var s = Math.sin(stepPhase + (side > 0 ? 0 : Math.PI));
      ctx.save();
      ctx.translate(side * 22, -s * 22);
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.ellipse(0, 0, 14, 22, 0, 0, 7); ctx.fill();
      ctx.fillStyle = C.shoe;
      ctx.beginPath(); ctx.ellipse(0, 0, 10.5, 18, 0, 0, 7); ctx.fill();
      ctx.restore();
    });
    /* 胴（白フチ付き。芝の上でも形が分かるように） */
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.ellipse(0, 3, 37, 28, 0, 0, 7); ctx.fill();
    ctx.fillStyle = C.blue;
    ctx.beginPath(); ctx.ellipse(0, 3, 32, 23, 0, 0, 7); ctx.fill();
    ctx.fillStyle = C.blueD;
    ctx.beginPath(); ctx.ellipse(0, 11, 30, 14, 0, 0, 7); ctx.fill();
    /* 頭。肩より小さく、進行方向（-Y）に顔が向く */
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(0, -8, 19, 0, 7); ctx.fill();
    ctx.fillStyle = C.skin;
    ctx.beginPath(); ctx.arc(0, -8, 15.5, 0, 7); ctx.fill();
    ctx.fillStyle = C.hair;
    ctx.beginPath(); ctx.arc(0, -6, 15.5, Math.PI * 0.08, Math.PI * 0.92); ctx.fill();
    ctx.restore();
  }

  return {
    W: W, H: H, C: C, FONT: FONT,
    lerp: lerp, clamp: clamp, ease: ease, easeOut: easeOut, kf: kf, beatBump: beatBump,
    rr: rr, txt: txt, wrap: wrap, shadow: shadow, ghostBall: ghostBall,
    kidFront: kidFront, kidTop: kidTop, shoe: shoe,
  };
})();
