/* ===== 算数の問題ジェネレーター（難易度対応） ===== */
/* 返り値: { q, answer, input:"number"|"choice", choices?, prompt?, svg? } */

function ri(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[ri(0, arr.length - 1)]; }
function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function lcm(a, b) { return (a * b) / gcd(a, b); }
function uniqChoices(arr) {
  const seen = new Set(), out = [];
  for (const x of arr) { if (!seen.has(x)) { seen.add(x); out.push(x); } if (out.length === 4) break; }
  return out;
}

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

/* --- 長方形（SVG） --- */
function rectSVG(w, h, unit) {
  return `<svg viewBox="0 0 200 140" role="img" aria-label="長方形">
    <rect x="30" y="30" width="140" height="80" fill="#e8f3ff" stroke="#3aa0ff" stroke-width="4"/>
    <text x="100" y="125" text-anchor="middle" font-size="16" font-weight="700" fill="#3a2b1a">たて ${h}${unit}</text>
    <text x="100" y="22" text-anchor="middle" font-size="16" font-weight="700" fill="#3a2b1a">よこ ${w}${unit}</text>
  </svg>`;
}

/* ===== 時計まわりの選択肢ヘルパー ===== */
function clockOClock() {
  const h = ri(1, 12);
  return { prompt: "なんじ？", q: "", svg: clockSVG(h, 0), answer: `${h}じ`,
    input: "choice", choices: [`${h}じ`, `${(h % 12) + 1}じ`, `${((h + 4) % 12) + 1}じ`, `${((h + 6) % 12) + 1}じ`],
    why: `みじかい はりが ${h}、ながい はりが 12 を さして いるね。ながい はりが 12 の ときは 「ちょうど」だから ${h}じ。` };
}
function clockHalf() {
  const h = ri(1, 12);
  return { prompt: "なんじ なんぷん？", q: "", svg: clockSVG(h, 30), answer: `${h}じ30ぷん`,
    input: "choice", choices: [`${h}じ30ぷん`, `${h}じ`, `${(h % 12) + 1}じ30ぷん`, `${h}じ15ふん`],
    why: `ながい はりが 6 を さす ときは 30ぷん。みじかい はりは ${h} と ${(h % 12) + 1} の あいだ だから ${h}じ30ぷん。` };
}

/* --- 1年生：追加の問題タイプ --- */
function moneyG1(diff) {
  const coin = diff === "easy" ? 10 : pick([5, 10, 100]);
  const n = ri(2, diff === "hard" ? 6 : 5);
  return { prompt: "おかね", q: `${coin}円が ${n}こで なん円？`, answer: `${coin * n}`, input: "number" };
}
function seqNextG1() { const a = ri(1, 18); return { prompt: "つぎの かず", q: `${a} の つぎの かずは？`, answer: `${a + 1}`, input: "number" }; }
function moreLessG1(diff) {
  const hi = diff === "hard" ? 90 : 15, dd = diff === "hard" ? 9 : 5;
  if (Math.random() < 0.5) { const base = ri(3, hi), d = ri(1, dd); return { prompt: "", q: `${base}より ${d} 大きい かずは？`, answer: `${base + d}`, input: "number" }; }
  const d = ri(1, dd), b2 = ri(d + 3, hi); return { prompt: "", q: `${b2}より ${d} 小さい かずは？`, answer: `${b2 - d}`, input: "number" };
}
function add2d1d() { const tens = ri(2, 8), ones = ri(0, 4); const t = tens * 10 + ones; const b = ri(1, 9 - ones); return { prompt: "2けたの たしざん", q: `${t} + ${b} =`, answer: `${t + b}`, input: "number" }; }
function sub2d1d() { const tens = ri(2, 9), ones = ri(5, 9); const t = tens * 10 + ones; const b = ri(1, ones); return { prompt: "2けたの ひきざん", q: `${t} - ${b} =`, answer: `${t - b}`, input: "number" }; }
function countBy(diff) { const step = pick(diff === "hard" ? [2, 5, 10] : [2, 5]); const start = step * ri(1, 4); return { prompt: `${step}ずつ`, q: `${start}, ${start + step}, ${start + step * 2}, つぎは？`, answer: `${start + step * 3}`, input: "number" }; }
function ineqG1(diff) { const hi = diff === "hard" ? 99 : 20; const a = ri(1, hi), b = ri(1, hi); const ans = a > b ? ">" : a < b ? "<" : "="; return { prompt: "□に 入る しるしは？", q: `${a} □ ${b}`, answer: ans, input: "choice", choices: [">", "<", "="] }; }

/* ===== 1年生の算数（やさしい/ふつう/むずかしい） ===== */
function mathG1(diff) {
  if (diff === "easy") return [
    () => { const a = ri(1, 5), b = ri(1, 9 - a); return { prompt: "たしざん", q: `${a} + ${b} =`, answer: `${a + b}`, input: "number" }; },
    () => { const a = ri(2, 9), b = ri(1, a); return { prompt: "ひきざん", q: `${a} - ${b} =`, answer: `${a - b}`, input: "number" }; },
    () => { const a = ri(1, 10), b = ri(1, 10); return { prompt: "大きいのは どっち？", q: `${a}  と  ${b}`, answer: a >= b ? `${a}` : `${b}`, input: "choice", choices: [`${a}`, `${b}`] }; },
    () => { const a = ri(1, 9); return { prompt: "10は □と", q: `10 = ${a} + □`, answer: `${10 - a}`, input: "number" }; },
    seqNextG1,
    () => moneyG1("easy"),
    () => moreLessG1("easy"),
    () => countBy("easy"),
  ];
  if (diff === "hard") return [
    () => { const a = ri(4, 9), b = ri(11 - a, 9); return { prompt: "くり上がり たしざん", q: `${a} + ${b} =`, answer: `${a + b}`, input: "number" }; },
    () => { const a = ri(11, 18), b = ri(a - 9, 9); return { prompt: "くり下がり ひきざん", q: `${a} - ${b} =`, answer: `${a - b}`, input: "number" }; },
    () => { const a = ri(1, 6), b = ri(1, 6), c = ri(1, 6); return { prompt: "3つの たしざん", q: `${a} + ${b} + ${c} =`, answer: `${a + b + c}`, input: "number" }; },
    () => { const t = ri(6, 18), a = ri(1, t - 1); return { prompt: "□に 入る かず", q: `${a} + □ = ${t}`, answer: `${t - a}`, input: "number" }; },
    () => { const a = ri(1, 100), b = ri(1, 100); return { prompt: "大きいのは どっち？", q: `${a}  と  ${b}`, answer: a >= b ? `${a}` : `${b}`, input: "choice", choices: [`${a}`, `${b}`] }; },
    clockHalf,
    add2d1d,
    sub2d1d,
    () => moneyG1("hard"),
    () => moreLessG1("hard"),
    () => countBy("hard"),
    () => ineqG1("hard"),
  ];
  // normal
  return [
    () => { const a = ri(1, 8), b = ri(1, 9 - a); return { q: `${a} + ${b} =`, answer: `${a + b}`, input: "number" }; },
    () => { const a = ri(4, 9), b = ri(11 - a, 9); return { q: `${a} + ${b} =`, answer: `${a + b}`, input: "number" }; },
    () => { const a = ri(3, 9), b = ri(1, a); return { q: `${a} - ${b} =`, answer: `${a - b}`, input: "number" }; },
    () => { const a = ri(11, 18), b = ri(a - 9, 9); return { q: `${a} - ${b} =`, answer: `${a - b}`, input: "number" }; },
    () => { const a = ri(1, 20), b = ri(1, 20); return { prompt: "大きいのは どっち？", q: `${a}  と  ${b}`, answer: a >= b ? `${a}` : `${b}`, input: "choice", choices: [`${a}`, `${b}`] }; },
    clockOClock,
    clockHalf,
    () => { const a = ri(1, 9); return { prompt: "10は □と", q: `10 = ${a} + □`, answer: `${10 - a}`, input: "number" }; },
    seqNextG1,
    () => moneyG1("normal"),
    () => moreLessG1("normal"),
    () => countBy("normal"),
    () => ineqG1("normal"),
  ];
}

/* ===== 5年生の算数（やさしい/ふつう/むずかしい） ===== */
// 分数の同分母たし算
function fracSame(dMin, dMax) {
  const d = ri(dMin, dMax); const a = ri(1, d - 1); const b = ri(1, d - 1);
  const num = a + b; const g = gcd(num, d);
  const ans = num % d === 0 ? `${num / d}` : `${num / g}/${d / g}`;
  return { prompt: "分数のたし算（約分も）", q: `${a}/${d} + ${b}/${d} =`, answer: ans, input: "choice",
    choices: uniqChoices([ans, `${num}/${d}`, `${num}/${d * 2}`, `${a + b}/${d + d}`]) };
}
// 分数の異分母たし算（通分）
function fracDiff() {
  let d1 = ri(2, 6), d2 = ri(2, 6); if (d1 === d2) d2 = d2 % 6 + 1;
  const a = ri(1, d1 - 1), b = ri(1, d2 - 1);
  const L = lcm(d1, d2); const num = a * (L / d1) + b * (L / d2);
  const g = gcd(num, L);
  const ans = num % L === 0 ? `${num / L}` : `${num / g}/${L / g}`;
  return { prompt: "分数のたし算（通分）", q: `${a}/${d1} + ${b}/${d2} =`, answer: ans, input: "choice",
    choices: uniqChoices([ans, `${a + b}/${d1 + d2}`, `${num}/${L}`, `${a + b}/${L}`]) };
}
function fracReduce() {
  const g = ri(2, 6); const base = ri(2, 5); const d0 = ri(base + 1, 8);
  const n = base * g, d = d0 * g; const ans = `${base}/${d0}`;
  return { prompt: "約分しよう", q: `${n}/${d} =`, answer: ans, input: "choice",
    choices: uniqChoices([ans, `${n}/${d}`, `${base + 1}/${d0}`, `${base}/${d0 + 1}`]) };
}
function rectArea(wMax, hMax) {
  const w = ri(3, wMax), h = ri(2, hMax);
  return { prompt: "長方形の面積（cm²）", q: "", svg: rectSVG(w, h, "cm"), answer: `${w * h}`, input: "number",
    why: `長方形の 面積 = たて × よこ。${h} × ${w} = ${w * h}（cm²）。` };
}
function triArea() {
  const base = pick([4, 6, 8, 10, 12]); const height = pick([3, 5, 6, 8, 10]);
  return { prompt: "三角形の面積（cm²）", q: `ていへん ${base}cm、高さ ${height}cm の 三角形の面積は？`, answer: `${base * height / 2}`, input: "number" };
}
// がい数（四捨五入）
function roundG5() {
  const [unit, name, below] = pick([[100, "百", "十"], [1000, "千", "百"]]);
  const n = ri(unit * 2 + 1, unit * 40);
  return { prompt: `がい数（${name}のくらいまで）`, q: `${n} を ${below}のくらいで 四捨五入すると？`,
    answer: `${Math.round(n / unit) * unit}`, input: "number" };
}
// たんいの かんさん
function unitG5() {
  const o = pick([["1m = □cm", "100"], ["1km = □m", "1000"], ["1kg = □g", "1000"], ["1L = □dL", "10"], ["1時間 = □分", "60"], ["1分 = □秒", "60"], ["1cm = □mm", "10"], ["1000g = □kg", "1"]]);
  return { prompt: "たんいの かんさん", q: o[0], answer: o[1], input: "number" };
}
// 直方体の体積
function volumeG5(diff) {
  const m = diff === "hard" ? 9 : 6;
  const a = ri(2, m), b = ri(2, m), c = ri(2, m);
  return { prompt: "直方体の体積（cm³）", q: `たて${a}cm よこ${b}cm 高さ${c}cm の 体積は？`, answer: `${a * b * c}`, input: "number" };
}
// 速さ（道のり）
function speedG5() {
  const v = pick([40, 50, 60, 70, 80]); const t = ri(2, 5);
  return { prompt: "速さ（道のり）", q: `時速${v}kmで ${t}時間 すすむと なんkm？`, answer: `${v * t}`, input: "number" };
}
// 約数の個数
function divisorsG5() {
  const n = pick([6, 8, 12, 16, 18, 20, 24, 28]); let c = 0;
  for (let i = 1; i <= n; i++) if (n % i === 0) c++;
  return { prompt: "やくすうの 数", q: `${n} の やくすうは いくつ ある？`, answer: `${c}`, input: "number" };
}
// 比を かんたんに
function ratioG5() {
  const g = ri(2, 6), a = g * ri(1, 5), b = g * ri(1, 5); const gg = gcd(a, b);
  const ans = `${a / gg}:${b / gg}`;
  return { prompt: "比を かんたんに", q: `${a} : ${b} =`, answer: ans, input: "choice",
    choices: uniqChoices([ans, `${a}:${b}`, `${a / gg}:${b}`, `${b / gg}:${a / gg}`]) };
}
// 分数 × 整数
function fracTimesInt() {
  const d = ri(3, 8), a = ri(1, d - 1), k = ri(2, 5);
  const num = a * k; const g = gcd(num, d);
  const ans = num % d === 0 ? `${num / d}` : `${num / g}/${d / g}`;
  return { prompt: "分数 × 整数", q: `${a}/${d} × ${k} =`, answer: ans, input: "choice",
    choices: uniqChoices([ans, `${num}/${d}`, `${a}/${d * k}`, `${a * k}/${d * k}`]) };
}
function avg3(vMax) {
  const vals = [ri(2, vMax), ri(2, vMax), ri(2, vMax)];
  let sum = vals.reduce((s, v) => s + v, 0); const rem = sum % 3;
  if (rem) vals[0] += (3 - rem); sum = vals.reduce((s, v) => s + v, 0);
  return { prompt: "へいきん", q: `${vals.join(", ")} のへいきんは？`, answer: `${sum / 3}`, input: "number" };
}
// 分数の同分母ひき算
function fracSubSame(dMin, dMax) {
  const d = ri(dMin, dMax); const a = ri(2, d - 1), b = ri(1, a - 1);
  const num = a - b; const g = gcd(num, d);
  const ans = num % d === 0 ? `${num / d}` : `${num / g}/${d / g}`;
  return { prompt: "分数のひき算（約分も）", q: `${a}/${d} - ${b}/${d} =`, answer: ans, input: "choice",
    choices: uniqChoices([ans, `${num}/${d}`, `${a}/${d}`, `${num}/${d * 2}`]) };
}
// 分数の異分母ひき算（通分）
function fracSubDiff() {
  let d1 = ri(2, 6), d2 = ri(2, 6); if (d1 === d2) d2 = d2 % 6 + 1;
  let a = ri(1, d1 - 1), b = ri(1, d2 - 1);
  if (a / d1 < b / d2) { [a, b] = [b, a]; [d1, d2] = [d2, d1]; }   // 引く数が大きくならないように
  const L = lcm(d1, d2); const num = a * (L / d1) - b * (L / d2); const g = gcd(num, L) || 1;
  const ans = num === 0 ? "0" : (num % L === 0 ? `${num / L}` : `${num / g}/${L / g}`);
  return { prompt: "分数のひき算（通分）", q: `${a}/${d1} - ${b}/${d2} =`, answer: ans, input: "choice",
    choices: uniqChoices([ans, `${num}/${L}`, `${a + b}/${L}`, `${a}/${d2}`]) };
}
// 小数のたし算
function decAdd(diff) {
  const hi = diff === "hard" ? 199 : 59;
  const a = ri(11, hi) / 10, b = ri(11, hi) / 10;
  return { prompt: "小数のたし算", q: `${a} + ${b} =`, answer: `${+(a + b).toFixed(1)}`, input: "number" };
}

function mathG5(diff) {
  if (diff === "easy") return [
    () => fracSame(3, 6),
    () => { const a = (ri(11, 29) / 10); const b = ri(2, 5); return { prompt: "小数のかけ算", q: `${a} × ${b} =`, answer: `${+(a * b).toFixed(1)}`, input: "number" }; },
    () => { const base = pick([100, 200, 300]); const p = pick([10, 20, 50]); return { prompt: "割合", q: `${base}の ${p}% は？`, answer: `${base * p / 100}`, input: "number" }; },
    () => rectArea(8, 6),
    () => avg3(8),
    unitG5,
    () => volumeG5("easy"),
    () => decAdd("easy"),
  ];
  if (diff === "hard") return [
    fracDiff,
    () => { const a = (ri(101, 999) / 100); const b = ri(3, 9); return { prompt: "小数のかけ算", q: `${a} × ${b} =`, answer: `${+(a * b).toFixed(2)}`, input: "number" }; },
    () => { const b = ri(3, 9); const q = (ri(15, 40) / 10); const a = +(q * b).toFixed(1); return { prompt: "小数のわり算", q: `${a} ÷ ${b} =`, answer: `${q}`, input: "number" }; },
    () => { const base = pick([120, 150, 180, 240, 250, 320]); const p = pick([15, 25, 35, 40, 75]); return { prompt: "割合（%）", q: `${base}の ${p}% は？`, answer: `${+(base * p / 100).toFixed(2)}`, input: "number" }; },
    () => { const a = ri(6, 12); let b = ri(6, 12); if (b === a) b = 6 + ((b - 5) % 7); return { prompt: "さいしょう公倍数（LCM）", q: `${a} と ${b} の 公倍数で いちばん小さいのは？`, answer: `${lcm(a, b)}`, input: "number" }; },
    () => { const g = ri(3, 8); const k1 = ri(2, 6); let k2 = ri(2, 6); if (k2 === k1) k2 = 2 + (k2 % 5); const a = g * k1, b = g * k2; return { prompt: "さいだい公約数（GCD）", q: `${a} と ${b} の 公約数で いちばん大きいのは？`, answer: `${gcd(a, b)}`, input: "number" }; },
    () => { const base = pick([6, 8, 10, 12, 14]); const height = pick([5, 7, 8, 9, 12]); return { prompt: "三角形の面積（cm²）", q: `ていへん ${base}cm、高さ ${height}cm の 三角形の面積は？`, answer: `${base * height / 2}`, input: "number" }; },
    roundG5,
    speedG5,
    ratioG5,
    divisorsG5,
    () => volumeG5("hard"),
    fracTimesInt,
    fracSubDiff,
    () => decAdd("hard"),
  ];
  // normal
  return [
    () => fracSame(3, 9),
    fracReduce,
    () => { const a = (ri(11, 39) / 10); const b = ri(2, 9); return { prompt: "小数のかけ算", q: `${a} × ${b} =`, answer: `${+(a * b).toFixed(1)}`, input: "number" }; },
    () => { const b = ri(2, 6); const q = (ri(11, 30) / 10); const a = +(q * b).toFixed(1); return { prompt: "小数のわり算", q: `${a} ÷ ${b} =`, answer: `${q}`, input: "number" }; },
    () => { const base = pick([100, 200, 300, 400, 500, 50, 80, 120]); const p = pick([10, 20, 25, 50, 75]); return { prompt: "割合", q: `${base}の ${p}% は？`, answer: `${base * p / 100}`, input: "number" }; },
    () => avg3(10),
    () => { const a = ri(2, 9); let b = ri(2, 9); if (b === a) b = (b % 9) + 2; return { prompt: "さいしょう公倍数（LCM）", q: `${a} と ${b} の 公倍数で いちばん小さいのは？`, answer: `${lcm(a, b)}`, input: "number" }; },
    () => { const g = ri(2, 6); const k1 = ri(2, 5); let k2 = ri(2, 5); if (k2 === k1) k2 = 2 + (k2 % 4); const a = g * k1, b = g * k2; return { prompt: "さいだい公約数（GCD）", q: `${a} と ${b} の 公約数で いちばん大きいのは？`, answer: `${gcd(a, b)}`, input: "number" }; },
    () => rectArea(12, 9),
    triArea,
    roundG5,
    unitG5,
    speedG5,
    ratioG5,
    divisorsG5,
    () => volumeG5("normal"),
    () => fracSubSame(3, 9),
    () => decAdd("normal"),
  ];
}

/* ===== 算数の かいせつ（まちがえた ときに 出す） =====
   問題文から 計算の しかたを 組み立てる。どのパターンにも 当てはまらない ときは null。 */
const UNIT_WHY = {
  "1m = □cm": "1メートル は 100センチメートル。m を cm に するには 100ばい。",
  "1km = □m": "1キロメートル は 1000メートル。km を m に するには 1000ばい。",
  "1kg = □g": "1キログラム は 1000グラム。kg を g に するには 1000ばい。",
  "1L = □dL": "1リットル は 10デシリットル。L を dL に するには 10ばい。",
  "1時間 = □分": "1時間 は 60分。時間 を 分に するには 60ばい。",
  "1分 = □秒": "1分 は 60秒。分 を 秒に するには 60ばい。",
  "1cm = □mm": "1センチメートル は 10ミリメートル。cm を mm に するには 10ばい。",
  "1000g = □kg": "1000グラム で 1キログラム。g を kg に するには 1000で わる。",
};
function mathWhy(it) {
  const q = (it.q || "").trim(), a = it.answer;
  let m;
  if (UNIT_WHY[q]) return UNIT_WHY[q];

  // 3つの たしざん
  if ((m = q.match(/^(\d+) \+ (\d+) \+ (\d+) =$/))) {
    const [x, y, z] = [+m[1], +m[2], +m[3]];
    return `まえから じゅんに たすよ。${x} + ${y} = ${x + y}、${x + y} + ${z} = ${a}。`;
  }
  // たしざん
  if ((m = q.match(/^(\d+) \+ (\d+) =$/))) {
    const x = +m[1], y = +m[2];
    if (x < 10 && y < 10 && x + y > 10) {
      const toTen = 10 - x, rest = y - toTen;
      return `10の まとまりを つくろう。${x} に ${toTen} を たして 10。${y} は ${toTen} と ${rest} だから、10 + ${rest} = ${a}。`;
    }
    if (x >= 10) return `${x} の 1のくらい (${x % 10}) に ${y} を たすよ。${x % 10} + ${y} = ${x % 10 + y} だから ${a}。`;
    return `${x} と ${y} を あわせると ${a}。`;
  }
  // ひきざん
  if ((m = q.match(/^(\d+) - (\d+) =$/))) {
    const x = +m[1], y = +m[2];
    if (x > 10 && y > x % 10) {
      const first = x % 10, rest = y - first;
      return `10 まで もどして かんがえよう。${x} - ${first} = 10、のこり ${rest} を ひいて 10 - ${rest} = ${a}。`;
    }
    if (x >= 10) return `${x} の 1のくらい から ひくよ。${x % 10} - ${y} = ${x % 10 - y} だから ${a}。`;
    return `${x} から ${y} を とると ${a}。`;
  }
  // □に 入る かず
  if ((m = q.match(/^(\d+) \+ □ = (\d+)$/))) return `ぜんぶで ${m[2]}。そこから ${m[1]} を ひくと □ が わかるよ。${m[2]} - ${m[1]} = ${a}。`;
  if ((m = q.match(/^10 = (\d+) \+ □$/))) return `10 は ${m[1]} と ${a} に わけられるよ。10 - ${m[1]} = ${a}。`;
  // 大小
  if ((m = q.match(/^(\d+)\s+と\s+(\d+)$/))) {
    const x = +m[1], y = +m[2];
    return x === y ? `${x} と ${y} は おなじ 大きさだよ。` : `${Math.max(x, y)} の ほうが 大きいよ（${Math.min(x, y)} より 大きい）。`;
  }
  if ((m = q.match(/^(\d+) □ (\d+)$/))) {
    const x = +m[1], y = +m[2];
    if (x > y) return `${x} は ${y} より 大きいから 「>」。口が 大きい ほうを むくよ。`;
    if (x < y) return `${x} は ${y} より 小さいから 「<」。口が 大きい ほうを むくよ。`;
    return `${x} と ${y} は おなじだから 「=」。`;
  }
  // おかね
  if ((m = q.match(/^(\d+)円が (\d+)こで/))) return `${m[1]}円 が ${m[2]}こ だから、${m[1]} × ${m[2]} = ${a}円。`;
  // つぎの かず / ○より大きい・小さい / ○ずつ
  if ((m = q.match(/^(\d+) の つぎの かずは/))) return `${m[1]} の つぎは 1 ふえて ${a}。`;
  if ((m = q.match(/^(\d+)より (\d+) 大きい/))) return `${m[1]} + ${m[2]} = ${a}。`;
  if ((m = q.match(/^(\d+)より (\d+) 小さい/))) return `${m[1]} - ${m[2]} = ${a}。`;
  if ((m = q.match(/^(\d+), (\d+), (\d+), つぎは/))) { const st = +m[2] - +m[1]; return `${st} ずつ ふえているよ。${m[3]} + ${st} = ${a}。`; }
  // 分数
  if ((m = q.match(/^(\d+)\/(\d+) \+ (\d+)\/(\d+) =$/))) {
    const [n1, d1, n2, d2] = [+m[1], +m[2], +m[3], +m[4]];
    if (d1 === d2) return `分母は そのまま。分子どうしを たして ${n1} + ${n2} = ${n1 + n2}、つまり ${n1 + n2}/${d1}。${a === `${n1 + n2}/${d1}` ? "" : `約分して ${a}。`}`;
    const L = lcm(d1, d2);
    return `分母を ${L} に そろえる（通分）。${n1}/${d1} = ${n1 * (L / d1)}/${L}、${n2}/${d2} = ${n2 * (L / d2)}/${L}。たして ${n1 * (L / d1) + n2 * (L / d2)}/${L} → ${a}。`;
  }
  if ((m = q.match(/^(\d+)\/(\d+) - (\d+)\/(\d+) =$/))) {
    const [n1, d1, n2, d2] = [+m[1], +m[2], +m[3], +m[4]];
    if (d1 === d2) return `分母は そのまま。分子どうしを ひいて ${n1} - ${n2} = ${n1 - n2}、つまり ${n1 - n2}/${d1} → ${a}。`;
    const L = lcm(d1, d2);
    return `分母を ${L} に そろえる（通分）。${n1 * (L / d1)}/${L} - ${n2 * (L / d2)}/${L} = ${n1 * (L / d1) - n2 * (L / d2)}/${L} → ${a}。`;
  }
  if ((m = q.match(/^(\d+)\/(\d+) × (\d+) =$/))) return `分子だけに かけるよ。${m[1]} × ${m[3]} = ${+m[1] * +m[3]}、つまり ${+m[1] * +m[3]}/${m[2]} → ${a}。`;
  if ((m = q.match(/^(\d+)\/(\d+) =$/)) && /約分/.test(it.prompt || "")) {
    const g = gcd(+m[1], +m[2]);
    return `分子と分母を さいだい公約数 ${g} で わるよ。${m[1]}÷${g}=${+m[1] / g}、${m[2]}÷${g}=${+m[2] / g} → ${a}。`;
  }
  // 小数
  if ((m = q.match(/^([\d.]+) \+ ([\d.]+) =$/))) return `小数点の いちを そろえて たすよ。${m[1]} + ${m[2]} = ${a}。`;
  if ((m = q.match(/^([\d.]+) × (\d+) =$/))) {
    const x = m[1], dec = (x.split(".")[1] || "").length;
    return `いったん 小数点を とって ${x.replace(".", "")} × ${m[2]} = ${+x.replace(".", "") * +m[2]}。小数点を ${dec}つ もどして ${a}。`;
  }
  if ((m = q.match(/^([\d.]+) ÷ (\d+) =$/))) return `${m[1]} を ${m[2]}つに 分けるよ。${a} × ${m[2]} = ${m[1]} だから、こたえは ${a}。`;
  // 割合・平均
  if ((m = q.match(/^(\d+)の (\d+)% は？$/))) return `${m[2]}% は ${+m[2] / 100}。${m[1]} × ${m[2]} ÷ 100 = ${a}。`;
  if ((m = q.match(/^([\d, ]+) のへいきんは？$/))) {
    const v = m[1].split(",").map(s => +s.trim()); const sum = v.reduce((x, y) => x + y, 0);
    return `ぜんぶ たすと ${v.join(" + ")} = ${sum}。${v.length} で わって ${sum} ÷ ${v.length} = ${a}。`;
  }
  // 公倍数・公約数・約数
  if (/公倍数で いちばん小さい/.test(q) && (m = q.match(/^(\d+) と (\d+)/)))
    return `${m[1]}の倍数：${[1, 2, 3, 4].map(k => +m[1] * k).join(", ")}…／${m[2]}の倍数：${[1, 2, 3, 4].map(k => +m[2] * k).join(", ")}… さいしょに そろうのが ${a}。`;
  if (/公約数で いちばん大きい/.test(q) && (m = q.match(/^(\d+) と (\d+)/))) {
    const divs = n => { const o = []; for (let i = 1; i <= n; i++) if (n % i === 0) o.push(i); return o; };
    return `${m[1]}の約数：${divs(+m[1]).join(", ")}／${m[2]}の約数：${divs(+m[2]).join(", ")}。共通で いちばん 大きいのが ${a}。`;
  }
  if ((m = q.match(/^(\d+) の やくすうは/))) {
    const n = +m[1], o = []; for (let i = 1; i <= n; i++) if (n % i === 0) o.push(i);
    return `${n} の やくすうは ${o.join(", ")} の ${a}こ。`;
  }
  // 面積・体積・速さ・比・がい数
  if ((m = q.match(/ていへん (\d+)cm、高さ (\d+)cm/))) return `三角形の 面積 = ていへん × 高さ ÷ 2。${m[1]} × ${m[2]} ÷ 2 = ${a}。`;
  if ((m = q.match(/たて(\d+)cm よこ(\d+)cm 高さ(\d+)cm/))) return `直方体の 体積 = たて × よこ × 高さ。${m[1]} × ${m[2]} × ${m[3]} = ${a}。`;
  if ((m = q.match(/時速(\d+)kmで (\d+)時間/))) return `道のり = 速さ × 時間。${m[1]} × ${m[2]} = ${a}km。`;
  if ((m = q.match(/^(\d+) : (\d+) =$/))) { const g = gcd(+m[1], +m[2]); return `どちらも さいだい公約数 ${g} で わるよ。${m[1]}÷${g} : ${m[2]}÷${g} = ${a}。`; }
  if ((m = q.match(/^(\d+) を (十|百)のくらいで 四捨五入/))) {
    const unit = m[2] === "十" ? 100 : 1000, n = +m[1];
    const rest = n % unit, half = unit / 2;
    const keep = Math.floor(n / unit) * unit;
    return rest >= half
      ? `${m[2]}のくらいから 下は ${rest}。${half} 以上 なので くり上げて ${keep} + ${unit} = ${a}。`
      : `${m[2]}のくらいから 下は ${rest}。${half} より 小さい ので 切りすてて ${a}。`;
  }
  return null;
}

/* n問ぶん生成（直近に出た問題は しばらく出さない） */
let _mathRecent = [];          // 直近の問題シグネチャ（ラウンドをまたいで保持）
const MATH_WINDOW = 18;        // この数だけは同じ問題を くり返さない
function generateMathSet(grade, n, diff) {
  const gens = grade === "g1" ? mathG1(diff || "normal") : mathG5(diff || "normal");
  const out = [];
  for (let i = 0; i < n; i++) {
    let item, sig, guard = 0;
    do {
      item = pick(gens)();
      sig = (item.prompt || "") + "|" + item.q + "|" + item.answer;
      guard++;
    } while (_mathRecent.includes(sig) && guard < 40);
    _mathRecent.push(sig);
    if (_mathRecent.length > MATH_WINDOW) _mathRecent.shift();
    if (!item.why) item.why = mathWhy(item);
    out.push(item);
  }
  return out;
}
