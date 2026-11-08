/* ===== まいにち スタディ：本体 ===== */
/* 保存キーは 旧名（natsuyasumi_v1）のまま。変えると これまでの きろくが きえる。 */

const STORE_KEY = "natsuyasumi_v1";
const QUESTIONS_PER_ROUND = 10;
const MAX_WRONG = 100;      // 間隔反復で 長く のこるので 少し 多めに もつ

/* ---------- じょうたい（保存データ） ---------- */
function freshProfile() {
  return {
    coins: 0, streak: 0, lastStudyDate: null,
    badges: [],
    stats: { math: { a: 0, c: 0 }, kokugo: { a: 0, c: 0 }, english: { a: 0, c: 0 }, other: { a: 0, c: 0 } },
    log: [],            // {date, subject, correct, total}
    wrong: [],          // にがて問題のスナップショット
    reviewCleared: 0,   // 復習でこくふくした数
    writeCount: 0,      // かきとりで練習した文字数
    owned: { avatars: ["kid"], themes: ["orange"] },
    avatar: "kid",
    theme: "orange",
    settings: { sound: true, speak: null, perRound: QUESTIONS_PER_ROUND, attackTime: 60, difficulty: "normal", voiceURI: null, dailyGoal: 3, rate: null, praise: true, strokeCheck: true },
    bestAttack: 0,      // タイムアタックの最高正解数
    goalDate: null,     // さいごに「きょうの めあて」を たっせいした日
    goalDays: 0,        // めあてを たっせいした 日数（のべ）
  };
}
const DIFF = { easy: "やさしい", normal: "ふつう", hard: "むずかしい" };
function difficulty() { return prof().settings.difficulty || "normal"; }
function choiceCount(diff) { return diff === "easy" ? 2 : diff === "hard" ? 4 : 3; }
// 旧データに新フィールドを補う
function migrate(p, grade) {
  const d = freshProfile();
  for (const k of Object.keys(d)) if (p[k] === undefined) p[k] = d[k];
  if (p.settings.attackTime === undefined) p.settings.attackTime = 60;
  if (p.settings.difficulty === undefined) p.settings.difficulty = "normal";
  if (p.settings.voiceURI === undefined) p.settings.voiceURI = null;
  if (p.settings.dailyGoal === undefined) p.settings.dailyGoal = 3;
  if (p.settings.rate === undefined) p.settings.rate = null;       // null = 学年の おすすめ（1年 ゆっくり）
  if (p.settings.praise === undefined) p.settings.praise = true;
  if (p.settings.strokeCheck === undefined) p.settings.strokeCheck = true;
  for (const w of p.wrong) migrateReview(w, todayStr());   // 旧「2回正かい」方式 → 間隔反復（js/srs.js）
  if (!p.owned) p.owned = { avatars: ["kid"], themes: ["orange"] };
  if (!p.owned.avatars) p.owned.avatars = ["kid"];
  if (!p.owned.themes) p.owned.themes = ["orange"];
  if (p.settings.speak === undefined || p.settings.speak === null) p.settings.speak = (grade === "g1");
  return p;
}
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.profiles) {
      migrate(s.profiles.g1, "g1"); migrate(s.profiles.g5, "g5");
      return s;
    }
  } catch (e) {}
  const s = { grade: "g1", profiles: { g1: freshProfile(), g5: freshProfile() } };
  s.profiles.g1.settings.speak = true; s.profiles.g5.settings.speak = false;
  return s;
}
function saveState() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }
/* ブラウザが 容量ふそくの ときに きろくを 消さないよう「ずっと 保存」を おねがいする（対応ブラウザのみ） */
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}

let state = loadState();
function prof() { return state.profiles[state.grade]; }

/* ---------- サウンド（Web Audio） ---------- */
let audioCtx = null;
function beep(type) {
  if (!prof().settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const seq = type === "ok" ? [[880, 0], [1320, .09]] : [[300, 0], [200, .12]];
    seq.forEach(([f, t]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f; o.type = "sine";
      o.connect(g); g.connect(audioCtx.destination);
      const s = audioCtx.currentTime + t;
      g.gain.setValueAtTime(.001, s);
      g.gain.exponentialRampToValueAtTime(.25, s + .02);
      g.gain.exponentialRampToValueAtTime(.001, s + .18);
      o.start(s); o.stop(s + .2);
    });
  } catch (e) {}
}

/* ---------- 音声よみあげ（SpeechSynthesis） ---------- */
/* 記号・単位を 日本語として 自然に 読める 文字列に なおす */
// 単位記号 → よみ（英字の かたまり ぜんたいが 一致した ときだけ 置きかえる）
const UNIT_WORDS = {
  km: "キロメートル", cm: "センチメートル", mm: "ミリメートル", m: "メートル",
  kg: "キログラム", g: "グラム", mg: "ミリグラム",
  L: "リットル", dL: "デシリットル", mL: "ミリリットル",
};
// 面積・体積は 英字1文字ずつの 置きかえより 先に 処理する
const AREA_RULES = [
  [/cm²/g, "へいほうセンチメートル"], [/m²/g, "へいほうメートル"],
  [/cm³/g, "りっぽうセンチメートル"], [/m³/g, "りっぽうメートル"],
];
const READ_RULES = [
  // 記号（比は ÷ より 先に 見るが、数字どうしに はさまれた ものだけ）
  [/(\d)\s*[:：]\s*(\d)/g, "$1たい$2"],
  [/\s*\+\s*/g, " たす "], [/\s*×\s*/g, " かける "], [/\s*÷\s*/g, " わる "],
  [/\s*−\s*/g, " ひく "], [/(\d)\s*-\s*(\d)/g, "$1 ひく $2"],
  [/「\s*[=＝]\s*」/g, "「イコール」"],
  [/\s*[=＝]\s*/g, " は "],
  [/□/g, "なに"], [/%/g, "パーセント"],
  [/[＞>]/g, "だいなり"], [/[＜<]/g, "しょうなり"],
  [/\s*[→⇒]\s*/g, "、つぎは "], [/\s*／\s*/g, "。 "], [/\s*：\s*/g, "は "],
  [/(\d)\s*〜\s*(\d)/g, "$1から$2"], [/〜/g, "から"],
  // 「なに＋たんい」は 日本語として「なん〜」と 読む
  [/なに分/g, "なんぷん"], [/なに秒/g, "なんびょう"], [/なに円/g, "なんえん"],
  [/なに時間/g, "なんじかん"], [/なにこ/g, "なんこ"],
  [/[（(]/g, "、"], [/[）)]/g, "、"], [/[・･]/g, "、"],
  // 仕上げ（よみやすさ）
  [/、\s*、/g, "、"], [/。\s*。/g, "。"], [/、\s*。/g, "。"],
  [/([？！?!])\s*。/g, "$1"], [/、\s*」/g, "」"],
];
/* よみあげエンジンが 読みまちがえやすい ことば（長い ものから 先に 置きかえる）。
   「何」は あとに つづく ことばで「なん／なに」が かわるので、ここで 決めておく。 */
const READ_FIX = [
  ["何曜日", "なんようび"], ["何かげつ", "なんかげつ"], ["何という", "なんという"],
  ["何日", "なんにち"], ["何時", "なんじ"], ["何月", "なんがつ"], ["何年", "なんねん"],
  ["何歳", "なんさい"], ["何才", "なんさい"], ["何回", "なんかい"], ["何人", "なんにん"],
  ["何本", "なんぼん"], ["何まい", "なんまい"], ["何びき", "なんびき"], ["何こ", "なんこ"],
  ["何ばい", "なんばい"], ["何円", "なんえん"], ["何分", "なんぷん"], ["何秒", "なんびょう"],
  ["何で", "なにで"], ["何から", "なにから"], ["何を", "なにを"], ["何に", "なにに"],
  ["何いろ", "なにいろ"], ["何色", "なにいろ"], ["何が", "なにが"],
  ["℃", "ど"], ["…", "、"],
];
/* 数字の 読み：前が 数字の ときは 置きかえない（「11日」を「1いちにち」に しない） */
const READ_FIX_NUM = [[/(^|[^0-9.])1しゅうかん/g, "$1いっしゅうかん"], [/(^|[^0-9.])1往復/g, "$1いちおうふく"]];
function fixReading(t) {
  for (const [w, r] of READ_FIX) if (t.includes(w)) t = t.split(w).join(r);
  for (const [re, r] of READ_FIX_NUM) t = t.replace(re, r);
  return t;
}
function toReadable(q) {
  let body = q.q || "";
  // 「よみ／読み」を答える問題は 答えを 先に 言わない：さいしょの「」だけ ふせて、
  // 2つめ以降は 「その中の 字」（例:「団結」の「団」…）。かっこ内の 読みがなも ふせる。
  if (/よみ|読み/.test(body)) {
    let i = 0;
    body = body.replace(/「[^」]*」/g, () => (i++ === 0 ? "この ことば" : " その 字 "));
    body = body.replace(/[（(][^）)]*[）)]/g, "");
  }
  // 見出しの（cm²）（LCM）などの 単位・記号だけの かっこは 読まない
  let head = (q.prompt || "").replace(/[（(][A-Za-z0-9²³%・\s]+[）)]/g, "").trim();
  let t = fixReading((head ? head + "。 " : "") + body);
  t = t.replace(/(\d+)\/(\d+)/g, "$2ぶんの$1");                    // 分数
  for (const [re, rep] of AREA_RULES) t = t.replace(re, rep);      // cm² など（英字置換より先）
  t = t.replace(/[A-Za-z]+/g, w => UNIT_WORDS[w] || w);            // 単位記号（かたまり一致のみ）
  for (const [re, rep] of READ_RULES) t = t.replace(re, rep);
  return t.replace(/\s+/g, " ").trim();
}
/* 日本語と英語の かたまりに 分ける（英単語を 日本語ボイスで 読ませない ため）。
   記号だけの きれはしは 前後の 日本語に くっつけて、ぶつ切りに ならないように する。 */
function splitSpeech(text) {
  const raw = String(text)
    .split(/([A-Za-z][A-Za-z'’.\-]*(?:\s+[A-Za-z][A-Za-z'’.\-]*)*[?!]?)/g)
    .map(s => (s || "").trim())
    .filter(Boolean)
    .map(s => ({ text: s, en: /^[A-Za-z][A-Za-z'’.\-\s]*[?!]?$/.test(s) && /[A-Za-z]{2,}/.test(s) }));
  const out = [];
  for (const seg of raw) {
    const symbolOnly = !seg.en && !/[\p{L}\p{N}]/u.test(seg.text);   // 「 や 。 だけ の きれはし
    const prev = out[out.length - 1];
    if (symbolOnly && prev && !prev.en) { prev.text += seg.text; continue; }
    if (symbolOnly && !prev) continue;                                // 先頭の 「 などは 読まない
    if (!seg.en && prev && !prev.en) { prev.text += seg.text; continue; }
    out.push({ ...seg });
  }
  return out.filter(s => /[\p{L}\p{N}]/u.test(s.text));
}
/* 日本語の音声を列挙し、より自然な（高品質な）ものを優先して選ぶ */
function jaVoices() {
  if (!("speechSynthesis" in window)) return [];
  return speechSynthesis.getVoices().filter(v => /^ja(\b|-|_)/i.test(v.lang) || /japan|日本語/i.test(v.name));
}
// 端末に入っている高品質ボイスの名前（Siriに近い自然なもの）を優先
const PREFERRED_VOICES = [
  "Siri", "Google 日本語", "Kyoko (Enhanced)", "Kyoko (Premium)", "O-ren (Enhanced)", "O-ren (Premium)",
  "O-ren", "Kyoko", "Otoya", "Microsoft Nanami", "Nanami", "Microsoft Ayumi", "Ayumi", "Microsoft Keita", "Sayaka", "Hattori",
];
// Siri系・高品質（拡張/プレミアム/ニューラル）ボイスかどうか
function isNaturalVoice(v) {
  return /Siri|Enhanced|Premium|Neural|Google 日本語|Nanami|O-?ren|Kyoko/i.test(v.name);
}
// おすすめ順（自然な声を先頭）に並べた日本語ボイス
function jaVoicesRanked() {
  const rank = v => {
    const i = PREFERRED_VOICES.findIndex(n => v.name.includes(n));
    return i === -1 ? 999 : i;
  };
  return jaVoices().slice().sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
function chooseVoice() {
  const list = jaVoices();
  if (!list.length) return null;
  const sel = prof().settings.voiceURI;
  if (sel) { const v = list.find(x => x.voiceURI === sel); if (v) return v; }
  for (const name of PREFERRED_VOICES) { const v = list.find(x => x.name.includes(name)); if (v) return v; }
  return list.find(v => v.localService) || list[0];  // 端末内→先頭
}
/* 英語ボイス（英単語の 問題を 日本語ボイスで 読ませない ため） */
function enVoice() {
  if (!("speechSynthesis" in window)) return null;
  const list = speechSynthesis.getVoices().filter(v => /^en(\b|-|_)/i.test(v.lang));
  if (!list.length) return null;
  for (const n of ["Samantha", "Google US English", "Microsoft Aria", "Ava", "Allison", "Daniel"]) {
    const v = list.find(x => x.name.includes(n)); if (v) return v;
  }
  return list.find(v => v.localService) || list[0];
}
/* 日本語と英語が まざった 文を、それぞれの ボイスで 順に 読む */
/* よむ はやさ（保護者メニューで えらぶ。未設定なら 1年＝ゆっくり、5年＝ふつう） */
const RATES = { slow: 0.8, normal: 0.95, fast: 1.12 };
const RATE_LABEL = { slow: "ゆっくり", normal: "ふつう", fast: "はやい" };
function rateKey() { return prof().settings.rate || (state.grade === "g1" ? "slow" : "normal"); }
function speak(text, force, slow) {
  if (!force && !prof().settings.speak) return;
  try {
    if (!("speechSynthesis" in window) || !text) return;
    speechSynthesis.cancel();
    const ja = chooseVoice(), en = enVoice();
    const rate = RATES[rateKey()] * (slow ? 0.72 : 1);   // 🐢 は さらに ゆっくり
    for (const seg of splitSpeech(text)) {
      const u = new SpeechSynthesisUtterance(seg.text);
      const v = seg.en ? en : ja;
      u.lang = seg.en ? (en ? en.lang : "en-US") : (ja ? ja.lang : "ja-JP");
      u.rate = seg.en ? Math.min(slow ? 0.7 : 1.05, rate + 0.03) : rate;
      u.pitch = 1.0;
      // ボイス代入に 失敗しても 読み上げ自体は 続ける
      if (v) { try { u.voice = v; } catch (e) {} }
      speechSynthesis.speak(u);
    }
  } catch (e) {}
}
/* ほめことば・はげまし（毎回 ちがう ことばに する） */
const PRAISE_OK = ["せいかい！", "すごい！", "やったね！", "よく できたね！", "その ちょうし！", "かんぺき！", "いいね！"];
const PRAISE_NG = ["おしい！", "だいじょうぶ！", "ドンマイ！", "もう すこし！"];
function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function praiseOn() { return prof().settings.praise !== false; }
/* 選択肢の ことばを 読める 形に する（記号・単位・英語も なおす） */
function choiceReadable(c) { return toReadable({ q: String(c) }); }
// ボイス一覧は非同期で読み込まれるため、変化時に確保しておく
if ("speechSynthesis" in window) {
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => { speechSynthesis.getVoices(); };
}

/* ---------- 演出 ---------- */
function confetti() {
  const fx = document.getElementById("fx");
  const colors = ["#ff8a3d", "#3aa0ff", "#34c759", "#a06bff", "#ffd23d", "#ff5a5a"];
  for (let i = 0; i < 40; i++) {
    const c = document.createElement("i");
    c.className = "confetti";
    c.style.left = Math.random() * 100 + "vw";
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = Math.random() * .3 + "s";
    fx.appendChild(c);
    setTimeout(() => c.remove(), 1600);
  }
}

/* ---------- 日付ヘルパー ---------- */
/* daysBetween / addDays / dateKey は js/srs.js にある */
function todayStr() { return dateKey(new Date()); }

/* ---------- きょうの めあて（毎日 つづける ための 目ひょう） ---------- */
function roundsToday() { const t = todayStr(); return prof().log.filter(l => l.date === t).length; }
function dailyGoal() { return prof().settings.dailyGoal || 3; }
/* めあてを はじめて たっせいした 瞬間だけ true（ボーナスは 1日1回） */
function checkGoal() {
  const p = prof(), t = todayStr();
  if (p.goalDate === t || roundsToday() < dailyGoal()) return false;
  p.goalDate = t; p.goalDays = (p.goalDays || 0) + 1; p.coins += 15;
  return true;
}
/* つぎに やると いい 教科：正答率が ひくい／しばらく やっていない 教科を えらぶ */
function recommendSubject() {
  const p = prof();
  const last = {};
  p.log.forEach((l, i) => { last[l.subject] = i; });
  let best = null, bestScore = -Infinity;
  for (const s of SUBJECTS[state.grade]) {
    const st = p.stats[s.id];
    const rate = st.a ? st.c / st.a : 0.5;
    const ago = last[s.id] === undefined ? p.log.length + 5 : p.log.length - last[s.id];
    const score = (1 - rate) * 3 + Math.min(ago, 8) * 0.5;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

/* ---------- にがて問題プール ---------- */
function wrongKey(x) { return `${x.subject}|${x.q}|${x.answer}`; }
function addWrong(subject, q) {
  const p = prof();
  const snap = { subject, q: q.q || "", answer: q.answer, choices: q.choices || null,
    prompt: q.prompt || "", svg: q.svg || "", input: q.input || "choice",
    why: q.why || "", gen: q.gen ?? null, genDiff: q.genDiff || null, step: 0, due: todayStr() };
  const same = p.wrong.find(w => wrongKey(w) === wrongKey(snap));
  if (same) { reviewWrong(same, todayStr()); return; }   // また まちがえたら さいしょから
  p.wrong.push(snap);
  if (p.wrong.length > MAX_WRONG) p.wrong.shift();
}
function removeWrong(subject, q) {
  const p = prof();
  const key = `${subject}|${q.q || ""}|${q.answer}`;
  const before = p.wrong.length;
  p.wrong = p.wrong.filter(w => wrongKey(w) !== key);
  return p.wrong.length < before;
}
/* にがて問題に 正かいした。にがてに 入っていなければ null。
   こくふく したら リストから はずす（js/srs.js の reviewCorrect が 予定を きめる） */
function hitWrong(subject, q) {
  const p = prof();
  const key = `${subject}|${q.q || ""}|${q.answer}`;
  const w = p.wrong.find(x => wrongKey(x) === key);
  if (!w) return null;
  const r = reviewCorrect(w, todayStr());
  if (r.cleared) removeWrong(subject, q);
  return r;
}
function dueCount() { return dueList(prof().wrong, todayStr()).length; }
function dayWord(n) { return n <= 0 ? "きょう" : n === 1 ? "あした" : n === 7 ? "1週間ご" : `${n}日ご`; }

/* ---------- 見た目（テーマ／アバター） ---------- */
const THEME_KEYS = Object.keys(SHOP.themes[0].vars);
function applyTheme(id) {
  const t = SHOP.themes.find(x => x.id === id) || SHOP.themes[0];
  const root = document.documentElement;
  THEME_KEYS.forEach(k => root.style.setProperty(k, t.vars[k]));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t.vars["--orange"]);
}
function avatarEmoji(id) { return (SHOP.avatars.find(a => a.id === id) || SHOP.avatars[0]).emoji; }

/* ---------- バッジ判定 ---------- */
function checkBadges(roundResult) {
  const p = prof(); const earned = [];
  const grant = id => { if (!p.badges.includes(id)) { p.badges.push(id); earned.push(id); } };

  grant("first");
  if (p.streak >= 3) grant("streak3");
  if (p.streak >= 7) grant("streak7");
  if (roundResult && roundResult.correct === roundResult.total) grant("perfect");
  if (p.coins >= 100) grant("coins100");
  if (p.coins >= 500) grant("coins500");
  if (p.stats.math.a >= 50) grant("math50");
  if (["math", "kokugo", "english", "other"].every(s => p.stats[s].a > 0)) grant("allsubj");
  if (p.reviewCleared >= 10) grant("review10");
  if (p.owned.avatars.length + p.owned.themes.length > 2) grant("shopper");
  if (p.writeCount >= 20) grant("writer");
  if ((p.goalDays || 0) >= 1) grant("goal1");
  if ((p.goalDays || 0) >= 10) grant("goal10");
  if (p.bestAttack >= 15) grant("speed");
  return earned;
}

/* ---------- 画面ユーティリティ ---------- */
const screen = () => document.getElementById("screen");
function render(html) {
  closeMemo();
  document.documentElement.classList.remove("write-lock");   // かきとりの 全画面シートを ぬけた
  screen().innerHTML = html; window.scrollTo(0, 0);
}
function refreshTop() {
  const coinEl = document.getElementById("coinCount");
  const before = +coinEl.textContent || 0;
  if (prof().coins > before) {                 // コインが ふえたら ぴょこっと
    const chip = coinEl.closest(".stat");
    if (chip) { chip.classList.remove("bumped"); void chip.offsetWidth; chip.classList.add("bumped"); }
  }
  coinEl.textContent = prof().coins;
  document.getElementById("streakCount").textContent = prof().streak;
  document.getElementById("gradePill").textContent =
    (state.grade === "g1" ? "1年生 " : "5年生 ") + avatarEmoji(prof().avatar);
  applyTheme(prof().theme);
}

/* ========== 画面：グレード選択 ========== */
function showGradeSelect() {
  clearAttackTimer();
  render(`
    <h1 class="title">だれが べんきょうする？ 🌻</h1>
    <p class="subtitle">まいにち すこしずつ、いっしょに たのしく べんきょうしよう！</p>
    <div class="grade-choose">
      <button class="card grade-card" data-grade="g1">
        <span class="emoji">🧒</span><span class="name">1年生</span>
        <span class="desc">たしざん・ひらがな・えいご</span>
      </button>
      <button class="card grade-card" data-grade="g5">
        <span class="emoji">🧑‍🎓</span><span class="name">5年生</span>
        <span class="desc">分数・漢字・都道府県</span>
      </button>
    </div>
  `);
  screen().querySelectorAll("[data-grade]").forEach(b =>
    b.onclick = () => { state.grade = b.dataset.grade; saveState(); refreshTop(); showHome(); });
}

/* ========== 画面：ホーム（教科えらび） ========== */
function showHome() {
  clearAttackTimer();
  refreshTop();
  const p = prof();
  const subjects = SUBJECTS[state.grade];
  const cards = subjects.map(s => `
    <button class="card" data-subject="${s.id}">
      <span class="emoji">${s.emoji}</span>
      <span class="name">${s.name}</span>
      <span class="desc">${s.desc}</span>
    </button>`).join("");

  const hour = new Date().getHours();
  const hello = hour < 11 ? "おはよう！" : hour < 18 ? "こんにちは！" : "こんばんは！";
  const streakMsg = p.streak > 0 ? `🔥 ${p.streak}日れんぞく つづいてるよ` : "きょうから はじめよう";
  const due = dueCount(), nextIn = nextDueIn(p.wrong, todayStr());
  const reviewTile = due > 0 ? `
    <button class="tile warn full" id="reviewBtn">
      <span class="t-emoji">🩹</span>
      <span><span class="t-name">きょうの ふくしゅう</span><span class="t-sub">${due}問 まってるよ（にがて ぜんぶで ${p.wrong.length}問）</span></span>
    </button>` : p.wrong.length > 0 ? `
    <button class="tile full" id="reviewBtn">
      <span class="t-emoji">📅</span>
      <span><span class="t-name">きょうの ふくしゅうは おわり！</span><span class="t-sub">つぎは ${dayWord(nextIn)}。いま れんしゅう しても OK（${p.wrong.length}問）</span></span>
    </button>` : "";

  const done = roundsToday(), goal = dailyGoal();
  const rec = recommendSubject();
  const dots = Array.from({ length: goal }, (_, i) => `<i class="${i < done ? "on" : ""}"></i>`).join("");
  const goalCard = `
    <div class="goal-card ${done >= goal ? "clear" : ""}">
      <div class="goal-main">
        <div class="goal-title">${done >= goal ? "🎉 きょうの めあて たっせい！" : "🎯 きょうの めあて"}</div>
        <div class="goal-sub">${done >= goal
          ? `${done}かい べんきょうしたよ。あしたも まってるね！`
          : `あと <b>${goal - done}かい</b> で たっせい（ボーナス +15🪙）`}</div>
        <div class="goal-dots" aria-label="${done}/${goal}">${dots}</div>
      </div>
      ${rec ? `<button class="goal-rec" id="recBtn"><span class="goal-rec-label">おすすめ</span><span class="goal-rec-emoji">${rec.emoji}</span><span class="goal-rec-name">${rec.name}</span></button>` : ""}
    </div>`;

  render(`
    <div class="hero">
      <div class="hero-avatar">${avatarEmoji(p.avatar)}</div>
      <div class="hero-text">
        <div class="hero-hello">${hello} ${state.grade === "g1" ? "1年生" : "5年生"}さん</div>
        <div class="hero-sub">${streakMsg}</div>
      </div>
    </div>
    ${goalCard}
    <div class="diff-select">
      <span class="diff-label">むずかしさ</span>
      <div class="seg">
        ${["easy", "normal", "hard"].map(k => `<button class="seg-btn ${difficulty() === k ? "on" : ""}" data-diff="${k}">${DIFF[k]}</button>`).join("")}
      </div>
    </div>

    <div class="section-label">きょうの べんきょう</div>
    <div class="grid">${cards}</div>

    <div class="section-label">チャレンジ</div>
    <div class="tile-row">
      <button class="tile accent" id="attackBtn">
        <span class="t-emoji">⏱️</span>
        <span><span class="t-name">タイムアタック</span><span class="t-sub">コイン2ばい！</span></span>
      </button>
      <button class="tile" id="writeBtn">
        <span class="t-emoji">✍️</span>
        <span><span class="t-name">かきとり</span><span class="t-sub">書き順も みられる</span></span>
      </button>
      ${reviewTile}
    </div>

    <div class="chip-row">
      <button class="chip" id="badgeBtn">🏅 バッジ ${p.badges.length}/${BADGES.length}</button>
      <button class="chip" id="shopBtn">🛍️ ショップ</button>
    </div>
  `);
  screen().querySelectorAll("[data-subject]").forEach(b =>
    b.onclick = () => startRound(b.dataset.subject));
  screen().querySelectorAll("[data-diff]").forEach(b =>
    b.onclick = () => { prof().settings.difficulty = b.dataset.diff; saveState(); showHome(); });
  if (rec) document.getElementById("recBtn").onclick = () => startRound(rec.id);
  document.getElementById("attackBtn").onclick = showAttackMenu;
  document.getElementById("writeBtn").onclick = showWritingMenu;
  document.getElementById("badgeBtn").onclick = showBadges;
  document.getElementById("shopBtn").onclick = showShop;
  if (p.wrong.length > 0) document.getElementById("reviewBtn").onclick = () => startReview(due > 0);
}

/* ========== ラウンド（クイズ） ========== */
let round = null;
let attackTimer = null;
function clearAttackTimer() {
  if (attackTimer) { clearInterval(attackTimer); attackTimer = null; }
  if (round && round.nextTimer) { clearTimeout(round.nextTimer); round.nextTimer = null; }
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

/* 選択問題の抽選：直近に出した問題（バンクの約7割）は出さない。
   → くり返しの間隔が つねに大きく、ほぼ全問を回ってから 再登場する。
   状態は (grade:subject) ごとに保持し、ラウンド・タイムアタックをまたいで連続する。 */
const _recent = {};
function drawFromBank(grade, subject, n) {
  const key = grade + ":" + subject;
  const bank = DATA[grade][subject];
  const avoid = Math.min(bank.length - 2, Math.round(bank.length * 0.7)); // これだけ 直近は避ける
  const recent = _recent[key] || (_recent[key] = []);
  const out = [];
  for (let k = 0; k < n; k++) {
    let pool = bank.filter(it => !recent.includes(it.q));
    if (!pool.length) pool = bank;                       // 念のため
    const item = pool[Math.floor(Math.random() * pool.length)];
    recent.push(item.q);
    while (recent.length > avoid) recent.shift();
    out.push(item);
  }
  return out;
}

function startRound(subject) {
  clearAttackTimer();
  const n = prof().settings.perRound || QUESTIONS_PER_ROUND;
  let questions;
  if (subject === "math") {
    questions = generateMathSet(state.grade, n, difficulty());
  } else {
    questions = drawFromBank(state.grade, subject, n).map(x => ({ ...x, input: "choice" }));
  }
  round = { subject, questions, idx: 0, correct: 0, current: "", locked: false, review: false };
  showQuestion();
}
/* onlyDue = true：きょう 予定の 問題（ふるい じゅん）。false：予定に かかわらず れんしゅう（予定は すすまない） */
function startReview(onlyDue = true) {
  clearAttackTimer();
  const p = prof();
  const n = p.settings.perRound || QUESTIONS_PER_ROUND;
  const pool = onlyDue ? dueList(p.wrong, todayStr()) : shuffle(p.wrong.slice());
  const questions = shuffle(pool.slice(0, Math.min(n, pool.length)).map(w => ({ ...w })));
  if (!questions.length) { showHome(); return; }
  round = { subject: "review", questions, idx: 0, correct: 0, current: "", locked: false, review: true, onlyDue };
  showQuestion();
}

/* ========== タイムアタック ========== */
function showAttackMenu() {
  clearAttackTimer();
  const p = prof();
  const subs = SUBJECTS[state.grade];
  const cards = subs.map(s => `
    <button class="card" data-atk="${s.id}">
      <span class="emoji">${s.emoji}</span><span class="name">${s.name}</span>
    </button>`).join("");
  render(`
    <h1 class="title">タイムアタック ⏱️</h1>
    <p class="subtitle">${p.settings.attackTime}秒で なんもん とけるかな？<br>正かいで <b>コイン2ばい</b>＋コンボボーナス！</p>
    <p class="subtitle" style="margin-top:4px">これまでの さいこう記録：<b>${p.bestAttack}問</b> 🏅</p>
    <p class="subtitle">教科を えらんでね</p>
    <div class="grid">${cards}</div>
    <button class="big-btn ghost" id="mixBtn">🎲 ぜんぶ ミックス</button>
    <button class="big-btn" id="backBtn">もどる</button>
  `);
  screen().querySelectorAll("[data-atk]").forEach(b => b.onclick = () => startTimeAttack(b.dataset.atk));
  document.getElementById("mixBtn").onclick = () => startTimeAttack("mix");
  document.getElementById("backBtn").onclick = showHome;
}

function buildAttackQuestions(subject, n) {
  const grade = state.grade;
  const asChoice = (arr, subj) => arr.map(x => ({ ...x, input: "choice", subject: subj }));
  if (subject === "math") {
    return generateMathSet(grade, n, difficulty()).map(q => ({ ...q, subject: "math" }));
  }
  if (subject === "mix") {
    // 算数＋各教科を まぜる（各教科は重複なしの全問、算数は多めに生成）
    let pool = generateMathSet(grade, 40, difficulty()).map(q => ({ ...q, subject: "math" }));
    for (const s of ["kokugo", "english", "other"]) {
      pool = pool.concat(asChoice(shuffle(DATA[grade][s].slice()), s));
    }
    return shuffle(pool).slice(0, n);
  }
  // 単一教科：袋引きで バンク全部を 出し切ってから 次サイクル（重複が固まらない）
  return asChoice(drawFromBank(grade, subject, n), subject);
}

function startTimeAttack(subject) {
  clearAttackTimer();
  const p = prof();
  const secs = p.settings.attackTime || 60;
  const questions = buildAttackQuestions(subject, 120);
  round = {
    subject, timed: true, questions, idx: 0, correct: 0, combo: 0, maxCombo: 0,
    current: "", locked: false, review: false, ended: false,
    timeTotal: secs * 1000, timeLeft: secs * 1000, endAt: Date.now() + secs * 1000,
  };
  showQuestion();
  attackTimer = setInterval(() => {
    round.timeLeft = Math.max(0, round.endAt - Date.now());
    const bar = document.getElementById("taBar");
    const sec = document.getElementById("taSec");
    if (bar) bar.style.width = (round.timeLeft / round.timeTotal) * 100 + "%";
    if (sec) { const s = Math.ceil(round.timeLeft / 1000); sec.textContent = s; sec.classList.toggle("urgent", s <= 10); }
    const combo = document.getElementById("combo");
    if (combo) combo.textContent = round.combo >= 3 ? `🔥 ${round.combo} コンボ！` : "";
    if (round.timeLeft <= 0) finishTimeAttack();
  }, 100);
}

function finishTimeAttack() {
  if (round.ended) return;
  round.ended = true;
  clearAttackTimer();
  const p = prof();
  const base = round.correct * 10;
  const doubled = base * 2;                         // コイン2倍
  const comboBonus = (round.maxCombo || 0) * 5;     // コンボボーナス
  const gained = doubled + comboBonus;
  p.coins += gained;

  const isBest = round.correct > p.bestAttack;
  if (isBest) p.bestAttack = round.correct;

  const today = todayStr();
  if (p.lastStudyDate !== today) {
    if (p.lastStudyDate && daysBetween(p.lastStudyDate, today) === 1) p.streak++;
    else p.streak = 1;
    p.lastStudyDate = today;
  }
  const newBadges = checkBadges(null);
  saveState(); refreshTop();
  if (round.correct >= 8) confetti();

  const badgeHtml = newBadges.map(id => {
    const b = BADGES.find(x => x.id === id);
    return `<div class="badge-pop">🎊 あたらしいバッジ ${b.emoji} 「${b.name}」ゲット！</div>`;
  }).join("");

  render(`
    <div class="result">
      <div class="big-emoji">⏱️</div>
      <div class="score">${round.correct}問 せいかい！</div>
      ${isBest ? `<div class="badge-pop">🏅 じこ さいこう記録こうしん！</div>` : ""}
      <div class="reward">
        コイン ${base}×2 = ${doubled}🪙${comboBonus ? `<br>コンボボーナス（さいだい${round.maxCombo}）+${comboBonus}🪙` : ""}<br>
        <b>ごうけい ${gained}🪙 ゲット！</b>
      </div>
      ${badgeHtml}
      <button class="big-btn green" id="againBtn">もういちど チャレンジ</button>
      <button class="big-btn blue" id="menuBtn">教科を かえる</button>
      <button class="big-btn ghost" id="homeBtn2" style="margin-top:10px">ホームに もどる</button>
    </div>
  `);
  document.getElementById("againBtn").onclick = () => startTimeAttack(round.subject);
  document.getElementById("menuBtn").onclick = showAttackMenu;
  document.getElementById("homeBtn2").onclick = showHome;
}

function subjectName(id) {
  if (id === "review") return "ふくしゅう";
  if (id === "mix") return "ミックス";
  return (SUBJECTS[state.grade].find(s => s.id === id) || {}).name || id;
}

function showQuestion() {
  const q = round.questions[round.idx];
  const total = round.questions.length;
  const pct = (round.idx / total) * 100;

  let choices = q.choices ? [...q.choices] : null;
  if (choices) {
    const cnt = choiceCount(difficulty());
    if (choices.length > cnt) {
      const others = shuffle(choices.filter(c => c !== q.answer)).slice(0, cnt - 1);
      choices = [q.answer, ...others];
    }
    shuffle(choices);
  }

  const bodyChoice = choices ? `
    <div class="choices">
      ${choices.map(c => `<button class="choice" data-choice="${encodeURIComponent(c)}">${c}</button>`).join("")}
    </div>
    ${round.timed ? "" : `<p class="choice-hint">🔊 こたえを ながおし すると よみあげるよ</p>`}` : "";

  const bodyNumber = q.input === "number" ? `
    <div class="answer-box" id="answerBox"></div>
    <div class="keypad">
      ${[1,2,3,4,5,6,7,8,9].map(n => `<button class="key" data-k="${n}">${n}</button>`).join("")}
      <button class="key del" data-k="del">⌫</button>
      <button class="key" data-k="0">0</button>
      <button class="key" data-k="dot">・</button>
      <button class="key ok" data-k="ok">こたえる</button>
    </div>` : "";

  const label = q.extra ? "🔁 れんしゅう" : round.review ? "🩹 ふくしゅう" : subjectName(round.subject);
  const head = round.timed
    ? `<div class="quiz-head">
         <span class="qnum">⚡${round.correct}問</span>
         <div class="ta-bar"><i id="taBar" style="width:${(round.timeLeft / (round.timeTotal)) * 100}%"></i></div>
         <span class="qnum ta-sec" id="taSec">${Math.ceil(round.timeLeft / 1000)}</span>
       </div>
       ${round.combo >= 3 ? `<div class="combo" id="combo">🔥 ${round.combo} コンボ！</div>` : `<div class="combo" id="combo"></div>`}`
    : `<div class="quiz-head">
         <span class="qnum">${round.idx + 1}/${total}</span>
         <div class="progress"><i style="width:${pct}%"></i></div>
         <span class="qnum">${label}</span>
       </div>`;
  render(`
    ${head}
    <div class="question-card">
      <button class="speak-btn" id="speakBtn" title="よみあげ" aria-label="よみあげ">🔊</button>
      <button class="speak-btn slow" id="slowBtn" title="ゆっくり よみあげ" aria-label="ゆっくり よみあげ">🐢</button>
      ${q.prompt ? `<div class="prompt">${q.prompt}</div>` : ""}
      ${q.svg || ""}
      ${q.q ? `<div class="q ${q.q.length > 12 ? "small" : ""}">${q.q}</div>` : ""}
    </div>
    ${bodyChoice}${bodyNumber}
    <div class="feedback" id="feedback"></div>
    <button class="memo-toggle" id="memoToggle">✏️ メモを ひらく（ひろい 自由帳）</button>
  `);

  round.locked = false; round.current = "";
  document.getElementById("speakBtn").onclick = () => speak(toReadable(q), true);
  document.getElementById("slowBtn").onclick = () => speak(toReadable(q), true, true);
  if (choices) {
    screen().querySelectorAll("[data-choice]").forEach(b => {
      const v = decodeURIComponent(b.dataset.choice);
      setupLongPress(b, () => speak(choiceReadable(v), true));
      b.onclick = () => { if (b.dataset.lp === "1") { b.dataset.lp = ""; return; } answerChoice(b, v); };
    });
  } else {
    screen().querySelectorAll("[data-k]").forEach(b => b.onclick = () => keypad(b.dataset.k));
  }
  resetMemo(q);
  document.getElementById("memoToggle").onclick = () => openMemo(q);
  speak(toReadable(q)); // 自動よみあげ（設定オン時）
}

/* ========== けいさんメモ（ぜんがめんの 自由帳） ==========
   ページの 中に キャンバスを おくと、2本ゆびの ピンチや スクロールが ブラウザの
   ズーム・ページスクロールに とられて 書きにくい。そこで メモは 画面の 上に かぶさる
   専用シートに して、ジェスチャーを ぜんぶ アプリが 受けとる：
     1本ゆび … 書く（✋モードでは うごかす）　2本ゆび … ひろげる／ちぢめる／うごかす
     マウスホイール … スクロール（Ctrl/⌘＋ホイールで ズーム）
   線は「点の ならび」で 保存して ズームの たびに かきなおすので、拡大しても ぼやけない。
   メモは 問題ごとに まっさら。とじても その問題の あいだは のこる。 */
const MEMO_W = 1000, MEMO_H = 1400, MEMO_GRID = 40, MEMO_MIN = 0.35, MEMO_MAX = 4;
const MEMO_PENS = [
  { id: "blue", color: "#2b6ad4", label: "あお" },
  { id: "red", color: "#e0453a", label: "あか" },
  { id: "black", color: "#2f2417", label: "くろ" },
];
const memo = {
  strokes: [], q: null, open: false, built: false,
  s: 1, ox: 0, oy: 0, tool: "pen", pen: "blue",
  pts: new Map(), cur: null, pan: null, pinch: null, blocked: false,
};
function resetMemo(q) {
  memo.q = q; memo.strokes = []; memo.cur = null;
  memo.s = 1; memo.ox = 0; memo.oy = 0;
}
function memoEls() {
  return {
    sheet: document.getElementById("memoSheet"), stage: document.getElementById("memoStage"),
    grid: document.getElementById("memoGrid"), ink: document.getElementById("memoInk"),
  };
}
function buildMemo() {
  if (memo.built) return;
  memo.built = true;
  const el = document.createElement("div");
  el.id = "memoSheet"; el.className = "memo-sheet"; el.hidden = true;
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "けいさんメモ");
  el.innerHTML = `
    <div class="memo-top">
      <div class="memo-q" id="memoQ"></div>
      <button class="memo-close" id="memoClose">✅ とじて こたえる</button>
    </div>
    <div class="memo-stage" id="memoStage">
      <canvas id="memoGrid" class="memo-layer"></canvas>
      <canvas id="memoInk" class="memo-layer"></canvas>
      <div class="memo-zoom">
        <button class="memo-zbtn" data-z="in" aria-label="おおきく">＋</button>
        <button class="memo-zbtn memo-pct" data-z="reset" id="memoPct" aria-label="100%に もどす">100%</button>
        <button class="memo-zbtn" data-z="out" aria-label="ちいさく">−</button>
        <button class="memo-zbtn" data-z="all" aria-label="ぜんたいを みる">⤢</button>
      </div>
      <div class="memo-help" id="memoHelp">1本ゆびで かく ／ 2本ゆびで ひろげる・うごかす</div>
    </div>
    <div class="memo-tools" role="toolbar" aria-label="メモの どうぐ">
      ${MEMO_PENS.map(p => `<button class="memo-tool" data-pen="${p.id}" aria-label="${p.label}ペン"><i class="memo-dot" style="background:${p.color}"></i><span>${p.label}</span></button>`).join("")}
      <button class="memo-tool" data-tool="eraser" aria-label="けしゴム"><b>🧽</b><span>けす</span></button>
      <button class="memo-tool" data-tool="hand" aria-label="うごかす"><b>✋</b><span>うごかす</span></button>
      <button class="memo-tool" data-act="undo" aria-label="ひとつ もどす"><b>↩️</b><span>もどす</span></button>
      <button class="memo-tool" data-act="clear" aria-label="ぜんぶ けす"><b>🗑️</b><span>ぜんぶ</span></button>
    </div>`;
  document.body.appendChild(el);

  // ブラウザの ズーム・スクロール・ダブルタップ拡大を シートの 中では とめる
  const stop = e => e.preventDefault();
  el.addEventListener("touchmove", stop, { passive: false });
  el.addEventListener("gesturestart", stop);
  el.addEventListener("gesturechange", stop);
  el.addEventListener("dblclick", stop);

  document.getElementById("memoClose").onclick = () => closeMemo();
  el.querySelectorAll("[data-pen]").forEach(b => b.onclick = () => { memo.tool = "pen"; memo.pen = b.dataset.pen; memoToolbar(); });
  el.querySelectorAll("[data-tool]").forEach(b => b.onclick = () => { memo.tool = b.dataset.tool; memoToolbar(); });
  el.querySelector('[data-act="undo"]').onclick = () => { memo.strokes.pop(); memoDraw(); };
  el.querySelector('[data-act="clear"]').onclick = () => { if (memo.strokes.length) { memo.strokes = []; memoDraw(); } };
  el.querySelectorAll("[data-z]").forEach(b => b.onclick = () => {
    const { stage } = memoEls(), cx = stage.clientWidth / 2, cy = stage.clientHeight / 2;
    const z = b.dataset.z;
    if (z === "in") memoZoomAt(memo.s * 1.25, cx, cy);
    else if (z === "out") memoZoomAt(memo.s / 1.25, cx, cy);
    else if (z === "reset") memoZoomAt(1, cx, cy);
    else { memo.s = Math.max(MEMO_MIN, Math.min(stage.clientWidth / MEMO_W, stage.clientHeight / MEMO_H)); memo.ox = 0; memo.oy = 0; memoClamp(); memoDraw(); }
  });

  const stage = document.getElementById("memoStage");
  stage.addEventListener("pointerdown", memoDown);
  stage.addEventListener("pointermove", memoMove);
  stage.addEventListener("pointerup", memoUp);
  stage.addEventListener("pointercancel", memoUp);
  stage.addEventListener("contextmenu", e => e.preventDefault());
  stage.addEventListener("wheel", e => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) memoZoomAt(memo.s * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    else { memo.ox += e.deltaX / memo.s; memo.oy += e.deltaY / memo.s; memoClamp(); memoDraw(); }
  }, { passive: false });
  window.addEventListener("resize", () => { if (memo.open) memoResize(); });
  document.addEventListener("keydown", e => { if (memo.open && e.key === "Escape") closeMemo(); });
}
function memoToolbar() {
  const { sheet } = memoEls();
  sheet.querySelectorAll("[data-pen]").forEach(b => b.classList.toggle("on", memo.tool === "pen" && memo.pen === b.dataset.pen));
  sheet.querySelectorAll("[data-tool]").forEach(b => b.classList.toggle("on", memo.tool === b.dataset.tool));
  memoEls().stage.dataset.tool = memo.tool;
}
function openMemo(q) {
  buildMemo();
  const { sheet } = memoEls();
  const qq = q || memo.q || {};
  document.getElementById("memoQ").innerHTML =
    `${qq.prompt ? `<span class="memo-q-p">${qq.prompt}</span>` : ""}${qq.svg ? `<span class="memo-q-svg">${qq.svg}</span>` : ""}${qq.q ? `<span class="memo-q-t">${qq.q}</span>` : ""}`;
  sheet.hidden = false;
  memo.open = true;
  document.documentElement.classList.add("memo-lock");
  memoToolbar();
  memoResize();
  document.getElementById("memoHelp").classList.toggle("gone", memo.strokes.length > 0);
}
function closeMemo() {
  if (!memo.open) return;
  memo.open = false; memo.pts.clear(); memo.cur = null; memo.pinch = null; memo.pan = null;
  memoEls().sheet.hidden = true;
  document.documentElement.classList.remove("memo-lock");
  const t = document.getElementById("memoToggle");
  if (t) t.textContent = memo.strokes.length ? "✏️ メモを ひらく（かきかけ あり）" : "✏️ メモを ひらく（ひろい 自由帳）";
}
function memoResize() {
  const { stage, grid, ink } = memoEls();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const c of [grid, ink]) {
    c.width = Math.max(1, Math.round(stage.clientWidth * dpr));
    c.height = Math.max(1, Math.round(stage.clientHeight * dpr));
  }
  memo.dpr = dpr;
  memoClamp(); memoDraw();
}
/* 紙の そとへ 行きすぎない ように する（紙が 画面より 小さい ときは まんなかに） */
function memoClamp() {
  const { stage } = memoEls();
  const vw = stage.clientWidth / memo.s, vh = stage.clientHeight / memo.s;
  const pad = 40;
  memo.ox = vw >= MEMO_W ? (MEMO_W - vw) / 2 : Math.min(Math.max(memo.ox, -pad), MEMO_W - vw + pad);
  memo.oy = vh >= MEMO_H ? (MEMO_H - vh) / 2 : Math.min(Math.max(memo.oy, -pad), MEMO_H - vh + pad);
}
function memoZoomAt(ns, sx, sy) {
  ns = Math.max(MEMO_MIN, Math.min(MEMO_MAX, ns));
  const wx = memo.ox + sx / memo.s, wy = memo.oy + sy / memo.s;   // 指の 下の 点を 動かさない
  memo.s = ns; memo.ox = wx - sx / ns; memo.oy = wy - sy / ns;
  memoClamp(); memoDraw();
}
function memoXform(ctx) {
  const k = memo.dpr * memo.s;
  ctx.setTransform(k, 0, 0, k, -memo.ox * k, -memo.oy * k);
}
function memoStrokePath(ctx, st) {
  const p = st.p;
  ctx.globalCompositeOperation = st.erase ? "destination-out" : "source-over";
  ctx.strokeStyle = st.color; ctx.lineWidth = st.w;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  if (p.length === 2) ctx.lineTo(p[0] + 0.1, p[1] + 0.1);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.stroke();
}
function memoDraw() {
  const { grid, ink } = memoEls();
  if (!grid) return;
  const g = grid.getContext("2d"), c = ink.getContext("2d");
  // 方眼の 紙（ひっ算の くらいを そろえやすい ように マス目つき）
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, grid.width, grid.height);
  memoXform(g);
  g.fillStyle = "#fffdf8"; g.fillRect(0, 0, MEMO_W, MEMO_H);
  g.lineWidth = 1 / memo.s;
  for (let x = MEMO_GRID; x < MEMO_W; x += MEMO_GRID) {
    g.strokeStyle = x % (MEMO_GRID * 5) === 0 ? "rgba(58,155,245,.30)" : "rgba(58,155,245,.14)";
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, MEMO_H); g.stroke();
  }
  for (let y = MEMO_GRID; y < MEMO_H; y += MEMO_GRID) {
    g.strokeStyle = y % (MEMO_GRID * 5) === 0 ? "rgba(58,155,245,.30)" : "rgba(58,155,245,.14)";
    g.beginPath(); g.moveTo(0, y); g.lineTo(MEMO_W, y); g.stroke();
  }
  g.strokeStyle = "rgba(0,0,0,.18)"; g.lineWidth = 2 / memo.s; g.strokeRect(0, 0, MEMO_W, MEMO_H);
  // インク
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, ink.width, ink.height);
  memoXform(c);
  for (const st of memo.strokes) memoStrokePath(c, st);
  if (memo.cur) memoStrokePath(c, memo.cur);
  c.globalCompositeOperation = "source-over";
  const pct = document.getElementById("memoPct");
  if (pct) pct.textContent = Math.round(memo.s * 100) + "%";
}
function memoPos(e) {
  const r = memoEls().stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function memoDown(e) {
  if (e.target.closest(".memo-zoom")) return;
  e.preventDefault();
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
  const pos = memoPos(e);
  memo.pts.set(e.pointerId, pos);
  document.getElementById("memoHelp").classList.add("gone");
  if (memo.pts.size === 2) {
    // 2本めの ゆび：書きはじめの 線は 「ピンチの つもり」だった ので すてる（長い線は のこす）
    if (memo.cur && memo.cur.p.length < 16) memo.cur = null;
    else if (memo.cur) { memo.strokes.push(memo.cur); memo.cur = null; }
    memo.pan = null;
    const [a, b] = [...memo.pts.values()];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    memo.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: memo.s, wx: memo.ox + mx / memo.s, wy: memo.oy + my / memo.s };
    memo.blocked = true;   // ピンチの あと、のこった 1本ゆびで 線を 引かない
    memoDraw();
    return;
  }
  if (memo.pts.size > 2 || memo.blocked) return;
  if (memo.tool === "hand" || e.button === 1 || e.button === 2) {
    memo.pan = { x: pos.x, y: pos.y, ox: memo.ox, oy: memo.oy };
    return;
  }
  const wx = memo.ox + pos.x / memo.s, wy = memo.oy + pos.y / memo.s;
  const erase = memo.tool === "eraser";
  const pen = MEMO_PENS.find(p => p.id === memo.pen) || MEMO_PENS[0];
  memo.cur = { p: [wx, wy], color: erase ? "#000" : pen.color, w: erase ? 28 : 4, erase };
  memoDraw();
}
function memoMove(e) {
  if (!memo.pts.has(e.pointerId)) return;
  e.preventDefault();
  const pos = memoPos(e);
  memo.pts.set(e.pointerId, pos);
  if (memo.pinch && memo.pts.size >= 2) {
    const [a, b] = [...memo.pts.values()];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const ns = Math.max(MEMO_MIN, Math.min(MEMO_MAX, memo.pinch.s * (Math.hypot(a.x - b.x, a.y - b.y) / memo.pinch.d)));
    memo.s = ns; memo.ox = memo.pinch.wx - mx / ns; memo.oy = memo.pinch.wy - my / ns;
    memoClamp(); memoDraw();
    return;
  }
  if (memo.pan) {
    memo.ox = memo.pan.ox - (pos.x - memo.pan.x) / memo.s;
    memo.oy = memo.pan.oy - (pos.y - memo.pan.y) / memo.s;
    memoClamp(); memoDraw();
    return;
  }
  if (memo.cur) {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const r = memoEls().stage.getBoundingClientRect();
    const c = memoEls().ink.getContext("2d");
    memoXform(c);
    c.globalCompositeOperation = memo.cur.erase ? "destination-out" : "source-over";
    c.strokeStyle = memo.cur.color; c.lineWidth = memo.cur.w; c.lineCap = "round"; c.lineJoin = "round";
    for (const ev of evs) {
      const p = memo.cur.p, lx = p[p.length - 2], ly = p[p.length - 1];
      const wx = memo.ox + (ev.clientX - r.left) / memo.s, wy = memo.oy + (ev.clientY - r.top) / memo.s;
      if (Math.abs(wx - lx) + Math.abs(wy - ly) < 0.6 / memo.s) continue;
      p.push(wx, wy);
      c.beginPath(); c.moveTo(lx, ly); c.lineTo(wx, wy); c.stroke();   // 1区間だけ かきたす（はやい）
    }
    c.globalCompositeOperation = "source-over";
  }
}
function memoUp(e) {
  memo.pts.delete(e.pointerId);
  if (memo.pts.size < 2) memo.pinch = null;
  if (memo.pts.size === 0) {
    memo.pan = null; memo.blocked = false;
    if (memo.cur) { memo.strokes.push(memo.cur); memo.cur = null; memoDraw(); }
  }
}

/* ながおしで よみあげ（えらぶ ボタンを おしたまま 0.45秒）。ながおしの あとの click は こたえに しない */
function setupLongPress(el, fn) {
  let timer = null, sx = 0, sy = 0;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  el.addEventListener("pointerdown", e => {
    sx = e.clientX; sy = e.clientY; el.dataset.lp = "";
    cancel();
    timer = setTimeout(() => { timer = null; el.dataset.lp = "1"; el.classList.add("reading"); fn();
      setTimeout(() => el.classList.remove("reading"), 600); }, 450);
  });
  el.addEventListener("pointermove", e => { if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 12) cancel(); });
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointercancel", () => { cancel(); el.dataset.lp = ""; });
  el.addEventListener("pointerleave", cancel);
  el.addEventListener("contextmenu", e => e.preventDefault());
}

function keypad(k) {
  if (round.locked) return;
  const box = document.getElementById("answerBox");
  if (k === "del") round.current = round.current.slice(0, -1);
  else if (k === "dot") { if (!round.current.includes(".") && round.current) round.current += "."; }
  else if (k === "ok") { if (round.current !== "") submitAnswer(round.current); return; }
  else if (round.current.length < 6) round.current += k;
  box.textContent = round.current;
}

function answerChoice(btn, value) {
  if (round.locked) return;
  round.locked = true;
  const q = round.questions[round.idx];
  const ok = value === q.answer;
  screen().querySelectorAll(".choice").forEach(b => {
    const v = decodeURIComponent(b.dataset.choice);
    if (v === q.answer) b.classList.add("correct");
    else if (b === btn) b.classList.add("wrong");
    b.disabled = true;
  });
  finishQuestion(ok, value);
}

function submitAnswer(value) {
  if (round.locked) return;   // 二重に こたえない（同じ 問題を 2回 数えない）
  round.locked = true;
  const q = round.questions[round.idx];
  finishQuestion(value === q.answer, value);
}

function finishQuestion(ok, given) {
  if (round.ended) return;
  const q = round.questions[round.idx];
  const p = prof();
  const subj = round.timed ? (q.subject || round.subject) : (round.review ? q.subject : round.subject);
  const fb = document.getElementById("feedback");

  if (ok) {
    round.correct++;
    if (round.timed) { round.combo = (round.combo || 0) + 1; round.maxCombo = Math.max(round.maxCombo || 0, round.combo); }
    fb.textContent = round.timed ? "⭕ せいかい！" : "せいかい！ ⭕ +10🪙";
    fb.className = "feedback ok";
    beep("ok");
    if (!round.timed) {
      const r = hitWrong(subj, q);
      if (r && r.cleared) { p.reviewCleared++; fb.textContent += "　🩹 にがて こくふく！"; }
      else if (r && r.advanced) fb.textContent += `　📅 つぎは ${dayWord(r.days)} ふくしゅう`;
      if (praiseOn()) speak(r && r.cleared ? "やったね！ にがて こくふく！" : pickOne(PRAISE_OK), true);
    }
  } else {
    if (round.timed) round.combo = 0;
    fb.textContent = `おしい！ こたえは「${q.answer}」`;
    fb.className = "feedback ng";
    beep("ng");
    if (!round.timed) addWrong(subj, q);   // ふくしゅう中に まちがえても 予定は さいしょから
  }
  // 統計（タイムアタックは除外して純粋な学習ログを保つ）
  if (!round.timed && p.stats[subj]) { p.stats[subj].a++; if (ok) p.stats[subj].c++; }

  const goNext = () => {
    if (round.ended) return;
    round.idx++;
    if (round.timed) {
      if (round.idx >= round.questions.length) round.idx = 0; // 足りなければ最初へ
      showQuestion();
    } else if (round.idx < round.questions.length) showQuestion();
    else finishRound();
  };

  // まちがえたら かいせつを 出す（タイムアタック以外は 読んでから 自分で すすむ）
  if (!ok) {
    showExplain(q, given, subj, goNext);
    if (round.timed) round.nextTimer = setTimeout(goNext, 1500);
    return;
  }
  // ほめことばを 言いおわる まで 少し まつ（つぎの 問題の よみあげで 切れない ように）
  round.nextTimer = setTimeout(goNext, round.timed ? 450 : (praiseOn() ? 1300 : 900));
}

/* ---------- かいせつ ---------- */
/* 解説は 4つの 部品で くみたてる：
   ① あなたの こたえ と 正しい こたえ を ならべる
   ② まちがいの ヒント（どこで つまずいたか） … mathMistake / choiceMistake
   ③ とき方（ステップごとに 番号つき） … explainFor
   ④ ポイント（つぎに まちがえない コツ） … pointFor */
function explainFor(q, subj) {
  if (q.why) return q.why;                                   // 算数など、生成時に付いたもの
  if (subj === "math" && typeof mathWhy === "function") { const w = mathWhy(q); if (w) return w; }
  const text = q.q || "";
  for (const k of Object.keys(WHY)) if (text.includes(k)) return WHY[k];
  const a = q.answer;
  let m;
  if ((m = text.match(/「(.+?)」の\s*(?:よみ|読み)/))) return `「${m[1]}」は 「${a}」と 読みます。`;
  if ((m = text.match(/「(.+?)」は\s*(?:えいご|英語)で/))) return `「${m[1]}」は 英語で 「${a}」。`;
  if ((m = text.match(/「(.+?)」の\s*(?:いみ|意味)/))) return `「${m[1]}」は 「${a}」という いみ。`;
  if ((m = text.match(/「(.+?)」の\s*(?:はんたい|対義語)/))) return `「${m[1]}」の はんたいは 「${a}」。`;
  if ((m = text.match(/「(.+?)」の\s*類義語/))) return `「${m[1]}」と にた いみの ことばは 「${a}」。`;
  if ((m = text.match(/「(.+?)」を\s*カタカナ/))) return `「${m[1]}」を カタカナで 書くと 「${a}」。`;
  if ((m = text.match(/「(.+?)」を\s*ひらがな/))) return `「${m[1]}」を ひらがなで 書くと 「${a}」。`;
  if ((m = text.match(/四字熟語「(.+?)」/))) return `□に 入るのは 「${a}」。正しくは 「${m[1].replace("□", a)}」。`;
  if ((m = text.match(/「(.+?)」の 部首/))) return `「${m[1]}」の 部首は 「${a}」。`;
  if ((m = text.match(/しりとり[:：]「(.+?)」/))) return `「${m[1]}」の さいごの 字から はじまる ことばは 「${a}」。`;
  if ((m = text.match(/「(.+?)」の\s*総画数/))) return `「${m[1]}」は ぜんぶで ${a}。ゆっくり かぞえて みよう。`;
  if ((m = text.match(/^「(.+?)」/)) && m[1] !== a) return `こたえは 「${a}」。「${m[1]}」と セットで おぼえよう。`;
  return `こたえは 「${a}」。`;
}
/* 選んだ こたえが、べつの 問題の こたえ だった ときに「それは ○○の こと」と 教える */
function choiceMistake(q, given, subj) {
  if (!given || given === q.answer) return null;
  const bank = (DATA[state.grade] || {})[subj];
  if (!bank) return null;
  const other = bank.find(x => x.answer === given && x.q !== q.q);
  if (!other) return null;
  let m;
  if ((m = other.q.match(/「(.+?)」の\s*(?:よみ|読み)/))) return `「${given}」と 読むのは 「${m[1]}」だよ。にているから まちがえやすいね。`;
  if ((m = other.q.match(/「(.+?)」は\s*(?:えいご|英語)で/))) return `「${given}」は 「${m[1]}」の ことだよ。`;
  if ((m = other.q.match(/「(.+?)」の\s*(?:いみ|意味)/))) return `「${given}」は 「${m[1]}」の いみだよ。`;
  if ((m = other.q.match(/「(.+?)」の\s*(?:はんたい|対義語)/))) return `「${given}」は 「${m[1]}」の はんたいの ことばだよ。`;
  return null;
}
function pointFor(q, subj) {
  const t = (q.prompt || "") + (q.q || "");
  if (subj === "math") {
    if (/分数|\/\d/.test(t)) return "分数は 「分母が なにを あらわすか」を まず かくにん。メモに 図を かくと わかりやすいよ。";
    if (/\./.test(q.q || "")) return "小数は 小数点の いちを そろえて 書くと まちがいが へるよ。";
    if (/[+−-]/.test(q.q || "")) return "くらいを そろえて メモに 書いて、1のくらいから じゅんに けいさんしよう。";
    return "わからない ときは ✏️メモに しきや 図を かいて かんがえよう。";
  }
  if (/よみ|読み/.test(t)) return "ことばの 中で 声に 出して 3回 読むと おぼえやすいよ。";
  if (subj === "english") return "🔊で 音を きいて、声に 出して まねして みよう。";
  if (/四字熟語|慣用句|意味|いみ/.test(t)) return "いみと いっしょに、つかう 場めんを そうぞうして おぼえよう。";
  return "にがて ふくしゅう で もういちど 出るよ。つぎは きっと できる！";
}
function whySteps(why) {
  const parts = String(why).split("。").map(s => s.trim()).filter(Boolean).map(s => s + "。");
  if (parts.length < 2) return `<div class="explain-body">${why}</div>`;
  return `<ol class="explain-steps">${parts.map(s => `<li>${s}</li>`).join("")}</ol>`;
}
function showExplain(q, given, subj, onNext) {
  const fb = document.getElementById("feedback");
  if (!fb) return;
  const why = explainFor(q, subj);
  const hint = subj === "math" ? mathMistake(q, given) : choiceMistake(q, given, subj);
  const point = round.timed ? "" : pointFor(q, subj);
  const similar = (!round.timed && subj === "math") ? generateSimilar(state.grade, q) : null;
  const box = document.createElement("div");
  box.className = "explain";
  box.innerHTML = `
    <div class="explain-head">💡 かいせつ<button class="speak-inline" id="whySpeak" title="よみあげ" aria-label="かいせつを よみあげ">🔊</button></div>
    <div class="explain-compare">
      ${given !== undefined && given !== "" ? `<div class="cmp ng"><span class="cmp-l">あなたの こたえ</span><span class="cmp-v">${given}</span></div>` : ""}
      <div class="cmp ok"><span class="cmp-l">ただしい こたえ</span><span class="cmp-v">${q.answer}</span></div>
    </div>
    ${hint ? `<div class="explain-hint"><span class="explain-tag">🔍 どこが ちがった？</span>${hint}</div>` : ""}
    <div class="explain-tag">📝 とき方</div>
    ${whySteps(why)}
    ${point ? `<div class="explain-point"><span class="explain-tag">⭐ ポイント</span>${point}</div>` : ""}
    ${round.timed ? "" : `
      <button class="big-btn green" id="whyNext" style="margin-top:12px">わかった！ つぎへ ➡️</button>
      ${similar ? `<button class="big-btn ghost" id="whySimilar" style="margin-top:10px">🔁 にた もんだいで れんしゅう</button>` : ""}`}`;
  fb.after(box);
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  // かいせつも 記号・単位を なおしてから 読む（生のままだと「＝」「cm²」が 読めない）
  const cheer = praiseOn() ? pickOne(PRAISE_NG) + " " : "";
  const readable = toReadable({ q: `${cheer}こたえは、${q.answer}。${hint ? hint : ""}${why}` });
  document.getElementById("whySpeak").onclick = () => speak(readable, true);
  const nextBtn = document.getElementById("whyNext");
  if (nextBtn) nextBtn.onclick = onNext;
  const simBtn = document.getElementById("whySimilar");
  if (simBtn) simBtn.onclick = () => {
    // つぎの 問題の まえに 1問 さしこむ（このラウンドの 問題数が 1 ふえる）
    round.questions.splice(round.idx + 1, 0, { ...similar, extra: true });
    onNext();
  };
  // よみあげ設定が オンなら かいせつも 読む。オフでも ほめことば設定が オンなら ひとこと はげます
  if (!round.timed) {
    if (prof().settings.speak) speak(readable);
    else if (cheer) speak(cheer + "かいせつを 読んで みよう。", true);
  }
}

/* せいかい率の リング（結果画面） */
function scoreRing(correct, total) {
  const pct = total ? correct / total : 0;
  const r = 70, c = 2 * Math.PI * r;
  return `<div class="score-ring">
    <svg viewBox="0 0 168 168" aria-hidden="true">
      <circle class="track" cx="84" cy="84" r="${r}"></circle>
      <circle class="bar" cx="84" cy="84" r="${r}"
        stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${c.toFixed(1)}" data-off="${(c * (1 - pct)).toFixed(1)}"></circle>
    </svg>
    <div class="ring-in">
      <div class="ring-num">${Math.round(pct * 100)}<span style="font-size:20px">%</span></div>
      <div class="ring-sub">せいかい</div>
    </div>
  </div>`;
}
function animateRing() {
  const bar = screen().querySelector(".score-ring .bar");
  if (bar) requestAnimationFrame(() => { bar.style.strokeDashoffset = bar.dataset.off; });
}

/* ========== ラウンド終了 ========== */
function finishRound() {
  const p = prof();
  const gained = round.correct * 10 + (round.correct === round.questions.length ? 20 : 0);
  p.coins += gained;

  const today = todayStr();
  if (p.lastStudyDate !== today) {
    if (p.lastStudyDate && daysBetween(p.lastStudyDate, today) === 1) p.streak++;
    else p.streak = 1;
    p.lastStudyDate = today;
  }
  p.log.push({ date: today, subject: round.subject, correct: round.correct, total: round.questions.length });
  if (p.log.length > 400) p.log = p.log.slice(-400);
  const goalNow = checkGoal();

  const newBadges = checkBadges({ correct: round.correct, total: round.questions.length });
  saveState(); refreshTop();

  const perfect = round.correct === round.questions.length;
  const emoji = perfect ? "🏆" : round.correct >= round.questions.length * 0.6 ? "🎉" : "💪";
  if (perfect || round.correct >= round.questions.length * 0.8) confetti();

  const badgeHtml = newBadges.map(id => {
    const b = BADGES.find(x => x.id === id);
    return `<div class="badge-pop">🎊 あたらしいバッジ ${b.emoji} 「${b.name}」ゲット！</div>`;
  }).join("");

  // つぎの ステップ：よく できたら むずかしく、むずかしすぎたら やさしく（算数・各教科とも 選択肢の数が かわる）
  const rate = round.correct / round.questions.length;
  const order = ["easy", "normal", "hard"], di = order.indexOf(difficulty());
  let stepUp = "";
  if (!round.review && rate >= 0.9 && di < 2) stepUp = `<button class="big-btn ghost" id="diffUp">⬆️ 「${DIFF[order[di + 1]]}」に チャレンジ！</button>`;
  else if (!round.review && rate <= 0.4 && di > 0) stepUp = `<button class="big-btn ghost" id="diffDown">🌱 「${DIFF[order[di - 1]]}」で じしんを つけよう</button>`;
  const goalNote = goalNow
    ? `<div class="badge-pop">🎯 きょうの めあて たっせい！ ボーナス +15🪙</div>`
    : roundsToday() < dailyGoal() ? `<div class="reward">🎯 きょうの めあて：あと ${dailyGoal() - roundsToday()}かい</div>` : "";

  const dueLeft = dueCount();
  const reviewNote = round.review
    ? `<div class="reward">きょうの ふくしゅう：あと ${dueLeft}問<br>にがて ぜんぶ：${p.wrong.length}問${p.wrong.length && !dueLeft ? `（つぎは ${dayWord(nextDueIn(p.wrong, todayStr()))}）` : ""}</div>` : "";
  const againLabel = round.review ? (dueLeft ? "つづけて ふくしゅう" : "もういちど れんしゅう") : `もういちど ${subjectName(round.subject)}`;
  const againDisabled = round.review && p.wrong.length === 0;

  render(`
    <div class="result">
      <div class="result-card">
        <div class="big-emoji">${emoji}</div>
        ${scoreRing(round.correct, round.questions.length)}
        <div class="score">${round.correct} / ${round.questions.length} 問せいかい</div>
        <div class="reward">コインを <b>${gained}🪙</b> ゲット！${perfect ? "<br>（ぜんもん正かいボーナス +20）" : ""}</div>
      </div>
      ${goalNote}
      ${reviewNote}
      ${badgeHtml}
      ${stepUp}
      ${againDisabled
        ? `<div class="badge-pop">🎉 にがてを ぜんぶ こくふく！</div>`
        : `<button class="big-btn green" id="againBtn">${againLabel}</button>`}
      <button class="big-btn blue" id="otherBtn">ホームに もどる</button>
    </div>
  `);
  animateRing();
  if (praiseOn()) {
    const msg = perfect ? "ぜんもん せいかい！ すごいね！" : goalNow ? "きょうの めあて、たっせい！ よく がんばったね！"
      : rate >= 0.6 ? "よく がんばったね！" : "おつかれさま！ つぎは もっと できるよ。";
    setTimeout(() => speak(msg, true), 300);
  }
  const setDiff = d => { prof().settings.difficulty = d; saveState(); startRound(round.subject); };
  if (document.getElementById("diffUp")) document.getElementById("diffUp").onclick = () => setDiff(order[di + 1]);
  if (document.getElementById("diffDown")) document.getElementById("diffDown").onclick = () => setDiff(order[di - 1]);
  if (!againDisabled) document.getElementById("againBtn").onclick = () => round.review ? startReview(dueLeft > 0) : startRound(round.subject);
  document.getElementById("otherBtn").onclick = showHome;
}

/* ========== 画面：バッジ ========== */
function showBadges() {
  const p = prof();
  const list = BADGES.map(b => {
    const got = p.badges.includes(b.id);
    return `<div class="badge ${got ? "" : "locked"}" title="${b.desc}">
      <div class="b-emoji">${b.emoji}</div><div class="b-name">${b.name}</div>
    </div>`;
  }).join("");
  render(`
    <h1 class="title">あつめた バッジ 🏅</h1>
    <p class="subtitle">${p.badges.length} / ${BADGES.length} こ ゲット！</p>
    <div class="badge-list">${list}</div>
    <button class="big-btn" id="backBtn">もどる</button>
  `);
  document.getElementById("backBtn").onclick = showHome;
}

/* ========== 画面：ショップ ========== */
let shopTab = "avatars";
function showShop() {
  const p = prof();
  const tabs = `
    <div class="shop-tabs">
      <button class="shop-tab ${shopTab === "avatars" ? "on" : ""}" data-tab="avatars">🧑 アバター</button>
      <button class="shop-tab ${shopTab === "themes" ? "on" : ""}" data-tab="themes">🎨 テーマ</button>
    </div>`;

  let items;
  if (shopTab === "avatars") {
    items = SHOP.avatars.map(a => {
      const owned = p.owned.avatars.includes(a.id);
      const active = p.avatar === a.id;
      return `<div class="shop-item ${active ? "active" : ""}">
        <div class="shop-emoji">${a.emoji}</div>
        <div class="shop-name">${a.name}</div>
        ${shopBtnHtml("avatar", a.id, a.price, owned, active)}
      </div>`;
    }).join("");
  } else {
    items = SHOP.themes.map(t => {
      const owned = p.owned.themes.includes(t.id);
      const active = p.theme === t.id;
      const sw = `background:linear-gradient(135deg, ${t.vars["--orange"]} 55%, ${t.vars["--bg2"]} 55%)`;
      return `<div class="shop-item ${active ? "active" : ""}">
        <div class="shop-swatch" style="${sw}"></div>
        <div class="shop-name">${t.name}</div>
        ${shopBtnHtml("theme", t.id, t.price, owned, active)}
      </div>`;
    }).join("");
  }

  render(`
    <h1 class="title">ショップ 🛍️</h1>
    <p class="subtitle">もっている コイン：<b>${p.coins}🪙</b></p>
    ${tabs}
    <div class="shop-grid">${items}</div>
    <button class="big-btn" id="backBtn">もどる</button>
  `);

  screen().querySelectorAll("[data-tab]").forEach(b =>
    b.onclick = () => { shopTab = b.dataset.tab; showShop(); });
  screen().querySelectorAll("[data-buy]").forEach(b =>
    b.onclick = () => buyItem(b.dataset.kind, b.dataset.buy, +b.dataset.price));
  screen().querySelectorAll("[data-use]").forEach(b =>
    b.onclick = () => useItem(b.dataset.kind, b.dataset.use));
  document.getElementById("backBtn").onclick = showHome;
}
function shopBtnHtml(kind, id, price, owned, active) {
  if (active) return `<button class="shop-btn using" disabled>つかってる</button>`;
  if (owned) return `<button class="shop-btn use" data-kind="${kind}" data-use="${id}">つかう</button>`;
  return `<button class="shop-btn buy" data-kind="${kind}" data-buy="${id}" data-price="${price}">${price}🪙</button>`;
}
function buyItem(kind, id, price) {
  const p = prof();
  if (p.coins < price) { alert("コインが たりないよ！ もっと べんきょうして ためよう 🪙"); return; }
  p.coins -= price;
  if (kind === "avatar") { p.owned.avatars.push(id); p.avatar = id; }
  else { p.owned.themes.push(id); p.theme = id; applyTheme(id); }
  checkBadges(null);
  saveState(); refreshTop(); confetti(); showShop();
}
function useItem(kind, id) {
  const p = prof();
  if (kind === "avatar") p.avatar = id;
  else { p.theme = id; applyTheme(id); }
  saveState(); refreshTop(); showShop();
}

/* ========== 画面：かきとり（手書きなぞり練習） ========== */
function showWritingMenu() {
  const sets = WRITING_SETS[state.grade];
  const cards = sets.map(s => `
    <button class="card" data-set="${s.id}">
      <span class="emoji">${s.emoji}</span>
      <span class="name">${s.name}</span>
      <span class="desc">${s.chars.length}文字</span>
    </button>`).join("");
  render(`
    <h1 class="title">かきとり れんしゅう ✍️</h1>
    <p class="subtitle">お手本を ゆびで なぞって かいてみよう！</p>
    <div class="grid">${cards}</div>
    <button class="big-btn" id="backBtn">もどる</button>
    <p class="hint" style="text-align:center;margin-top:12px">書き順データ: <b>KanjiVG</b>（CC BY-SA 3.0）kanjivg.tagaini.net</p>
  `);
  screen().querySelectorAll("[data-set]").forEach(b => b.onclick = () => startWriting(b.dataset.set));
  document.getElementById("backBtn").onclick = showHome;
}

let writeState = null;
const MODEL_OPACITY = [0.22, 0.1, 0]; // こい / うすい / なし
function startWriting(setId) {
  const set = WRITING_SETS[state.grade].find(s => s.id === setId);
  writeState = { set, idx: 0, opacityStep: 0, perfect: 0 };
  showWritingCard();
}

const OP_LABEL = ["こい", "うすい", "なし"];
/* かきとりは メモと おなじく 画面ぜんたいを つかう シートで 書く。
   ブラウザの ダブルタップ拡大・ピンチ・スクロールを シートの 中では ぜんぶ 止める
   （「、」や「・」のような みじかい 画を 2回 つづけて 書くと、ページが 拡大されていた）。
   書き順チェック（js/strokecheck.js）が オンなら、1画 書くごとに お手本の 何画めかを はんていし、
   ちがったら その画を 赤で 見せてから 消し、正しい 画を オレンジで 光らせる。 */
const pad = { strokes: [], cur: null, refs: [], ds: null, k: 0, miss: 0, reject: null, size: 0, pid: null };
function strokeCheckOn() { return prof().settings.strokeCheck !== false; }

function showWritingCard() {
  const { set, idx } = writeState;
  const item = set.chars[idx];
  const total = set.chars.length;
  const pct = (idx / total) * 100;
  const showYomi = item.yomi && item.yomi !== item.c;
  const ds = STROKES[item.c];
  const op = MODEL_OPACITY[writeState.opacityStep];
  Object.assign(pad, { strokes: [], cur: null, ds: ds || null, refs: ds ? strokeRefs(ds) : [], k: 0, miss: 0, reject: null, pid: null, warned: false });

  // お手本レイヤー（筆順データがあればSVG、なければフォント文字）
  const modelLayer = ds
    ? `<svg class="pad-model-svg" id="modelSvg" viewBox="0 0 109 109" style="opacity:${op}">
         ${ds.map(d => `<path d="${d}"/>`).join("")}</svg>`
    : `<div class="pad-model" id="modelSvg" style="opacity:${op}">${item.c}</div>`;
  // 書き順アニメ・ヒント用レイヤー（最初は非表示）
  const orderLayer = ds
    ? `<svg class="pad-order-svg" id="orderSvg" viewBox="0 0 109 109">
         ${ds.map(d => `<path d="${d}" pathLength="1"/>`).join("")}
         <circle id="startDot" r="4.5" cx="-20" cy="-20"></circle></svg>` : "";

  render(`
    <div class="write-sheet" id="writeSheet">
      <div class="write-top">
        <button class="write-x" id="quitBtn" aria-label="やめる">✕</button>
        <div class="progress"><i style="width:${pct}%"></i></div>
        <span class="qnum">${idx + 1}/${total}</span>
      </div>
      <div class="write-info">
        <span class="write-set">✍️ ${set.name}</span>
        ${showYomi ? `<span>よみ：<b>${item.yomi}</b></span>` : ""}
        <button class="speak-inline" id="speakBtn" aria-label="よみあげ">🔊</button>
        ${ds ? `<span class="hint">${ds.length}かく</span>` : ""}
      </div>
      <div class="write-stage" id="writeStage">
        <div class="pad-wrap" id="padWrap">
          ${modelLayer}
          ${orderLayer}
          <canvas id="padCanvas" class="pad-canvas"></canvas>
        </div>
      </div>
      <div class="write-status" id="writeStatus"></div>
      <div class="write-tools">
        <button class="memo-tool" id="orderBtn" ${ds ? "" : "disabled"}><b>▶️</b><span>書き順</span></button>
        <button class="memo-tool" id="modelBtn"><b>👁️</b><span id="modelLabel">お手本 ${OP_LABEL[writeState.opacityStep]}</span></button>
        <button class="memo-tool" id="undoBtn"><b>↩️</b><span>もどす</span></button>
        <button class="memo-tool" id="clearBtn"><b>🗑️</b><span>けす</span></button>
        <button class="memo-tool ${strokeCheckOn() && ds ? "on" : ""}" id="checkBtn" ${ds ? "" : "disabled"} aria-pressed="${strokeCheckOn()}" aria-label="書き順チェック"><b>${strokeCheckOn() ? "✅" : "⬜"}</b><span>チェック</span></button>
      </div>
      <button class="big-btn green write-done" id="doneBtn">かけた！ つぎへ ➡️</button>
    </div>
  `);
  document.documentElement.classList.add("write-lock");

  const sheet = document.getElementById("writeSheet");
  const stop = e => e.preventDefault();
  sheet.addEventListener("touchmove", stop, { passive: false });
  sheet.addEventListener("gesturestart", stop);
  sheet.addEventListener("gesturechange", stop);
  sheet.addEventListener("dblclick", stop);
  sheet.addEventListener("contextmenu", stop);

  setupPad();
  writeStatus();
  document.getElementById("speakBtn").onclick = () => speak(item.yomi || item.c, true);
  document.getElementById("modelBtn").onclick = () => {
    writeState.opacityStep = (writeState.opacityStep + 1) % MODEL_OPACITY.length;
    document.getElementById("modelSvg").style.opacity = MODEL_OPACITY[writeState.opacityStep];
    document.getElementById("modelLabel").textContent = "お手本 " + OP_LABEL[writeState.opacityStep];
  };
  document.getElementById("undoBtn").onclick = () => {
    if (!pad.strokes.length) return;
    pad.strokes.pop();
    if (pad.k > 0 && pad.k > pad.strokes.length) pad.k = pad.strokes.length;
    padDraw(); writeStatus();
  };
  document.getElementById("clearBtn").onclick = () => { pad.strokes = []; pad.k = 0; padDraw(); writeStatus(); };
  document.getElementById("checkBtn").onclick = () => {
    prof().settings.strokeCheck = !strokeCheckOn(); saveState();
    pad.strokes = []; pad.k = 0; pad.miss = 0;
    const b = document.getElementById("checkBtn");
    b.classList.toggle("on", strokeCheckOn());
    b.setAttribute("aria-pressed", strokeCheckOn());
    b.querySelector("b").textContent = strokeCheckOn() ? "✅" : "⬜";
    padDraw(); writeStatus();
  };
  document.getElementById("doneBtn").onclick = writingDone;
  document.getElementById("quitBtn").onclick = showWritingMenu;
  if (ds) document.getElementById("orderBtn").onclick = () => animateStrokes();

  speak(item.yomi || item.c);   // 自動よみあげ（設定オン時）
  if (ds) setTimeout(() => animateStrokes(), 350);  // カード表示時に書き順を1回さいせい
}

/* 書き順チェックの ようすを 1行で 出す */
function writeStatus(kind, extra) {
  const el = document.getElementById("writeStatus");
  if (!el) return;
  const total = pad.refs.length;
  let text, cls = "";
  if (!pad.ds) text = "お手本を 見ながら 書いてみよう";
  else if (!strokeCheckOn()) text = "じゆうに 書いてみよう（書き順チェック オフ）";
  else if (kind === "order") { cls = "ng"; text = `❌ じゅんばんが ちがうよ。いまは <b>${pad.k + 1}画め</b>（オレンジの 線）`; }
  else if (kind === "reverse") { cls = "ng"; text = `↩️ 書く むきが ぎゃくだよ。<b>●</b> から 書きはじめよう`; }
  else if (kind === "off") { cls = "ng"; text = `🤔 かたちや ばしょが ちがうみたい。オレンジの 線を 見て もういちど`; }
  else if (pad.k >= total) {
    cls = "ok";
    text = pad.miss === 0 ? "🎉 書き順 ぴったり！ 「かけた！」を おしてね" : `✅ ぜんぶ かけた！（書き順の まちがい ${pad.miss}回）`;
  }
  else if (kind === "ok") { cls = "ok"; text = `⭕ ${pad.k}画め OK！ つぎは <b>${pad.k + 1}画め</b>`; }
  else text = `<b>${pad.k + 1}画め</b> から 書いてね（ぜんぶで ${total}画）`;
  el.className = "write-status " + cls;
  el.innerHTML = text + (extra || "");
}

/* パッドの 大きさを 画面に あわせる（正方形で いちばん 大きく） */
function padLayout() {
  const stage = document.getElementById("writeStage"), wrap = document.getElementById("padWrap"), cv = document.getElementById("padCanvas");
  if (!stage || !wrap || !cv) return;
  const size = Math.max(160, Math.floor(Math.min(stage.clientWidth, stage.clientHeight, 560)));
  wrap.style.width = wrap.style.height = size + "px";
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(size * dpr); cv.height = Math.round(size * dpr);
  pad.size = size; pad.dpr = dpr;
  padDraw();
}
function padCtx109(ctx) { const k = pad.dpr * pad.size / 109; ctx.setTransform(k, 0, 0, k, 0, 0); }
function padStrokePath(ctx, p, color, w) {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]);
  if (p.length === 1) ctx.lineTo(p[0][0] + 0.05, p[0][1] + 0.05);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
  ctx.stroke();
}
const PAD_W = 6.5;   // 線の 太さ（109 ます あたり）
function padDraw() {
  const cv = document.getElementById("padCanvas");
  if (!cv) return;
  const c = cv.getContext("2d");
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
  padCtx109(c);
  for (const s of pad.strokes) padStrokePath(c, s, "#2f2417", PAD_W);
  if (pad.reject) padStrokePath(c, pad.reject, "rgba(242,84,91,.85)", PAD_W);
  if (pad.cur) padStrokePath(c, pad.cur, "#2b6ad4", PAD_W);
}
let padResizeBound = false;
function setupPad() {
  const cv = document.getElementById("padCanvas");
  padLayout();
  if (!padResizeBound) { padResizeBound = true; window.addEventListener("resize", () => { if (document.getElementById("padCanvas")) padLayout(); }); }
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * 109, (e.clientY - r.top) / r.height * 109]; };
  cv.addEventListener("pointerdown", e => {
    e.preventDefault();
    if (pad.pid !== null) return;          // 2本め の ゆび（手のひら など）は むし
    pad.pid = e.pointerId;
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    pad.cur = [pos(e)];
    padDraw();
  });
  cv.addEventListener("pointermove", e => {
    if (e.pointerId !== pad.pid || !pad.cur) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs) {
      const p = pos(ev), l = pad.cur[pad.cur.length - 1];
      if (Math.abs(p[0] - l[0]) + Math.abs(p[1] - l[1]) > 0.25) pad.cur.push(p);
    }
    padDraw();
  });
  const end = e => {
    if (e.pointerId !== pad.pid) return;
    pad.pid = null;
    const s = pad.cur; pad.cur = null;
    if (s) padFinishStroke(s, e.type === "pointercancel");
  };
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);
}
/* 1画 書きおわった ときの はんてい */
function padFinishStroke(s, cancelled) {
  if (cancelled && s.length < 3) { padDraw(); return; }
  if (!pad.ds || !strokeCheckOn() || pad.k >= pad.refs.length) {
    pad.strokes.push(s); padDraw();
    if (pad.ds && strokeCheckOn()) writeStatus("extra", "<br>（画が おおいよ。↩️もどす で けせるよ）");
    return;
  }
  const pairs = pad.strokes.map((u, i) => [u, pad.refs[i]]);
  const tol = writeState.opacityStep === 2 ? 26 : 22;   // お手本なしの ときは すこし ゆるく
  const r = judgeStroke(s, pad.refs, pad.k, { tol, shift: strokeShift(pairs) });
  if (r.result === "ok") {
    pad.strokes.push(s); pad.k++;
    padDraw();
    writeStatus("ok");
    if (pad.k >= pad.refs.length) { beep("ok"); if (praiseOn()) speak(pad.miss === 0 ? "書き順 ぴったり！" : "ぜんぶ かけたね！", true); }
    return;
  }
  // まちがい：赤で 見せてから 消し、正しい 画を 光らせる
  pad.miss++;
  pad.reject = s; padDraw();
  beep("ng");
  writeStatus(r.result);
  hintStroke(pad.k, r.result === "reverse");
  setTimeout(() => { if (pad.reject === s) { pad.reject = null; padDraw(); } }, 900);
}

/* 書き順アニメ：ストロークを1画ずつ描く（only を わたすと その画だけ ＝ ヒント） */
let strokeTimers = [];
function animateStrokes(only) {
  const svg = document.getElementById("orderSvg");
  if (!svg) return;
  strokeTimers.forEach(clearTimeout); strokeTimers = [];
  const paths = [...svg.querySelectorAll("path")];
  const dot = document.getElementById("startDot");
  if (dot) dot.setAttribute("cx", "-20");
  // まだ 番が きていない 画は かくしておく（線の はしの まるい 点が 先に 見えてしまうため）
  paths.forEach(p => { p.style.transition = "none"; p.style.strokeDashoffset = "1"; p.style.opacity = "0"; });
  void svg.getBoundingClientRect(); // reflow
  let t = 0;
  paths.forEach((p, i) => {
    if (only !== undefined && only !== i) return;
    const dur = 460, gap = 170;
    strokeTimers.push(setTimeout(() => {
      p.style.opacity = "1";
      p.style.transition = `stroke-dashoffset ${dur}ms linear`;
      p.style.strokeDashoffset = "0";
    }, t));
    t += dur + gap;
  });
  // ヒントは しばらく したら 消す（お手本を じゃましない）
  if (only !== undefined) strokeTimers.push(setTimeout(() => {
    paths[only].style.transition = "opacity .4s"; paths[only].style.opacity = "0";
    if (dot) dot.setAttribute("cx", "-20");
  }, 2600));
}
/* まちがえた ときの ヒント：正しい 画を オレンジで 書いて みせ、書きはじめに ● を おく */
function hintStroke(i, showStart) {
  animateStrokes(i);
  const dot = document.getElementById("startDot"), ref = pad.refs[i];
  // 書きはじめの ●（むきが ぎゃくの ときは 大きく して 目立たせる）
  if (dot && ref) { dot.setAttribute("cx", ref[0][0]); dot.setAttribute("cy", ref[0][1]); dot.setAttribute("r", showStart ? 6 : 4.5); }
}

function writingDone() {
  const p = prof();
  // 書き順チェック中に まだ 画が のこっている ときは 1回だけ 知らせる（もう一度 おせば すすむ）
  if (pad.ds && strokeCheckOn() && pad.k < pad.refs.length && !pad.warned) {
    pad.warned = true;
    writeStatus("", `<br>まだ ${pad.refs.length - pad.k}画 のこってるよ（もう一度 おすと つぎへ）`);
    return;
  }
  const perfect = pad.ds && strokeCheckOn() && pad.k >= pad.refs.length && pad.miss === 0;
  p.coins += 5 + (perfect ? 3 : 0); p.writeCount++;
  if (perfect) writeState.perfect = (writeState.perfect || 0) + 1;
  const today = todayStr();
  if (p.lastStudyDate !== today) {
    if (p.lastStudyDate && daysBetween(p.lastStudyDate, today) === 1) p.streak++;
    else p.streak = 1;
    p.lastStudyDate = today;
  }
  const newBadges = checkBadges(null);
  saveState(); refreshTop();

  writeState.idx++;
  if (writeState.idx < writeState.set.chars.length) {
    showWritingCard();
    if (newBadges.length) {
      const b = BADGES.find(x => x.id === newBadges[0]);
      writeStatus("", `<br>🎊 ${b.emoji} 「${b.name}」ゲット！`);
    }
  } else {
    finishWriting(newBadges);
  }
}

function finishWriting(newBadges) {
  const total = writeState.set.chars.length;
  confetti();
  const badgeHtml = (newBadges || []).map(id => {
    const b = BADGES.find(x => x.id === id);
    return `<div class="badge-pop">🎊 あたらしいバッジ ${b.emoji} 「${b.name}」ゲット！</div>`;
  }).join("");
  render(`
    <div class="result">
      <div class="big-emoji">🏆</div>
      <div class="score">${writeState.set.name} ぜんぶ かけた！</div>
      <div class="reward">${total}文字 れんしゅう！ コイン ${total * 5 + (writeState.perfect || 0) * 3}🪙 ゲット！
        ${writeState.perfect ? `<br>書き順 ぴったり：${writeState.perfect}文字（+${writeState.perfect * 3}🪙）` : ""}</div>
      ${badgeHtml}
      <button class="big-btn green" id="againBtn">もういちど</button>
      <button class="big-btn blue" id="menuBtn">ほかの かきとり</button>
      <button class="big-btn ghost" id="homeBtn2" style="margin-top:10px">ホームに もどる</button>
    </div>
  `);
  document.getElementById("againBtn").onclick = () => startWriting(writeState.set.id);
  document.getElementById("menuBtn").onclick = showWritingMenu;
  document.getElementById("homeBtn2").onclick = showHome;
}

/* ========== 画面：ほごしゃ ========== */
function showParent() {
  clearAttackTimer();
  const p = prof();
  const subjects = SUBJECTS[state.grade];
  const statRows = subjects.map(s => {
    const st = p.stats[s.id]; const rate = st.a ? Math.round(st.c / st.a * 100) : 0;
    return `<div class="stat-row">
      <span>${s.emoji} ${s.name}</span>
      <span>${st.c}/${st.a}問 正答 <b>${rate}%</b></span>
    </div>
    <div class="bar"><i style="width:${rate}%"></i></div>`;
  }).join("");

  const doneDates = new Set(p.log.map(l => l.date));
  let cal = "";
  for (let i = 27; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    cal += `<div class="cal-cell ${doneDates.has(key) ? "done" : ""}">${doneDates.has(key) ? "💮" : d.getDate()}</div>`;
  }

  const recent = [...p.log].slice(-8).reverse().map(l =>
    `<div class="log-day">📅 ${l.date}　${subjectName(l.subject)}　${l.correct}/${l.total}問</div>`).join("") || `<div class="hint">まだ きろくが ありません</div>`;

  render(`
    <h1 class="title">ほごしゃメニュー 👪</h1>
    <p class="subtitle">${state.grade === "g1" ? "1年生" : "5年生"}の 学習きろく</p>

    <div class="panel">
      <h3>📊 教科べつ 正答率</h3>
      ${statRows}
    </div>

    <div class="panel">
      <h3>🔥 れんぞく学習</h3>
      <div class="stat-row"><span>いまの連続日数</span><b>${p.streak}日</b></div>
      <div class="stat-row"><span>ためたコイン</span><b>${p.coins}🪙</b></div>
      <div class="stat-row"><span>にがて問題（未こくふく）</span><b>${p.wrong.length}問</b></div>
      <div class="stat-row"><span>きょう ふくしゅう予定</span><b>${dueCount()}問</b></div>
      <div class="stat-row"><span>にがて こくふく数</span><b>${p.reviewCleared}問</b></div>
      <div class="stat-row"><span>かきとり れんしゅう</span><b>${p.writeCount}文字</b></div>
      <div class="stat-row"><span>タイムアタック さいこう</span><b>${p.bestAttack}問</b></div>
      <div class="stat-row"><span>めあて たっせい日数</span><b>${p.goalDays || 0}日</b></div>
      <div style="margin-top:10px" class="calendar">${cal}</div>
      <div class="hint" style="margin-top:6px">💮 = べんきょうした日（直近4週間）</div>
    </div>

    <div class="panel">
      <h3>📝 さいきんの記録</h3>
      ${recent}
    </div>

    <div class="panel">
      <h3>⚙️ せってい</h3>
      <div class="setting-row">
        <span>むずかしさ</span>
        <select id="difficulty">
          ${["easy", "normal", "hard"].map(k => `<option value="${k}" ${p.settings.difficulty === k ? "selected" : ""}>${DIFF[k]}</option>`).join("")}
        </select>
      </div>
      <div class="setting-row">
        <span>きょうの めあて（1日の回数）</span>
        <select id="dailyGoal">
          ${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${dailyGoal() === n ? "selected" : ""}>${n}かい</option>`).join("")}
        </select>
      </div>
      <div class="setting-row">
        <span>1回の問題数</span>
        <select id="perRound">
          ${[5, 10, 15, 20].map(n => `<option value="${n}" ${p.settings.perRound === n ? "selected" : ""}>${n}問</option>`).join("")}
        </select>
      </div>
      <div class="setting-row">
        <span>こうか音</span>
        <select id="sound">
          <option value="on" ${p.settings.sound ? "selected" : ""}>オン</option>
          <option value="off" ${!p.settings.sound ? "selected" : ""}>オフ</option>
        </select>
      </div>
      <div class="setting-row">
        <span>もんだいの よみあげ</span>
        <select id="speak">
          <option value="on" ${p.settings.speak ? "selected" : ""}>オン</option>
          <option value="off" ${!p.settings.speak ? "selected" : ""}>オフ</option>
        </select>
      </div>
      <div class="setting-row">
        <span>よむ はやさ</span>
        <select id="rate">
          ${["slow", "normal", "fast"].map(k => `<option value="${k}" ${rateKey() === k ? "selected" : ""}>${RATE_LABEL[k]}</option>`).join("")}
        </select>
      </div>
      <div class="setting-row">
        <span>ほめことば・はげましの こえ</span>
        <select id="praise">
          <option value="on" ${praiseOn() ? "selected" : ""}>オン</option>
          <option value="off" ${!praiseOn() ? "selected" : ""}>オフ</option>
        </select>
      </div>
      <div class="setting-row">
        <span>タイムアタックの じかん</span>
        <select id="attackTime">
          ${[30, 60, 90, 120].map(n => `<option value="${n}" ${p.settings.attackTime === n ? "selected" : ""}>${n}秒</option>`).join("")}
        </select>
      </div>
      <div class="setting-row">
        <span>こえの しゅるい</span>
        <select id="voice">
          <option value="">おまかせ（自動で いちばん 自然な こえ）</option>
          ${jaVoicesRanked().map(v => `<option value="${v.voiceURI}" ${p.settings.voiceURI === v.voiceURI ? "selected" : ""}>${v.name}${isNaturalVoice(v) ? "（おすすめ・自然な声）" : ""}</option>`).join("")}
        </select>
      </div>
      <div class="setting-row">
        <span></span>
        <button class="shop-btn use" id="voiceTest" style="width:auto;padding:8px 16px">🔊 こえを ためす</button>
      </div>
      <div class="hint">
        いま えらべる 日本語ボイス：<b>${jaVoices().length}こ</b>${jaVoicesRanked().some(isNaturalVoice) ? "（自然な声あり ✅）" : ""}<br>
        <b>Siriのような 自然な声にするには（iPhone/iPad）：</b>
        「設定」→「アクセシビリティ」→「読み上げコンテンツ」→「声」→「日本語」で
        <b>Kyoko や O-ren の『拡張』版</b>をダウンロードすると、この一覧に出て えらべます。
        （Siri そのものの声は、Appleの仕様で アプリからは使えないため、いちばん 近い 高品質ボイスです）<br>
        Android・PC は「Google 日本語」などを 追加すると えらべます。
      </div>
      <button class="big-btn ghost" id="resetBtn" style="margin-top:16px;color:#ff5a5a">この学年のデータを けす</button>
    </div>

    <div class="panel">
      <h3>💾 データの バックアップ</h3>
      <div class="hint">
        学習の きろくは この ブラウザの 中だけに 保存されています。
        機種変更・ブラウザの データ削除・学年が 上がって 端末を かえる ときに そなえて、
        ときどき バックアップファイルを 保存しておくと、あとから そのまま つづきが できます。
        （1年生・5年生 両方の きろくが 入ります）
      </div>
      <button class="big-btn blue" id="exportBtn" style="margin-top:12px">⬇️ バックアップを 保存</button>
      <label class="big-btn ghost file-btn" style="margin-top:10px">⬆️ バックアップから もどす
        <input type="file" id="importFile" accept="application/json,.json" hidden>
      </label>
    </div>

    <button class="big-btn" id="backBtn">もどる</button>
  `);

  document.getElementById("difficulty").onchange = e => { p.settings.difficulty = e.target.value; saveState(); };
  document.getElementById("dailyGoal").onchange = e => { p.settings.dailyGoal = +e.target.value; saveState(); };
  document.getElementById("exportBtn").onclick = exportBackup;
  document.getElementById("importFile").onchange = e => { const f = e.target.files && e.target.files[0]; if (f) importBackup(f); e.target.value = ""; };
  document.getElementById("perRound").onchange = e => { p.settings.perRound = +e.target.value; saveState(); };
  document.getElementById("sound").onchange = e => { p.settings.sound = e.target.value === "on"; saveState(); };
  document.getElementById("speak").onchange = e => {
    p.settings.speak = e.target.value === "on"; saveState();
    if (p.settings.speak) speak("よみあげを おんに しました", true);
  };
  document.getElementById("rate").onchange = e => { p.settings.rate = e.target.value; saveState(); speak("この はやさで よみあげます。", true); };
  document.getElementById("praise").onchange = e => { p.settings.praise = e.target.value === "on"; saveState(); if (p.settings.praise) speak(pickOne(PRAISE_OK), true); };
  document.getElementById("attackTime").onchange = e => { p.settings.attackTime = +e.target.value; saveState(); };
  document.getElementById("voice").onchange = e => { p.settings.voiceURI = e.target.value || null; saveState(); speak("こんにちは。この こえで よみあげます。", true); };
  document.getElementById("voiceTest").onclick = () => speak("こんにちは。いっしょに べんきょう しましょう。", true);
  document.getElementById("resetBtn").onclick = () => {
    if (confirm("この学年の コイン・バッジ・きろく・アイテムを ぜんぶ けしますか？")) {
      state.profiles[state.grade] = freshProfile();
      state.profiles[state.grade].settings.speak = (state.grade === "g1");
      saveState(); refreshTop(); showParent();
    }
  };
  document.getElementById("backBtn").onclick = showHome;
}

/* ---------- バックアップ（書き出し／読みこみ） ---------- */
function exportBackup() {
  const data = JSON.stringify({ app: "natsuyasumi", version: 1, exportedAt: new Date().toISOString(), state }, null, 1);
  const blob = new Blob([data], { type: "application/json" });
  const a = document.createElement("a");
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `study-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      const s = obj && obj.state;
      if (!s || !s.profiles || !s.profiles.g1 || !s.profiles.g5) throw new Error("bad");
      if (!confirm("いまの きろくを、バックアップの 内容に おきかえます。よろしいですか？")) return;
      migrate(s.profiles.g1, "g1"); migrate(s.profiles.g5, "g5");
      if (s.grade !== "g1" && s.grade !== "g5") s.grade = "g1";
      state = s; saveState(); refreshTop();
      alert("バックアップから もどしました！ つづきから べんきょうできます。");
      showParent();
    } catch (e) {
      alert("この ファイルは よみこめませんでした。「バックアップを 保存」で 作った ファイルを えらんでください。");
    }
  };
  reader.readAsText(file);
}

/* ---------- ヘッダーのボタン ---------- */
document.getElementById("homeBtn").onclick = () => { clearAttackTimer(); showGradeSelect(); };
document.getElementById("parentBtn").onclick = () => { clearAttackTimer(); showParent(); };

/* ---------- Service Worker 登録（PWA） ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

/* ---------- 起動 ---------- */
refreshTop();
showHome();
