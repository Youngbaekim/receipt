// 글자 인식 엔진·한글/영문 자료를 public/ocr 로 복사 (npm install 때 자동 실행)
// → 외부 CDN 없이 앱 주소에서 바로 받음 (학교망·회사망에서도 동작)
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (...p) => join(root, 'node_modules', ...p);
const out = join(root, 'public', 'ocr');
mkdirSync(join(out, 'lang'), { recursive: true });

const files = [
  [nm('tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js'],
  ...['lstm', 'simd-lstm', 'relaxedsimd-lstm'].map((v) => [nm('tesseract.js-core', `tesseract-core-${v}.wasm.js`), `tesseract-core-${v}.wasm.js`]),
  [nm('@tesseract.js-data', 'kor', '4.0.0_best_int', 'kor.traineddata.gz'), 'lang/kor.traineddata.gz'],
  [nm('@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), 'lang/eng.traineddata.gz'],
];
for (const [src, dst] of files) {
  if (!existsSync(src)) { console.error('[copy-ocr] 없음:', src); process.exitCode = 1; continue; }
  copyFileSync(src, join(out, dst));
}
console.log('[copy-ocr] public/ocr 준비 완료');
