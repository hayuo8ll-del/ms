/* ボールなしドリブル練習：描画部品。
   SDraw の関数はすべて「渡された値だけ」で描く。時刻の解釈や状態は持たない
   （動画は 1 コマずつ時刻を指定して描かせるので、前フレームに依存すると破綻する）。 */
var SDraw = (function () {
  "use strict";

  var W = 720, H = 1280;
  var FONT = '"M PLUS Rounded 1c","Hiragino Maru Gothic ProN","IPAPGothic",sans-serif';

  var C = {
    bg: "#fbf6ea", card: "#fffdf7", ink: "#20313d", sub: "#69808f", line: "#e6dcc6",
    green: "#16a35d", greenD: "#0d7a43", grass: "#46b672", grassD: "#3aa566", grassF: "#2f8d55",
    orange: "#ff8b3d", orangeD: "#e0762f", blue: "#2f7fd4", blueD: "#1e5fa6", blueL: "#5aa0e6",
    pink: "#ff5f7a", yellow: "#ffc93c", sky: "#e8f4ee", sky2: "#d6ebdd",
    skin: "#ffd6ad", skinD: "#eeb98a", hair: "#3a2a22", hairL: "#54392c",
    shoe: "#ff8b3d", shoeD: "#d96b23", sock: "#ffffff", sockB: "#2f7fd4",
  };

  /* ---------- 数 ---------- */
  function lerp(a, b, k) { return a + (b - a) * k; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(k) { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); }
  function easeOut(k) { k = clamp(k, 0, 1); return 1 - (1 - k) * (1 - k); }
  function easeIn(k) { k = clamp(k, 0, 1); return k * k; }
  /* 行き過ぎてから収まる。足を置く・文字が出るなど「止まる動き」に効く */
  function easeBack(k, s) {
    k = clamp(k, 0, 1); s = s === undefined ? 1.7 : s;
    var u = k - 1;
    return u * u * ((s + 1) * u + s) + 1;
  }
  function easeElastic(k) {
    k = clamp(k, 0, 1);
    if (k === 0 || k === 1) return k;
    return Math.pow(2, -9 * k) * Math.sin((k * 10 - 0.75) * 2.1) + 1;
  }

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

  /* ---------- 図形・文字 ---------- */
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
    if (o.max) {
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
  }

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

  /* 影は 3 枚重ねてふちをぼかす（canvas の shadowBlur は重いので使わない）。
     h = 地面からの浮き具合 0..1。浮くほど小さく薄くなる。 */
  function shadow(ctx, x, y, rx, ry, a, h) {
    h = h || 0;
    var s = 1 - h * 0.45, al = (a === undefined ? 0.18 : a) * (1 - h * 0.55);
    ctx.save();
    for (var i = 0; i < 3; i++) {
      var k = 1 + i * 0.26;
      ctx.fillStyle = "rgba(24,60,44," + (al / (1 + i * 1.7)).toFixed(3) + ")";
      ctx.beginPath(); ctx.ellipse(x, y, rx * s * k, ry * s * k, 0, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  /* そうぞうのボール。squash は当たった瞬間のつぶれ 0..1 */
  function ghostBall(ctx, x, y, r, a, squash) {
    if (a <= 0.01) return;
    squash = squash || 0;
    var sx = 1 + squash * 0.22, sy = 1 - squash * 0.2;
    ctx.save();
    ctx.globalAlpha = a;
    shadow(ctx, x, y + r * 0.94, r * 0.8, r * 0.26, 0.2, 0);
    ctx.translate(x, y + r * (1 - sy));
    ctx.scale(sx, sy);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7);
    ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.fill();
    /* 白だけだと芝の上で消えるので、下側にうっすら影を入れて球に見せる */
    var g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(1, "rgba(32,49,61,0.16)");
    ctx.fillStyle = g; ctx.fill();
    ctx.setLineDash([9, 8]); ctx.lineWidth = 4; ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(32,49,61,0.5)"; ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(32,49,61,0.15)";
    ctx.beginPath(); ctx.arc(0, -r * 0.04, r * 0.29, 0, 7); ctx.fill();
    for (var i = 0; i < 3; i++) {
      var an = -1.75 + i * 2.1;
      ctx.beginPath();
      ctx.arc(Math.cos(an) * r * 0.62, Math.sin(an) * r * 0.62, r * 0.145, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  }

  /* 接地・接触のしるし。age は 0（当たった瞬間）→1（消える） */
  function impact(ctx, x, y, age, tint) {
    if (age < 0 || age > 1) return;
    var k = easeOut(age);
    ctx.save();
    ctx.globalAlpha = (1 - age) * 0.75;
    ctx.lineWidth = 5 * (1 - age) + 1;
    ctx.strokeStyle = tint || "rgba(255,255,255,0.95)";
    ctx.beginPath(); ctx.ellipse(x, y, 16 + k * 46, 5 + k * 15, 0, 0, 7); ctx.stroke();
    for (var i = 0; i < 5; i++) {
      var a = -0.4 - i * 0.55, d = 12 + k * 52;
      ctx.globalAlpha = (1 - age) * 0.5;
      ctx.fillStyle = tint || "#ffffff";
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d * (i % 2 ? -1 : 1), y - Math.abs(Math.sin(a)) * d * 0.42,
        (1 - age) * 6 + 1.5, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ---------- キャラクター（正面） ---------- */
  function seg(ctx, a, b, w, color) {
    ctx.save();
    ctx.lineCap = "round"; ctx.lineWidth = w; ctx.strokeStyle = color;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.restore();
  }

  /* 二次ベジエの中点＝ひざ・ひじの位置。これで曲がった手足になる */
  function joint(hip, ctrl, foot) {
    return { x: 0.25 * hip.x + 0.5 * ctrl.x + 0.25 * foot.x,
             y: 0.25 * hip.y + 0.5 * ctrl.y + 0.25 * foot.y };
  }

  function shoe(ctx, x, y, ang, side) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang); ctx.scale(side, 1);
    ctx.fillStyle = C.shoe;
    ctx.beginPath();
    ctx.moveTo(-22, -12); ctx.quadraticCurveTo(22, -16, 33, -1);
    ctx.quadraticCurveTo(36, 10, 22, 11); ctx.lineTo(-20, 11);
    ctx.quadraticCurveTo(-30, 10, -22, -12); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.moveTo(-22, 4); ctx.lineTo(30, 4);
    ctx.quadraticCurveTo(36, 10, 22, 11); ctx.lineTo(-20, 11);
    ctx.quadraticCurveTo(-28, 10, -22, 4); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = C.shoeD; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-4, -11); ctx.lineTo(6, 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, -13); ctx.lineTo(16, 0); ctx.stroke();
    ctx.restore();
  }

  function leg(ctx, hip, foot, side, lift) {
    var ctrl = { x: lerp(hip.x, foot.x, 0.35) + side * (16 + lift * 20),
                 y: lerp(hip.y, foot.y, 0.58) + 12 };
    var knee = joint(hip, ctrl, foot);
    var ankle = { x: lerp(knee.x, foot.x, 0.82), y: lerp(knee.y, foot.y, 0.82) - 10 };
    seg(ctx, hip, knee, 34, C.skin);
    seg(ctx, knee, ankle, 27, C.skin);
    /* ソックス（くるぶし上まで）＋ライン */
    var sockTop = { x: lerp(knee.x, ankle.x, 0.5), y: lerp(knee.y, ankle.y, 0.5) };
    seg(ctx, sockTop, ankle, 26, C.sock);
    seg(ctx, sockTop, { x: lerp(sockTop.x, ankle.x, 0.16), y: lerp(sockTop.y, ankle.y, 0.16) }, 26, C.sockB);
    return ankle;
  }

  function arm(ctx, sh, hand, side, bend) {
    var ctrl = { x: lerp(sh.x, hand.x, 0.4) + side * (26 + bend), y: lerp(sh.y, hand.y, 0.55) };
    var elbow = joint(sh, ctrl, hand);
    seg(ctx, sh, elbow, 26, C.skin);
    seg(ctx, elbow, hand, 22, C.skin);
    ctx.fillStyle = C.skin;
    ctx.beginPath(); ctx.arc(hand.x, hand.y, 12, 0, 7); ctx.fill();
    return elbow;
  }

  /* p = {hipX,hipY,fL,fR,bob,lean,look,armL,armR,squash,headLag,hairLag,blink,mouth,brow} */
  function kidFront(ctx, p) {
    var hx = p.hipX, hy = p.hipY + (p.bob || 0), lean = p.lean || 0;
    var look = p.look === undefined ? 1 : p.look;
    var sq = p.squash || 0;
    var ground = p.hipY + 214;
    var lift = clamp((ground - Math.min(p.fL.y, p.fR.y)) / 120, 0, 1);

    shadow(ctx, hx + lean * 1.5, ground + 4, 78, 18, 0.2, lift * 0.5 + (sq < 0 ? -sq * 0.5 : 0));

    ctx.save();
    /* つぶれ・のび。接地点を軸にすると重さが出る */
    ctx.translate(hx, ground);
    ctx.scale(1 + sq * 0.07, 1 - sq * 0.09);
    ctx.rotate(lean * 0.015);
    ctx.translate(-hx, -ground);

    /* 脚 */
    [["L", p.fL, -1], ["R", p.fR, 1]].forEach(function (o) {
      var f = o[1], side = o[2];
      var hip = { x: hx + side * 21, y: hy };
      var fl = clamp((ground - f.y) / 120, 0, 1);
      var ankle = leg(ctx, hip, { x: f.x, y: f.y - 14 }, side, fl);
      shoe(ctx, f.x, f.y - 4, f.ang || 0, side);
      return ankle;
    });

    /* ズボン */
    ctx.fillStyle = C.ink;
    ctx.beginPath();
    ctx.moveTo(hx - 58, hy - 46);
    ctx.lineTo(hx + 58, hy - 46);
    ctx.quadraticCurveTo(hx + 62, hy + 16, hx + 40, hy + 26);
    ctx.quadraticCurveTo(hx + 20, hy + 30, hx + 12, hy + 6);
    ctx.quadraticCurveTo(hx, hy - 6, hx - 12, hy + 6);
    ctx.quadraticCurveTo(hx - 20, hy + 30, hx - 40, hy + 26);
    ctx.quadraticCurveTo(hx - 62, hy + 16, hx - 58, hy - 46);
    ctx.fill();

    /* 上半身。同じパスを塗りとクリップの両方に使う（バンドがはみ出さない） */
    var top = hy - 156, tw = 64, bw = 54;
    function torsoPath() {
      ctx.beginPath();
      ctx.moveTo(hx - bw, hy - 30);
      ctx.bezierCurveTo(hx - bw - 6, hy - 90, hx - tw - 2, top + 44, hx - tw, top + 18);
      ctx.quadraticCurveTo(hx - tw + 2, top, hx - tw + 22, top - 2);
      ctx.quadraticCurveTo(hx, top - 12, hx + tw - 22, top - 2);
      ctx.quadraticCurveTo(hx + tw - 2, top, hx + tw, top + 18);
      ctx.bezierCurveTo(hx + tw + 2, top + 44, hx + bw + 6, hy - 90, hx + bw, hy - 30);
      ctx.quadraticCurveTo(hx, hy - 20, hx - bw, hy - 30);
      ctx.closePath();
    }
    ctx.fillStyle = C.blue;
    torsoPath(); ctx.fill();
    ctx.save();
    torsoPath(); ctx.clip();
    ctx.fillStyle = C.blueD;
    ctx.fillRect(hx - 90, top + 62, 180, 22);
    ctx.fillStyle = "rgba(255,255,255,0.13)";
    ctx.fillRect(hx - 90, top - 20, 36, 280);
    ctx.fillStyle = "rgba(20,40,70,0.10)";
    ctx.fillRect(hx + 40, top - 20, 60, 280);
    ctx.restore();
    txt(ctx, "8", hx, top + 128, 42, "rgba(255,255,255,0.92)");
    /* えり */
    ctx.strokeStyle = C.blueD; ctx.lineWidth = 7; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(hx, top - 6, 20, 0.12 * Math.PI, 0.88 * Math.PI); ctx.stroke();

    /* 腕。腕を描いてから、そでを腕に沿って上から重ねる */
    var sh = { l: { x: hx - tw + 10, y: top + 24 }, r: { x: hx + tw - 10, y: top + 24 } };
    var elbowL = arm(ctx, sh.l, p.armL, -1, (p.armL.bend || 0));
    var elbowR = arm(ctx, sh.r, p.armR, 1, (p.armR.bend || 0));
    [[sh.l, elbowL], [sh.r, elbowR]].forEach(function (o) {
      var a = o[0], e = o[1];
      seg(ctx, { x: a.x, y: a.y - 6 },
             { x: lerp(a.x, e.x, 0.52), y: lerp(a.y, e.y, 0.52) }, 36, C.blue);
    });

    /* 首 */
    var headY = top - 44 + (p.headLag || 0), headX = hx + lean * 2.2;
    ctx.fillStyle = C.skinD;
    rr(ctx, hx - 13, top - 26, 26, 26, 10); ctx.fill();

    /* 頭 */
    ctx.fillStyle = C.skin;
    ctx.beginPath(); ctx.ellipse(headX, headY, 50, 47, 0, 0, 7); ctx.fill();
    /* 髪（走ると少し遅れて揺れる） */
    var hair = p.hairLag || 0;
    ctx.fillStyle = C.hair;
    ctx.beginPath();
    ctx.moveTo(headX - 51, headY - 4);
    ctx.bezierCurveTo(headX - 54, headY - 52, headX + 54, headY - 52, headX + 51, headY - 4);
    ctx.quadraticCurveTo(headX + 44, headY - 16, headX + 22, headY - 14);
    ctx.quadraticCurveTo(headX - 6, headY - 12 + hair * 0.5, headX - 30, headY - 20);
    ctx.quadraticCurveTo(headX - 44, headY - 22, headX - 51, headY - 4);
    ctx.fill();
    ctx.fillStyle = C.hairL;
    ctx.beginPath();
    ctx.ellipse(headX - 12, headY - 36 - hair * 0.3, 22, 11, -0.35, 0, 7); ctx.fill();
    /* 耳 */
    ctx.fillStyle = C.skinD;
    [-1, 1].forEach(function (s2) {
      ctx.beginPath(); ctx.ellipse(headX + s2 * 50, headY + 4, 7, 10, 0, 0, 7); ctx.fill();
    });

    /* 顔 */
    var eyeY = headY + (look > 0 ? 13 : 3);
    var blink = p.blink || 0;
    ctx.fillStyle = C.ink;
    ctx.strokeStyle = C.ink; ctx.lineCap = "round";
    [-19, 19].forEach(function (dx) {
      if (blink > 0.5) {
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(headX + dx, eyeY - 2, 8, 0.18 * Math.PI, 0.82 * Math.PI);
        ctx.stroke();
      } else {
        ctx.beginPath(); ctx.ellipse(headX + dx, eyeY, 5.6, 7.8 * (1 - blink), 0, 0, 7); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath(); ctx.arc(headX + dx + 2, eyeY - 3, 2, 0, 7); ctx.fill();
        ctx.fillStyle = C.ink;
      }
    });
    /* まゆ（がんばっているほど上がる） */
    var brow = p.brow || 0;
    ctx.lineWidth = 4.5;
    [-1, 1].forEach(function (s2) {
      ctx.beginPath();
      ctx.moveTo(headX + s2 * 10, eyeY - 15 - brow * 3);
      ctx.lineTo(headX + s2 * 27, eyeY - 12 - brow * 6);
      ctx.stroke();
    });
    ctx.fillStyle = "rgba(255,140,150,0.42)";
    [-33, 33].forEach(function (dx) {
      ctx.beginPath(); ctx.ellipse(headX + dx, eyeY + 12, 10, 6.5, 0, 0, 7); ctx.fill();
    });
    /* 口 */
    var mouth = p.mouth || 0;
    if (mouth > 0.35) {
      ctx.fillStyle = "#8d3c46";
      ctx.beginPath();
      ctx.ellipse(headX, eyeY + 19, 9 + mouth * 4, 7 + mouth * 6, 0, 0, 7); ctx.fill();
    } else {
      ctx.strokeStyle = C.ink; ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(headX, eyeY + 13, 11, 0.22 * Math.PI, 0.78 * Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- キャラクター（真上から） ---------- */
  function kidTop(ctx, x, y, dir, stepPhase, sc) {
    sc = sc || 1;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(dir); ctx.scale(sc, sc);
    shadow(ctx, 3, 7, 33, 29, 0.22, 0);
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
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.ellipse(0, 3, 37, 28, 0, 0, 7); ctx.fill();
    ctx.fillStyle = C.blue;
    ctx.beginPath(); ctx.ellipse(0, 3, 32, 23, 0, 0, 7); ctx.fill();
    ctx.fillStyle = C.blueD;
    ctx.beginPath(); ctx.ellipse(0, 11, 30, 14, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.beginPath(); ctx.ellipse(-12, -2, 12, 14, 0.3, 0, 7); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(0, -8, 19, 0, 7); ctx.fill();
    ctx.fillStyle = C.skin;
    ctx.beginPath(); ctx.arc(0, -8, 15.5, 0, 7); ctx.fill();
    ctx.fillStyle = C.hair;
    ctx.beginPath(); ctx.arc(0, -6, 15.5, Math.PI * 0.1, Math.PI * 0.9); ctx.fill();
    ctx.restore();
  }

  /* ---------- 紙のような粒子。毎フレーム作らずタイルを 1 枚だけ作って使い回す ---------- */
  var grainTile = null;
  function grain(ctx) {
    if (!grainTile && typeof document !== "undefined") {
      var c = document.createElement("canvas");
      c.width = c.height = 96;
      var g = c.getContext("2d"), img = g.createImageData(96, 96), s = 1;
      for (var i = 0; i < img.data.length; i += 4) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;      /* 固定シード＝毎回同じ模様 */
        var v = 128 + ((s >> 16) % 40) - 20;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      grainTile = ctx.createPattern(c, "repeat");
    }
    if (!grainTile) return;
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = grainTile;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  return {
    W: W, H: H, C: C, FONT: FONT,
    lerp: lerp, clamp: clamp, ease: ease, easeOut: easeOut, easeIn: easeIn,
    easeBack: easeBack, easeElastic: easeElastic, kf: kf, beatBump: beatBump,
    rr: rr, txt: txt, wrap: wrap, shadow: shadow, ghostBall: ghostBall, impact: impact,
    kidFront: kidFront, kidTop: kidTop, shoe: shoe, grain: grain,
  };
})();
