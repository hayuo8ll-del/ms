/* ===== にがて復習の スケジュール（間隔反復） ===== */
/* 画面（document）にも 時計（new Date）にも ふれない 純粋な 関数だけを おく。
   「きょう」は かならず 引数で もらうので、scripts/test-study.mjs で そのまま 試せる。

   まちがえた 問題は その日の うちに ふくしゅうできる（due = きょう）。
   予定日 いこうに 正かいすると、つぎの 予定日を 「翌日 → 3日後 → 1週間後」と のばし、
   1週間後の ふくしゅうでも 正かいしたら こくふく（にがてリストから はずす）。
   予定日より 前に 正かいしても 予定は すすめない（つめこみでは おぼえた ことに しない）。
   どこかで まちがえたら さいしょから（きょう もういちど）。 */

const REVIEW_GAPS = [1, 3, 7];   // 正かい ごとに あける 日数

/* 日付キーは "2026-11-3" 形式（0うめ なし。保存データの 既存の 形式に あわせる） */
function dateKey(d) { return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function parseKey(k) { const [y, m, d] = String(k).split("-").map(Number); return Date.UTC(y, m - 1, d); }
function daysBetween(a, b) { return Math.round((parseKey(b) - parseKey(a)) / 86400000); }
function addDays(k, n) { const t = new Date(parseKey(k) + n * 86400000); return `${t.getUTCFullYear()}-${t.getUTCMonth() + 1}-${t.getUTCDate()}`; }

/* 予定日が きょう か すぎている */
function isDue(w, today) { return !w.due || daysBetween(w.due, today) >= 0; }
/* まちがえた：さいしょから。きょう もういちど ふくしゅうできる */
function reviewWrong(w, today) { w.step = 0; w.due = today; return w; }
/* 正かいした：{ cleared, advanced, days }
   cleared  … こくふく した（リストから はずしてよい）
   advanced … 予定を すすめた（days 日後に また 出る）
   どちらも false … 予定日 前の 正かい（予定は そのまま） */
function reviewCorrect(w, today) {
  if (!isDue(w, today)) return { cleared: false, advanced: false, days: daysBetween(today, w.due) };
  const step = (w.step || 0) + 1;
  if (step > REVIEW_GAPS.length) return { cleared: true, advanced: true, days: 0 };
  w.step = step;
  w.due = addDays(today, REVIEW_GAPS[step - 1]);
  return { cleared: false, advanced: true, days: REVIEW_GAPS[step - 1] };
}
/* こくふく までに あと 何回 正かいが いるか */
function reviewLeft(w) { return REVIEW_GAPS.length + 1 - (w.step || 0); }
/* きょう ふくしゅうする 問題（予定日の ふるい じゅん） */
function dueList(wrong, today) {
  return wrong.filter(w => isDue(w, today)).sort((a, b) => daysBetween(b.due || today, a.due || today));
}
/* つぎに ふくしゅうが ある 日まで あと 何日（なければ null） */
function nextDueIn(wrong, today) {
  let best = null;
  for (const w of wrong) { const d = w.due ? daysBetween(today, w.due) : 0; if (best === null || d < best) best = d; }
  return best === null ? null : Math.max(0, best);
}
/* 旧データ（hits 方式）を いまの 形式に なおす */
function migrateReview(w, today) {
  if (w.step === undefined) w.step = Math.min(w.hits || 0, 1);
  if (!w.due) w.due = today;
  delete w.hits;
  return w;
}
