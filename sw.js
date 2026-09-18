/* AETHEL 棱镜 · 体验沙箱 Service Worker（v0.8.7）
 * cache-first：优先命中缓存，未命中走网络并回填；CACHE 版本号变化即整体换新。
 * 相对路径，兼容 GitHub Pages 子路径（如 /prism-sandbox/）。
 * v0.8.0：预缓存红线引擎 prism_wasm.wasm（T-WASM-01），离线状态下 WASM 真逻辑仍可载入。
 * v0.8.2：诚意修复版，缓存名整体换新（v082）。
 * v0.8.3：红线批次二委婉求助层，引擎 79,468 B 随缓存名换新（v083）整体更新。
 * v0.8.4：鸿蒙真机打磨版，缓存名整体换新（v084）；壳内（prism.local）不注册本 SW。
 * v0.8.5：MVP-24 就绪版（JSON 快照导出），缓存名整体换新（v085）。
 * v0.8.6：答问止血包（C 档）——预缓存排盘引擎 prism_wasm_engine.wasm 与 glue，
 *         离线状态下分域文案仍可引用当下真实盘面；缓存名整体换新（v086）。
 * v0.8.7：抢修批次（P0 崩溃回滚/多标签合并/防死锁 + P1 守卫防刷诚实口径 + P2 发布卫生），
 *         缓存名整体换新（v087）。
 */
var CACHE = "prism-sandbox-v087";
var ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./prism_wasm.wasm", "./prism_wasm_engine.wasm", "./timing_wasm_glue.js"];

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
