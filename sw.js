/* AETHEL 棱镜 · 体验沙箱 Service Worker（v0.8.1）
 * cache-first：优先命中缓存，未命中走网络并回填；CACHE 版本号变化即整体换新。
 * 相对路径，兼容 GitHub Pages 子路径（如 /prism-sandbox/）。
 * v0.8.0：预缓存红线引擎 prism_wasm.wasm（T-WASM-01），离线状态下 WASM 真逻辑仍可载入。
 * v0.8.1：互测响应版，缓存名整体换新（v081）。
 */
var CACHE = "prism-sandbox-v081";
var ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./prism_wasm.wasm"];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          if (k !== CACHE) return caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      }).catch(function () { return caches.match("./index.html"); });
    })
  );
});
