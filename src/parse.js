// 영수증 OCR 글자에서 일자·가맹점·금액을 찾아냄
// 원칙: 확실하지 않으면 비워 두고, 사용자가 직접 고치도록 함

const KO = /[가-힣]/;
const compact = (s) => s.replace(/\s+/g, '');

/** OCR이 숫자 자리에서 자주 틀리는 글자 보정 (O→0, l·I→1 등) */
function fixDigits(s) {
  // 숫자가 섞인 덩어리(예: 4,1OO · 1l,500) 안에서만 바꿈
  return s.replace(/[\dOolI|][\dOolI|,.]*[\dOolI|]/g, (t) => (/\d/.test(t) && /\d[,.]?[OolI|]|[OolI|][,.]?\d/.test(t) ? t.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1') : t));
}

/* ───────── 일자 ───────── */
const DATE_KEYS = ['거래일시', '승인일시', '거래일자', '판매일시', '판매일', '결제일시', '일시', '일자', '날짜', '발행일'];

function validDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return null;
  const now = new Date();
  const max = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const min = new Date(now.getFullYear() - 5, 0, 1);
  if (dt > max || dt < min) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function datesIn(line) {
  const out = [];
  const s = line.replace(/\s+(?=[.\-/년월일])|(?<=[.\-/년월])\s+/g, '');
  let m;
  const full = /(20\d{2})[.\-/년](\d{1,2})[.\-/월](\d{1,2})/g;
  while ((m = full.exec(s))) {
    const v = validDate(+m[1], +m[2], +m[3]);
    if (v) out.push(v);
  }
  if (!out.length) {
    const short = /(?<!\d)(\d{2})[.\-/](\d{2})[.\-/](\d{2})(?!\d)/g;
    while ((m = short.exec(s))) {
      const v = validDate(2000 + +m[1], +m[2], +m[3]);
      if (v) out.push(v);
    }
  }
  if (!out.length) {
    const packed = /(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/g; // 20261107
    while ((m = packed.exec(s))) {
      const v = validDate(+m[1], +m[2], +m[3]);
      if (v) out.push(v);
    }
  }
  return out;
}

export function findDate(lines) {
  for (const line of lines) {
    if (DATE_KEYS.some((k) => compact(line).includes(k))) {
      const d = datesIn(line);
      if (d.length) return d[0];
    }
  }
  for (const line of lines) {
    const d = datesIn(line);
    if (d.length) return d[0];
  }
  return '';
}

/* ───────── 금액 ───────── */
// OCR이 자주 틀리는 열쇠말 글자 보정 (금맥·금엑 → 금액, 숨인·슴인 → 승인 등)
const keyText = (l) => compact(l).toUpperCase()
  .replace(/[맥엑앰액액]/g, '액').replace(/[숨슴]인/g, '승인').replace(/발은/g, '받은').replace(/합게|함계/g, '합계');

// 앞에 있을수록 우선 (실제로 결제된 금액)
const AMOUNT_KEYS = [
  ['결제금액', '승인금액', '총결제금액', '카드금액', '카드결제', '신용카드', '결제합계', '청구금액'],
  ['합계금액', '총합계', '합계', '총액', '총금액', '판매합계', '총구매액', 'TOTAL', '이용금액'],
  // '판매금액'은 영수증에 따라 부가세 제외 금액이기도 해서 낮은 순위
  ['받을금액', '받은금액', '판매금액', '금액'],
];
const EXCLUDE = ['부가세', '부가가치세', '세액', '과세', '면세', '공급가', '물품가', '봉사료', '할인', '거스름', '잔액', '포인트', '사업자', '전화', 'TEL', '카드번호', '승인번호', '가맹번호', '가맹점번호', '단말', '단가', '수량'];

function amountsIn(line) {
  const s = fixDigits(line);
  const out = [];
  // 12,345 · 12.345(쉼표를 마침표로 읽음) · 12, 345 / 12 ,345(사이 공백) · 12345
  const re = /(?<![\d\-*])(\d{1,3}(?:\s?[,.]\s?\d{3})+|\d{3,8})(?:\s*원)?(?![\d\-*])/g;
  let m;
  while ((m = re.exec(s))) {
    const n = Number(m[1].replace(/[,.\s]/g, ''));
    if (n >= 100 && n < 100000000) out.push(n);
  }
  return out;
}

let verified = false; // 마지막 금액이 '공급가액+부가세' 검산과 맞았는지
let rank = 99;        // 금액을 찾은 근거의 확실성 (0 검산 일치 · 1~3 열쇠말 순위 · 9 열쇠말 없음 · 99 못 찾음)

export function findAmount(lines) {
  verified = false;
  rank = 99;
  const K = lines.map(keyText);
  // ① 검산값: 공급가액(과세물품가액) + 부가세 — 부가세가 공급가액의 약 10%일 때만 신뢰
  // 공급가액 자리에 '판매금액'·'과세금액'을 쓰는 영수증도 있음 → 부가세가 그 금액의 약 10%인 줄을 찾음
  // (부가세가 약 1/11이면 그 금액은 이미 부가세 포함 합계이므로 검산에 쓰지 않음)
  const lineNums = (i) => { const n = amountsIn(lines[i]); return n.length || !lines[i + 1] ? n : amountsIn(lines[i + 1]); };
  const vats = [], supplies = [];
  K.forEach((c, i) => {
    const head = c.replace(/^[^가-힣A-Z0-9]+/, '');
    if (/^(부가세|부가가치세|세액)/.test(head) && !/물품가|공급가|과세/.test(c)) vats.push(...lineNums(i));
    if (/공급가|물품가|판매금액|과세금액|과세물품/.test(c)) supplies.push(...lineNums(i));
  });
  const hasTaxFree = K.some((c) => c.includes('면세') && amountsIn(c).some((n) => n > 0));
  let check = 0;
  for (const sv of supplies) {
    const v = vats.find((x) => Math.abs(x - sv / 10) <= 2); // 반올림·버림 차이는 최대 1원 남짓
    if (v) { check = sv + v; break; }
  }

  // ② 열쇠말 후보
  let keyed = 0, keyedRank = 99;
  const all = [];
  for (const [gi, group] of AMOUNT_KEYS.entries()) {
    let best = 0;
    K.forEach((c, i) => {
      if (!group.some((k) => c.includes(k))) return;
      if (EXCLUDE.some((k) => c.includes(k.toUpperCase()))) return;
      let nums = amountsIn(lines[i]);
      if (!nums.length && lines[i + 1]) nums = amountsIn(lines[i + 1]);
      all.push(...nums);
      if (nums.length) best = Math.max(best, Math.max(...nums));
    });
    if (best && !keyed) { keyed = best; keyedRank = gi + 1; }
  }
  if (check) {
    verified = true;
    rank = 0;
    if (all.some((n) => Math.abs(n - check) <= 1)) return all.find((n) => Math.abs(n - check) <= 1);
    if (!hasTaxFree) return check; // 열쇠말 금액을 잘못 읽은 경우(예: 51,500 → 571,500)
    verified = false;
  }
  if (keyed) { rank = keyedRank; return keyed; }
  // ③ 열쇠말이 없으면: 쉼표가 있는 금액 중 가장 큰 값 (제외 줄은 빼고)
  let best = 0;
  lines.forEach((l, i) => {
    if (EXCLUDE.some((k) => K[i].includes(k.toUpperCase()))) return;
    if (!/\d\s?[,.]\s?\d{3}/.test(l)) return;
    for (const n of amountsIn(l)) best = Math.max(best, n);
  });
  if (best) rank = 9;
  return best || '';
}

/* ───────── 가맹점 ───────── */
const MERCHANT_KEYS = ['가맹점명', '가맹점', '상호명', '상호', '매장명', '점포명', '업체명'];
const SKIP_HEAD = ['영수증', '매출전표', '고객용', '카드', '결제', '승인', '현금', '전표', '재발행', '거래명세', '대기번호', '주문번호', '사업자', '대표', '주소', '전화', '번호', '특별시', '광역시', '안녕하', '안념하', '감사합', '어서오', '일시', '판매원', '공급가', '부가세', '합계', '금액', '할인', '포인트'];
// 주소 줄: '서울 관악구 관악로 237', '동작구 상도로369' 등
const ADDR = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|충청|전북|전남|전라|경북|경남|경상|제주)|[가-힣]+(구|군|시)\s*[가-힣0-9]+(로|길|동)(\s|\d|$)/;
const STOP = /품명|상품명|단가|수량|POS|거래일|20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/;

function cleanName(s) {
  return s.replace(/^[\s:：\-\[\]]+|[\s:：\-\[\]]+$/g, '').replace(/\s{2,}/g, ' ').slice(0, 40);
}

/** OCR 잡음을 걸러 한글 낱말(2글자 이상)과 (주)·영문 상호만 남김 */
function nameTokens(line) {
  const raw = line.split(/\s+/).map((t) => t.replace(/[^가-힣A-Za-z0-9()&.\-]/g, ''));
  const isKo = (t) => /^(\(주\)|㈜)?[가-힣]{2,}(\([^)]*\))?[가-힣]*$/.test(t) || /^\(주\)[가-힣]+/.test(t);
  // 영문 대문자 상표(CU·GS25 등)는 바로 뒤에 한글 상호가 올 때만 인정
  return raw.filter((t, i) => isKo(t) || (/^[A-Z][A-Z0-9]{1,5}$/.test(t) && raw[i + 1] && isKo(raw[i + 1])));
}

export function findMerchant(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const c = compact(line);
    const key = MERCHANT_KEYS.find((k) => c.startsWith(k) || c.includes(k + ':') || c.includes(k + '：'));
    if (!key || /^가맹점?번호/.test(c.slice(c.indexOf(key)))) continue;
    const pat = key.split('').join('\\s*');
    const idx = line.search(new RegExp(pat));
    let rest = idx >= 0 ? line.slice(idx).replace(new RegExp('^' + pat), '') : '';
    rest = cleanName(rest.replace(/^명?\s*[:：]?/, ''));
    if (rest && !/카드/.test(rest) && (KO.test(rest) || /[A-Za-z]{2,}/.test(rest))) return rest;
  }
  // 위쪽 줄(품목표·거래일시 전까지) 중 상호로 보이는 첫 줄 — 확실하지 않으면 비움
  for (const [i, line] of lines.slice(0, 12).entries()) {
    const c = compact(line).toUpperCase();
    if (STOP.test(c)) break;
    if (SKIP_HEAD.some((k) => c.includes(k))) continue;
    if (/\d{2,}[-)]\d{3,}/.test(line)) continue; // 전화·사업자번호
    if (ADDR.test(line)) continue; // 주소
    const toks = nameTokens(line);
    const longest = Math.max(0, ...toks.map((t) => t.replace(/[^가-힣]/g, '').length));
    // 위쪽 3줄 안이면 2글자 상호도 인정, 그 밖은 3글자 이상
    if (longest >= 3 || (longest >= 2 && i < 3)) return toks.join(' ');
  }
  return '';
}

/** OCR 결과 전체 → { date, merchant, amount } */
export function parseReceipt(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/[|¦]/g, ' ').trim())
    .filter((l) => l.length > 0);
  const amount = findAmount(lines);
  return { date: findDate(lines), merchant: findMerchant(lines), amount, verified, rank };
}
