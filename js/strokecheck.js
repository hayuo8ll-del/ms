/* ===== 書き順チェック（書いた 1画を お手本の 何画めと 見くらべる） ===== */
/* 画面（document）に ふれない 純粋な 関数だけ。座標は KanjiVG と おなじ 109×109 の ます。
   scripts/test-study.mjs が Node で そのまま 試す。

   見かた（1画 かくごとに judgeStroke）：
     ok      … いま 書く はずの k画めと 形・場所・むきが あっている
     order   … べつの（まだ 書いていない）画の ほうが ずっと よく あう ＝ じゅんばんが ちがう
     reverse … k画めの 形だが、書く むきが 反対（右→左、下→上 など）
     off     … どの 画とも あわない（形や 場所が ずれている）
   お手本を 消して 書くと 字の 位置が ずれるので、それまでに あっていた 画の
   ずれ（shift）を 引いてから くらべる。 */

const SC_N = 24;   // 1画を この 点数に そろえて くらべる

/* SVG の d（KanjiVG が つかう M m C c S s L l）を 点の ならびに する */
function svgPathPoints(d) {
  const tok = String(d).match(/[MmCcSsLl]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  const pts = [];
  let i = 0, cmd = "M", x = 0, y = 0, sx = 0, sy = 0, lc = null;   // lc = 前の 2つめの 制御点（S 用）
  const num = () => +tok[i++];
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    for (let t = 1; t <= 12; t++) {
      const u = t / 12, v = 1 - u;
      pts.push([v * v * v * x + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3,
                v * v * v * y + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3]);
    }
    lc = [x2, y2]; x = x3; y = y3;
  };
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M": x = ox + num(); y = oy + num(); sx = x; sy = y; pts.push([x, y]); lc = null; cmd = rel ? "l" : "L"; break;
      case "L": x = ox + num(); y = oy + num(); pts.push([x, y]); lc = null; break;
      case "C": { const a = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()]; cubic(...a); break; }
      case "S": {
        const r1 = lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y];
        const a = [ox + num(), oy + num(), ox + num(), oy + num()];
        cubic(r1[0], r1[1], ...a); break;
      }
      default: i++;   // 知らない 命令は とばす
    }
  }
  return pts.length ? pts : [[sx, sy]];
}

/* 道のりで 等間隔に n点 とりなおす */
function resampleStroke(pts, n = SC_N) {
  if (!pts.length) return [];
  const seg = [0];
  for (let i = 1; i < pts.length; i++) seg.push(seg[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = seg[seg.length - 1];
  if (total < 1e-6) return Array.from({ length: n }, () => [pts[0][0], pts[0][1]]);
  const out = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const t = (total * k) / (n - 1);
    while (j < pts.length - 1 && seg[j] < t) j++;
    const a = pts[j - 1], b = pts[j], span = seg[j] - seg[j - 1] || 1, f = Math.min(1, Math.max(0, (t - seg[j - 1]) / span));
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}
function strokeLength(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; }
function strokeCenter(pts) { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; }
/* 2本の 線の へだたり（おなじ じゅんの 点どうしの 平均きょり） */
function strokeDist(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]); return s / a.length; }

/* 1文字ぶんの お手本（STROKES[char] の d の ならび）を くらべやすい 形に */
function strokeRefs(ds) { return (ds || []).map(d => resampleStroke(svgPathPoints(d))); }

/* 1画を はんてい する。
   user  … 書いた 点（109 ます 座標）
   refs  … strokeRefs の けっか
   k     … いま 書く はずの 画（0から）
   opts  … { tol: ゆるさ（ます）, shift: [dx, dy] これまでの ずれ } */
function judgeStroke(user, refs, k, opts = {}) {
  const tol = opts.tol || 22, sh = opts.shift || [0, 0];
  const u = resampleStroke(user.map(p => [p[0] - sh[0], p[1] - sh[1]]));
  const rev = u.slice().reverse();
  const fwd = refs.map(r => strokeDist(u, r));
  const back = refs.map(r => strokeDist(rev, r));
  // まだ 書いていない 画の 中で いちばん よく あう もの
  let best = -1;
  for (let j = k; j < refs.length; j++) if (best < 0 || fwd[j] < fwd[best]) best = j;
  const base = { expected: k, d: fwd[k], dRev: back[k] };
  if (best !== k && best >= 0 && fwd[best] < tol && fwd[best] < fwd[k] * 0.6) return { ...base, result: "order", matched: best };
  if (fwd[k] < tol && !(back[k] < fwd[k] * 0.5)) return { ...base, result: "ok", matched: k };
  if (back[k] < tol) return { ...base, result: "reverse", matched: k };
  if (best !== k && best >= 0 && fwd[best] < tol) return { ...base, result: "order", matched: best };
  for (let j = k + 1; j < refs.length; j++) if (back[j] < tol) return { ...base, result: "order", matched: j };
  return { ...base, result: "off", matched: -1 };
}

/* あっていた 画から「字ぜんたいの ずれ」を 見つもる（大きすぎる ずれは 切りつめる） */
function strokeShift(pairs, limit = 24) {
  if (!pairs.length) return [0, 0];
  let dx = 0, dy = 0;
  for (const [user, ref] of pairs) { const a = strokeCenter(resampleStroke(user)), b = strokeCenter(ref); dx += a[0] - b[0]; dy += a[1] - b[1]; }
  const c = v => Math.max(-limit, Math.min(limit, v / pairs.length));
  return [c(dx), c(dy)];
}
