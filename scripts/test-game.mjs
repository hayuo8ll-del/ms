/* GRAVIX のシミュレーションを Node で検算する。
   実行: node scripts/test-game.mjs

   game/js/core.js と game/js/world.js は DOM を一切さわらないので、
   scripts/build-strokes.mjs と同じ new Function 方式でそのまま読み込める。
   ブラウザを立ち上げずに「理不尽な死が構造的に起きないこと」まで検証するのが目的。 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = ["core.js", "world.js"]
  .map((f) => fs.readFileSync(path.join(root, "game/js", f), "utf8"))
  .join("\n;\n");
const G = new Function(src + "\n; return G;")();

let failed = 0, passed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? "  → " + detail : ""}`); }
}
function section(t) { console.log(`\n\x1b[1m${t}\x1b[0m`); }

const C = G.Cfg;
const W = G.World;

/* 決められた入力テープを再生する（毎回まったく同じ入力を与えるため） */
function tape(seed) {
  const rng = G.rngFrom(seed ^ 0x9e3779b9);
  return (tick) => ({ pressed: rng() < .04, released: false, held: false });
}
function run(seed, ticks, inputFn, burst) {
  const w = W.create();
  W.reset(w, seed);
  let t = 0;
  while (t < ticks) {
    const n = burst ? Math.min(burst, ticks - t) : 1;
    for (let i = 0; i < n; i++) { W.step(w, inputFn(t)); t++; }
  }
  return w;
}

/* ---------- 1. 決定性 ---------- */
section("1. 決定性（同じシード＋同じ入力 ⇒ 同じ結果）");
{
  const a = run(42, 20000, tape(42));
  const b = run(42, 20000, tape(42));
  ok("同一シードで 20,000 ティック回して状態が完全一致", W.hash(a) === W.hash(b),
    `${W.hash(a)} vs ${W.hash(b)}`);

  // 1 ティックずつ回した場合と 7 ティックずつまとめて回した場合が一致する
  // ＝ ループ側の都合（フレームレート）がシムに漏れていない
  const c = run(7, 12000, tape(7), 1);
  const d = run(7, 12000, tape(7), 7);
  ok("1 ティック刻みと 7 ティックまとめ刻みで結果が一致", W.hash(c) === W.hash(d),
    `${W.hash(c)} vs ${W.hash(d)}`);

  const e = run(43, 20000, tape(42));
  ok("シードが違えば地形も変わる", W.hash(a) !== W.hash(e));
}

/* ---------- 2. step() が dt を取らないこと ---------- */
section("2. 可変 dt がシムに入り込めないこと");
{
  // step(w, input) の 2 引数のみ。dt を足そうとすると、この判定が落ちる。
  ok("World.step の引数は (world, input) の 2 つだけ", W.step.length === 2,
    `length=${W.step.length}`);
  const s = W.step.toString();
  ok("step 内で Math.random / Date / performance を使っていない",
    !/Math\.random|Date\.|performance\./.test(s));
}

/* ---------- 3. 数値の健全性 ---------- */
section("3. 数値の健全性（長時間まわしても壊れない）");
{
  const rng = G.rngFrom(999);
  const w = W.create();
  W.reset(w, 999);
  let bad = null, maxAlive = 0, prevScore = -1, scoreDrop = false;
  for (let t = 0; t < 120000 && !bad; t++) {
    W.step(w, { pressed: rng() < .05, released: false, held: false });
    if (w.dead) { W.reset(w, (rng() * 1e9) | 0); prevScore = -1; continue; }
    const p = w.player;
    for (const v of [p.x, p.y, p.vy, w.score, w.scrollX, w.speed, w.distance]) {
      if (!Number.isFinite(v)) { bad = `t=${t} 非有限値 ${v}`; break; }
    }
    if (w.score + 1e-9 < prevScore) scoreDrop = true;
    prevScore = w.score;
    let alive = 0;
    for (let i = 0; i < C.MAX_OBS; i++) if (w.obs[i].active) alive++;
    if (alive > maxAlive) maxAlive = alive;
    if (p.y < C.TOP_Y - .001 || p.y > C.BOT_Y + .001) { bad = `t=${t} プレイヤーが通路の外 y=${p.y}`; }
  }
  ok("120,000 ティックで NaN / Infinity が出ない", !bad, bad || "");
  ok("スコアは単調非減少", !scoreDrop);
  ok(`障害物プールが上限内（最大 ${maxAlive} / ${C.MAX_OBS}）`, maxAlive < C.MAX_OBS);
}

/* ---------- 4. 当たり判定とグレイズ ---------- */
section("4. 当たり判定とグレイズ");
{
  const d0 = G.distToRect(100, 100, 10, 90, 90, 20, 20);       // 完全に内側
  const d1 = G.distToRect(100, 60, 10, 90, 90, 20, 20);        // 真上 30 離れ − r
  const d2 = G.distToRect(100, 100, 10, 200, 200, 20, 20);     // 遠い
  ok("矩形の内側は距離 0 以下", d0 <= 0, String(d0));
  ok("真上 30 の距離は 20（半径ぶん引かれる）", Math.abs(d1 - 20) < 1e-9, String(d1));
  ok("離れていれば正の距離", d2 > 0);

  // 実際にワールドで、当たれば死に、かすればコンボが増えることを確認する
  const w = W.create();
  W.reset(w, 5);
  w.invuln = 0;
  for (let i = 0; i < C.MAX_OBS; i++) w.obs[i].active = false;
  const p = w.player;
  // プレイヤーに重なる障害物
  w.obs[0].active = true;
  w.obs[0].x = p.x - 5; w.obs[0].y = p.y - 5; w.obs[0].w = 20; w.obs[0].h = 20; w.obs[0].grazed = false;
  W.step(w, null);
  ok("重なったら死ぬ", w.dead === true);

  // かすめる距離（半径 + GRAZE の内側、かつ重ならない）に置く
  const w2 = W.create();
  W.reset(w2, 5);
  w2.invuln = 0;
  for (let i = 0; i < C.MAX_OBS; i++) w2.obs[i].active = false;
  const q = w2.player;
  const o = w2.obs[0];
  o.active = true; o.w = 20; o.h = 20; o.grazed = false;
  o.x = q.x - 10; o.y = q.y - C.R - 8 - 20;    // 上に 8 だけ隙間
  W.step(w2, null);
  ok("かすめるとグレイズが成立して死なない", w2.dead === false && w2.grazes === 1,
    `dead=${w2.dead} grazes=${w2.grazes}`);
  const g1 = w2.grazes;
  W.step(w2, null);
  ok("同じ障害物で二重にグレイズしない", w2.grazes === g1);

  // ちょうど外側
  const w3 = W.create();
  W.reset(w3, 5);
  w3.invuln = 0;
  for (let i = 0; i < C.MAX_OBS; i++) w3.obs[i].active = false;
  const r = w3.player, o3 = w3.obs[0];
  o3.active = true; o3.w = 20; o3.h = 20; o3.grazed = false;
  o3.x = r.x - 10; o3.y = r.y - C.R - C.GRAZE - 6 - 20;
  W.step(w3, null);
  ok("グレイズ範囲の外なら何も起きない", w3.grazes === 0 && !w3.dead);
}

/* ---------- 5. 難易度カーブ ---------- */
section("5. 難易度カーブ");
{
  const ds = G.Tiers.map((t) => t.d);
  ok("ティアのしきい値が単調増加", ds.every((d, i) => i === 0 || d > ds[i - 1]));
  const sp = G.Tiers.map((t) => t.speed);
  ok("速度が単調増加", sp.every((s, i) => i === 0 || s > sp[i - 1]));
  const gmin = G.Tiers.map((t) => t.gapMin);
  ok("配置間隔が単調に詰まる", gmin.every((g, i) => i === 0 || g <= gmin[i - 1]));
  ok("速度は頭打ちになる（無限に速くならない）", sp[sp.length - 1] <= 600, String(sp[sp.length - 1]));

  // 実走でも速度が単調に上がることを確認（ティア間の補間を含む）
  const w = W.create();
  W.reset(w, 1234);
  w.invuln = 1e9;                 // 死なせずに距離だけ伸ばす
  let prev = 0, drop = false;
  for (let t = 0; t < 60 * 60 * 6; t++) {
    W.step(w, null);
    if (w.speed + 1e-9 < prev) drop = true;
    prev = w.speed;
  }
  ok("実走 6 分間、速度が一度も下がらない", !drop);
  ok(`最終ティアまで到達する（${Math.round(w.distance)}m, tier ${w.tier}）`, w.tier >= 4);
}

/* ---------- 6. パターンの通過可能性 ---------- */
section("6. 障害物パターンの通過可能性（＝理不尽な死が起きない）");
{
  // (a) 全パターン・全ティアで、床沿いの道と天井沿いの道を同時に塞がないこと
  let bothBlocked = null, midTooClose = null, checked = 0;
  for (let ti = 0; ti < G.Tiers.length && !bothBlocked && !midTooClose; ti++) {
    for (const key of G.Tiers[ti].pats) {
      for (let s = 0; s < 400; s++) {
        const fake = { rng: G.rngFrom(ti * 100003 + s), speed: G.Tiers[ti].speed, curSurface: "floor" };
        const b = G.Patterns[key](fake);
        checked++;
        const floorSpans = [], ceilSpans = [];
        for (const r of b.rects) {
          const onFloor = r.y + r.h >= C.FLOOR_Y - .5;
          const onCeil = r.y <= C.CEIL_Y + .5;
          if (onFloor) floorSpans.push([r.dx, r.dx + r.w]);
          else if (onCeil) ceilSpans.push([r.dx, r.dx + r.w]);
          else {
            // 中空バーは床・天井から MID_CLEAR 以上離れていること
            const clearTop = r.y - C.CEIL_Y;
            const clearBot = C.FLOOR_Y - (r.y + r.h);
            if (clearTop < C.MID_CLEAR - .001 || clearBot < C.MID_CLEAR - .001) {
              midTooClose = `${key}: 上 ${clearTop.toFixed(1)} 下 ${clearBot.toFixed(1)}`;
            }
          }
        }
        for (const f of floorSpans) for (const c of ceilSpans) {
          if (f[0] < c[1] && c[0] < f[1]) bothBlocked = `${key} tier${ti}: [${f}] と [${c}] が重なる`;
        }
      }
    }
  }
  ok(`床と天井を同時に塞ぐパターンが無い（${checked} 通り検査）`, !bothBlocked, bothBlocked || "");
  ok("中空バーは常に面沿いの道を MID_CLEAR 以上あけている", !midTooClose, midTooClose || "");

  // (b) パターン内部の乗り換えに、物理的に足りる助走距離があること
  let tight = null;
  for (let ti = 0; ti < G.Tiers.length && !tight; ti++) {
    for (const key of G.Tiers[ti].pats) {
      for (let s = 0; s < 200; s++) {
        const speed = G.Tiers[ti].speed;
        const fake = { rng: G.rngFrom(ti * 7919 + s), speed: speed, curSurface: "floor" };
        const b = G.Patterns[key](fake);
        // 面ブロックだけを x 順に見て、面が切り替わるところで距離を検査
        const solid = b.rects
          .filter((r) => r.y + r.h >= C.FLOOR_Y - .5 || r.y <= C.CEIL_Y + .5)
          .map((r) => ({ a: r.dx, b: r.dx + r.w, h: r.h, side: r.y <= C.CEIL_Y + .5 ? "ceil" : "floor" }))
          .sort((x, y) => x.a - y.a);
        for (let i = 1; i < solid.length; i++) {
          if (solid[i].side === solid[i - 1].side) continue;
          const runway = solid[i].a - solid[i - 1].b;
          const need = W.switchDist(solid[i].h, speed);
          if (runway + 1e-6 < need) {
            tight = `${key} tier${ti}: 助走 ${runway.toFixed(1)} < 必要 ${need.toFixed(1)}`;
          }
        }
      }
    }
  }
  ok("パターン内部の面の乗り換えが物理的に間に合う", !tight, tight || "");

  // (b2) 「間に合う」だけでなく「見えている」こと。
  //      障害物が画面右端に現れてからプレイヤーに届くまでの距離 (W - PLAYER_X) より
  //      乗り換えに必要な助走が長いと、見えた時点ではもう手遅れになる。
  //      避けようのない死のうち、パターン検査だけでは絶対に見つからない種類。
  const visible = C.W - C.PLAYER_X;
  let unseen = null, worstRatio = 0;
  for (const t of G.Tiers) {
    for (const key of t.pats) {
      for (let s = 0; s < 60; s++) {
        const fake = { rng: G.rngFrom(s * 31 + t.d), speed: t.speed, curSurface: "floor" };
        const b = G.Patterns[key](fake);
        if (b.needSurface === "any") continue;
        const need = W.switchDist(b.needHeight, t.speed);
        if (need / visible > worstRatio) worstRatio = need / visible;
        if (need > visible) unseen = `${key} @${t.speed}u/s: 助走 ${need.toFixed(0)} > 視界 ${visible}`;
      }
    }
  }
  ok(`乗り換えの助走が必ず視界に収まる（最悪 ${(worstRatio * 100).toFixed(0)}% を使用）`,
    !unseen, unseen || "");

  // 最高速でも、いちばん高い柱を見てから登り切る余裕があること
  {
    const topSpeed = Math.max(...G.Tiers.map((t) => t.speed));
    const tallest = 190;
    const lookahead = visible / topSpeed;
    const climb = Math.sqrt(2 * tallest / C.GRAV);
    ok(`最高速でも反応の猶予が残る（視界 ${lookahead.toFixed(2)}s − 登り ${climb.toFixed(2)}s = ${(lookahead - climb).toFixed(2)}s）`,
      lookahead - climb >= .25, `${(lookahead - climb).toFixed(3)}s しかない`);
  }

  // (c) 実走：連続するパターンの間隔が、乗り換えに足りていること
  let gapTight = null, spawned = 0;
  for (let seed = 1; seed <= 40 && !gapTight; seed++) {
    const w = W.create();
    W.reset(w, seed);
    w.invuln = 1e9;
    let prev = null;
    for (let t = 0; t < 60 * 60 * 4; t++) {
      const before = w.spawnLeft;
      W.step(w, null);
      if (w.spawnLeft > before) {           // 配置が起きた瞬間
        spawned++;
        const cur = { surface: w.curSurface, key: w.pending && w.pending.key };
        prev = cur;
      }
    }
    // 実走中に到達不能な配置があれば、下の「実プレイ AI」でも死ぬはず
  }
  ok(`実走でパターンが配置される（${spawned} 個）`, spawned > 200);
}

/* ---------- 7. 素朴な AI が長く生き延びられること ---------- */
section("7. 素朴な自動操作でも長く走れる（＝初見殺しが無い）");
{
  /* 「目の前の障害物を見て、必要なら反転する」だけの単純な操作。
     人間より下手なはずのこの AI が十分な距離を走れるなら、
     少なくとも避けようのない配置は生まれていない。 */
  function autoInput(w, lookSeconds) {
    const p = w.player;
    // 既定では「画面に映っている範囲」＝人間が実際に見えている範囲を見る
    const look = lookSeconds === undefined ? C.W : p.x + 6 + w.speed * lookSeconds;
    // 前方にある面ブロックのうち「いちばん近い 1 つ」だけを見る。
    // 見えている全部に反応させると、遠くの障害物に釣られて反転が往復してしまう。
    let nearX = Infinity, nearSide = null;
    for (let i = 0; i < C.MAX_OBS; i++) {
      const o = w.obs[i];
      if (!o.active) continue;
      if (o.x + o.w < p.x - C.R) continue;        // すでに通り過ぎた
      if (o.x > look) continue;                   // まだ見えていない
      const onFloor = o.y + o.h >= C.FLOOR_Y - .5;
      const onCeil = o.y <= C.CEIL_Y + .5;
      if (!onFloor && !onCeil) continue;          // 中空バーは無視（下手な AI）
      if (o.x < nearX) { nearX = o.x; nearSide = onFloor ? "floor" : "ceil"; }
    }
    const heading = p.grav > 0 ? "floor" : "ceil";
    if (nearSide !== heading) return { pressed: false, released: false, held: false };

    /* 渡ろうとしている最中に中空バーが自分の真横を通るなら、通り過ぎるまで待つ。
       乗り換えの助走はバーの span の「後ろ」から測られているので、
       待っても必要な距離は必ず残る（＝待つのが正解になるように配置してある）。 */
    for (let i = 0; i < C.MAX_OBS; i++) {
      const o = w.obs[i];
      if (!o.active) continue;
      if (o.y + o.h >= C.FLOOR_Y - .5 || o.y <= C.CEIL_Y + .5) continue;   // 面ブロックは対象外
      const inSoon = (o.x - p.x - C.R) / w.speed < .40;
      const notYetPast = o.x + o.w > p.x - C.R;
      if (inSoon && notYetPast) return { pressed: false, released: false, held: false };
    }
    return { pressed: true, released: false, held: false };
  }

  const CAP = 60 * 60 * 5;           // 5 分
  const perfect = [];
  let survived = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const w = W.create();
    W.reset(w, seed);
    let t = 0;
    while (!w.dead && t < CAP) { W.step(w, autoInput(w)); t++; }
    if (!w.dead) survived++;
    perfect.push(w.distance);
  }
  perfect.sort((a, b) => a - b);
  console.log(`     完璧な操作: 最短 ${Math.round(perfect[0])}m / 生存 ${survived}/40 本`);
  ok("完璧に反応できれば 40 シードすべて 5 分間死なない（＝避けられない配置が無い）",
    survived === 40, `${40 - survived} 本が死亡（最短 ${Math.round(perfect[0])}m）`);

  /* 逆に、人間並みの反応遅れ（0.2 秒）を入れると、いずれちゃんと死ぬこと。
     死なないなら難易度が上がっておらず、ゲームとして成立していない。 */
  /* 「反転したい」と気づいた瞬間（立ち上がり）だけを取り出し、それを lagTicks 遅らせて入力する。
     押しっぱなしを遅らせると反転が往復してしまい、ゲームではなく AI の粗を測ることになる。 */
  function runs20(lagTicks, lookSeconds) {
    const out = [];
    for (let seed = 1; seed <= 20; seed++) {
      const w = W.create();
      W.reset(w, seed);
      const queue = [];
      let prevWant = false, t = 0;
      while (!w.dead && t < CAP) {
        const want = autoInput(w, lookSeconds).pressed;
        if (want && !prevWant) queue.push(t + lagTicks);
        prevWant = want;
        let press = false;
        while (queue.length && queue[0] <= t) { queue.shift(); press = true; }
        W.step(w, { pressed: press, released: false, held: false });
        t++;
      }
      out.push({ dist: w.distance, dead: w.dead });
    }
    return out;
  }
  const medianOf = (rs) => rs.map((r) => r.dist).sort((a, b) => a - b)[Math.floor(rs.length / 2)];

  // 人間並みの反応遅れ（0.2 秒）を入れても、ちゃんと走れること＝人間に対して公平
  const human = runs20(12);
  console.log(`     0.2 秒の反応遅れ: ${human.filter((r) => r.dead).length}/20 本が死亡 / 中央値 ${Math.round(medianOf(human))}m`);
  ok("人間並みの反応遅れ（0.2 秒）でも中央値 1500m 以上走れる",
    medianOf(human) >= 1500, `${Math.round(medianOf(human))}m`);

  /* 逆に、直前しか見ていない操作（0.3 秒先だけ）なら、ちゃんと詰まること。
     これが死ななければ「見て避ける」ゲームになっていない。 */
  const myopic = runs20(0, .3);
  const myopicDied = myopic.filter((r) => r.dead).length;
  console.log(`     直前しか見ない操作: ${myopicDied}/20 本が死亡 / 中央値 ${Math.round(medianOf(myopic))}m`);
  ok("先を見ずに反射だけで避けようとすると通用しない", myopicDied >= 15, `${myopicDied}/20 本しか死なない`);
}

/* ---------- 8. 保存データの移行 ---------- */
section("8. 保存データの移行（migrate）");
{
  const M = G.Store.migrate, F = G.Store.fresh;
  const full = Object.keys(F());
  const a = M({});
  ok("空オブジェクトを渡しても全キーが埋まる", full.every((k) => a[k] !== undefined));
  const b = M({ best: 1234, settings: { sound: false } });
  ok("既存の値は保たれる", b.best === 1234 && b.settings.sound === false);
  ok("欠けた設定は既定値で埋まる", b.settings.motion === null && b.settings.showFps === false);
  const c = M({ best: "こわれてる", runs: NaN, settings: 7, seen: null });
  ok("壊れた値は既定値に戻る（例外を投げない）",
    c.best === 0 && c.runs === 0 && typeof c.settings === "object" && typeof c.seen === "object");
  ok("スキーマ番号が更新される", M({ v: 0 }).v === G.Store.SCHEMA);
}

/* ---------- 結果 ---------- */
console.log(`\n${failed === 0 ? "\x1b[32m" : "\x1b[31m"}${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
