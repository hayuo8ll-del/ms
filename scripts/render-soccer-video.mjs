/* 練習動画の書き出し。Chromium で 1 コマずつ canvas を描かせ、JPEG のまま ffmpeg に流し込む。
   実時間で再生して録画するのではなく、時刻を指定して描かせるので、
   マシンが遅くてもコマ落ちしない（＝拍と映像がずれない）。
     node scripts/render-soccer-video.mjs soccer/video/dribble-noball.mp4
   音は scripts/build-soccer-audio.mjs が作る WAV を先に用意すること。 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const out = process.argv[2];
const fps = Number(arg("--fps", 30));
const from = Number(arg("--from", 0));
const audio = arg("--audio", "/tmp/soccer-audio.wav");
/* ffmpeg は環境変数 FFMPEG か、npm の ffmpeg-static か、PATH の順に探す。
   libx264 と AAC が要るので、Playwright 同梱の ffmpeg（VP8 のみ）では代用できない。 */
const FFMPEG = process.env.FFMPEG || (() => {
  try { return require("ffmpeg-static"); } catch { return "ffmpeg"; }
})();
if (!out) { console.error("usage: render-soccer-video.mjs <out.mp4> [--fps 30] [--from s] [--to s]"); process.exit(1); }

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 760, height: 1320 } });
page.on("pageerror", (e) => { console.error("PAGE ERROR:", e.message); process.exitCode = 1; });
await page.goto(new URL("./soccer-frame.html", import.meta.url).href);
await page.evaluate(() => window.__fontReady);

const total = await page.evaluate(() => window.__total);
const to = Number(arg("--to", total + 0.4));
const frames = Math.round((to - from) * fps);

const hasAudio = existsSync(audio);
const args = ["-y", "-f", "image2pipe", "-vcodec", "mjpeg", "-framerate", String(fps), "-i", "-"];
if (hasAudio) args.push("-i", audio, "-c:a", "aac", "-b:a", "128k", "-shortest");
/* tune=animation はベタ塗りのアニメ向け設定。60fps だと粒子ぶんビットレートが伸びるので
   crf は 24。24 と 21 は見分けがつかず、ファイルは 3 割小さい。 */
args.push("-c:v", "libx264", "-preset", "slow", "-tune", "animation", "-crf", "24",
  "-pix_fmt", "yuv420p", "-profile:v", "high", "-movflags", "+faststart", out);
const ff = spawn(FFMPEG, args, { stdio: ["pipe", "ignore", "pipe"] });
let err = "";
ff.stderr.on("data", (d) => { err += d; if (err.length > 40000) err = err.slice(-20000); });

const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  const t = from + i / fps;
  const b64 = await page.evaluate((t) => window.__jpeg(t), t);
  if (!ff.stdin.write(Buffer.from(b64, "base64"))) await once(ff.stdin, "drain");
  if (i % 300 === 0) {
    const el = (Date.now() - t0) / 1000;
    process.stdout.write(`\r${i}/${frames}  ${el.toFixed(0)}s  eta ${(el / (i || 1) * (frames - i)).toFixed(0)}s   `);
  }
}
ff.stdin.end();
const [code] = await once(ff, "close");
await browser.close();
if (code !== 0) { console.error("\n" + err.slice(-3000)); process.exit(1); }
console.log(`\ndone: ${out}  ${frames} frames @${fps}fps  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
