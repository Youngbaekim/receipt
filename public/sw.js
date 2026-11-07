// YB-Receipt 서비스 워커 — 인터넷이 없어도 앱 화면이 열리도록 파일을 기기에 보관
// 영수증 데이터는 Firestore가 따로 기기에 보관하므로 여기서는 다루지 않음
const VERSION = 'v0.1.2';
const SHELL = `ybr-shell-${VERSION}`;
const EXT = 'ybr-ext-v1'; // 글꼴(외부 파일)
const SCOPE = self.registration.scope; // https://…/yb-receipt/

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) =>
      c.addAll([SCOPE, `${SCOPE}manifest.webmanifest`, `${SCOPE}icons/icon.svg`, `${SCOPE}icons/icon-192.png`])
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('ybr-shell-') && k !== SHELL).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

const isExt = (url) =>
  url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' ||
  (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('pretendard'));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (isExt(url)) {
    e.respondWith(
      caches.open(EXT).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') c.put(req, res.clone()).catch(() => {});
        return res;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin || !req.url.startsWith(SCOPE)) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(SHELL).then((c) => c.put(SCOPE, copy));
          return res;
        })
        .catch(() => caches.match(SCOPE))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(SHELL).then((c) => c.put(req, copy));
          return res;
        })
    )
  );
});
