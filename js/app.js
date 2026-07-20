/* ===== なつやすみ スタディ：本体 ===== */

const STORE_KEY = "natsuyasumi_v1";
const QUESTIONS_PER_ROUND = 10;
const MAX_WRONG = 60;

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
    settings: { sound: true, speak: null, perRound: QUESTIONS_PER_ROUND, attackTime: 60, difficulty: "normal", voiceURI: null },
    bestAttack: 0,      // タイムアタックの最高正解数
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
function saveState() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

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
function toReadable(q) {
  let body = q.q || "";
  // 「よみ／読み」を答える問題は、「」内の文字を読み上げない（答えを言ってしまうため）
  if (/よみ|読み/.test(body)) body = body.replace(/「[^」]*」/g, "この かん字");
  let t = (q.prompt ? q.prompt + "。 " : "") + body;
  t = t.replace(/(\d+)\/(\d+)/g, "$2ぶんの$1");           // 分数
  t = t.replace(/\s*\+\s*/g, " たす ").replace(/\s*×\s*/g, " かける ")
       .replace(/\s*÷\s*/g, " わる ").replace(/\s*-\s*/g, " ひく ")
       .replace(/\s*=\s*/g, " は ").replace(/□/g, "なに")
       .replace(/²/g, "へいほう").replace(/%/g, "パーセント");
  return t.trim();
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
function speak(text, force) {
  if (!force && !prof().settings.speak) return;
  try {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = chooseVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = "ja-JP"; }
    u.rate = 0.92; u.pitch = 1.0;   // より自然な読み上げ
    speechSynthesis.speak(u);
  } catch (e) {}
}
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
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function daysBetween(a, b) {
  const [ay, am, ad] = a.split("-").map(Number), [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/* ---------- にがて問題プール ---------- */
function wrongKey(x) { return `${x.subject}|${x.q}|${x.answer}`; }
function addWrong(subject, q) {
  const p = prof();
  const snap = { subject, q: q.q || "", answer: q.answer, choices: q.choices || null,
    prompt: q.prompt || "", svg: q.svg || "", input: q.input || "choice" };
  if (p.wrong.some(w => wrongKey(w) === wrongKey(snap))) return;
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
  if (p.bestAttack >= 15) grant("speed");
  return earned;
}

/* ---------- 画面ユーティリティ ---------- */
const screen = () => document.getElementById("screen");
function render(html) { screen().innerHTML = html; window.scrollTo(0, 0); }
function refreshTop() {
  document.getElementById("coinCount").textContent = prof().coins;
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
    <p class="subtitle">なつやすみ、いっしょに たのしく べんきょうしよう！</p>
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

  const streakMsg = p.streak > 0 ? `🔥 ${p.streak}日れんぞく！ すごい！` : "きょうも がんばろう！";
  const reviewBtn = p.wrong.length > 0
    ? `<button class="big-btn red-btn" id="reviewBtn">🩹 にがてを ふくしゅう（${p.wrong.length}）</button>` : "";

  render(`
    <div class="hero">
      <div class="hero-avatar">${avatarEmoji(p.avatar)}</div>
      <div>
        <h1 class="title" style="margin:0">きょうの べんきょう ✏️</h1>
        <p class="subtitle" style="margin:4px 0 0">${streakMsg}</p>
      </div>
    </div>
    <div class="diff-select">
      <span class="diff-label">むずかしさ</span>
      <div class="seg">
        ${["easy", "normal", "hard"].map(k => `<button class="seg-btn ${difficulty() === k ? "on" : ""}" data-diff="${k}">${DIFF[k]}</button>`).join("")}
      </div>
    </div>
    <p class="subtitle">教科を えらんでね</p>
    <div class="grid">${cards}</div>
    <button class="big-btn blue" id="attackBtn">⏱️ タイムアタック（コイン2ばい！）</button>
    <button class="big-btn" id="writeBtn">✍️ かきとり れんしゅう</button>
    ${reviewBtn}
    <div class="grid" style="margin-top:14px">
      <button class="big-btn ghost" id="badgeBtn" style="margin:0">🏅 バッジ</button>
      <button class="big-btn ghost" id="shopBtn" style="margin:0">🛍️ ショップ</button>
    </div>
  `);
  screen().querySelectorAll("[data-subject]").forEach(b =>
    b.onclick = () => startRound(b.dataset.subject));
  screen().querySelectorAll("[data-diff]").forEach(b =>
    b.onclick = () => { prof().settings.difficulty = b.dataset.diff; saveState(); showHome(); });
  document.getElementById("attackBtn").onclick = showAttackMenu;
  document.getElementById("writeBtn").onclick = showWritingMenu;
  document.getElementById("badgeBtn").onclick = showBadges;
  document.getElementById("shopBtn").onclick = showShop;
  if (p.wrong.length > 0) document.getElementById("reviewBtn").onclick = startReview;
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
function startRound(subject) {
  clearAttackTimer();
  const n = prof().settings.perRound || QUESTIONS_PER_ROUND;
  let questions;
  if (subject === "math") {
    questions = generateMathSet(state.grade, n, difficulty());
  } else {
    const pool = shuffle([...DATA[state.grade][subject]]);
    questions = pool.slice(0, n).map(x => ({ ...x, input: "choice" }));
  }
  round = { subject, questions, idx: 0, correct: 0, current: "", locked: false, review: false };
  showQuestion();
}
function startReview() {
  clearAttackTimer();
  const p = prof();
  const n = p.settings.perRound || QUESTIONS_PER_ROUND;
  const pool = shuffle(p.wrong.map(w => ({ ...w })));
  const questions = pool.slice(0, Math.min(n, pool.length));
  round = { subject: "review", questions, idx: 0, correct: 0, current: "", locked: false, review: true };
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
  const out = [];
  const addChoice = (arr, subj) => arr.map(x => ({ ...x, input: "choice", subject: subj }));
  if (subject === "math") {
    return generateMathSet(grade, n, difficulty()).map(q => ({ ...q, subject: "math" }));
  }
  if (subject === "mix") {
    // 算数＋各教科をまぜる
    let pool = generateMathSet(grade, Math.ceil(n / 2), difficulty()).map(q => ({ ...q, subject: "math" }));
    for (const s of ["kokugo", "english", "other"]) pool = pool.concat(addChoice(DATA[grade][s], s));
    return shuffle(pool).slice(0, n);
  }
  // 単一教科（選択式）：足りなければ繰り返して n 問に
  let base = addChoice(DATA[grade][subject], subject);
  while (base.length < n) base = base.concat(addChoice(DATA[grade][subject], subject));
  return shuffle(base).slice(0, n);
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
    </div>` : "";

  const bodyNumber = q.input === "number" ? `
    <div class="answer-box" id="answerBox"></div>
    <div class="keypad">
      ${[1,2,3,4,5,6,7,8,9].map(n => `<button class="key" data-k="${n}">${n}</button>`).join("")}
      <button class="key del" data-k="del">⌫</button>
      <button class="key" data-k="0">0</button>
      <button class="key" data-k="dot">・</button>
      <button class="key ok" data-k="ok">こたえる</button>
    </div>` : "";

  const label = round.review ? "🩹 ふくしゅう" : subjectName(round.subject);
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
      ${q.prompt ? `<div class="prompt">${q.prompt}</div>` : ""}
      ${q.svg || ""}
      ${q.q ? `<div class="q ${q.q.length > 12 ? "small" : ""}">${q.q}</div>` : ""}
    </div>
    ${bodyChoice}${bodyNumber}
    <div class="feedback" id="feedback"></div>
    <button class="memo-toggle" id="memoToggle">✏️ メモ（けいさん用）</button>
    <div class="memo-wrap" id="memoWrap" style="display:none">
      <canvas id="memoCanvas" class="memo-canvas"></canvas>
      <button class="key del memo-clear" id="memoClear">メモを けす</button>
    </div>
  `);

  round.locked = false; round.current = "";
  document.getElementById("speakBtn").onclick = () => speak(toReadable(q), true);
  if (choices) {
    screen().querySelectorAll("[data-choice]").forEach(b =>
      b.onclick = () => answerChoice(b, decodeURIComponent(b.dataset.choice)));
  } else {
    screen().querySelectorAll("[data-k]").forEach(b => b.onclick = () => keypad(b.dataset.k));
  }
  setupMemo();
  speak(toReadable(q)); // 自動よみあげ（設定オン時）
}

/* けいさん用メモ（手書き）— 各問題ごとにまっさら、開閉はラウンド中いじ */
let memoOpen = false, memoSketch = null;
function setupMemo() {
  const wrap = document.getElementById("memoWrap");
  const toggle = document.getElementById("memoToggle");
  if (!wrap || !toggle) return;
  const openIt = () => {
    wrap.style.display = "block";
    toggle.textContent = "✏️ メモを とじる";
    memoSketch = makeSketch(document.getElementById("memoCanvas"), { color: "#2b6ad4", width: 4 });
  };
  if (memoOpen) openIt();
  toggle.onclick = () => {
    memoOpen = !memoOpen;
    if (memoOpen) openIt();
    else { wrap.style.display = "none"; toggle.textContent = "✏️ メモ（けいさん用）"; memoSketch = null; }
  };
  const clr = document.getElementById("memoClear");
  if (clr) clr.onclick = () => memoSketch && memoSketch.clear();
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
  finishQuestion(ok);
}

function submitAnswer(value) {
  round.locked = true;
  const q = round.questions[round.idx];
  finishQuestion(value === q.answer);
}

function finishQuestion(ok) {
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
    if (round.review) { if (removeWrong(subj, q)) p.reviewCleared++; }
    else if (!round.timed) removeWrong(subj, q);
  } else {
    if (round.timed) round.combo = 0;
    fb.textContent = `おしい！ こたえは「${q.answer}」`;
    fb.className = "feedback ng";
    beep("ng");
    if (!round.review && !round.timed) addWrong(subj, q);
  }
  // 統計（タイムアタックは除外して純粋な学習ログを保つ）
  if (!round.timed && p.stats[subj]) { p.stats[subj].a++; if (ok) p.stats[subj].c++; }

  const delay = round.timed ? (ok ? 450 : 800) : (ok ? 900 : 1600);
  round.nextTimer = setTimeout(() => {
    if (round.ended) return;
    round.idx++;
    if (round.timed) {
      if (round.idx >= round.questions.length) round.idx = 0; // 足りなければ最初へ
      showQuestion();
    } else if (round.idx < round.questions.length) showQuestion();
    else finishRound();
  }, delay);
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
  if (p.log.length > 200) p.log = p.log.slice(-200);

  const newBadges = checkBadges({ correct: round.correct, total: round.questions.length });
  saveState(); refreshTop();

  const perfect = round.correct === round.questions.length;
  const emoji = perfect ? "🏆" : round.correct >= round.questions.length * 0.6 ? "🎉" : "💪";
  if (perfect || round.correct >= round.questions.length * 0.8) confetti();

  const badgeHtml = newBadges.map(id => {
    const b = BADGES.find(x => x.id === id);
    return `<div class="badge-pop">🎊 あたらしいバッジ ${b.emoji} 「${b.name}」ゲット！</div>`;
  }).join("");

  const reviewNote = round.review
    ? `<div class="reward">のこりの にがて問題：${p.wrong.length}問</div>` : "";
  const againLabel = round.review ? "もういちど ふくしゅう" : `もういちど ${subjectName(round.subject)}`;
  const againDisabled = round.review && p.wrong.length === 0;

  render(`
    <div class="result">
      <div class="big-emoji">${emoji}</div>
      <div class="score">${round.correct} / ${round.questions.length} 問せいかい</div>
      <div class="reward">コインを ${gained}🪙 ゲット！${perfect ? "（ぜんもん正かいボーナス+20）" : ""}</div>
      ${reviewNote}
      ${badgeHtml}
      ${againDisabled
        ? `<div class="badge-pop">🎉 にがてを ぜんぶ こくふく！</div>`
        : `<button class="big-btn green" id="againBtn">${againLabel}</button>`}
      <button class="big-btn blue" id="otherBtn">ホームに もどる</button>
    </div>
  `);
  if (!againDisabled) document.getElementById("againBtn").onclick = () => round.review ? startReview() : startRound(round.subject);
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
  writeState = { set, idx: 0, opacityStep: 0 };
  showWritingCard();
}

const OP_LABEL = ["こい", "うすい", "なし"];
function showWritingCard() {
  const { set, idx } = writeState;
  const item = set.chars[idx];
  const total = set.chars.length;
  const pct = (idx / total) * 100;
  const showYomi = item.yomi && item.yomi !== item.c;
  const ds = STROKES[item.c];
  const op = MODEL_OPACITY[writeState.opacityStep];

  // お手本レイヤー（筆順データがあればSVG、なければフォント文字）
  const modelLayer = ds
    ? `<svg class="pad-model-svg" id="modelSvg" viewBox="0 0 109 109" style="opacity:${op}">
         ${ds.map(d => `<path d="${d}"/>`).join("")}</svg>`
    : `<div class="pad-model" id="modelSvg" style="opacity:${op}">${item.c}</div>`;
  // 書き順アニメ用レイヤー（最初は非表示）
  const orderLayer = ds
    ? `<svg class="pad-order-svg" id="orderSvg" viewBox="0 0 109 109">
         ${ds.map(d => `<path d="${d}" pathLength="1"/>`).join("")}</svg>` : "";

  render(`
    <div class="quiz-head">
      <span class="qnum">${idx + 1}/${total}</span>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <span class="qnum">✍️ ${set.name}</span>
    </div>
    ${showYomi ? `<p class="subtitle" style="text-align:center;margin:2px 0 8px">よみ：${item.yomi}　<button class="speak-inline" id="speakBtn">🔊</button>　<span class="hint">${ds ? ds.length + "かく" : ""}</span></p>`
               : `<div style="text-align:center;margin-bottom:6px"><button class="speak-inline" id="speakBtn">🔊 きく</button>　<span class="hint">${ds ? ds.length + "かく" : ""}</span></div>`}
    <div class="pad-wrap">
      ${modelLayer}
      ${orderLayer}
      <canvas id="padCanvas" class="pad-canvas"></canvas>
    </div>
    <div class="pad-controls pad-controls-3">
      <button class="key" id="orderBtn" ${ds ? "" : "disabled"}>▶ 書き順</button>
      <button class="key" id="modelBtn">お手本 ${OP_LABEL[writeState.opacityStep]}</button>
      <button class="key del" id="clearBtn">けす</button>
    </div>
    <button class="big-btn green" id="doneBtn">かけた！ つぎへ ➡️</button>
    <button class="big-btn ghost" id="quitBtn" style="margin-top:10px">やめる</button>
    <div class="feedback" id="feedback"></div>
  `);

  setupPad();
  document.getElementById("speakBtn").onclick = () => speak(item.yomi || item.c, true);
  document.getElementById("modelBtn").onclick = () => {
    writeState.opacityStep = (writeState.opacityStep + 1) % MODEL_OPACITY.length;
    document.getElementById("modelSvg").style.opacity = MODEL_OPACITY[writeState.opacityStep];
    document.getElementById("modelBtn").textContent = "お手本 " + OP_LABEL[writeState.opacityStep];
  };
  document.getElementById("clearBtn").onclick = clearPad;
  document.getElementById("doneBtn").onclick = writingDone;
  document.getElementById("quitBtn").onclick = showWritingMenu;
  if (ds) document.getElementById("orderBtn").onclick = animateStrokes;

  speak(item.yomi || item.c);   // 自動よみあげ（設定オン時）
  if (ds) setTimeout(animateStrokes, 350);  // カード表示時に書き順を1回さいせい
}

/* 書き順アニメ：ストロークを1画ずつ描く */
let strokeTimers = [];
function animateStrokes() {
  const svg = document.getElementById("orderSvg");
  if (!svg) return;
  strokeTimers.forEach(clearTimeout); strokeTimers = [];
  const paths = [...svg.querySelectorAll("path")];
  paths.forEach(p => { p.style.transition = "none"; p.style.strokeDashoffset = "1"; p.style.opacity = "1"; });
  void svg.getBoundingClientRect(); // reflow
  let t = 0;
  paths.forEach((p, i) => {
    const dur = 460, gap = 170;
    strokeTimers.push(setTimeout(() => {
      p.style.transition = `stroke-dashoffset ${dur}ms linear`;
      p.style.strokeDashoffset = "0";
    }, t));
    t += dur + gap;
  });
}

/* 指／マウス／スタイラスで描けるキャンバスを用意する共通関数 */
function makeSketch(canvas, { color = "#3a2b1a", width = 12 } = {}) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = color;
  let drawing = false;
  const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener("pointerdown", e => {
    drawing = true; canvas.setPointerCapture(e.pointerId);
    const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke();
  });
  canvas.addEventListener("pointermove", e => { if (!drawing) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); });
  const stop = () => { drawing = false; };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
  canvas.addEventListener("pointerleave", stop);
  return { ctx, clear: () => ctx.clearRect(0, 0, canvas.width, canvas.height) };
}

let padCtx = null, padCanvas = null;
function setupPad() {
  padCanvas = document.getElementById("padCanvas");
  padCtx = makeSketch(padCanvas, { color: "#3a2b1a", width: 12 }).ctx;
}
function clearPad() { if (padCtx && padCanvas) padCtx.clearRect(0, 0, padCanvas.width, padCanvas.height); }

function writingDone() {
  const p = prof();
  p.coins += 5; p.writeCount++;
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
      const fb = document.getElementById("feedback");
      if (fb) { fb.className = "feedback ok"; fb.textContent = `🎊 ${b.emoji} 「${b.name}」ゲット！`; }
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
      <div class="reward">${total}文字 れんしゅう！ コイン ${total * 5}🪙 ゲット！</div>
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
  for (let i = 13; i >= 0; i--) {
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
      <div class="stat-row"><span>にがて こくふく数</span><b>${p.reviewCleared}問</b></div>
      <div class="stat-row"><span>かきとり れんしゅう</span><b>${p.writeCount}文字</b></div>
      <div class="stat-row"><span>タイムアタック さいこう</span><b>${p.bestAttack}問</b></div>
      <div style="margin-top:10px" class="calendar">${cal}</div>
      <div class="hint" style="margin-top:6px">💮 = べんきょうした日（直近14日）</div>
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

    <button class="big-btn" id="backBtn">もどる</button>
  `);

  document.getElementById("difficulty").onchange = e => { p.settings.difficulty = e.target.value; saveState(); };
  document.getElementById("perRound").onchange = e => { p.settings.perRound = +e.target.value; saveState(); };
  document.getElementById("sound").onchange = e => { p.settings.sound = e.target.value === "on"; saveState(); };
  document.getElementById("speak").onchange = e => {
    p.settings.speak = e.target.value === "on"; saveState();
    if (p.settings.speak) speak("よみあげを おんに しました", true);
  };
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
