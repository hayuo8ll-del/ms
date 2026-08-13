/* GRAVIX 専用の Service Worker。
   game/index.html から相対パスで登録するので、スコープは /ms/game/ になる。
   学習アプリのルート SW（スコープ /ms/）よりスコープが限定的なので、
   このフォルダ配下のページはこちらが受け持つ。

   ファイルを足す・名前を変えるときは ASSETS の更新と CACHE のバージョン上げを必ずセットで。
   キャッシュ名でまとめてバージョン管理しているので、片方だけだと
   新旧の JS が混ざった状態が残ってしまう。 */
const CACHE = "ms-game-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./css/game.css",
  "./js/core.js",
  "./js/world.js",
  "./js/render.js",
  "./js/game.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
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
      /* CacheStorage はオリジン単位で共有されている。
         接頭辞で絞らないと、同じオリジンにある学習アプリのキャッシュまで消してしまう。 */
      Promise.all(keys.filter((k) => k.startsWith("ms-game-") && k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  /* ゲームは静的なファイルの集合で、CACHE 名ごとまとめて更新する。だから cache-first。
     caches.match には必ず cacheName を渡す（付けないとオリジン内の
     他のキャッシュ＝学習アプリの中身まで探しに行ってしまう）。 */
  e.respondWith(
    caches.match(e.request, { cacheName: CACHE }).then((hit) => hit ||
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => {
        // ページ遷移だけはゲーム本体にフォールバックする（相対解決で /ms/game/index.html）
        if (e.request.mode === "navigate") return caches.match("./index.html", { cacheName: CACHE });
        return Response.error();
      })
    )
  );
});
