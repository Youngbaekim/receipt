// 영수증 자르기 — 네 모퉁이를 끌어 영수증 테두리에 맞추면 비스듬히 찍힌 사진도 반듯한 직사각형으로 펴 줌
// 처음 열 때 영수증(흰 종이) 영역을 자동으로 찾아 모퉁이를 미리 맞춰 둠
import { rotateCanvas } from './image.js';

const OUT_MAX = 2400; // 잘라 낸 결과의 긴 변 상한 (글자 인식용으로 충분)

/* ───────── 영수증 영역 자동 찾기 ───────── */
// 흰 종이는 밝고 덜 누렇다 → 책상·손 등과 구분, 가는 연결(그림자·빛 반사)은 한 칸 깎아 끊음
function detectQuad(src) {
  const S = 360 / Math.max(src.width, src.height);
  const w = Math.max(8, Math.round(src.width * S));
  const h = Math.max(8, Math.round(src.height * S));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const v = new Uint8Array(w * h);
  const hist = new Array(256).fill(0);
  // 종이다움 = 밝기 + 푸른기(흰 종이는 책상·나무보다 덜 누렇다) → 0~255로 늘려 씀
  const raw = new Float32Array(w * h);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < w * h; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    const s = (r + g + b) / 3 + 1.5 * (b - r);
    raw[i] = s;
    if (s < lo) lo = s;
    if (s > hi) hi = s;
  }
  for (let i = 0; i < w * h; i++) {
    const m = Math.round(((raw[i] - lo) / Math.max(1, hi - lo)) * 255);
    v[i] = m;
    hist[m]++;
  }
  // 오츠(Otsu) 방식으로 밝음/어두움 경계값
  const total = w * h;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, th = 160;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; th = t; }
  }
  const bright = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bright[i] = v[i] > th ? 1 : 0;
  const mask = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    mask[i] = bright[i] & bright[i - 1] & bright[i + 1] & bright[i - w] & bright[i + w];
  }
  // 밝은 칸 중 가장 큰 덩어리
  const seen = new Uint8Array(w * h);
  let bestPix = null;
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || !mask[s]) continue;
    const pix = [];
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop();
      pix.push(p);
      const x = p % w, y = (p / w) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) if (q >= 0 && !seen[q] && mask[q]) { seen[q] = 1; stack.push(q); }
    }
    if (!bestPix || pix.length > bestPix.length) bestPix = pix;
  }
  const full = [[0, 0], [src.width, 0], [src.width, src.height], [0, src.height]];
  if (!bestPix) return full;
  const ratio = bestPix.length / total;
  if (ratio < 0.03 || ratio > 0.92) return full; // 못 찾았거나 이미 영수증만 찍힌 사진
  // 네 모퉁이: 왼위(x+y 최소)·오른위(x-y 최대)·오른아래(x+y 최대)·왼아래(x-y 최소)
  let tl, tr, br, bl;
  let a = Infinity, b = -Infinity, c2 = -Infinity, e = Infinity;
  for (const p of bestPix) {
    const x = p % w, y = (p / w) | 0;
    if (x + y < a) { a = x + y; tl = [x - 1, y - 1]; }
    if (x - y > b) { b = x - y; tr = [x + 2, y - 1]; }
    if (x + y > c2) { c2 = x + y; br = [x + 2, y + 2]; }
    if (x - y < e) { e = x - y; bl = [x - 1, y + 2]; }
  }
  return [tl, tr, br, bl].map(([x, y]) => [Math.min(src.width, Math.max(0, x / S)), Math.min(src.height, Math.max(0, y / S))]);
}

/* ───────── 원근 보정(사다리꼴 → 직사각형) ───────── */
// 8×8 연립방정식으로 변환 행렬을 구함: 결과 직사각형의 점 → 원본 사진의 점
function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let max = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[max][i])) max = r;
    [A[i], A[max]] = [A[max], A[i]];
    [b[i], b[max]] = [b[max], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let k = i; k < n; k++) A[r][k] -= f * A[i][k];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let k = i + 1; k < n; k++) s -= A[i][k] * x[k];
    x[i] = s / A[i][i];
  }
  return x;
}
function homography(from, to) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return solve(A, b);
}
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

export function warp(src, quad) {
  const [tl, tr, br, bl] = quad;
  let W = Math.max(dist(tl, tr), dist(bl, br));
  let H = Math.max(dist(tl, bl), dist(tr, br));
  const k = Math.min(1, OUT_MAX / Math.max(W, H));
  W = Math.max(1, Math.round(W * k));
  H = Math.max(1, Math.round(H * k));
  const m = homography([[0, 0], [W, 0], [W, H], [0, H]], quad);

  // 원본 픽셀 읽기 (영수증 둘레만 잘라서 읽어 메모리 절약)
  const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const x1 = Math.min(src.width, Math.ceil(Math.max(...xs))), y1 = Math.min(src.height, Math.ceil(Math.max(...ys)));
  const sw = Math.max(1, x1 - x0), sh = Math.max(1, y1 - y0);
  const sc = document.createElement('canvas');
  sc.width = sw;
  sc.height = sh;
  const sctx = sc.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(src, x0, y0, sw, sh, 0, 0, sw, sh);
  const sd = sctx.getImageData(0, 0, sw, sh).data;

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d');
  const img = octx.createImageData(W, H);
  const od = img.data;
  const [a, b, c, d, e, f, g, h] = m;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const den = g * x + h * y + 1;
      let u = (a * x + b * y + c) / den - x0;
      let v = (d * x + e * y + f) / den - y0;
      u = Math.min(sw - 1.001, Math.max(0, u));
      v = Math.min(sh - 1.001, Math.max(0, v));
      const ui = u | 0, vi = v | 0, fu = u - ui, fv = v - vi;
      const i00 = (vi * sw + ui) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const o = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        od[o + ch] = (sd[i00 + ch] * (1 - fu) + sd[i10 + ch] * fu) * (1 - fv) + (sd[i01 + ch] * (1 - fu) + sd[i11 + ch] * fu) * fv;
      }
      od[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/* ───────── 자르기 화면 ───────── */
/**
 * @param {ImageBitmap|HTMLCanvasElement} bitmap
 * @param {{index?:number, total?:number}} [opt] 여러 장일 때 "2/3" 표시
 * @returns {Promise<HTMLCanvasElement|ImageBitmap|null>} 잘라 낸 사진 · 원본 그대로 · 취소(null)
 */
export function openCropper(bitmap, opt = {}) {
  return new Promise((resolve) => {
    let src = bitmap;
    let quad = detectQuad(src);
    const root = document.createElement('div');
    root.className = 'cropper';
    root.innerHTML = `
      <div class="cr-head">
        <button class="cr-btn" data-a="cancel">취소</button>
        <span class="cr-title">영수증 자르기${opt.total > 1 ? ` <em>${opt.index}/${opt.total}</em>` : ''}</span>
        <button class="cr-btn cr-ok" data-a="ok">완료</button>
      </div>
      <div class="cr-stage"><canvas></canvas><canvas class="cr-loupe" width="132" height="132" hidden></canvas></div>
      <div class="cr-foot">
        <button class="cr-tool" data-a="rotate">↻ 회전</button>
        <button class="cr-tool" data-a="auto">✨ 자동</button>
        <button class="cr-tool" data-a="full">⬚ 전체</button>
        <button class="cr-tool" data-a="orig" title="자르지 않고 원본 그대로 사용">원본</button>
      </div>
      <p class="cr-hint">네 모퉁이(●)를 끌어 영수증 테두리에 맞추세요. 비스듬히 찍혀도 반듯하게 펴집니다.</p>`;
    document.body.appendChild(root);
    document.body.classList.add('cropping');
    const stage = root.querySelector('.cr-stage');
    const cv = stage.querySelector('canvas');
    const loupe = root.querySelector('.cr-loupe');
    const ctx = cv.getContext('2d');
    let scale = 1, ox = 0, oy = 0, dpr = 1, active = -1;

    function layout() {
      dpr = window.devicePixelRatio || 1;
      const r = stage.getBoundingClientRect();
      const pad = 22;
      scale = Math.min((r.width - pad * 2) / src.width, (r.height - pad * 2) / src.height);
      const dw = src.width * scale, dh = src.height * scale;
      ox = (r.width - dw) / 2;
      oy = (r.height - dh) / 2;
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      cv.style.width = `${r.width}px`;
      cv.style.height = `${r.height}px`;
      draw();
    }
    const toScreen = ([x, y]) => [ox + x * scale, oy + y * scale];
    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(src, ox, oy, src.width * scale, src.height * scale);
      const P = quad.map(toScreen);
      // 영수증 바깥은 어둡게
      ctx.beginPath();
      ctx.rect(ox, oy, src.width * scale, src.height * scale);
      ctx.moveTo(...P[0]); P.slice(1).forEach((p) => ctx.lineTo(...p)); ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fill('evenodd');
      ctx.beginPath();
      ctx.moveTo(...P[0]); P.slice(1).forEach((p) => ctx.lineTo(...p)); ctx.closePath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#8fb0e6';
      ctx.stroke();
      P.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p[0], p[1], i === active ? 14 : 11, 0, Math.PI * 2);
        ctx.fillStyle = i === active ? '#ffffff' : 'rgba(143,176,230,.95)';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#16294f';
        ctx.stroke();
      });
    }
    // 끄는 모퉁이 주변 확대경
    function drawLoupe() {
      if (active < 0) { loupe.hidden = true; return; }
      loupe.hidden = false;
      const [x, y] = quad[active];
      const P = toScreen(quad[active]);
      const r = stage.getBoundingClientRect();
      loupe.style.left = `${P[0] < r.width / 2 ? r.width - 146 : 14}px`;
      loupe.style.top = '14px';
      const lc = loupe.getContext('2d');
      const zoom = 3 * scale;
      const span = 132 / zoom;
      lc.fillStyle = '#000';
      lc.fillRect(0, 0, 132, 132);
      lc.drawImage(src, x - span / 2, y - span / 2, span, span, 0, 0, 132, 132);
      lc.strokeStyle = '#ff5b5b';
      lc.lineWidth = 1.5;
      lc.beginPath(); lc.moveTo(66, 52); lc.lineTo(66, 80); lc.moveTo(52, 66); lc.lineTo(80, 66); lc.stroke();
    }
    const evPos = (e) => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    cv.addEventListener('pointerdown', (e) => {
      const [mx, my] = evPos(e);
      let bi = -1, bd = 40;
      quad.forEach((q, i) => { const [sx, sy] = toScreen(q); const dd = Math.hypot(sx - mx, sy - my); if (dd < bd) { bd = dd; bi = i; } });
      if (bi < 0) return;
      active = bi;
      cv.setPointerCapture(e.pointerId);
      e.preventDefault();
      draw(); drawLoupe();
    });
    cv.addEventListener('pointermove', (e) => {
      if (active < 0) return;
      const [mx, my] = evPos(e);
      quad[active] = [Math.min(src.width, Math.max(0, (mx - ox) / scale)), Math.min(src.height, Math.max(0, (my - oy) / scale))];
      draw(); drawLoupe();
    });
    const end = () => { active = -1; draw(); drawLoupe(); };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);

    function close(result) {
      window.removeEventListener('resize', layout);
      document.removeEventListener('keydown', onKey);
      root.remove();
      document.body.classList.remove('cropping');
      resolve(result);
    }
    const onKey = (e) => { if (e.key === 'Escape') close(null); if (e.key === 'Enter') root.querySelector('[data-a=ok]').click(); };
    document.addEventListener('keydown', onKey);
    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      if (a === 'cancel') return close(null);
      if (a === 'orig') return close(src);
      if (a === 'ok') {
        const isFull = quad.every((p, i) => dist(p, [[0, 0], [src.width, 0], [src.width, src.height], [0, src.height]][i]) < 2);
        return close(isFull ? src : warp(src, quad));
      }
      if (a === 'rotate') {
        src = rotateCanvas(src, 90);
        quad = detectQuad(src);
      }
      if (a === 'auto') quad = detectQuad(src);
      if (a === 'full') quad = [[0, 0], [src.width, 0], [src.width, src.height], [0, src.height]];
      layout();
    });
    window.addEventListener('resize', layout);
    requestAnimationFrame(layout);
  });
}

export { detectQuad };
