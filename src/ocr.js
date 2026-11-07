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
 * 가로로 찍힌 영수증(가로가 더 긴 사진)은 90°·270° 두 방향을 모두 읽어 더 잘 읽힌 쪽을 고름
 * 세로 사진이 잘 안 읽히면(신뢰도 낮음) 거꾸로(180°)도 시도
 * @returns {Promise<{text:string, rotation:number, date:string, merchant:string, amount:number|''}>}
 */
export function recognize(bitmap, onProgress) {
  const job = chain.then(async () => {
    initCb = onProgress || null;
    const w = await getWorker();
    initCb = null;
    const landscape = bitmap.width > bitmap.height * 1.15;
    const tries = landscape ? [90, 270] : [0];
    let best = null;
    const run = async (deg, k, n) => {
      progressCb = (m) => onProgress?.({ ...m, progress: m.status === 'recognizing text' ? (k + (m.progress || 0)) / n : m.progress });
      const src = deg ? rotateCanvas(bitmap, deg) : bitmap;
      const { data } = await w.recognize(prepForOcr(src));
      const r = { text: (data.text || '').trim(), conf: data.confidence || 0, rotation: deg };
      if (!best || r.conf > best.conf) best = r;
    };
    for (let k = 0; k < tries.length; k++) await run(tries[k], k, tries.length);
    if (!landscape && best.conf < 45) await run(180, 0, 1);
    progressCb = null;
    return { text: best.text, rotation: best.rotation, confidence: best.conf, ...parseReceipt(best.text) };
  });
  chain = job.catch(() => {});
  return job;
}
