/* 動画の下見：指定した秒数のコマを PNG で書き出すだけの確認用スクリプト。 */
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

const out = process.argv[2];
const times = process.argv.slice(3).map(Number);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 760, height: 1320 } });
page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
await page.goto(new URL("./soccer-frame.html", import.meta.url).href);
await page.evaluate(() => window.__fontReady);
for (const t of times) {
  const b64 = await page.evaluate((t) => window.__png(t), t);
  writeFileSync(`${out}/t${String(t).padStart(6, "0")}.png`, Buffer.from(b64, "base64"));
}
console.log("total", await page.evaluate(() => window.__total), "frames written:", times.length);
await browser.close();
