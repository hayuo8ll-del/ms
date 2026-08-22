/* ページ側の再生。動画と同じ SStory.frame() をそのまま実時間で回している。
   （MP4 は共有・オフライン用。ページでは種目のくりかえし再生ができる） */
(function () {
  "use strict";
  var cv = document.getElementById("stage");
  var ctx = cv.getContext("2d");
  var playBtn = document.getElementById("play");
  var loopBtn = document.getElementById("loop");
  var soundBtn = document.getElementById("sound");
  var seek = document.getElementById("seek");
  var nowEl = document.getElementById("now");
  var chapEl = document.getElementById("chapter");

  var t = 0, playing = false, loop = false, sound = true, last = 0;

  function fit() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = 720 * dpr; cv.height = 1280 * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function mmss(s) {
    s = Math.max(0, Math.round(s));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  /* --- メトロノーム（動画の音と同じ拍） --- */
  var ac = null, lastBeat = -1, lastCount = -1;
  function beep(freq, dur, vol) {
    if (!ac || !sound) return;
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + dur);
  }
  function tick(st) {
    if (st.seg.kind !== "drill") { lastBeat = -1; lastCount = -1; return; }
    var s = SD.drillState(st.seg, st.local);
    if (s.phase === "go") {
      var b = Math.floor(s.beat);
      if (b !== lastBeat) {
        lastBeat = b;
        var accent = b % st.seg.drill.beatsPerRep === 0;
        beep(accent ? 1760 : 1180, accent ? 0.09 : 0.06, accent ? 0.18 : 0.1);
      }
      lastCount = -1;
    } else if (s.phase === "count") {
      if (s.count !== lastCount) { lastCount = s.count; beep(880, 0.18, 0.16); }
      lastBeat = -1;
    } else { lastBeat = -1; lastCount = -1; }
  }

  function draw() {
    SStory.frame(ctx, t);
    var st = SD.segAt(t);
    seek.value = Math.round((t / SD.TOTAL) * 1000);
    nowEl.textContent = mmss(t);
    chapEl.textContent = st.seg.kind === "drill" ? st.seg.drill.no + ". " + st.seg.drill.name
      : st.seg.kind === "title" ? "タイトル" : st.seg.kind === "howto" ? "やりかた" : "まとめ";
    Array.prototype.forEach.call(document.querySelectorAll("#list button"), function (b, i) {
      b.setAttribute("aria-current", st.seg.drill && st.seg.drill.no === i + 1 ? "true" : "false");
    });
  }

  function frame(ms) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.25, (ms - last) / 1000);
    last = ms;
    if (!playing) return;
    var seg = SD.segAt(t).seg;
    t += dt;
    if (loop && t >= seg.end) t = seg.start;            /* 同じ種目をくりかえす */
    if (t >= SD.TOTAL) { t = SD.TOTAL - 0.01; setPlaying(false); }
    tick(SD.segAt(t));
    draw();
  }

  function setPlaying(on) {
    playing = on;
    playBtn.textContent = on ? "⏸ ストップ" : "▶︎ さいせい";
    if (on && !ac && window.AudioContext) ac = new AudioContext();
    if (on && ac && ac.state === "suspended") ac.resume();
  }

  playBtn.addEventListener("click", function () { setPlaying(!playing); });
  loopBtn.addEventListener("click", function () {
    loop = !loop; loopBtn.setAttribute("aria-pressed", String(loop));
  });
  soundBtn.addEventListener("click", function () {
    sound = !sound; soundBtn.setAttribute("aria-pressed", String(sound));
  });
  seek.addEventListener("input", function () {
    t = (seek.value / 1000) * SD.TOTAL; lastBeat = -1; lastCount = -1; draw();
  });

  /* メニュー */
  var list = document.getElementById("list");
  SD.SEGS.forEach(function (seg) {
    if (seg.kind !== "drill") return;
    var d = seg.drill;
    var li = document.createElement("li");
    var b = document.createElement("button");
    b.type = "button";
    b.innerHTML = '<span class="no">' + d.no + '</span><span><span class="name">' + d.name +
      '</span><br><span class="cue">' + d.cue + '</span></span>';
    b.addEventListener("click", function () {
      t = seg.start; lastBeat = -1; lastCount = -1; setPlaying(true); draw();
    });
    li.appendChild(b); list.appendChild(li);
  });

  document.getElementById("total").textContent = mmss(SD.TOTAL);
  window.addEventListener("resize", fit);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) setPlaying(false);
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
  fit();
  requestAnimationFrame(function (ms) { last = ms; requestAnimationFrame(frame); });
})();
