/* ===== ミニゲーム（すきま時間に あそぶ） =====
   学習の記録（stats / wrong / log / streak）には いっさい さわらない。
   もらえるコインは 1日 GAME_COIN_CAP まで（ゲームだけで かせげないように）。
   画面を はなれるときは かならず clearGameTimers() を よぶこと。 */

const GAME_COIN_CAP = 100;   // 1日にゲームで もらえるコインの じょうげん
const MOLE_SECS = 30;        // もぐらたたきの じかん

const GAMES = [
  { id: "touch",  emoji: "🔢", name: "かずタッチ",   desc: "小さい じゅんに タッチ" },
  { id: "memory", emoji: "🧠", name: "ペアさがし",   desc: "しきと こたえを あわせる" },
  { id: "mole",   emoji: "🐹", name: "もぐらたたき", desc: "こたえの もぐらを たたく" },
];

let game = null;
let gameTimers = [];
function gameTimeout(fn, ms) { const id = setTimeout(fn, ms); gameTimers.push(id); return id; }
function clearGameTimers() {
  if (game && game.tick) { clearInterval(game.tick); game.tick = null; }
  gameTimers.forEach(clearTimeout); gameTimers = [];
}

/* ---------- コイン（1日じょうげん つき） ---------- */
function gameCoinLeft() {
  const p = prof();
  if (!p.gameCoins || p.gameCoins.date !== todayStr()) return GAME_COIN_CAP;
  return Math.max(0, GAME_COIN_CAP - p.gameCoins.got);
}
function awardGameCoins(n) {
  const p = prof(); const today = todayStr();
  if (!p.gameCoins || p.gameCoins.date !== today) p.gameCoins = { date: today, got: 0 };
  const give = Math.max(0, Math.min(Math.round(n), GAME_COIN_CAP - p.gameCoins.got));
  p.gameCoins.got += give; p.coins += give;
  return give;
}

/* ---------- きろく（ベスト） ---------- */
function gameBest(id) { return (prof().games || {})[id] || 0; }
function setGameBest(id, val, lowerIsBetter) {
  const p = prof();
  if (!p.games) p.games = { touch: 0, memory: 0, mole: 0 };
  const cur = p.games[id] || 0;
  const better = cur === 0 || (lowerIsBetter ? val < cur : val > cur);
  if (better) p.games[id] = val;
  return better;
}
function bestLabel(id) {
  const b = gameBest(id);
  if (!b) return "きろく なし";
  if (id === "touch")  return `ベスト ${(b / 1000).toFixed(1)}びょう`;
  if (id === "memory") return `ベスト ${b}かい`;
  return `ベスト ${b}こ`;
}

/* ========== 画面：ミニゲーム えらび ========== */
function showGames() {
  leaveScreen();
  refreshTop();
  const cards = GAMES.map(g => `
    <button class="card game-card" data-game="${g.id}">
      <span class="emoji">${g.emoji}</span>
      <span class="name">${g.name}</span>
      <span class="desc">${g.desc}</span>
      <span class="best">🏅 ${bestLabel(g.id)}</span>
    </button>`).join("");
  render(`
    <h1 class="title">ミニゲーム 🎮</h1>
    <p class="subtitle">30びょうくらいで あそべる！ あたまの たいそうに どうぞ</p>
    <div class="grid game-grid">${cards}</div>
    <p class="hint" style="text-align:center;margin-top:14px">
      ゲームで もらえるコインは 1日 ${GAME_COIN_CAP}🪙 まで（きょうの のこり ${gameCoinLeft()}🪙）
    </p>
    <button class="big-btn" id="backBtn">もどる</button>
  `);
  screen().querySelectorAll("[data-game]").forEach(b => b.onclick = () => startGame(b.dataset.game));
  document.getElementById("backBtn").onclick = showHome;
}
function startGame(id) {
  if (id === "touch") startTouch();
  else if (id === "memory") startMemory();
  else startMole();
}

/* ========== 結果（3ゲーム共通） ========== */
function endGame(o) {
  clearGameTimers();
  const isBest = setGameBest(o.id, o.value, !!o.lower);
  const gained = awardGameCoins(o.coins);
  const earned = checkBadges(null);
  saveState(); refreshTop();
  if (isBest || o.celebrate) confetti();

  const badgeHtml = earned.map(id => {
    const b = BADGES.find(x => x.id === id);
    return `<div class="badge-pop">🎊 あたらしいバッジ ${b.emoji} 「${b.name}」ゲット！</div>`;
  }).join("");

  render(`
    <div class="result">
      <div class="big-emoji">${o.emoji}</div>
      <div class="score">${o.score}</div>
      ${o.detail ? `<div class="reward">${o.detail}</div>` : ""}
      ${isBest ? `<div class="badge-pop">🏅 じこ さいこう記録こうしん！</div>` : ""}
      <div class="reward">
        コイン ${gained}🪙 ゲット！
        ${gained < Math.round(o.coins) ? `<br><span class="hint">きょうの ゲームコインは じょうげんに とどきました</span>` : ""}
      </div>
      ${badgeHtml}
      <button class="big-btn green" id="againBtn">もういちど</button>
      <button class="big-btn blue" id="menuBtn">ほかの ゲーム</button>
      <button class="big-btn ghost" id="homeBtn2" style="margin-top:10px">ホームに もどる</button>
    </div>
  `);
  document.getElementById("againBtn").onclick = () => startGame(o.id);
  document.getElementById("menuBtn").onclick = showGames;
  document.getElementById("homeBtn2").onclick = showHome;
}

/* ========== ゲーム1：かずタッチ ==========
   小さい じゅんに タッチ。1年生は 1〜n の せいすう、
   5年生は 分数・小数・せいすうを まぜて 大小くらべの れんしゅうに なる。 */
const TOUCH_VALUES_G5 = [
  { label: "1/2", v: 0.5 },  { label: "0.75", v: 0.75 }, { label: "1", v: 1 },    { label: "1.2", v: 1.2 },
  { label: "3/2", v: 1.5 },  { label: "1.8", v: 1.8 },   { label: "2", v: 2 },    { label: "9/4", v: 2.25 },
  { label: "2.5", v: 2.5 },  { label: "3", v: 3 },       { label: "7/2", v: 3.5 },{ label: "3.8", v: 3.8 },
  { label: "4", v: 4 },      { label: "4.5", v: 4.5 },   { label: "19/4", v: 4.75 }, { label: "5", v: 5 },
];
function touchCount() { const d = difficulty(); return d === "easy" ? 9 : d === "hard" ? 16 : 12; }
function touchTiles(n) {
  if (state.grade === "g5") {
    return shuffle(TOUCH_VALUES_G5.slice()).slice(0, n).sort((a, b) => a.v - b.v);
  }
  return Array.from({ length: n }, (_, i) => ({ label: String(i + 1), v: i + 1 }));
}

function startTouch() {
  leaveScreen();
  const n = touchCount();
  const order = touchTiles(n);                       // 小さい じゅん
  const board = shuffle(order.map((t, i) => ({ ...t, i })));  // ならべる じゅん
  game = { kind: "touch", order, next: 0, startAt: 0, penalty: 0, tick: null };

  const cols = n <= 9 ? 3 : 4;
  render(`
    <div class="game-head">
      <span class="qnum">🔢 かずタッチ</span>
      <span class="game-timer" id="gTime">0.0</span>
      <span class="qnum" id="gProg">0/${n}</span>
    </div>
    <p class="subtitle" style="text-align:center">小さい じゅんに タッチ！<br>
      <span class="hint">まちがえると +1びょう</span></p>
    <div class="touch-grid" style="grid-template-columns:repeat(${cols},1fr)">
      ${board.map(t => `<button class="touch-tile" data-i="${t.i}">${t.label}</button>`).join("")}
    </div>
    <button class="big-btn ghost" id="quitBtn">やめる</button>
  `);
  screen().querySelectorAll("[data-i]").forEach(b => b.onclick = () => touchTap(b));
  document.getElementById("quitBtn").onclick = showGames;
}

function touchTap(btn) {
  if (!game || game.kind !== "touch") return;
  const i = +btn.dataset.i;
  if (btn.disabled) return;
  if (i !== game.next) {                       // じゅんばんが ちがう
    game.penalty += 1000;
    btn.classList.add("shake");
    gameTimeout(() => btn.classList.remove("shake"), 400);
    beep("ng");
    return;
  }
  if (game.next === 0) {                       // 1つめの タッチで 時計スタート
    game.startAt = Date.now();
    game.tick = setInterval(() => {
      const el = document.getElementById("gTime");
      if (el) el.textContent = ((Date.now() - game.startAt + game.penalty) / 1000).toFixed(1);
    }, 100);
  }
  btn.classList.add("done"); btn.disabled = true;
  game.next++;
  const prog = document.getElementById("gProg");
  if (prog) prog.textContent = `${game.next}/${game.order.length}`;
  if (game.next >= game.order.length) finishTouch();
}

function finishTouch() {
  const ms = Date.now() - game.startAt + game.penalty;
  beep("ok");
  const sec = ms / 1000;
  endGame({
    id: "touch", value: ms, lower: true, emoji: "⏱️",
    score: `${sec.toFixed(1)} びょう`,
    detail: `${game.order.length}こ タッチ！` + (game.penalty ? `<br><span class="hint">おてつき ${game.penalty / 1000}回（+${game.penalty / 1000}びょう）</span>` : ""),
    coins: Math.max(5, 45 - Math.round(sec)),
    celebrate: sec <= 12,
  });
}

/* ========== ゲーム2：ペアさがし（しんけいすいじゃく） ==========
   「しき」と「こたえ」の カードを あわせる。こたえは かならず ぜんぶ ちがう数にする。 */
function memoryPairCount() { const d = difficulty(); return d === "easy" ? 4 : d === "hard" ? 8 : 6; }
function memoryPairG1() {
  const d = difficulty();
  const max = d === "easy" ? 10 : 18;
  const a = 1 + Math.floor(Math.random() * (max - 1));
  const b = 1 + Math.floor(Math.random() * (max - a));
  return Math.random() < 0.5 ? { q: `${a}+${b}`, a: a + b } : { q: `${a + b}-${b}`, a: a };
}
function memoryPairG5() {
  const r = Math.random();
  if (r < 0.45) {
    const a = 2 + Math.floor(Math.random() * 11), b = 2 + Math.floor(Math.random() * 8);
    return { q: `${a}×${b}`, a: a * b };
  }
  if (r < 0.8) {
    const b = 2 + Math.floor(Math.random() * 8), ans = 2 + Math.floor(Math.random() * 11);
    return { q: `${ans * b}÷${b}`, a: ans };
  }
  const a = 2 + Math.floor(Math.random() * 9);
  return { q: `${a}×0.5`, a: a * 0.5 };
}
function memoryPairs(n) {
  const seen = new Set(), out = [];
  for (let guard = 0; guard < 500 && out.length < n; guard++) {
    const p = state.grade === "g5" ? memoryPairG5() : memoryPairG1();
    if (seen.has(p.a)) continue;               // こたえが かぶると あわせられないので さける
    seen.add(p.a); out.push(p);
  }
  return out;
}

function startMemory() {
  leaveScreen();
  const pairs = memoryPairs(memoryPairCount());
  const cards = shuffle(pairs.flatMap((p, i) => [
    { id: i, text: p.q }, { id: i, text: String(p.a) },
  ]));
  game = { kind: "memory", cards, open: [], done: 0, flips: 0, pairs: pairs.length, lock: false, startAt: Date.now(), tick: null };

  render(`
    <div class="game-head">
      <span class="qnum">🧠 ペアさがし</span>
      <span class="game-timer" id="gTime">0.0</span>
      <span class="qnum" id="gFlips">0かい</span>
    </div>
    <p class="subtitle" style="text-align:center">しきと こたえの ペアを さがそう！</p>
    <div class="mem-grid">
      ${cards.map((c, i) => `
        <button class="mem-card" data-c="${i}">
          <span class="mem-back">❓</span>
          <span class="mem-face">${c.text}</span>
        </button>`).join("")}
    </div>
    <button class="big-btn ghost" id="quitBtn">やめる</button>
  `);
  game.tick = setInterval(() => {
    const el = document.getElementById("gTime");
    if (el) el.textContent = ((Date.now() - game.startAt) / 1000).toFixed(1);
  }, 100);
  screen().querySelectorAll("[data-c]").forEach(b => b.onclick = () => memoryTap(b));
  document.getElementById("quitBtn").onclick = showGames;
}

function memoryTap(btn) {
  if (!game || game.kind !== "memory" || game.lock) return;
  const i = +btn.dataset.c;
  const card = game.cards[i];
  if (card.matched || game.open.some(o => o.i === i)) return;
  btn.classList.add("on");
  game.open.push({ i, btn });
  if (game.open.length < 2) return;

  game.flips++;
  document.getElementById("gFlips").textContent = `${game.flips}かい`;
  const [x, y] = game.open;
  if (game.cards[x.i].id === game.cards[y.i].id) {          // ペアせいりつ
    game.cards[x.i].matched = game.cards[y.i].matched = true;
    x.btn.classList.add("match"); y.btn.classList.add("match");
    game.open = [];
    game.done++;
    beep("ok");
    if (game.done >= game.pairs) gameTimeout(finishMemory, 400);
  } else {
    game.lock = true;
    beep("ng");
    gameTimeout(() => {
      x.btn.classList.remove("on"); y.btn.classList.remove("on");
      game.open = []; game.lock = false;
    }, 750);
  }
}

function finishMemory() {
  const sec = (Date.now() - game.startAt) / 1000;
  const flips = game.flips, pairs = game.pairs;
  endGame({
    id: "memory", value: flips, lower: true, emoji: "🧠",
    score: `${flips}かいで クリア！`,
    detail: `${pairs}ペア／${sec.toFixed(1)}びょう` + (flips === pairs ? `<br>むだなし パーフェクト！ ✨` : ""),
    coins: Math.max(5, 40 - (flips - pairs) * 3),
    celebrate: flips <= pairs + 2,
  });
}

/* ========== ゲーム3：もぐらたたき ==========
   「こたえが ○○ の しき」の もぐらだけ たたく。あたまの中で 計算して すばやく はんだん。 */
function moleSpeed() {
  const d = difficulty();
  if (d === "easy")  return { spawn: 650, life: 2200 };
  if (d === "hard")  return { spawn: 380, life: 1300 };
  return { spawn: 480, life: 1700 };
}
function moleTarget() {
  if (state.grade === "g5") {
    const a = 2 + Math.floor(Math.random() * 8), b = 3 + Math.floor(Math.random() * 8);
    return a * b;
  }
  return 5 + Math.floor(Math.random() * 14);        // 5〜18
}
/* v に なる しきを 1つ つくる */
function moleExpr(v) {
  if (state.grade === "g5") {
    const opts = [];
    for (let k = 2; k <= 12; k++) if (v % k === 0 && v / k >= 2 && v / k <= 12) opts.push(`${k}×${v / k}`);
    for (let k = 2; k <= 9; k++) opts.push(`${v * k}÷${k}`);
    return opts[Math.floor(Math.random() * opts.length)];
  }
  if (v >= 2 && Math.random() < 0.55) {
    const a = 1 + Math.floor(Math.random() * (v - 1));
    return `${a}+${v - a}`;
  }
  const b = 1 + Math.floor(Math.random() * 5);
  return `${v + b}-${b}`;
}
/* target いがいの 近い数を 1つ えらぶ */
function moleOtherValue(target) {
  for (let i = 0; i < 20; i++) {
    const d = 1 + Math.floor(Math.random() * (state.grade === "g5" ? 9 : 4));
    const v = target + (Math.random() < 0.5 ? -d : d);
    const min = state.grade === "g5" ? 4 : 1;
    if (v !== target && v >= min) return v;
  }
  return target + 1;
}

function startMole() {
  leaveScreen();
  const secs = MOLE_SECS;
  game = {
    kind: "mole", score: 0, combo: 0, maxCombo: 0, hits: 0,
    target: moleTarget(), holes: new Array(9).fill(null),
    speed: moleSpeed(), nextSpawn: 0, nextTarget: Date.now() + 7000,
    timeTotal: secs * 1000, endAt: Date.now() + secs * 1000, ended: false, tick: null,
  };
  render(`
    <div class="quiz-head">
      <span class="qnum" id="mScore">⚡0こ</span>
      <div class="ta-bar"><i id="mBar" style="width:100%"></i></div>
      <span class="qnum ta-sec" id="mSec">${secs}</span>
    </div>
    <div class="mole-target">こたえが <b id="mTarget">${game.target}</b> の もぐらを たたこう！</div>
    <div class="mole-grid" id="moleGrid">
      ${[...Array(9)].map((_, i) => `
        <div class="hole" data-h="${i}">
          <div class="mole"><span class="m-emoji">🐹</span><span class="m-expr"></span></div>
        </div>`).join("")}
    </div>
    <div class="combo" id="mCombo"></div>
    <button class="big-btn ghost" id="quitBtn">やめる</button>
  `);
  screen().querySelectorAll("[data-h]").forEach(h => h.onclick = () => moleHit(+h.dataset.h));
  document.getElementById("quitBtn").onclick = showGames;
  game.tick = setInterval(moleTick, 100);
}

function moleTick() {
  if (!game || game.kind !== "mole" || game.ended) return;
  const now = Date.now();
  const left = Math.max(0, game.endAt - now);

  const bar = document.getElementById("mBar"), sec = document.getElementById("mSec");
  if (bar) bar.style.width = (left / game.timeTotal) * 100 + "%";
  if (sec) { const s = Math.ceil(left / 1000); sec.textContent = s; sec.classList.toggle("urgent", s <= 10); }
  if (left <= 0) { finishMole(); return; }

  // ひっこめる
  game.holes.forEach((m, i) => { if (m && now > m.until) moleHide(i); });

  // ときどき おだいを かえる
  if (now >= game.nextTarget) {
    game.target = moleTarget();
    game.nextTarget = now + 7000;
    const t = document.getElementById("mTarget");
    if (t) { t.textContent = game.target; t.classList.remove("flash"); void t.offsetWidth; t.classList.add("flash"); }
  }

  // 出す
  if (now >= game.nextSpawn) {
    const empty = game.holes.map((m, i) => m ? -1 : i).filter(i => i >= 0);
    if (empty.length) {
      const i = empty[Math.floor(Math.random() * empty.length)];
      const v = Math.random() < 0.45 ? game.target : moleOtherValue(game.target);
      moleShow(i, v);
    }
    const sp = game.speed.spawn;
    game.nextSpawn = now + sp * (0.6 + Math.random() * 0.8);
  }
}

function moleEl(i) { return screen().querySelector(`[data-h="${i}"] .mole`); }
function moleShow(i, v) {
  game.holes[i] = { v, until: Date.now() + game.speed.life };
  const el = moleEl(i);
  if (!el) return;
  el.querySelector(".m-expr").textContent = moleExpr(v);
  el.classList.remove("hit", "miss");
  el.classList.add("up");
}
function moleHide(i) {
  game.holes[i] = null;
  const el = moleEl(i);
  if (el) el.classList.remove("up", "hit", "miss");
}

function moleHit(i) {
  if (!game || game.kind !== "mole" || game.ended) return;
  const m = game.holes[i];
  if (!m || m.dead) return;
  const el = moleEl(i);
  // たたいた あとは 少しのあいだ「たたかれた すがた」で のこす（tick が ひっこめる）
  const keep = ms => { game.holes[i] = { v: null, until: Date.now() + ms, dead: true }; };
  if (m.v === game.target) {
    game.score++; game.hits++;
    game.combo++; game.maxCombo = Math.max(game.maxCombo, game.combo);
    beep("ok");
    if (el) el.classList.add("hit");
    keep(200);
    if (game.hits % 5 === 0) game.nextTarget = 0;   // 5こ たたいたら つぎの おだいへ
  } else {
    game.score = Math.max(0, game.score - 1);
    game.combo = 0;
    beep("ng");
    if (el) el.classList.add("miss");
    keep(300);
  }
  const s = document.getElementById("mScore");
  if (s) s.textContent = `⚡${game.score}こ`;
  const c = document.getElementById("mCombo");
  if (c) c.textContent = game.combo >= 3 ? `🔥 ${game.combo} コンボ！` : "";
}

function finishMole() {
  if (game.ended) return;
  game.ended = true;
  endGame({
    id: "mole", value: game.score, lower: false, emoji: "🐹",
    score: `${game.score}こ たたいた！`,
    detail: game.maxCombo >= 3 ? `さいだい ${game.maxCombo} コンボ 🔥` : "",
    coins: game.score * 2 + game.maxCombo,
    celebrate: game.score >= 15,
  });
}
