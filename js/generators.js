/* ===== 算数の問題ジェネレーター ===== */
/* 返り値: { q, answer, input:"number"|"choice", choices?, prompt?, svg? } */

function ri(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[ri(0, arr.length - 1)]; }
function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function lcm(a, b) { return (a * b) / gcd(a, b); }

/* --- とけい（SVG） --- */
function clockSVG(h, m) {
  const cx = 100, cy = 100, r = 90;
  const hourAng = ((h % 12) + m / 60) * 30 - 90;
  const minAng = m * 6 - 90;
  const hx = cx + Math.cos(hourAng * Math.PI / 180) * 45;
  const hy = cy + Math.sin(hourAng * Math.PI / 180) * 45;
  const mx = cx + Math.cos(minAng * Math.PI / 180) * 70;
  const my = cy + Math.sin(minAng * Math.PI / 180) * 70;
  let ticks = "";
  for (let i = 0; i < 12; i++) {
    const a = i * 30 - 90;
    const x1 = cx + Math.cos(a * Math.PI / 180) * 78;
    const y1 = cy + Math.sin(a * Math.PI / 180) * 78;
    const x2 = cx + Math.cos(a * Math.PI / 180) * 88;
    const y2 = cy + Math.sin(a * Math.PI / 180) * 88;
    const nx = cx + Math.cos(a * Math.PI / 180) * 64;
    const ny = cy + Math.sin(a * Math.PI / 180) * 64 + 6;
    const num = i === 0 ? 12 : i;
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#3a2b1a" stroke-width="3"/>`;
    ticks += `<text x="${nx}" y="${ny}" font-size="16" font-weight="700" text-anchor="middle" fill="#3a2b1a">${num}</text>`;
  }
  return `<svg viewBox="0 0 200 200" role="img" aria-label="とけい">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff8ee" stroke="#ff8a3d" stroke-width="6"/>
    ${ticks}
    <line x1="${cx}" y1="${cy}" x2="${hx}" y2="${hy}" stroke="#3a2b1a" stroke-width="7" stroke-linecap="round"/>
    <line x1="${cx}" y1="${cy}" x2="${mx}" y2="${my}" stroke="#ef6c1a" stroke-width="4" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="6" fill="#3a2b1a"/>
  </svg>`;
}

/* --- 長方形／三角形（SVG） --- */
function rectSVG(w, h, unit) {
  return `<svg viewBox="0 0 200 140" role="img" aria-label="長方形">
    <rect x="30" y="30" width="140" height="80" fill="#e8f3ff" stroke="#3aa0ff" stroke-width="4"/>
    <text x="100" y="125" text-anchor="middle" font-size="16" font-weight="700" fill="#3a2b1a">たて ${h}${unit}</text>
    <text x="100" y="22" text-anchor="middle" font-size="16" font-weight="700" fill="#3a2b1a">よこ ${w}${unit}</text>
  </svg>`;
}

/* ===== 1年生の算数 ===== */
const MATH_G1 = [
  // たし算（繰り上がりなし）
  () => { const a = ri(1, 8), b = ri(1, 9 - a); return { q: `${a} + ${b} =`, answer: `${a + b}`, input: "number" }; },
  // たし算（繰り上がりあり）
  () => { const a = ri(4, 9), b = ri(11 - a, 9); return { q: `${a} + ${b} =`, answer: `${a + b}`, input: "number" }; },
  // ひき算（繰り下がりなし）
  () => { const a = ri(3, 9), b = ri(1, a); return { q: `${a} - ${b} =`, answer: `${a - b}`, input: "number" }; },
  // ひき算（繰り下がりあり）
  () => { const a = ri(11, 18), b = ri(a - 9, 9); return { q: `${a} - ${b} =`, answer: `${a - b}`, input: "number" }; },
  // 数の大小
  () => {
    const a = ri(1, 20), b = ri(1, 20);
    const ans = a > b ? `${a}` : `${b}`;
    return { prompt: "大きいのは どっち？", q: `${a}  と  ${b}`, answer: ans, input: "choice", choices: [`${a}`, `${b}`] };
  },
  // とけい（ちょうど）
  () => {
    const h = ri(1, 12);
    return { prompt: "なんじ？", q: "", svg: clockSVG(h, 0), answer: `${h}じ`,
      input: "choice", choices: [`${h}じ`, `${(h % 12) + 1}じ`, `${((h + 4) % 12) + 1}じ`, `${((h + 6) % 12) + 1}じ`] };
  },
  // とけい（30ぷん）
  () => {
    const h = ri(1, 12);
    return { prompt: "なんじ なんぷん？", q: "", svg: clockSVG(h, 30), answer: `${h}じ30ぷん`,
      input: "choice", choices: [`${h}じ30ぷん`, `${h}じ`, `${(h % 12) + 1}じ30ぷん`, `${h}じ15ふん`] };
  },
  // いくつといくつ（10の合成）
  () => { const a = ri(1, 9); return { prompt: "10は □ と", q: `10 = ${a} + □`, answer: `${10 - a}`, input: "number" }; },
];

/* ===== 5年生の算数 ===== */
const MATH_G5 = [
  // 分数のたし算（同分母）
  () => {
    const d = ri(3, 9); const a = ri(1, d - 1); const b = ri(1, d - 1);
    const num = a + b;
    const g = gcd(num, d);
    const ans = num % d === 0 ? `${num / d}` : `${num / g}/${d / g}`;
    const wrong = [`${num}/${d}`, `${num}/${d * 2}`, `${a + b}/${d + d}`];
    return { prompt: "分数のたし算（約分も）", q: `${a}/${d} + ${b}/${d} =`, answer: ans, input: "choice",
      choices: [ans, ...wrong.filter(w => w !== ans)].slice(0, 4) };
  },
  // 約分
  () => {
    const g = ri(2, 6); const base = ri(2, 5); const d0 = ri(base + 1, 8);
    const n = base * g, d = d0 * g;
    const ans = `${base}/${d0}`;
    return { prompt: "約分しよう", q: `${n}/${d} =`, answer: ans, input: "choice",
      choices: [ans, `${n}/${d}`, `${base + 1}/${d0}`, `${base}/${d0 + 1}`] };
  },
  // 小数のかけ算
  () => {
    const a = (ri(11, 39) / 10); const b = ri(2, 9);
    const ans = +(a * b).toFixed(1);
    return { prompt: "小数のかけ算", q: `${a} × ${b} =`, answer: `${ans}`, input: "number" };
  },
  // 小数のわり算（わり切れる）
  () => {
    const b = ri(2, 6); const q = (ri(11, 30) / 10); const a = +(q * b).toFixed(1);
    return { prompt: "小数のわり算", q: `${a} ÷ ${b} =`, answer: `${q}`, input: "number" };
  },
  // 割合（百分率）
  () => {
    const base = pick([100, 200, 300, 400, 500, 50, 80, 120]); const p = pick([10, 20, 25, 50, 75]);
    const ans = base * p / 100;
    return { prompt: "割合", q: `${base}の ${p}% は？`, answer: `${ans}`, input: "number" };
  },
  // 平均
  () => {
    const n = 3; const vals = [ri(2, 10), ri(2, 10), ri(2, 10)];
    let sum = vals.reduce((s, v) => s + v, 0);
    // 平均が整数になるよう調整
    const rem = sum % n; if (rem) vals[0] += (n - rem); sum = vals.reduce((s, v) => s + v, 0);
    return { prompt: "へいきん", q: `${vals.join(", ")} のへいきんは？`, answer: `${sum / n}`, input: "number" };
  },
  // 最小公倍数
  () => {
    const a = ri(2, 9), b = ri(2, 9);
    const ans = lcm(a, b);
    return { prompt: "さいしょう公倍数（LCM）", q: `${a} と ${b} の 公倍数で いちばん小さいのは？`, answer: `${ans}`, input: "number" };
  },
  // 最大公約数
  () => {
    const g = ri(2, 6); const a = g * ri(2, 5), b = g * ri(2, 5);
    const ans = gcd(a, b);
    return { prompt: "さいだい公約数（GCD）", q: `${a} と ${b} の 公約数で いちばん大きいのは？`, answer: `${ans}`, input: "number" };
  },
  // 長方形の面積
  () => {
    const w = ri(3, 12), h = ri(2, 9);
    return { prompt: "長方形の面積（cm²）", q: "", svg: rectSVG(w, h, "cm"), answer: `${w * h}`, input: "number" };
  },
  // 三角形の面積
  () => {
    const base = pick([4, 6, 8, 10, 12]); const height = pick([3, 5, 6, 8, 10]);
    return { prompt: "三角形の面積（cm²）", q: `そこ辺 ${base}cm、高さ ${height}cm の 三角形の面積は？`, answer: `${base * height / 2}`, input: "number" };
  },
];

/* n問ぶん生成（連続同一を避ける） */
function generateMathSet(grade, n) {
  const gens = grade === "g1" ? MATH_G1 : MATH_G5;
  const out = []; let last = "";
  for (let i = 0; i < n; i++) {
    let item, guard = 0;
    do { item = pick(gens)(); guard++; } while (item.q + item.answer === last && guard < 6);
    last = item.q + item.answer;
    out.push(item);
  }
  return out;
}
