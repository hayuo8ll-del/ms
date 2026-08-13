/* game/icons/icon.svg から PNG 一式を作る一回きりのスクリプト。
   実行: node scripts/build-game-icons.mjs
   SVG を描き変えたときだけ回せばよい（scripts/ は Pages の公開対象外）。

   ルートの icons/ と同じ方針で、ヘッドレス Chromium にラスタライズさせる。
   apple-touch-icon だけは iOS の都合で「不透明・角丸なし」が必須
   （透明部分は黒く落ちるし、角丸は iOS が自分で付ける）。 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconDir = path.join(root, "game/icons");
const svg = fs.readFileSync(path.join(iconDir, "icon.svg"), "utf8");
const CHROME = "/opt/pw-browsers/chromium";
const BG = "#06070f";

/* maskable は中央 409/512 の安全円に収める必要がある。
   絵はすでに安全円の内側に描いてあるが、規格どおり 10% の余白を明示的に足しておく。 */
const SIZES = [
  { file: "icon-192.png", px: 192, pad: 0 },
  { file: "icon-512.png", px: 512, pad: 0 },
  { file: "icon-512-maskable.png", px: 512, pad: 0.1 },
  { file: "apple-touch-icon.png", px: 180, pad: 0 },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gravix-icons-"));

for (const s of SIZES) {
  const inner = Math.round(s.px * (1 - s.pad * 2));
  const off = Math.round((s.px - inner) / 2);
  const html = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:${BG};width:${s.px}px;height:${s.px}px;overflow:hidden}
  svg{position:absolute;left:${off}px;top:${off}px;width:${inner}px;height:${inner}px;display:block}
</style>
${svg}`;
  const page = path.join(tmp, s.file + ".html");
  fs.writeFileSync(page, html);
  execFileSync(CHROME, [
    "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${s.px},${s.px}`,
    `--screenshot=${path.join(iconDir, s.file)}`,
    "file://" + page,
  ], { stdio: ["ignore", "ignore", "inherit"] });
  const bytes = fs.statSync(path.join(iconDir, s.file)).size;
  console.log(`${s.file}  ${s.px}x${s.px}  ${(bytes / 1024).toFixed(1)} KB`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("done");
