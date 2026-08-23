/* 8つの練習の動き。拍（beat）だけを入力に、足・ボール・体の状態を返す純関数。
   時間ではなく拍で書くので、テンポを変えても、おてほんをゆっくり再生しても形が崩れない。
   返す値：fL/fR（足）、ball、bob（上下）、crouch（腰の高さ）、lean、look、
   squash（つぶれ）、effort（表情）、contact（当たった位置と経過拍）、swing/pump（腕）。 */
var SMove = (function () {
  "use strict";
  var D = SDraw;
  var CX = SScene.CX, GY = SScene.GY;
  var REST_L = { x: CX - 54, y: GY }, REST_R = { x: CX + 54, y: GY };

  function mix(rest, target, h) {
    return { x: D.lerp(rest.x, target.x, h), y: D.lerp(rest.y, target.y, h) };
  }
  /* 拍の頭で当たる動作の「経過ぶん」。0=当たった瞬間 */
  function since(beat) { return beat - Math.floor(beat); }
  function pop(beat, k) { return Math.max(0, 1 - since(beat) * (k || 6)); }

  function scrollAt(beat, speed) {
    var s = 0, dt = 0.25, b = 0;
    for (; b + dt <= beat; b += dt) s += speed(b) * dt;
    return s + speed(b) * (beat - b);
  }

  /* 腕。swing=前後の振り、pump=走りの大きさ、cheer=バンザイ */
  function arms(hipX, hipY, o) {
    o = o || {};
    var sh = hipY - 150, swing = o.swing || 0, pump = o.pump || 0, cheer = o.cheer || 0;
    if (cheer > 0) {
      return {
        armL: { x: hipX - 92, y: sh - 74 - cheer * 12, bend: 18 },
        armR: { x: hipX + 92, y: sh - 74 - cheer * 12, bend: 18 },
      };
    }
    return {
      armL: { x: hipX - 80 - swing * 6 + pump * 14, y: sh + 102 + swing * 8 - pump * swing * 52, bend: 6 + pump * 16 },
      armR: { x: hipX + 80 + swing * 6 - pump * 14, y: sh + 102 - swing * 8 + pump * swing * 52, bend: 6 + pump * 16 },
    };
  }

  /* --- 1. あしうら タッチ --- */
  function sole(beat) {
    var ball = { x: CX, y: GY - 32, r: 32, a: 1 };
    var bR = D.beatBump(beat, 0), bL = D.beatBump(beat, 1);
    var top = ball.y - ball.r + 8;
    var fR = mix(REST_R, { x: ball.x + 13, y: top }, bR.h);
    var fL = mix(REST_L, { x: ball.x - 13, y: top }, bL.h);
    fR.ang = -0.34 * bR.h; fL.ang = 0.34 * bL.h;
    var h = Math.max(bR.h, bL.h);
    var hit = pop(beat, 7);
    return {
      fL: fL, fR: fR, ball: ball, bob: -10 * h, crouch: 18, look: 1,
      squash: hit * 0.5, ballSquash: hit,
      contact: { x: ball.x, y: ball.y - ball.r + 6, age: Math.min(1, since(beat) * 2.2) },
      swing: (bR.h - bL.h) * 0.5, effort: 0.15,
    };
  }

  /* --- 2. インサイド トントン --- */
  function inside(beat) {
    var side = function (k) { return (((k % 2) + 2) % 2) === 0 ? -1 : 1; };
    var k = Math.floor(beat), u = beat - k;
    var from = side(k), to = side(k + 1);
    var bx = CX + D.lerp(from, to, D.ease(u / 0.3)) * 66;
    var ball = { x: bx, y: GY - 30, r: 30, a: 1 };
    var bR = D.beatBump(beat, 1), bL = D.beatBump(beat, 0);
    var fR = mix(REST_R, { x: CX + 44, y: GY - 8 }, bR.h);
    var fL = mix(REST_L, { x: CX - 44, y: GY - 8 }, bL.h);
    fR.y -= 9 * bR.h; fL.y -= 9 * bL.h;
    fR.ang = 0.2 * bR.h; fL.ang = -0.2 * bL.h;
    var hit = pop(beat, 7);
    return {
      fL: fL, fR: fR, ball: ball, bob: -5, crouch: 28, look: 1,
      dx: from * 9 * (1 - D.ease(u / 0.4)) + to * 9 * D.ease(u / 0.4),
      squash: hit * 0.4, ballSquash: hit,
      contact: { x: CX + from * 62, y: GY - 12, age: Math.min(1, since(beat) * 2.4) },
      swing: (bL.h - bR.h) * 0.4, effort: 0.2,
    };
  }

  /* --- 3. アウトサイド おし --- */
  function outside(beat, rep, reps) {
    var S = rep < reps / 2 ? 1 : -1;           /* 前半みぎ足、後半ひだり足 */
    var k = Math.floor(beat), u = beat - k;
    var pos = function (i) { return (((i % 2) + 2) % 2) === 0 ? 26 : 132; };
    var bx = CX + S * D.lerp(pos(k), pos(k + 1), D.ease(u / 0.32));
    var dx = (bx - CX) * 0.2;
    var hip = CX + dx;
    var off = function (i) { return (((i % 2) + 2) % 2) === 0 ? -38 : 38; };
    var o = D.lerp(off(k), off(k + 1), D.ease(u / 0.24));
    var act = {
      x: bx + S * o,
      y: GY - 16 * Math.sin(Math.PI * D.clamp(u / 0.34, 0, 1)),
      ang: S * 0.24,
    };
    var plant = { x: hip - S * 62, y: GY };
    var hit = pop(beat, 7);
    return {
      fL: S > 0 ? plant : act, fR: S > 0 ? act : plant,
      ball: { x: bx, y: GY - 30, r: 30, a: 1 },
      bob: -5, crouch: 24, look: 1, foot: S, dx: dx, lean: S * 4,
      squash: hit * 0.4, ballSquash: hit,
      contact: { x: bx, y: GY - 12, age: Math.min(1, since(beat) * 2.4) },
      effort: 0.25, swing: -S * 0.3,
    };
  }

  /* --- 4. こきざみ ステップ → ダッシュ --- */
  function steps(beat) {
    var inSet = beat % 8;
    var speed = function (b) { return (b % 8) >= 6 ? 220 : 26; };
    var dash = D.ease((inSet - 5.75) / 0.45);
    var crouchAnt = Math.max(0, 1 - Math.abs(inSet - 5.6) * 2.4);  /* ダッシュ直前のため */
    var amp = D.lerp(30, 72, dash), xa = D.lerp(10, 50, dash);
    var ph = beat * Math.PI;
    var sr = Math.sin(ph), sl = Math.sin(ph + Math.PI);
    var fR = { x: CX + 52 + Math.cos(ph) * xa, y: GY - Math.max(0, sr) * amp, ang: -Math.max(0, sr) * 0.3 };
    var fL = { x: CX - 52 + Math.cos(ph + Math.PI) * xa, y: GY - Math.max(0, sl) * amp, ang: -Math.max(0, sl) * 0.3 };
    var hit = pop(beat, 8);
    return {
      fL: fL, fR: fR,
      ball: { x: CX + dash * 210, y: GY - 30, r: 30, a: 1 - dash * 0.8 },
      bob: -7 - dash * 10, crouch: 12 + dash * 12 + crouchAnt * 16,
      lean: dash * 10, look: dash > 0.4 ? -1 : 1, dash: dash,
      scroll: scrollAt(beat, speed), swing: sr * 0.8, pump: dash,
      squash: hit * 0.45 + crouchAnt * 0.3,
      contact: { x: sr > 0 ? fL.x : fR.x, y: GY - 6, age: Math.min(1, since(beat) * 2.6) },
      effort: 0.3 + dash * 0.7,
    };
  }

  /* --- 7. かおを あげて タッチ（動きは 1 と同じ、目線だけ前） --- */
  function lookup(beat) {
    var p = sole(beat);
    p.look = -1;
    p.fingers = 1 + ((Math.floor(beat / 4) * 3) % 5);
    p.answer = (beat % 4) > 1.4 && (beat % 4) < 3.6;
    p.effort = p.answer ? 0.5 : 0.15;
    p.mouth = p.answer ? 0.8 : 0;
    return p;
  }

  /* --- 8. またぎ フェイント（シザース） --- */
  function scissors(beat) {
    var rp = beat % 2;
    var fR = D.kf([
      [0, CX + 54, GY], [0.16, CX + 4, GY - 78], [0.4, CX - 32, GY - 92],
      [0.64, CX + 44, GY - 84], [0.84, CX + 106, GY - 18], [1.0, CX + 106, GY],
      [1.5, CX + 106, GY], [1.74, CX + 26, GY - 48], [2.0, CX + 54, GY],
    ], rp);
    var fL = D.kf([
      [0, CX - 54, GY], [1.0, CX - 54, GY], [1.18, CX - 4, GY - 32],
      [1.36, CX + 18, GY - 8], [1.6, CX - 80, GY - 22], [2.0, CX - 54, GY],
    ], rp);
    fR.ang = rp < 1 ? -0.3 * Math.sin(Math.PI * rp) : 0.2 * Math.max(0, Math.sin(Math.PI * (rp - 1.5) / 0.5));
    fL.ang = rp > 1 && rp < 1.6 ? 0.3 : 0;
    var bx = D.lerp(CX, CX - 145, D.ease((rp - 1.32) / 0.34));
    var a = rp < 0.15 ? D.ease(rp / 0.15) : rp > 1.8 ? 1 - D.ease((rp - 1.8) / 0.2) : 1;
    var dash = D.ease((rp - 1.42) / 0.32) * (rp > 1.9 ? 1 - D.ease((rp - 1.9) / 0.1) : 1);
    var speed = function (b) { var r = b % 2; return r >= 1.42 && r < 1.95 ? -210 : 0; };
    var hitAge = rp >= 1.32 ? D.clamp((rp - 1.32) * 2.2, 0, 1) : 1;
    return {
      fL: fL, fR: fR, ball: { x: bx, y: GY - 30, r: 30, a: a },
      bob: -6 - dash * 6, crouch: 22 + Math.max(0, 1 - Math.abs(rp - 1.2) * 3) * 14,
      lean: -dash * 10, look: rp < 1.3 ? 1 : -1,
      dash: dash, scroll: scrollAt(beat, speed), swing: rp < 1 ? 0.4 : -0.6, pump: dash,
      squash: Math.max(0, 1 - Math.abs(rp - 1) * 5) * 0.4 + Math.max(0, 1 - hitAge * 3) * 0.4,
      ballSquash: Math.max(0, 1 - hitAge * 3),
      contact: { x: CX - 10, y: GY - 12, age: hitAge },
      effort: 0.25 + dash * 0.6, over: rp < 1.0,
    };
  }

  /* --- 5. ジグザグ（真上から） --- */
  var ZD = 216, ZY = 646, ZA = 118;
  function zigzag(beat) {
    var repf = beat / 2;
    var x = CX + Math.cos(Math.PI * repf) * ZA;
    var vx = -Math.sin(Math.PI * repf) * Math.PI * ZA, vy = -ZD;
    var tr = [];
    for (var i = 1; i <= 16; i++) {
      var r = Math.max(0, repf - i * 0.05);
      tr.push({ x: CX + Math.cos(Math.PI * r) * ZA, y: ZY + (repf - r) * ZD });
    }
    var ahead = repf + 0.2;
    var age = D.clamp((repf - Math.floor(repf)) * 1.6, 0, 1);   /* コーンを抜けた直後 */
    return {
      x: x, y: ZY, ZY: ZY, dir: Math.atan2(vx, -vy), repf: repf, D: ZD, trail: tr,
      ball: { x: CX + Math.cos(Math.PI * ahead) * ZA, y: ZY - 0.2 * ZD, r: 24, a: 1 },
      step: beat * Math.PI * 1.1, scrollY: repf * ZD,
      contact: { x: CX + Math.cos(Math.PI * Math.floor(repf)) * ZA, y: ZY, age: age },
      effort: 0.4,
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
    for (var i = 1; i <= 14; i++) {
      var uu = Math.max(0, u - i * 0.02);
      tr.push({ x: CX, y: D.lerp(from, to, D.ease(D.clamp(uu / 0.7, 0, 1))) });
    }
    var bd = up ? -1 : 1;
    var by = k >= 1 ? to + bd * 52 : y + bd * 52;
    return {
      x: CX, y: y, dir: dir, trail: tr, step: beat * Math.PI * 1.6 * (k < 1 ? 1 : 0),
      ball: { x: CX + (turn > 0.1 ? 34 * turn * -bd : 0), y: by, r: 24, a: 1 },
      stop: u > 0.7 && u < 1.0, stopK: D.clamp((u - 0.7) / 0.12, 0, 1),
      stepsDone: Math.min(3, Math.floor(k * 3.2)), lo: A, hi: B, scrollY: 0,
      contact: { x: CX, y: to, age: D.clamp((u - 0.7) / 0.22, 0, 1) },
      effort: 0.45,
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
