// 다크 모드 선택: system(기기 설정 따름) · dark(항상 켜기) · light(항상 끄기) — YB-EverNote와 같은 방식
const KEY = 'ybr-theme';
const orig = new WeakMap();

export function getTheme() {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}

function walk(rules, media) {
  for (const r of rules) {
    if (r.media && r.cssRules) {
      if (!orig.has(r) && /prefers-color-scheme\s*:\s*dark/.test(r.media.mediaText)) orig.set(r, r.media.mediaText);
      if (orig.has(r)) r.media.mediaText = media ?? orig.get(r);
    }
  }
}

export function applyTheme(mode = getTheme()) {
  const media = mode === 'dark' ? 'all' : mode === 'light' ? 'not all' : null;
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    walk(rules, media);
  }
  const root = document.documentElement;
  root.style.colorScheme = mode === 'system' ? '' : mode;
  root.dataset.theme = mode;
  syncTitleBar();
}

function syncTitleBar() {
  const color = getComputedStyle(document.documentElement).getPropertyValue('--pane').trim() || '#ffffff';
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', color);
}
try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => syncTitleBar()); } catch { /* 무시 */ }

export function setTheme(mode) {
  try { localStorage.setItem(KEY, mode); } catch { /* 무시 */ }
  applyTheme(mode);
}

applyTheme();
window.addEventListener('load', () => applyTheme());
