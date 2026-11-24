const VAK_FONT_CACHE = "vak-living-sanctuary-fonts-v1";
const VAK_GOOGLE_FONT_STYLESHEET = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      const fontCache = await caches.open(VAK_FONT_CACHE);
      const cssResp = await fetch(VAK_GOOGLE_FONT_STYLESHEET, { mode: "cors", credentials: "omit" });
      if (cssResp && cssResp.status === 200) {
        await fontCache.put(VAK_GOOGLE_FONT_STYLESHEET, cssResp.clone());
        const cssText = await cssResp.text();
        const fontUrls = Array.from(new Set(cssText.match(/https:\/\/fonts\.gstatic\.com\/[^\s)'"]+/g) || []));
        await Promise.allSettled(
          fontUrls.map(async (fontUrl) => {
            const fontResp = await fetch(fontUrl, { mode: "cors", credentials: "omit" });
            if (fontResp && (fontResp.status === 200 || fontResp.type === "opaque")) {
              await fontCache.put(fontUrl, fontResp);
            }
          })
        );
      }
    } catch {
      // Non-blocking: font warm-up failure never prevents service-worker installation
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) =>
          (key === "vak-living-sanctuary-google-fonts-cache" ||
           key === "vak-living-sanctuary-gstatic-fonts-cache" ||
           key.startsWith("vak-living-sanctuary-fonts-")) &&
          key !== VAK_FONT_CACHE
        )
        .map((key) => caches.delete(key))
    );
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith((async () => {
      const fontCache = await caches.open(VAK_FONT_CACHE);
      const cached = await fontCache.match(request);
      if (cached) return cached;
      try {
        const networkResponse = await fetch(request);
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === "opaque")) {
          await fontCache.put(request, networkResponse.clone());
        }
        return networkResponse;
      } catch {
        if (url.hostname === "fonts.googleapis.com") {
          return new Response("/* VAK Living Sanctuary offline font fallback */", {
            status: 200,
            headers: {
              "Content-Type": "text/css; charset=utf-8",
              "Cache-Control": "no-store"
            }
          });
        }
        return Response.error();
      }
    })());
  }
});

if(!self.define){let e,s={};const n=(n,i)=>(n=new URL(n+".js",i).href,s[n]||new Promise(s=>{if("document"in self){const e=document.createElement("script");e.src=n,e.onload=s,document.head.appendChild(e)}else e=n,importScripts(n),s()}).then(()=>{let e=s[n];if(!e)throw new Error(`Module ${n} didn’t register its module`);return e}));self.define=(i,a)=>{const c=e||("document"in self?document.currentScript.src:"")||location.href;if(s[c])return;let o={};const r=e=>n(e,c),f={module:{uri:c},exports:o,require:r};s[c]=Promise.all(i.map(e=>f[e]||r(e))).then(e=>(a(...e),o))}}define(["./workbox-63c18b4d"],function(e){"use strict";self.skipWaiting(),e.clientsClaim(),e.precacheAndRoute([{url:"registerSW.js",revision:"597937e5945855d0efac76e34a9a146d"},{url:"pwa-maskable-512x512.png",revision:"01d1e47f3f1666897ad98afdcb08eba9"},{url:"pwa-512x512.png",revision:"773c5a3fad26def5eb6ae78c9fdd6d01"},{url:"pwa-192x192.png",revision:"1b311ee45ccb5d0f93269b261afa9a1f"},{url:"offline-shell-sw.js",revision:"69b01240c58e85415deeca7f9137774a"},{url:"index.html",revision:"a3efefd7fa99cac0ebb56ff446fc5944"},{url:"icon.svg",revision:"5c40b330cb2d727f5f9ad0e8af55117c"},{url:"apple-touch-icon.png",revision:"4ce59d7fcda3b04acf01d5031ca57487"},{url:"assets/index-Dw9BQKWO.css",revision:null},{url:"assets/index-CUrzyYgb.js",revision:null},{url:"assets/vak-living-sanctuary-sdk-bridge.js",revision:null},{url:"manifest.webmanifest",revision:"f319c2c057fe3d016e6e3b2b440a141b"}],{}),e.cleanupOutdatedCaches(),e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("index.html")))});

