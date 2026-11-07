// 내보내기 — 엑셀(.xlsx) · 백업(JSON) · 증빙 인쇄(A4)
import { loadImageURL, loadImageBlob } from './store.js';
import { blobToDataURL } from './image.js';

export const STATUS = { todo: '미제출', submitted: '제출', done: '정산완료' };
const won = (n) => (Number(n) || 0).toLocaleString('ko-KR');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

/** 엑셀 목록: No · 일자 · 가맹점 · 금액 · 정산상태 · 메모 + 합계 */
export async function exportExcel(list, label) {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const head = (v) => ({ value: v, fontWeight: 'bold', backgroundColor: '#E3E9F4', align: 'center', borderStyle: 'thin' });
  const cell = (v, extra = {}) => ({ value: v, borderStyle: 'thin', ...extra });
  const rows = [[head('No'), head('일자'), head('가맹점'), head('금액(원)'), head('정산상태'), head('메모')]];
  let total = 0;
  list.forEach((r, i) => {
    const amt = Number(r.amount) || 0;
    total += amt;
    rows.push([
      cell(i + 1, { type: Number, align: 'center' }),
      cell(r.date || '', { type: String, align: 'center' }),
      cell(r.merchant || '', { type: String }),
      cell(amt, { type: Number, format: '#,##0' }),
      cell(STATUS[r.status] || '', { type: String, align: 'center' }),
      cell(r.memo || '', { type: String, wrap: true }),
    ]);
  });
  rows.push([
    cell(null), cell(null), cell(`합계 (${list.length}건)`, { type: String, fontWeight: 'bold', align: 'right' }),
    cell(total, { type: Number, format: '#,##0', fontWeight: 'bold' }), cell(null), cell(null),
  ]);
  const columns = [{ width: 6 }, { width: 12 }, { width: 30 }, { width: 14 }, { width: 10 }, { width: 40 }];
  const blob = await writeExcelFile(rows, { columns, sheet: '영수증' }, { fontFamily: '맑은 고딕', fontSize: 10 }).toBlob();
  download(blob, `YB-Receipt_${label}_${stamp()}.xlsx`);
}

/** 백업: 영수증 정보 + 사진(data URL)을 하나의 JSON으로 */
export async function exportBackup(list, onStep) {
  const items = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    onStep?.(i + 1, list.length);
    let image = null;
    if (r.hasImage) {
      const b = await loadImageBlob(r.id).catch(() => null);
      if (b) image = await blobToDataURL(b);
    }
    items.push({ ...r, image });
  }
  const blob = new Blob([JSON.stringify({ app: 'YB-Receipt', version: 1, exportedAt: new Date().toISOString(), items })], { type: 'application/json' });
  download(blob, `YB-Receipt_백업_${stamp()}.json`);
}

/** 증빙 인쇄: 1쪽 목록표, 이어서 영수증 사진 (A4 세로, 한 쪽에 2장) */
export async function printEvidence(list, label) {
  const root = document.getElementById('print-root');
  const total = list.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const byStatus = Object.keys(STATUS).map((k) => {
    const g = list.filter((r) => r.status === k);
    return { k, n: g.length, sum: g.reduce((s, r) => s + (Number(r.amount) || 0), 0) };
  });
  const urls = await Promise.all(list.map((r) => (r.hasImage ? loadImageURL(r.id).catch(() => null) : null)));
  const rows = list.map((r, i) => `<tr><td class="c">${i + 1}</td><td class="c nw">${esc((r.date || '').replace(/-/g, '.'))}</td><td>${esc(r.merchant)}</td><td class="r">${won(r.amount)}</td><td class="c">${STATUS[r.status] || ''}</td><td>${esc(r.memo)}</td></tr>`).join('');
  const withImg = list.map((r, i) => ({ r, i, url: urls[i] })).filter((x) => x.url);
  const pages = [];
  for (let i = 0; i < withImg.length; i += 2) pages.push(withImg.slice(i, i + 2));
  const today = new Date().toLocaleDateString('ko-KR');
  root.innerHTML = `
    <section class="pp">
      <h1>영수증 증빙 목록</h1>
      <p class="pp-meta">대상: ${esc(label)} · 출력일: ${today} · ${list.length}건</p>
      <table class="pp-sum"><thead><tr><th>구분</th>${byStatus.map((s) => `<th>${STATUS[s.k]}</th>`).join('')}<th>합계</th></tr></thead>
        <tbody><tr><th>건수</th>${byStatus.map((s) => `<td class="r">${s.n}건</td>`).join('')}<td class="r"><b>${list.length}건</b></td></tr>
        <tr><th>금액(원)</th>${byStatus.map((s) => `<td class="r">${won(s.sum)}</td>`).join('')}<td class="r"><b>${won(total)}</b></td></tr></tbody></table>
      <table class="pp-list"><colgroup><col style="width:7%"><col style="width:14%"><col style="width:30%"><col style="width:14%"><col style="width:11%"><col></colgroup>
        <thead><tr><th>No</th><th>일자</th><th>가맹점</th><th>금액(원)</th><th>상태</th><th>메모</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><th colspan="3" class="r">합계</th><th class="r">${won(total)}</th><th colspan="2"></th></tr></tfoot></table>
    </section>
    ${pages.map((pg) => `<section class="pp pp-img">${pg.map(({ r, i, url }) => `
      <figure><div class="pp-cap"><b>No.${i + 1}</b> ${esc((r.date || '').replace(/-/g, '.'))} · ${esc(r.merchant)} · <b>${won(r.amount)}원</b></div><img src="${url}" alt="" /></figure>`).join('')}</section>`).join('')}`;
  await Promise.all([...root.querySelectorAll('img')].map((im) => (im.complete ? 0 : im.decode().catch(() => 0))));
  document.body.classList.add('printing');
  const done = () => {
    document.body.classList.remove('printing');
    root.innerHTML = '';
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}
