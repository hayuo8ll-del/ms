/* まいにち スタディ（学習アプリ）の 問題と 復習スケジュールを Node で検算する。
   実行: node scripts/test-study.mjs

   js/data.js・js/generators.js・js/srs.js・js/strokecheck.js は DOM を さわらないので、
   scripts/test-game.mjs と同じ new Function 方式で そのまま 読みこめる。
   算数は 問題文から「自分で 計算しなおした こたえ」と ジェネレーターの こたえを
   くらべる（ジェネレーターの コードを なぞるのではなく、別の 計算で たしかめる）。 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const S = new Function(
  [read("js/data.js"), read("js/generators.js"), read("js/strokes.js"), read("js/srs.js"), read("js/strokecheck.js")].join("\n;\n") +
  "\n; return { DATA, BADGES, SUBJECTS, SHOP, WRITING_SETS, WHY, STROKES, mathG1, mathG5, generateMathSet, generateSimilar, mathWhy, mathMistake," +
  " REVIEW_GAPS, dateKey, daysBetween, addDays, isDue, reviewWrong, reviewCorrect, reviewLeft, dueList, nextDueIn, migrateReview," +
  " svgPathPoints, resampleStroke, strokeRefs, judgeStroke, strokeShift };"
)();

let failed = 0, passed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? "  → " + detail : ""}`); }
}
function section(t) { console.log(`\n\x1b[1m${t}\x1b[0m`); }
/* まちがいを 最大 n こ 見せる */
const show = (arr, n = +(process.env.SHOW || 4)) => arr.slice(0, n).map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" / ") + (arr.length > n ? ` …ほか${arr.length - n}件` : "");

/* ---------- 有理数（分数・小数を 誤差なしで 計算する） ---------- */
const gcd = (a, b) => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const R = (n, d = 1) => { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d) || 1; return { n: n / g, d: d / g }; };
function parseR(s) {
  s = String(s).trim();
  let m;
  if ((m = s.match(/^(\d+)\/(\d+)$/))) return R(+m[1], +m[2]);
  if ((m = s.match(/^(\d+)(?:\.(\d+))?$/))) { const dec = m[2] || ""; return R(+(m[1] + dec), 10 ** dec.length); }
  return null;
}
const add = (a, b) => R(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => R(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a, b) => R(a.n * b.n, a.d * b.d);
const div = (a, b) => R(a.n * b.d, a.d * b.n);
const eqR = (a, b) => a && b && a.n === b.n && a.d === b.d;
const NUM = String.raw`(\d+(?:\.\d+)?(?:\/\d+)?)`;
const UNIT = { "1m = □cm": 100, "1km = □m": 1000, "1kg = □g": 1000, "1L = □dL": 10, "1時間 = □分": 60, "1分 = □秒": 60, "1cm = □mm": 10, "1000g = □kg": 1 };

/* 問題文から こたえを 計算しなおす。わからない 形なら undefined。
   こたえは { r: 有理数 } か { s: 文字列 } で かえす。 */
function solve(it) {
  const q = (it.q || "").trim(), p = it.prompt || "";
  let m;
  if (UNIT[q] !== undefined) return { r: R(UNIT[q]) };
  if ((m = q.match(new RegExp(`^${NUM} ([+\\-×÷]) ${NUM}(?: \\+ ${NUM})? =$`)))) {
    const [a, op, b, c] = [parseR(m[1]), m[2], parseR(m[3]), m[4] && parseR(m[4])];
    let r = op === "+" ? add(a, b) : op === "-" ? sub(a, b) : op === "×" ? mul(a, b) : div(a, b);
    if (c) r = add(r, c);
    return { r };
  }
  if ((m = q.match(/^(\d+)\/(\d+) =$/)) && /約分/.test(p)) return { r: R(+m[1], +m[2]), reduced: true };
  if ((m = q.match(/^(\d+) \+ □ = (\d+)$/))) return { r: R(+m[2] - +m[1]) };
  if ((m = q.match(/^10 = (\d+) \+ □$/))) return { r: R(10 - +m[1]) };
  if ((m = q.match(/^(\d+)\s+と\s+(\d+)$/))) return { s: String(Math.max(+m[1], +m[2])) };
  if ((m = q.match(/^(\d+) □ (\d+)$/))) return { s: +m[1] > +m[2] ? ">" : +m[1] < +m[2] ? "<" : "=" };
  if ((m = q.match(/^(\d+)円が (\d+)こで/))) return { r: R(+m[1] * +m[2]) };
  if ((m = q.match(/^(\d+) の つぎの かずは/))) return { r: R(+m[1] + 1) };
  if ((m = q.match(/^(\d+)より (\d+) 大きい/))) return { r: R(+m[1] + +m[2]) };
  if ((m = q.match(/^(\d+)より (\d+) 小さい/))) return { r: R(+m[1] - +m[2]) };
  if ((m = q.match(/^(\d+), (\d+), (\d+), つぎは/))) return { r: R(2 * +m[3] - +m[2]) };
  if ((m = q.match(/^(\d+)の (\d+)% は？$/))) return { r: R(+m[1] * +m[2], 100) };
  if ((m = q.match(/^([\d, ]+) のへいきんは？$/))) { const v = m[1].split(",").map((x) => +x.trim()); return { r: R(v.reduce((a, b) => a + b, 0), v.length) }; }
  if ((m = q.match(/^(\d+) と (\d+) の 公倍数で いちばん小さい/))) return { r: R((+m[1] * +m[2]) / gcd(+m[1], +m[2])) };
  if ((m = q.match(/^(\d+) と (\d+) の 公約数で いちばん大きい/))) return { r: R(gcd(+m[1], +m[2])) };
  if ((m = q.match(/^(\d+) の やくすうは/))) { let c = 0; for (let i = 1; i <= +m[1]; i++) if (+m[1] % i === 0) c++; return { r: R(c) }; }
  if ((m = q.match(/ていへん (\d+)cm、高さ (\d+)cm/))) return { r: R(+m[1] * +m[2], 2) };
  if ((m = q.match(/たて(\d+)cm よこ(\d+)cm 高さ(\d+)cm/))) return { r: R(+m[1] * +m[2] * +m[3]) };
  if ((m = q.match(/時速(\d+)kmで (\d+)時間/))) return { r: R(+m[1] * +m[2]) };
  if ((m = q.match(/^(\d+) : (\d+) =$/))) { const g = gcd(+m[1], +m[2]); return { s: `${+m[1] / g}:${+m[2] / g}` }; }
  if ((m = q.match(/^(\d+) を (十|百)のくらいで 四捨五入/))) { const u = m[2] === "十" ? 100 : 1000; return { r: R(Math.round(+m[1] / u) * u) }; }
  // 図だけの 問題（時計・長方形）は SVG から 読む
  if (!q && it.svg && /とけい/.test(it.svg)) {
    const lines = [...it.svg.matchAll(/<line x1="100" y1="100" x2="([\d.e-]+)" y2="([\d.e-]+)"/g)].map((x) => [+x[1] - 100, +x[2] - 100]);
    if (lines.length === 2) {
      const ang = ([x, y]) => ((Math.atan2(y, x) * 180) / Math.PI + 90 + 360) % 360;
      const min = Math.round(ang(lines[1]) / 6) % 60, hour = Math.floor((ang(lines[0]) + 0.5) / 30) % 12 || 12;
      return { s: min === 0 ? `${hour}じ` : `${hour}じ${min}ぷん` };
    }
  }
  if (!q && it.svg && /長方形/.test(it.svg)) {
    const w = it.svg.match(/よこ (\d+)/), h = it.svg.match(/たて (\d+)/);
    if (w && h) return { r: R(+w[1] * +h[1]) };
  }
  return undefined;
}

/* ---------- 1. 算数ジェネレーター ---------- */
section("1. 算数ジェネレーター（学年 × むずかしさ × 問題タイプ ごとに 400問ずつ）");
{
  const N = 400;
  const badFrac = [], wrongAns = [], unsolved = [], badChoice = [], badKeypad = [], noWhy = [], whyMiss = [], notReduced = [], simBad = [], hintOnRight = [];
  for (const [grade, mk] of [["g1", S.mathG1], ["g5", S.mathG5]]) {
    for (const diff of ["easy", "normal", "hard"]) {
      const gens = mk(diff);
      gens.forEach((g, gi) => {
        for (let k = 0; k < N; k++) {
          const it = g();
          it.gen = gi; it.genDiff = diff;
          const tag = `${grade}/${diff}#${gi} ${it.prompt || ""} ${it.q || "(図)"} → ${it.answer}`;
          const sol = solve(it);
          if (sol === undefined) { unsolved.push(tag); continue; }
          const right = sol.r ? eqR(sol.r, parseR(it.answer)) : sol.s === it.answer;
          if (!right) wrongAns.push(`${tag}（けいさんでは ${sol.r ? `${sol.r.n}/${sol.r.d}` : sol.s}）`);
          // 分母 1 の 分数（「1/1」など）は 出さない
          if (/\/1(?!\d)/.test(it.q || "") || (it.choices || []).some((x) => /\/1(?!\d)/.test(x))) badFrac.push(tag);
          // 分数の こたえは それ以上 約分できない 形（「約分も」「通分」の 問題・約分問題）
          const fa = String(it.answer).match(/^(\d+)\/(\d+)$/);
          if (fa && gcd(+fa[1], +fa[2]) !== 1) notReduced.push(tag);
          if (it.input === "choice") {
            const c = it.choices || [];
            if (!c.includes(it.answer) || new Set(c).size !== c.length || c.length < 2) badChoice.push(`${tag} ${JSON.stringify(c)}`);
            // ちがう 選択肢が「計算すると 正解と おなじ 値」になっていない（3/6 と 1/2 が 両方 正解、など）
            const ar = parseR(it.answer);
            // ただし「約分」の 問題では「約分しきれていない 形」を わざと まぜている（3/3 や 30/42）ので のぞく
            if (ar && !/約分/.test(it.prompt || "") && c.some((x) => x !== it.answer && eqR(parseR(x), ar))) badChoice.push(`${tag} 値が おなじ 選択肢 ${JSON.stringify(c)}`);
          } else {
            // テンキーで 入力できる こたえ：数字と 小数点だけ、6文字まで（app.js の keypad と おなじ 制限）
            if (!/^\d+(\.\d+)?$/.test(it.answer) || it.answer.length > 6) badKeypad.push(tag);
          }
          const why = it.why || S.mathWhy(it);
          if (!why) noWhy.push(tag);
          else if (!why.includes(String(it.answer).replace(":", " : ")) && !why.includes(String(it.answer))) whyMiss.push(`${tag} 「${why}」`);
          if (S.mathMistake(it, it.answer) !== null) hintOnRight.push(tag);
          if (k < 5) {
            const sim = S.generateSimilar(grade, it);
            if (!sim || sim.gen !== gi || sim.genDiff !== diff || solve(sim) === undefined) simBad.push(tag);
          }
        }
      });
    }
  }
  ok("すべての 問題を 問題文から 計算しなおせる", unsolved.length === 0, show(unsolved));
  ok("こたえが 計算と 一致する", wrongAns.length === 0, show(wrongAns));
  ok("分母が 1 の 分数は 出ない", badFrac.length === 0, show(badFrac));
  ok("分数の こたえは 約分しきった 形", notReduced.length === 0, show(notReduced));
  ok("選択肢に 正解が あり、重複も「値が おなじ」別解も ない", badChoice.length === 0, show(badChoice));
  ok("テンキー問題の こたえは 入力できる 形（数字・小数点、6文字まで）", badKeypad.length === 0, show(badKeypad));
  ok("すべての 問題に とき方（解説）が つく", noWhy.length === 0, show(noWhy));
  ok("解説の 中に 正解が 書かれている", whyMiss.length === 0, show(whyMiss));
  ok("正解を 入れたときに まちがいヒントを 出さない", hintOnRight.length === 0, show(hintOnRight));
  ok("「にた もんだい」は おなじ タイプで 作れる", simBad.length === 0, show(simBad));
}

/* ---------- 2. 算数：generateMathSet ---------- */
section("2. 1ラウンドぶんの 算数（generateMathSet）");
{
  let short = 0, dup = 0, noGen = 0;
  for (const g of ["g1", "g5"]) for (const d of ["easy", "normal", "hard"]) for (let r = 0; r < 60; r++) {
    const set = S.generateMathSet(g, 10, d);
    if (set.length !== 10) short++;
    const sig = set.map((x) => (x.prompt || "") + x.q + x.answer + (x.svg || ""));
    if (new Set(sig).size !== sig.length) dup++;
    if (set.some((x) => x.gen === undefined || !x.why)) noGen++;
  }
  ok("つねに 指定した 問題数が 出る", short === 0);
  ok("1ラウンドの 中で おなじ 問題が かさならない", dup === 0, `${dup}ラウンド`);
  ok("すべての 問題に gen（にた もんだい用）と why が つく", noGen === 0);
}

/* ---------- 3. まちがいヒント ---------- */
section("3. まちがいヒント（mathMistake）");
{
  const H = S.mathMistake;
  ok("くり上がり わすれ（8+5 に 3）→ ひきざんの ヒント", /ひきざん/.test(H({ q: "8 + 5 =", answer: "13" }, "3") || ""));
  ok("くり上がり わすれ（27+6 に 23）→ 10 ずれ", /くり上がり/.test(H({ q: "27 + 6 =", answer: "33" }, "23") || ""));
  ok("くり下がり（23-7 に 26）", /くり下がり/.test(H({ q: "23 - 7 =", answer: "16" }, "26") || ""));
  ok("分母どうしを たした（1/3+1/4 に 2/7）", /分母/.test(H({ q: "1/3 + 1/4 =", answer: "7/12" }, "2/7") || ""));
  ok("小数点の いち（1.2×3 に 36）", /小数点/.test(H({ q: "1.2 × 3 =", answer: "3.6" }, "36") || ""));
  ok("÷2 わすれ（三角形）", /÷ 2/.test(H({ q: "ていへん 6cm、高さ 4cm の 三角形の面積は？", answer: "12" }, "24") || ""));
  ok("見当が つかない ときは 何も 言わない", H({ q: "6 と 8 の 公約数で いちばん大きいのは？", answer: "2" }, "1") === null);
}

/* ---------- 4. 問題データ（国語・英語・クイズ） ---------- */
section("4. 問題データ（DATA）");
{
  const bad = [], dupQ = [], few = [];
  for (const g of Object.keys(S.DATA)) for (const subj of Object.keys(S.DATA[g])) {
    const seen = new Set();
    for (const it of S.DATA[g][subj]) {
      const tag = `${g}/${subj} ${it.q}`;
      if (!it.q || !it.answer || !Array.isArray(it.choices)) { bad.push(tag); continue; }
      if (!it.choices.includes(it.answer) || new Set(it.choices).size !== it.choices.length) bad.push(`${tag} ${JSON.stringify(it.choices)}`);
      if (it.choices.length < 3) few.push(tag);
      if (seen.has(it.q)) dupQ.push(tag);
      seen.add(it.q);
    }
  }
  ok("正解が 選択肢に あり、選択肢に 重複が ない", bad.length === 0, show(bad));
  ok("選択肢は 3つ 以上（「むずかしい」でも えらぶ 意味が ある）", few.length === 0, show(few));
  ok("おなじ 教科に おなじ 問題が 2回 ない", dupQ.length === 0, show(dupQ));
  for (const g of Object.keys(S.SUBJECTS)) {
    const ids = S.SUBJECTS[g].map((s) => s.id);
    ok(`${g}：教科メニューの 教科（算数いがい）に 問題が ある`, ids.filter((i) => i !== "math").every((i) => (S.DATA[g][i] || []).length >= 10));
  }
  const all = Object.values(S.DATA).flatMap((g) => Object.values(g).flat()).map((x) => x.q);
  const stale = Object.keys(S.WHY).filter((k) => !all.some((q) => q.includes(k)));
  ok("WHY（手がきの 解説）の キーが どれかの 問題に 当たる", stale.length === 0, show(stale));
  const multi = Object.keys(S.WHY).filter((k) => all.filter((q) => q.includes(k)).length > 1 && new Set(all.filter((q) => q.includes(k))).size > 1);
  ok("WHY の キーが 2つ以上の ちがう 問題に 当たらない", multi.length === 0, show(multi));
}

/* ---------- 5. そのほかの 定義 ---------- */
section("5. バッジ・ショップ・かきとり");
{
  const uniq = (a) => new Set(a).size === a.length;
  ok("バッジの id が 重複しない", uniq(S.BADGES.map((b) => b.id)));
  ok("アバター・テーマの id が 重複しない", uniq(S.SHOP.avatars.map((a) => a.id)) && uniq(S.SHOP.themes.map((t) => t.id)));
  ok("テーマは どれも おなじ CSS変数を もつ", S.SHOP.themes.every((t) => JSON.stringify(Object.keys(t.vars).sort()) === JSON.stringify(Object.keys(S.SHOP.themes[0].vars).sort())));
  const chars = Object.values(S.WRITING_SETS).flat().flatMap((s) => s.chars.map((c) => c.c));
  const noStroke = [...new Set(chars)].filter((c) => !S.STROKES[c]);
  ok("かきとりの 字に 書き順データが ある", noStroke.length === 0, show(noStroke, 10));
}

/* ---------- 6. 復習スケジュール ---------- */
section("6. にがて復習の スケジュール（js/srs.js）");
{
  const T = "2026-11-3";
  ok("日付の 足し算（月・年 またぎ）", S.addDays("2026-11-29", 3) === "2026-12-2" && S.addDays("2026-12-30", 7) === "2027-1-6");
  ok("日数の 差（うるう年）", S.daysBetween("2028-2-28", "2028-3-1") === 2);
  const w = S.reviewWrong({}, T);
  ok("まちがえた 日に すぐ ふくしゅうできる", S.isDue(w, T) && w.step === 0);
  let r = S.reviewCorrect(w, T);
  ok("1回め 正かい → あした", r.advanced && r.days === 1 && w.due === "2026-11-4");
  r = S.reviewCorrect(w, T);
  ok("予定日 前の 正かいでは 予定が すすまない", !r.advanced && !r.cleared && w.due === "2026-11-4");
  r = S.reviewCorrect(w, "2026-11-4");
  ok("2回め → 3日後", r.days === 3 && w.due === "2026-11-7");
  r = S.reviewCorrect(w, "2026-11-9");        // 予定より おくれても いい
  ok("3回め（おくれて とく）→ その日から 1週間後", r.days === 7 && w.due === "2026-11-16");
  ok("こくふく まで あと 1回", S.reviewLeft(w) === 1);
  r = S.reviewCorrect(w, "2026-11-16");
  ok("4回め（1週間後）で こくふく", r.cleared);
  const v = { step: 2, due: "2026-11-7" };
  S.reviewWrong(v, "2026-11-7");
  ok("とちゅうで まちがえたら さいしょから", v.step === 0 && v.due === "2026-11-7");
  const list = [{ q: "a", due: "2026-11-5" }, { q: "b", due: "2026-11-1" }, { q: "c", due: "2026-11-3" }, { q: "d", due: "2026-11-9" }];
  ok("きょうの ふくしゅうは 予定日の ふるい じゅん", S.dueList(list, T).map((x) => x.q).join("") === "bc");
  ok("つぎの ふくしゅうまでの 日数", S.nextDueIn([{ due: "2026-11-5" }, { due: "2026-11-9" }], T) === 2 && S.nextDueIn([], T) === null);
  const old = S.migrateReview({ q: "x", hits: 1 }, T);
  ok("旧データ（hits）を 変換：きょう 予定・1回 正かい ずみ", old.step === 1 && old.due === T && old.hits === undefined);
}

/* ---------- 7. Service Worker ---------- */
section("7. オフライン用ファイル一覧（sw.js）");
{
  const sw = read("sw.js"), html = read("index.html");
  const assets = [...sw.matchAll(/"\.\/([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
  const missing = assets.filter((a) => !fs.existsSync(path.join(root, a)));
  ok("ASSETS の ファイルが ぜんぶ ある", missing.length === 0, show(missing));
  const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|webmanifest|svg|png))"/g)].map((m) => m[1]);
  const notCached = refs.filter((r) => !assets.includes(r));
  ok("index.html が 読みこむ ファイルは ぜんぶ ASSETS に ある", notCached.length === 0, show(notCached));
}

/* ---------- 8. 書き順チェック ---------- */
section("8. 書き順チェック（js/strokecheck.js）— かきとりの 全文字で、手ぶれ・ずれを くわえて 書かせる");
{
  // 決まった 乱数（毎回 おなじ 結果に なる）
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const shake = (pts, amp, off) => {
    const w = [(rnd() - 0.5) * amp, (rnd() - 0.5) * amp];
    return pts.map((p, i) => [p[0] + off[0] + w[0] * Math.sin((i / pts.length) * 3) + (rnd() - 0.5) * amp * 0.3,
                              p[1] + off[1] + w[1] * Math.cos((i / pts.length) * 3) + (rnd() - 0.5) * amp * 0.3]);
  };
  const chars = [...new Set(Object.values(S.WRITING_SETS).flat().flatMap((st) => st.chars.map((c) => c.c)))];
  let okN = 0, okBad = [], ordN = 0, ordBad = [], revN = 0, revHit = 0;
  for (const off of [[0, 0], [8, -6]]) for (const ch of chars) {
    const ds = S.STROKES[ch]; if (!ds) continue;
    const refs = S.strokeRefs(ds), raw = ds.map((d) => S.svgPathPoints(d)), pairs = [];
    for (let k = 0; k < raw.length; k++) {
      const u = shake(raw[k], 6, off);
      const r = S.judgeStroke(u, refs, k, { tol: 22, shift: S.strokeShift(pairs) });
      okN++;
      if (r.result === "ok") pairs.push([u, refs[k]]); else okBad.push(`${ch} ${k + 1}画め → ${r.result}`);
    }
    if (off[0] === 0) for (let j = 1; j < raw.length; j++) {
      ordN++;
      const r = S.judgeStroke(shake(raw[j], 6, [0, 0]), refs, 0, { tol: 22 });
      if (r.result === "ok") ordBad.push(`${ch}：${j + 1}画めを さきに 書いても OK に なった`);
    }
    const a = raw[0][0], b = raw[0][raw[0].length - 1];
    if (off[0] === 0 && Math.hypot(a[0] - b[0], a[1] - b[1]) > 15) {
      revN++;
      if (S.judgeStroke(shake(raw[0], 6, [0, 0]).reverse(), refs, 0, { tol: 22 }).result === "reverse") revHit++;
    }
  }
  ok(`正しい 書き順なら ぜんぶ OK（${okN}画、字の ずれ あり／なし）`, okBad.length === 0, show(okBad));
  ok(`じゅんばんを かえると OK に しない（${ordN}とおり）`, ordBad.length === 0, show(ordBad));
  ok(`むきが ぎゃくだと 98%以上 見つける（${revHit}/${revN}）`, revHit / revN >= 0.98);
  ok("SVG の パスを 点に できる（相対 c・S を ふくむ）", S.svgPathPoints("M10,10c0,0,10,0,10,10s10,10,10,0").length > 20);
  const line = S.resampleStroke([[0, 0], [10, 0]], 5);
  ok("点を 等間隔に とりなおす", line.length === 5 && Math.abs(line[2][0] - 5) < 1e-9);
  ok("1点だけ（点を うつ）の 画でも こわれない", S.judgeStroke([[50, 50]], S.strokeRefs(S.STROKES["山"]), 0).result !== undefined);
}

/* ---------- 結果 ---------- */
console.log(`\n${failed === 0 ? "\x1b[32m" : "\x1b[31m"}${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
