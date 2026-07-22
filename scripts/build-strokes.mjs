/* 書き順ストロークデータの生成スクリプト（ワンオフ）
 * WRITING_SETS の全文字について KanjiVG からパスを取得し js/strokes.js を生成する。
 * 使い方: リポジトリのルートで `node scripts/build-strokes.mjs`
 * 出典: KanjiVG (http://kanjivg.tagaini.net) CC BY-SA 3.0
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const code = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
const WRITING_SETS = new Function(code + '; return WRITING_SETS;')();

const chars = new Set();
for (const g of Object.keys(WRITING_SETS))
  for (const set of WRITING_SETS[g])
    for (const it of set.chars) chars.add(it.c);
const list = [...chars];
console.log('unique chars:', list.length);

const cp = ch => ch.codePointAt(0).toString(16).padStart(5, '0');
const STROKES = {};
const missing = [];
let i = 0;
for (const ch of list) {
  const url = `https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/${cp(ch)}.svg`;
  let svg = '';
  try { svg = execSync(`curl -s --max-time 30 "${url}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }); } catch (e) {}
  const strokeArea = svg.split(/id="kvg:StrokeNumbers/)[0];   // 画数テキスト群を除外
  const ds = [...strokeArea.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map(m => m[1]);
  if (ds.length) STROKES[ch] = ds; else missing.push(ch);
  if (++i % 40 === 0) console.log(`  ${i}/${list.length}...`);
}
console.log('got', Object.keys(STROKES).length, 'chars; missing:', missing.length, missing.join(''));

const header = `/* ===== 書き順（筆順）ストロークデータ =====
 * Source: KanjiVG (https://kanjivg.tagaini.net) by Ulrich Apel.
 * Licensed under Creative Commons Attribution-Share Alike 3.0.
 *   https://creativecommons.org/licenses/by-sa/3.0/
 * このファイルは KanjiVG から本アプリで使用する文字分のパスを抽出した派生物であり、
 * 同一ライセンス（CC BY-SA 3.0）で配布されます。
 * viewBox は 109x109。STROKES[文字] = [筆順どおりのpath d文字列, ...]
 */
const STROKES = ${JSON.stringify(STROKES)};
`;
fs.writeFileSync(path.join(root, 'js/strokes.js'), header);
console.log('wrote js/strokes.js');
