/* ===== なつやすみ スタディ：本体 ===== */

const STORE_KEY = "natsuyasumi_v1";
const QUESTIONS_PER_ROUND = 10;

/* ---------- じょうたい（保存データ） ---------- */
function freshProfile() {
  return {
    coins: 0, streak: 0, lastStudyDate: null,
    badges: [],
    stats: { math: { a: 0, c: 0 }, kokugo: { a: 0, c: 0 }, english: { a: 0, c: 0 }, other: { a: 0, c: 0 } },
    log: [], // {date, subject, correct, total}
    settings: { sound: true, perRound: QUESTIONS_PER_ROUND },
  };
}
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.profiles) return s;
  } catch (e) {}
  return { grade: "g1", profiles: { g1: freshProfile(), g5: freshProfile() } };
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

/* ---------- バッジ判定 ---------- */
function checkBadges(roundResult) {
  const p = prof(); const earned = [];
  const has = id => p.badges.includes(id);
  const grant = id => { if (!has(id)) { p.badges.push(id); earned.push(id); } };

  grant("first");
  if (p.streak >= 3) grant("streak3");
  if (p.streak >= 7) grant("streak7");
  if (roundResult && roundResult.correct === roundResult.total) grant("perfect");
  if (p.coins >= 100) grant("coins100");
  if (p.coins >= 500) grant("coins500");
  if (p.stats.math.a >= 50) grant("math50");
  if (["math", "kokugo", "english", "other"].every(s => p.stats[s].a > 0)) grant("allsubj");
  return earned;
}

/* ---------- 画面ユーティリティ ---------- */
const screen = () => document.getElementById("screen");
function render(html) { screen().innerHTML = html; window.scrollTo(0, 0); }
function refreshTop() {
  document.getElementById("coinCount").textContent = prof().coins;
  document.getElementById("streakCount").textContent = prof().streak;
  document.getElementById("gradePill").textContent = state.grade === "g1" ? "1年生" : "5年生";
}

/* ========== 画面：グレード選択 ========== */
function showGradeSelect() {
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
  render(`
    <h1 class="title">きょうの べんきょう ✏️</h1>
    <p class="subtitle">${streakMsg}　教科を えらんでね</p>
    <div class="grid">${cards}</div>
    <button class="big-btn ghost" id="badgeBtn">🏅 あつめた バッジを みる</button>
  `);
  screen().querySelectorAll("[data-subject]").forEach(b =>
    b.onclick = () => startRound(b.dataset.subject));
  document.getElementById("badgeBtn").onclick = showBadges;
}

/* ========== ラウンド（クイズ） ========== */
let round = null;
function startRound(subject) {
  const n = prof().settings.perRound || QUESTIONS_PER_ROUND;
  let questions;
  if (subject === "math") {
    questions = generateMathSet(state.grade, n);
  } else {
    const pool = [...DATA[state.grade][subject]];
    // シャッフルして n問
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    questions = pool.slice(0, n).map(x => ({ ...x, input: "choice" }));
  }
  round = { subject, questions, idx: 0, correct: 0, current: "", locked: false };
  showQuestion();
}

function subjectName(id) { return SUBJECTS[state.grade].find(s => s.id === id).name; }

function showQuestion() {
  const q = round.questions[round.idx];
  const total = round.questions.length;
  const pct = (round.idx / total) * 100;

  // 選択肢はシャッフル
  let choices = q.choices ? [...q.choices] : null;
  if (choices) for (let i = choices.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [choices[i], choices[j]] = [choices[j], choices[i]]; }

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

  render(`
    <div class="quiz-head">
      <span class="qnum">${round.idx + 1}/${total}</span>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <span class="qnum">${subjectName(round.subject)}</span>
    </div>
    <div class="question-card">
      ${q.prompt ? `<div class="prompt">${q.prompt}</div>` : ""}
      ${q.svg || ""}
      ${q.q ? `<div class="q ${q.q.length > 12 ? "small" : ""}">${q.q}</div>` : ""}
    </div>
    ${bodyChoice}${bodyNumber}
    <div class="feedback" id="feedback"></div>
  `);

  round.locked = false; round.current = "";
  if (choices) {
    screen().querySelectorAll("[data-choice]").forEach(b =>
      b.onclick = () => answerChoice(b, decodeURIComponent(b.dataset.choice)));
  } else {
    screen().querySelectorAll("[data-k]").forEach(b => b.onclick = () => keypad(b.dataset.k));
  }
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
  finishQuestion(ok, q.answer);
}

function submitAnswer(value) {
  round.locked = true;
  const q = round.questions[round.idx];
  const ok = value === q.answer;
  finishQuestion(ok, q.answer);
}

function finishQuestion(ok, correctAnswer) {
  const fb = document.getElementById("feedback");
  if (ok) {
    round.correct++;
    fb.textContent = "せいかい！ ⭕ +10🪙";
    fb.className = "feedback ok";
    beep("ok");
  } else {
    fb.textContent = `おしい！ こたえは「${correctAnswer}」`;
    fb.className = "feedback ng";
    beep("ng");
  }
  // 統計
  const st = prof().stats[round.subject];
  st.a++; if (ok) st.c++;

  setTimeout(() => {
    round.idx++;
    if (round.idx < round.questions.length) showQuestion();
    else finishRound();
  }, ok ? 900 : 1600);
}

/* ========== ラウンド終了 ========== */
function finishRound() {
  const p = prof();
  const gained = round.correct * 10 + (round.correct === round.questions.length ? 20 : 0);
  p.coins += gained;

  // ストリーク更新（1日1回）
  const today = todayStr();
  if (p.lastStudyDate !== today) {
    if (p.lastStudyDate && daysBetween(p.lastStudyDate, today) === 1) p.streak++;
    else p.streak = 1;
    p.lastStudyDate = today;
  }
  // ログ
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

  render(`
    <div class="result">
      <div class="big-emoji">${emoji}</div>
      <div class="score">${round.correct} / ${round.questions.length} 問せいかい</div>
      <div class="reward">コインを ${gained}🪙 ゲット！${perfect ? "（ぜんもん正かいボーナス+20）" : ""}</div>
      ${badgeHtml}
      <button class="big-btn green" id="againBtn">もういちど ${subjectName(round.subject)}</button>
      <button class="big-btn blue" id="otherBtn">ほかの教科を やる</button>
    </div>
  `);
  document.getElementById("againBtn").onclick = () => startRound(round.subject);
  document.getElementById("otherBtn").onclick = showHome;
}

/* ========== 画面：バッジ ========== */
function showBadges() {
  const p = prof();
  const list = BADGES.map(b => {
    const got = p.badges.includes(b.id);
    return `<div class="badge ${got ? "" : "locked"}">
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

/* ========== 画面：ほごしゃ ========== */
function showParent() {
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

  // 直近14日カレンダー
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
      <button class="big-btn ghost" id="resetBtn" style="margin-top:16px;color:#ff5a5a">この学年のデータを けす</button>
    </div>

    <button class="big-btn" id="backBtn">もどる</button>
  `);

  document.getElementById("perRound").onchange = e => { p.settings.perRound = +e.target.value; saveState(); };
  document.getElementById("sound").onchange = e => { p.settings.sound = e.target.value === "on"; saveState(); };
  document.getElementById("resetBtn").onclick = () => {
    if (confirm("この学年の コイン・バッジ・きろくを ぜんぶ けしますか？")) {
      state.profiles[state.grade] = freshProfile(); saveState(); refreshTop(); showParent();
    }
  };
  document.getElementById("backBtn").onclick = showHome;
}

/* ---------- ヘッダーのボタン ---------- */
document.getElementById("homeBtn").onclick = showGradeSelect;
document.getElementById("parentBtn").onclick = showParent;

/* ---------- Service Worker 登録（PWA） ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

/* ---------- 起動 ---------- */
refreshTop();
showHome();
