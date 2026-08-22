/* 8つの練習の動き。拍（beat）だけを入力に、足とボールの位置を返す純関数。
   時間ではなく拍で書くので、テンポを変えても、おてほんをゆっくり再生しても同じ形になる。 */
var SMove = (function () {
  "use strict";
  var D = SDraw;
  var CX = SScene.CX, GY = SScene.GY;
  var REST_L = { x: CX - 56, y: GY }, REST_R = { x: CX + 56, y: GY };

  function mix(rest, target, h) {
    return { x: D.lerp(rest.x, target.x, h), y: D.lerp(rest.y, target.y, h) };
  }

  /* 区間ごとに速度が変わるスクロール量。拍の関数として積分する（毎フレーム同じ値になる） */
  function scrollAt(beat, speed) {
    var s = 0, dt = 0.25, b = 0;
    for (; b + dt <= beat; b += dt) s += speed(b) * dt;
    return s + speed(b) * (beat - b);
  }

  function arms(hipX, hipY, swing, cheer) {
    var sh = hipY - 150;
    if (cheer) {
      return {
        armL: { x: hipX - 96, y: sh - 76 - cheer * 10, o: 26, c: -46 },
        armR: { x: hipX + 96, y: sh - 76 - cheer * 10, o: 26, c: -46 },
      };
    }
    return {
      armL: { x: hipX - 84 - swing * 8, y: sh + 104 + swing * 6, o: 8, c: 62 },
      armR: { x: hipX + 84 + swing * 8, y: sh + 104 - swing * 6, o: 8, c: 62 },
    };
  }

  /* --- 1. あしうら タッチ --- */
  function sole(beat) {
    var ball = { x: CX, y: GY - 32, r: 32, a: 1 };
    var bR = D.beatBump(beat, 0), bL = D.beatBump(beat, 1);
    var top = ball.y - ball.r + 8;
    var fR = mix(REST_R, { x: ball.x + 12, y: top }, bR.h);
    var fL = mix(REST_L, { x: ball.x - 12, y: top }, bL.h);
    fR.ang = -0.3 * bR.h; fL.ang = 0.3 * bL.h;
    var h = Math.max(bR.h, bL.h);
    return { fL: fL, fR: fR, ball: ball, bob: -9 * h, crouch: 16, look: 1 };
  }

  /* --- 2. インサイド トントン --- */
  function inside(beat) {
    var side = function (k) { return (((k % 2) + 2) % 2) === 0 ? -1 : 1; };
    var k = Math.floor(beat), u = beat - k;
    var bx = CX + D.lerp(side(k), side(k + 1), D.ease(u / 0.32)) * 66;
    var ball = { x: bx, y: GY - 30, r: 30, a: 1 };
    var bR = D.beatBump(beat, 1), bL = D.beatBump(beat, 0);
    var fR = mix(REST_R, { x: CX + 66 - 24, y: GY - 8 }, bR.h);
    var fL = mix(REST_L, { x: CX - 66 + 24, y: GY - 8 }, bL.h);
    fR.y -= 8 * bR.h; fL.y -= 8 * bL.h;
    fR.ang = 0.18 * bR.h; fL.ang = -0.18 * bL.h;
    return { fL: fL, fR: fR, ball: ball, bob: -4, crouch: 26, look: 1 };
  }

  /* --- 3. アウトサイド おし --- */
  function outside(beat, rep, reps) {
    var S = rep < reps / 2 ? 1 : -1;           /* 前半みぎ足、後半ひだり足 */
    var k = Math.floor(beat), u = beat - k;
    var pos = function (i) { return (((i % 2) + 2) % 2) === 0 ? 26 : 132; };
    var bx = CX + S * D.lerp(pos(k), pos(k + 1), D.ease(u / 0.34));
    var dx = (bx - CX) * 0.2;                  /* ボールについていく分だけ体もずれる */
    var hip = CX + dx;
    /* 外へ押すときは足がボールの内側、戻すときは外側にまわる */
    var off = function (i) { return (((i % 2) + 2) % 2) === 0 ? -38 : 38; };
    var o = D.lerp(off(k), off(k + 1), D.ease(u / 0.26));
    var act = {
      x: bx + S * o,
      y: GY - 14 * Math.sin(Math.PI * D.clamp(u / 0.34, 0, 1)),
      ang: S * 0.22,
    };
    var plant = { x: hip - S * 62, y: GY };
    var fR = S > 0 ? act : plant, fL = S > 0 ? plant : act;
    return {
      fL: fL, fR: fR, ball: { x: bx, y: GY - 30, r: 30, a: 1 },
      bob: -4, crouch: 22, look: 1, foot: S, dx: dx, lean: S * 3,
    };
  }

  /* --- 4. こきざみ ステップ → ダッシュ --- */
  function steps(beat) {
    var speed = function (b) { return (b % 8) >= 6 ? 200 : 24; };
    var dash = D.ease(((beat % 8) - 5.7) / 0.5);
    var amp = D.lerp(28, 66, dash), xa = D.lerp(9, 46, dash);
    var ph = beat * Math.PI;
    var fR = { x: CX + 56 + Math.cos(ph) * xa, y: GY - Math.max(0, Math.sin(ph)) * amp };
    var fL = { x: CX - 56 + Math.cos(ph + Math.PI) * xa, y: GY - Math.max(0, Math.sin(ph + Math.PI)) * amp };
    var ball = { x: CX + dash * 190, y: GY - 30, r: 30, a: 1 - dash * 0.75 };
    return {
      fL: fL, fR: fR, ball: ball, bob: -6 - dash * 8, crouch: 10 + dash * 10,
      lean: dash * 9, look: dash > 0.4 ? -1 : 1, dash: dash, scroll: scrollAt(beat, speed),
      swing: dash * 1.4,
    };
  }

  /* --- 7. かおを あげて タッチ（動きは 1 と同じ、目線だけ前） --- */
  function lookup(beat) {
    var p = sole(beat);
    p.look = -1;
    p.fingers = 1 + ((Math.floor(beat / 4) * 3) % 5);
    p.answer = (beat % 4) > 1.4 && (beat % 4) < 3.6;
    return p;
  }

  /* --- 8. またぎ フェイント（シザース） --- */
  function scissors(beat) {
    var rp = beat % 2;
    var fR = D.kf([
      [0, CX + 56, GY], [0.18, CX + 4, GY - 74], [0.42, CX - 30, GY - 88],
      [0.66, CX + 44, GY - 80], [0.86, CX + 108, GY - 16], [1.0, CX + 108, GY],
      [1.5, CX + 108, GY], [1.75, CX + 30, GY - 44], [2.0, CX + 56, GY],
    ], rp);
    var fL = D.kf([
      [0, CX - 56, GY], [1.0, CX - 56, GY], [1.2, CX - 6, GY - 30],
      [1.38, CX + 18, GY - 8], [1.62, CX - 78, GY - 20], [2.0, CX - 56, GY],
    ], rp);
    var bx = D.lerp(CX, CX - 140, D.ease((rp - 1.3) / 0.35));
    var a = rp < 0.15 ? D.ease(rp / 0.15) : rp > 1.8 ? 1 - D.ease((rp - 1.8) / 0.2) : 1;
    var dash = D.ease((rp - 1.45) / 0.35) * (rp > 1.9 ? 1 - D.ease((rp - 1.9) / 0.1) : 1);
    var speed = function (b) { var r = b % 2; return r >= 1.45 && r < 1.95 ? -190 : 0; };
    return {
      fL: fL, fR: fR, ball: { x: bx, y: GY - 30, r: 30, a: a },
      bob: -6, crouch: 20, lean: -dash * 8, look: rp < 1.4 ? 1 : -1,
      dash: dash, scroll: scrollAt(beat, speed), swing: dash * 1.2,
      over: rp < 1.0,
    };
  }

  /* --- 5. ジグザグ（真上から） --- */
  var ZD = 216, ZY = 646;
  function zigPos(repf) {
    return { x: SScene.CX + Math.cos(Math.PI * repf) * 118, y: ZY };
  }
  function zigzag(beat) {
    var repf = beat / 2;
    var x = SScene.CX + Math.cos(Math.PI * repf) * 118;
    var vx = -Math.sin(Math.PI * repf) * Math.PI * 118, vy = -ZD;
    var tr = [];
    for (var i = 1; i <= 14; i++) {
      var r = Math.max(0, repf - i * 0.055);
      tr.push({ x: SScene.CX + Math.cos(Math.PI * r) * 118, y: ZY + (repf - r) * ZD });
    }
    var ahead = repf + 0.2;
    return {
      x: x, y: ZY, ZY: ZY, dir: Math.atan2(vx, -vy), repf: repf, D: ZD, trail: tr,
      ball: { x: SScene.CX + Math.cos(Math.PI * ahead) * 118, y: ZY - 0.2 * ZD, r: 24, a: 1 },
      step: beat * Math.PI * 1.1, scrollY: repf * ZD,
    };
  }

  /* --- 6. ストップ＆ターン（真上から） --- */
  function stopturn(beat) {
    var r = Math.floor(beat / 4), u = (beat % 4) / 4;
    var up = r % 2 === 0;
    var A = 742, B = 392;
    var from = up ? A : B, to = up ? B : A;
    var k = D.ease(D.clamp(u / 0.7, 0, 1));
    var y = D.lerp(from, to, k);
    var base = up ? 0 : Math.PI;
    var turn = D.ease(D.clamp((u - 0.76) / 0.2, 0, 1));
    var dir = base + Math.PI * turn;
    var tr = [];
    for (var i = 1; i <= 12; i++) {
      var uu = Math.max(0, u - i * 0.022);
      tr.push({ x: SScene.CX, y: D.lerp(from, to, D.ease(D.clamp(uu / 0.7, 0, 1))) });
    }
    var bd = up ? -1 : 1;
    var by = k >= 1 ? to + bd * 52 : y + bd * 52;
    return {
      x: SScene.CX, y: y, dir: dir, trail: tr, step: beat * Math.PI * 1.6 * (k < 1 ? 1 : 0),
      ball: { x: SScene.CX + (turn > 0.1 ? 34 * turn * -bd : 0), y: by, r: 22, a: 1 },
      stop: u > 0.7 && u < 1.0, stopK: D.clamp((u - 0.7) / 0.12, 0, 1),
      stepsDone: Math.min(3, Math.floor(k * 3.2)), lo: A, hi: B, scrollY: 0,
    };
  }

  var TABLE = {
    sole: sole, inside: inside, outside: outside, steps: steps,
    lookup: lookup, scissors: scissors, zigzag: zigzag, stopturn: stopturn,
  };

  function pose(d, s) {
    var f = TABLE[d.key];
    return d.key === "outside" ? f(s.beat, s.rep, d.reps) : f(s.beat);
  }

  return { pose: pose, arms: arms, TABLE: TABLE, REST_L: REST_L, REST_R: REST_R };
})();
