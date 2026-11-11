// 기기 안 글자 인식(Tesseract.js, 한글+영문) — 서버로 사진을 보내지 않음
// 인식 엔진·한글/영문 자료는 앱 주소의 ocr/ 폴더에서 받음(외부 CDN 미사용), 처음 한 번 받은 뒤에는 기기에 보관
import { prepForOcr, rotateCanvas } from './image.js';
import { parseReceipt } from './parse.js';

let workerP = null;
let progressCb = null;
let initCb = null; // 엔진 준비 단계 진행 표시

async function getWorker() {
  if (!workerP) {
    workerP = (async () => {
      const { createWorker } = await import('tesseract.js');
      const base = new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href;
      const w = await createWorker(['kor', 'eng'], 1, {
        workerPath: `${base}worker.min.js`,
        corePath: base,
        langPath: `${base}lang`,
        logger: (m) => (progressCb ? progressCb(m) : initCb?.(m)),
      });
      await w.setParameters({ preserve_interword_spaces: '1' });
      return w;
    })().catch((e) => {
      workerP = null;
      throw e;
    });
  }
  return workerP;
}

// 여러 장을 한꺼번에 넣어도 한 장씩 차례로
let chain = Promise.resolve();

/**
 * 가로가 더 긴 사진은 그대로 먼저 읽고, 잘 안 읽히면 90°·270°도 읽어 더 잘 읽힌 쪽을 고름
 * 세로 사진이 잘 안 읽히면(신뢰도 낮음) 거꾸로(180°)도 시도
 * @returns {Promise<{text:string, rotation:number, date:string, merchant:string, amount:number|''}>}
 */
export function recognize(bitmap, onProgress) {
  const job = chain.then(async () => {
    initCb = onProgress || null;
    const w = await getWorker();
    initCb = null;
    // 가로가 더 긴 사진: 짧고 넓은 영수증일 수도, 옆으로 찍은 영수증일 수도 있음
    // → 먼저 그대로 읽고, 신뢰도가 낮으면 90°·270°도 읽어 가장 잘 읽힌 쪽을 고름
    const landscape = bitmap.width > bitmap.height * 1.15;
    let best = null;
    const run = async (deg, k, n, size = 2000, sx = 1) => {
      progressCb = (m) => onProgress?.({ ...m, progress: m.status === 'recognizing text' ? (k + (m.progress || 0)) / n : m.progress });
      const src = deg ? rotateCanvas(bitmap, deg) : bitmap;
      const { data } = await w.recognize(prepForOcr(src, size, sx));
      const r = { text: (data.text || '').trim(), conf: data.confidence || 0, rotation: deg };
      if (!best || r.conf > best.conf) best = r;
    };
    await run(0, 0, 1);
    if (landscape && best.conf < 60) { await run(90, 0, 2); await run(270, 1, 2); }
    else if (!landscape && best.conf < 45) await run(180, 0, 1);
    let parsed = parseReceipt(best.text);
    let text = best.text;
    // 금액이 검산(공급가액+부가세)으로 확인되지 않으면 → 가로로 좁힌 사진으로 한 번 더 읽음
    // (영수증의 굵고 넓은 금액 글씨는 가로를 75%로 좁히면 더 잘 읽힘)
    if (!parsed.verified) {
      const first = best;
      best = null;
      await run(first.rotation, 0, 1, 2000, 0.75);
      const second = best;
      best = first;
      const p2 = parseReceipt(second.text);
      const merged = parseReceipt(`${first.text}\n${second.text}`);
      const pick = merged.verified ? merged : p2.rank < parsed.rank ? p2 : null; // 더 확실한 근거로 찾은 쪽
      if (pick) {
        parsed = { ...parsed, amount: pick.amount, verified: pick.verified, rank: pick.rank };
        if (!parsed.merchant && p2.merchant) parsed.merchant = p2.merchant;
        if (!parsed.date && p2.date) parsed.date = p2.date;
      }
      if (!parsed.merchant && p2.merchant) parsed.merchant = p2.merchant;
      text = `${first.text}\n\n[2차 인식]\n${second.text}`;
    }
    progressCb = null;
    return { text, rotation: best.rotation, confidence: best.conf, ...parsed };
  });
  chain = job.catch(() => {});
  return job;
}
