/* 練習動画の音を合成して WAV に書き出す。バイナリ素材は持たない（全部その場で計算）。
   拍・カウントダウン・区切りの時刻は soccer/js/drills.js から取るので、絵と必ず一致する。 */
import { readFileSync, writeFileSync } from "node:fs";

const SD = (0, eval)(readFileSync(new URL("../soccer/js/drills.js", import.meta.url), "utf8") + "; SD;");

const RATE = 44100;
const LEN = Math.ceil((SD.TOTAL + 1.6) * RATE);
const buf = new Float32Array(LEN);

function add(t0, dur, amp, fn) {
  const a = Math.max(0, Math.round(t0 * RATE)), n = Math.round(dur * RATE);
  for (let i = 0; i < n && a + i < LEN; i++) buf[a + i] += amp * fn(i / RATE, i / n);
}

/* 打楽器的な音（立ち上がり数 ms、あとは指数減衰） */
function hit(t0, freq, dur, amp, harm = 0.35) {
  add(t0, dur, amp, (t, u) => {
    const env = Math.min(1, t / 0.004) * Math.exp(-t / (dur * 0.28));
    return env * (Math.sin(2 * Math.PI * freq * t) + harm * Math.sin(4 * Math.PI * freq * t));
  });
}

/* 伸ばす音（チャイム・ファンファーレ用） */
function bell(t0, freq, dur, amp) {
  add(t0, dur, amp, (t) => {
    const env = Math.min(1, t / 0.012) * Math.exp(-t / (dur * 0.4));
    return env * (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(4 * Math.PI * freq * t) + 0.12 * Math.sin(6 * Math.PI * freq * t));
  });
}

/* 背景のパッド。リズムを持たせない（練習のテンポと喧嘩するため） */
function pad(t0, dur, freqs, amp) {
  add(t0, dur, amp, (t, u) => {
    const env = Math.sin(Math.PI * Math.min(1, u)) ** 1.2;
    let v = 0;
    for (const f of freqs) v += Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 1.004 * t + 1.2);
    return (env * v) / (freqs.length * 1.5);
  });
}

const N = (n) => 440 * Math.pow(2, (n - 69) / 12);  /* MIDI番号 → Hz */
const CHORDS = [[60, 64, 67], [57, 60, 64], [65, 69, 72], [55, 59, 62]];
for (let i = 0, t = 0; t < SD.TOTAL; i++, t += 4) {
  pad(t, 4.4, CHORDS[i % CHORDS.length].map((n) => N(n - 12)), 0.075);
}

SD.SEGS.forEach((seg) => {
  if (seg.kind === "title") {
    [60, 64, 67, 72].forEach((n, i) => bell(seg.start + 0.15 + i * 0.11, N(n), 1.4, 0.2));
  }
  if (seg.kind === "outro") {
    [67, 72, 76, 79].forEach((n, i) => bell(seg.start + 0.1 + i * 0.13, N(n), 1.8, 0.22));
    [72, 79].forEach((n) => bell(seg.start + 0.9, N(n), 2.4, 0.14));
  }
  if (seg.kind !== "drill") return;

  const d = seg.drill;
  /* 種目のはじまり */
  [64, 69, 72].forEach((n, i) => bell(seg.start + 0.08 + i * 0.1, N(n), 1.0, 0.16));

  /* ３・２・１ → スタート */
  const cs = seg.start + SD.INTRO;
  for (let i = 0; i < 3; i++) bell(cs + i, N(69), 0.34, 0.2);
  const go = cs + SD.COUNTDOWN;
  bell(go, N(81), 0.5, 0.24);

  /* 拍のクリック。1回ぶんの頭はアクセント */
  const beatSec = 60 / d.bpm;
  const total = d.reps * d.beatsPerRep;
  for (let b = 0; b < total; b++) {
    const t = go + b * beatSec;
    const accent = b % d.beatsPerRep === 0;
    hit(t, accent ? 1760 : 1180, accent ? 0.09 : 0.07, accent ? 0.26 : 0.15);
  }
  /* できた！ */
  const end = go + total * beatSec;
  [72, 76, 79].forEach((n, i) => bell(end + 0.05 + i * 0.09, N(n), 0.9, 0.2));
});

/* 書き出し（16bit モノラル、軽くソフトクリップ） */
const pcm = Buffer.alloc(LEN * 2);
let peak = 0;
for (let i = 0; i < LEN; i++) peak = Math.max(peak, Math.abs(buf[i]));
const gain = Math.min(1, 0.85 / (peak || 1));
for (let i = 0; i < LEN; i++) {
  const v = Math.tanh(buf[i] * gain * 1.15);
  pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), i * 2);
}
const head = Buffer.alloc(44);
head.write("RIFF", 0); head.writeUInt32LE(36 + pcm.length, 4); head.write("WAVE", 8);
head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
head.writeUInt16LE(1, 22); head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28);
head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
head.write("data", 36); head.writeUInt32LE(pcm.length, 40);

const out = process.argv[2] || "/tmp/soccer-audio.wav";
writeFileSync(out, Buffer.concat([head, pcm]));
console.log("wrote", out, (LEN / RATE).toFixed(1) + "s", "peak", peak.toFixed(2));
