// 영수증 사진 처리 — 보관용 압축 · 목록용 미리보기 · 글자 인식용 보정
const MAX_SIDE = 1800;          // 보관용 긴 변
const MAX_BYTES = 650 * 1024;   // Firestore 문서 한도(1MB) 안에 들도록
const QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.42];

const toBlob = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q));

export async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* 아래 방식 */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawTo(src, w, h, filter = '') {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  if (filter) ctx.filter = filter;
  ctx.drawImage(src, 0, 0, w, h);
  return c;
}

/** 보관용: JPEG, 긴 변 1,800px, 650KB 이하 */
export async function compressImage(src) {
  let scale = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
  let blob;
  for (let round = 0; round < 4; round++) {
    const c = drawTo(src, Math.round(src.width * scale), Math.round(src.height * scale));
    for (const q of QUALITIES) {
      blob = await toBlob(c, 'image/jpeg', q);
      if (blob && blob.size <= MAX_BYTES) return blob;
    }
    scale *= 0.75;
  }
  return blob;
}

/** 목록용 미리보기: 긴 변 240px JPEG data URL (약 10KB) */
export function makeThumb(src) {
  const s = Math.min(1, 240 / Math.max(src.width, src.height));
  const c = drawTo(src, Math.round(src.width * s), Math.round(src.height * s));
  return c.toDataURL('image/jpeg', 0.6);
}

/** 90°·180°·270° 회전 (시계 방향) → canvas */
export function rotateCanvas(src, deg) {
  const d = ((deg % 360) + 360) % 360;
  const swap = d === 90 || d === 270;
  const c = document.createElement('canvas');
  c.width = swap ? src.height : src.width;
  c.height = swap ? src.width : src.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((d * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** 글자 인식용: 흑백 + 대비 강화, 작은 사진은 키우고 큰 사진은 줄임 (긴 변 약 2,000px) */
export function prepForOcr(src) {
  const long = Math.max(src.width, src.height);
  const s = Math.min(2.5, 2000 / long);
  const w = Math.round(src.width * s);
  const h = Math.round(src.height * s);
  const c = drawTo(src, w, h, 'grayscale(1) contrast(1.35)');
  // ctx.filter를 지원하지 않는 브라우저(일부 Safari)는 직접 흑백 변환
  const ctx = c.getContext('2d');
  const probe = ctx.getImageData(Math.floor(w / 2), Math.floor(h / 2), 1, 1).data;
  if (probe[0] !== probe[1] || probe[1] !== probe[2]) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      let v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      v = Math.max(0, Math.min(255, (v - 128) * 1.35 + 128));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
  }
  return c;
}

export const blobToDataURL = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = rej;
  r.readAsDataURL(blob);
});

export async function dataURLToBlob(url) {
  return (await fetch(url)).blob();
}
