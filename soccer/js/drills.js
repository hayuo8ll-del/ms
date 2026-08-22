/* ボールなしドリブル練習：メニュー定義とタイムライン。
   ここは純データ＋計算だけ。document / window / Date / Math.random に触れないこと。
   ブラウザ（描画・ページ）と Node（音声生成・動画書き出し）の両方から
   同じ定義を読むので、DOM に依存すると音と絵がずれる。 */
var SD = (function () {
  "use strict";

  /* 1ヶ月目の1年生向け。むずかしい足技ではなく、
     「小さく速く足を動かす」「止まる・向きを変える」「顔を上げる」を身につける順番。 */
  var DRILLS = [
    {
      no: 1, key: "sole", view: "front",
      name: "あしうら タッチ",
      lines: ["ボールの うえを", "トン トン トン！"],
      cue: "つまさきの つけねで かるく",
      tip: "足裏の感覚づくり。かかとを上げ、母趾球のあたりで軽く触る。強く踏まない。",
      bpm: 96, beatsPerRep: 1, reps: 20,
    },
    {
      no: 2, key: "inside", view: "front",
      name: "インサイド トントン",
      lines: ["あしの うちがわで", "ひだり みぎ！"],
      cue: "ひざを すこし まげて",
      tip: "母指球の内側（インサイド）で押す。足首を固定し、ボール1個ぶんの幅で。",
      bpm: 96, beatsPerRep: 1, reps: 20,
    },
    {
      no: 3, key: "outside", view: "front",
      name: "アウトサイド おし",
      lines: ["こゆびがわで", "そとへ ポン！"],
      cue: "つまさきを すこし うちに",
      tip: "小趾側で押し出す動き。実戦で相手から遠い側にボールを置くための基本。",
      bpm: 88, beatsPerRep: 1, reps: 16,
    },
    {
      no: 4, key: "steps", view: "front",
      name: "こきざみ ステップ",
      lines: ["こきざみ 7かい", "そして ダッシュ！"],
      cue: "かかとを つけない",
      tip: "歩幅が小さいほどボールを触る回数が増える。細かい足踏み→急加速の切り替えを覚える。",
      bpm: 168, beatsPerRep: 1, reps: 32, countPer: 8, unit: "セット",
    },
    {
      no: 5, key: "zigzag", view: "top",
      name: "ジグザグ ドリブル",
      lines: ["くつを ならべて", "ジグザグ すすむ"],
      cue: "からだを たおして まがる",
      tip: "くつ下やペットボトルを1m間隔で。曲がる前に外側の足で地面を押すのがコツ。",
      bpm: 120, beatsPerRep: 2, reps: 12,
    },
    {
      no: 6, key: "stopturn", view: "top",
      name: "ストップ＆ターン",
      lines: ["３ぽ はしって", "ピタッ！ くるり"],
      cue: "あしうらで とまる",
      tip: "止まる技術は抜く技術。止まる直前に重心を落とし、足裏で踏んで反転する。",
      bpm: 108, beatsPerRep: 4, reps: 6,
    },
    {
      no: 7, key: "lookup", view: "front",
      name: "かおを あげて タッチ",
      lines: ["ゆびは なんぼん？", "あてながら タッチ"],
      cue: "ボールを みない",
      tip: "おうちの方が指を出して数を当てさせる。顔を上げてドリブルする習慣の第一歩。",
      bpm: 84, beatsPerRep: 1, reps: 16,
    },
    {
      no: 8, key: "scissors", view: "front",
      name: "またぎ フェイント",
      lines: ["ボールを またいで", "そとへ ダッシュ！"],
      cue: "またいだら すぐ うごく",
      tip: "シザース。またぐこと自体より、またいだ直後の一歩の速さで相手を外す。",
      bpm: 90, beatsPerRep: 2, reps: 10,
    },
  ];

  var INTRO = 5.0;      /* おてほん（ゆっくり）の時間 */
  var COUNTDOWN = 3.0;  /* ３・２・１ */
  var TAIL = 1.4;       /* 練習のあと、次にいくまでの間 */

  function practiceDur(d) {
    return COUNTDOWN + (d.reps * d.beatsPerRep * 60) / d.bpm + TAIL;
  }

  /* 通しの構成。start / end は秒。動画も音も、必ずここから時刻を取る。 */
  function timeline() {
    var segs = [
      { kind: "title", dur: 7.0 },
      { kind: "howto", dur: 6.5 },
    ];
    DRILLS.forEach(function (d) {
      segs.push({ kind: "drill", drill: d, dur: INTRO + practiceDur(d) });
    });
    segs.push({ kind: "outro", dur: 14.0 });

    var t = 0;
    segs.forEach(function (s) {
      s.start = t;
      t += s.dur;
      s.end = t;
    });
    return segs;
  }

  var SEGS = timeline();
  var TOTAL = SEGS[SEGS.length - 1].end;

  /* 時刻 t が属する区間と、その区間内での経過秒 */
  function segAt(t) {
    for (var i = 0; i < SEGS.length; i++) {
      if (t < SEGS[i].end || i === SEGS.length - 1) {
        return { seg: SEGS[i], i: i, local: Math.max(0, t - SEGS[i].start) };
      }
    }
    return { seg: SEGS[0], i: 0, local: 0 };
  }

  /* 練習パートの進み具合。おてほん中・カウントダウン中は phase で区別する。 */
  function drillState(seg, local) {
    var d = seg.drill;
    var beatSec = 60 / d.bpm;
    if (local < INTRO) {
      /* おてほんは実速の 6 割でゆっくり見せる */
      return { phase: "demo", beat: (local / beatSec) * 0.6, rep: 0, left: d.reps, tRel: local };
    }
    var p = local - INTRO;
    if (p < COUNTDOWN) {
      return { phase: "count", beat: 0, rep: 0, left: d.reps, count: Math.ceil(COUNTDOWN - p), tRel: p };
    }
    var beat = (p - COUNTDOWN) / beatSec;
    var total = d.reps * d.beatsPerRep;
    var done = Math.min(d.reps, Math.floor(beat / d.beatsPerRep));
    if (beat >= total) return { phase: "done", beat: total, rep: d.reps, left: 0, tRel: p - COUNTDOWN - total * beatSec };
    return { phase: "go", beat: beat, rep: done, left: d.reps - done, tRel: p - COUNTDOWN };
  }

  return {
    DRILLS: DRILLS, SEGS: SEGS, TOTAL: TOTAL,
    INTRO: INTRO, COUNTDOWN: COUNTDOWN, TAIL: TAIL,
    practiceDur: practiceDur, segAt: segAt, drillState: drillState,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = SD;
