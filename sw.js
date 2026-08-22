/* Service Worker：オフラインでも動かす */
const CACHE = "natsu-study-v17";
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/data.js",
  "./js/generators.js",
  "./js/strokes.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-96.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      /* CacheStorage は「オリジン単位」で共有されている。スコープ単位ではない。
         接頭辞で絞らないと、同じオリジンにある /game/ 用のキャッシュ（ms-game-*）まで
         道連れに消してしまい、学習アプリを更新するたびにゲームのオフライン再生が壊れる。 */
      Promise.all(keys.filter((k) => k.startsWith("natsu-study-") && k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  const url = new URL(e.request.url);

  /* 他サイトへのリクエスト（MLBの成績API・選手写真）は素通しする。
     ここでキャッシュすると /mlb/ が古い成績を出し続けてしまう。 */
  if (url.origin !== self.location.origin) return;

  /* /game/ は専用の Service Worker（game/sw.js、スコープ /ms/game/）が受け持つ。
     ここで拾うと、下の cache-first がゲームのファイルを学習アプリのキャッシュに
     取り込んでしまい、オフライン時には学習アプリの index.html を
     ゲームの URL で返してしまう。素通しするのが正解。 */
  if (url.pathname.includes("/game/")) return;

  /* /soccer/ も学習アプリとは別物。ここで cache-first に流すと、
     11MB の動画が学習アプリのキャッシュに入り、動画のシーク（Range リクエスト）にも
     キャッシュ済みの全体レスポンスを返してしまう。素通しする。 */
  if (url.pathname.includes("/soccer/")) return;

  /* /mlb/ は開くたびに更新されるページなので network-first。
     オフラインのときだけキャッシュを使う。 */
  if (url.pathname.includes("/mlb/")) {
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(e.request, { cacheName: CACHE })
        .then((hit) => hit || caches.match("./index.html", { cacheName: CACHE })))
    );
    return;
  }

  /* 学習アプリ本体は従来どおり cache-first：まずキャッシュ、なければネット取得。
     caches.match には必ず cacheName を渡す。付けないとオリジン内の全キャッシュを
     横断して探すので、ゲーム側が保存したレスポンスを拾ってしまうことがある。 */
  e.respondWith(
    caches.match(e.request, { cacheName: CACHE }).then((hit) => hit ||
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match("./index.html", { cacheName: CACHE }))
    )
  );
});
