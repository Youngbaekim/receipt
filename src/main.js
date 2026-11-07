// YB-Receipt — 업무 영수증 증빙 관리 (촬영 → 기기 안 글자 인식 → 정산 상태 관리 → 엑셀·인쇄)
import './style.css';
import { getTheme, setTheme } from './theme.js';
import { signIn, signOutUser, watchAuth, finishRedirect } from './firebase.js';
import * as store from './store.js';
import { loadBitmap, compressImage, makeThumb, dataURLToBlob, rotateCanvas } from './image.js';
import { recognize } from './ocr.js';
import { STATUS, exportExcel, exportBackup, printEvidence } from './export.js';

const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => (Number(n) || 0).toLocaleString('ko-KR');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** '2026-11-07' → '토' */
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const dow = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  return m ? DOW[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] : '';
};
const dateLabel = (d) => `${d.replace(/-/g, '.')} (${dow(d)})`;
const pref = {
  get: (k, d) => { try { return localStorage.getItem('ybr-' + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('ybr-' + k, v); } catch { /* 무시 */ } },
};

const state = {
  user: null,
  list: [],            // 전체 영수증
  month: pref.get('month', 'all'),
  status: 'all',
  q: '',
  selId: null,
  checked: new Set(),
  ocr: new Map(),      // id → { p: 0~1, msg }
  loaded: false,
};

/* ───────── 걸러 보기 ───────── */
const monthOf = (r) => (r.date ? r.date.slice(0, 7) : '');
function inMonth(r) {
  if (state.month === 'all') return true;
  if (state.month === 'nodate') return !r.date;
  return monthOf(r) === state.month;
}
function matchQ(r) {
  if (!state.q) return true;
  const q = state.q.toLowerCase();
  return [r.merchant, r.memo, String(r.amount || '')].some((v) => String(v || '').toLowerCase().includes(q));
}
const sortKey = (r) => `${r.date || '0000-00-00'}|${String(r.createdAt || 0).padStart(15, '0')}`;
function visible() {
  return state.list
    .filter((r) => inMonth(r) && matchQ(r) && (state.status === 'all' || r.status === state.status))
    .sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1));
}
const current = () => state.list.find((r) => r.id === state.selId) || null;
function periodLabel() {
  if (state.month === 'all') return '전체기간';
  if (state.month === 'nodate') return '일자없음';
  return state.month;
}

/* ───────── 목록 그리기 ───────── */
function renderMonths() {
  const months = [...new Set(state.list.map(monthOf).filter(Boolean))].sort().reverse();
  const hasNoDate = state.list.some((r) => !r.date);
  if (state.month !== 'all' && state.month !== 'nodate' && !months.includes(state.month)) months.unshift(state.month);
  const opts = [['all', '전체 기간'], ...months.map((m) => [m, `${m.slice(0, 4)}년 ${+m.slice(5)}월`])];
  if (hasNoDate || state.month === 'nodate') opts.push(['nodate', '일자 없음']);
  $('#sel-month').innerHTML = opts.map(([v, t]) => `<option value="${v}"${v === state.month ? ' selected' : ''}>${t}</option>`).join('');
}

function renderChips() {
  const base = state.list.filter((r) => inMonth(r) && matchQ(r));
  const cnt = (k) => base.filter((r) => k === 'all' || r.status === k).length;
  const items = [['all', '전체'], ['todo', STATUS.todo], ['submitted', STATUS.submitted], ['done', STATUS.done]];
  $('#chips').innerHTML = items.map(([k, t]) => `<button class="chip${state.status === k ? ' active' : ''}" data-status="${k}" role="tab">${t}<b>${cnt(k)}</b></button>`).join('');
}

function renderSummary() {
  const base = state.list.filter((r) => inMonth(r) && matchQ(r));
  const g = (k) => base.filter((r) => r.status === k);
  const sum = (a) => a.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const cols = ['todo', 'submitted', 'done'];
  $('#summary').innerHTML = `
    <thead><tr><th></th>${cols.map((k) => `<th>${STATUS[k]}</th>`).join('')}<th>합계</th></tr></thead>
    <tbody>
      <tr><th>건수</th>${cols.map((k) => `<td>${g(k).length}</td>`).join('')}<td class="tot">${base.length}</td></tr>
      <tr><th>금액</th>${cols.map((k) => `<td>${won(sum(g(k)))}</td>`).join('')}<td class="tot">${won(sum(base))}</td></tr>
    </tbody>`;
}

function cardHTML(r) {
  const o = state.ocr.get(r.id);
  const thumb = r.thumb ? `style="background-image:url('${r.thumb}')"` : '';
  const badge = o ? `<span class="badge ocr">인식 ${Math.round((o.p || 0) * 100)}%</span>` : `<span class="badge ${r.status}">${STATUS[r.status] || ''}</span>`;
  return `<li class="card${r.id === state.selId ? ' active' : ''}${state.checked.has(r.id) ? ' checked' : ''}" data-id="${r.id}">
    <input type="checkbox" class="cb" aria-label="선택"${state.checked.has(r.id) ? ' checked' : ''} />
    <span class="thumb" ${thumb}>${r.thumb ? '' : '🧾'}</span>
    <span class="c-main">
      <span class="c-merchant${r.merchant ? '' : ' none'}">${esc(r.merchant || (o ? '인식 중…' : '가맹점 미입력'))}</span>
      <span class="c-sub">${r.date ? `<span class="${{ 토: 'sat', 일: 'sun' }[dow(r.date)] || ''}">${dateLabel(r.date)}</span>` : '<span class="warn">일자 없음</span>'}</span>${r.memo ? `<span class="c-memo">${esc(r.memo)}</span>` : ''}
    </span>
    <span class="c-right"><span class="c-amount${r.amount ? '' : ' warn'}">${r.amount ? won(r.amount) + '원' : '금액 없음'}</span>${badge}</span>
  </li>`;
}

function renderList() {
  const items = visible();
  const ul = $('#list');
  if (!state.loaded) {
    ul.innerHTML = '<li class="empty">불러오는 중…</li>';
    return;
  }
  if (!items.length) {
    ul.innerHTML = state.list.length
      ? '<li class="empty">조건에 맞는 영수증이 없습니다.</li>'
      : '<li class="empty">아직 영수증이 없습니다.<br /><b>＋ 영수증</b>으로 사진을 찍거나 고르세요.</li>';
    return;
  }
  // 월별 머리줄 (전체 기간일 때)
  let html = '';
  let lastM = null;
  const monthSum = {};
  if (state.month === 'all') items.forEach((r) => { const m = monthOf(r) || '일자 없음'; monthSum[m] = (monthSum[m] || 0) + (Number(r.amount) || 0); });
  for (const r of items) {
    if (state.month === 'all') {
      const m = monthOf(r) || '일자 없음';
      if (m !== lastM) {
        const cnt = items.filter((x) => (monthOf(x) || '일자 없음') === m).length;
        const label = m === '일자 없음' ? m : `${m.slice(0, 4)}년 ${+m.slice(5)}월`;
        html += `<li class="month-h"><span>${label}</span><span>${cnt}건 · ${won(monthSum[m])}원</span></li>`;
        lastM = m;
      }
    }
    html += cardHTML(r);
  }
  ul.innerHTML = html;
}

function renderSelbar() {
  const n = state.checked.size;
  $('#selbar').hidden = n === 0;
  $('#sel-count').textContent = `${n}건`;
  const vis = visible();
  const all = vis.length > 0 && vis.every((r) => state.checked.has(r.id));
  $('#chk-all').checked = all;
  $('#chk-all').indeterminate = !all && vis.some((r) => state.checked.has(r.id));
}

function renderAll() {
  renderMonths();
  renderChips();
  renderSummary();
  renderList();
  renderSelbar();
  renderDetail();
}

/* ───────── 상세 ───────── */
let shownId = null;    // 상세에 지금 그려 둔 영수증
let editing = false;   // 입력 중에는 서버 반영으로 칸을 덮어쓰지 않음

function renderDetail() {
  const r = current();
  const has = !!r;
  $('#detail').hidden = !has;
  $('#empty-detail').hidden = has;
  ['#btn-delete', '#btn-photo'].forEach((s) => ($(s).disabled = !has));
  $('#btn-reocr').disabled = !has || !r?.hasImage || state.ocr.has(r?.id);
  $('#btn-rotate').disabled = $('#btn-reocr').disabled;
  if (!has) {
    shownId = null;
    $('#detail-title').textContent = '영수증';
    $('#save-state').textContent = '';
    return;
  }
  const fresh = shownId !== r.id;
  $('#detail-title').textContent = r.merchant || '영수증';
  if (fresh || !editing) {
    setVal('#f-date', r.date || '');
  }
  setDow(r.date);
  if (fresh || !editing) {
    setVal('#f-merchant', r.merchant || '');
    setVal('#f-amount', r.amount ? won(r.amount) : '');
    setVal('#f-memo', r.memo || '');
  }
  $('#f-date').classList.toggle('missing', !r.date && !state.ocr.has(r.id));
  $('#f-amount').classList.toggle('missing', !r.amount && !state.ocr.has(r.id));
  document.querySelectorAll('#f-status button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === r.status);
    b.setAttribute('aria-checked', b.dataset.v === r.status);
  });
  const fmt = (t) => (t ? new Date(t).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '');
  $('#f-meta').textContent = `등록 ${fmt(r.createdAt)}${r.updatedAt && r.updatedAt !== r.createdAt ? ` · 수정 ${fmt(r.updatedAt)}` : ''}`;
  $('#ocr-raw').hidden = !r.ocrText;
  $('#ocr-text').textContent = r.ocrText || '';

  // 사진
  if (fresh) {
    const img = $('#photo-img');
    img.hidden = true;
    img.removeAttribute('src');
    $('#photo-empty').hidden = !!r.hasImage;
    if (r.hasImage) {
      if (r.thumb) { img.src = r.thumb; img.hidden = false; }
      const id = r.id;
      store.loadImageURL(id).then((url) => {
        if (url && state.selId === id) { img.src = url; img.hidden = false; }
      }).catch(() => {});
    }
  } else if (r.hasImage && $('#photo-img').hidden) {
    $('#photo-empty').hidden = true;
    store.loadImageURL(r.id).then((url) => { if (url && state.selId === r.id) { $('#photo-img').src = url; $('#photo-img').hidden = false; } }).catch(() => {});
  }
  renderOcrOverlay();
  shownId = r.id;
}

function setDow(d) {
  const el = $('#f-dow');
  const w = dow(d);
  el.textContent = w ? `(${w}요일)` : '';
  el.classList.toggle('sat', w === '토');
  el.classList.toggle('sun', w === '일');
}

function setVal(sel, v) {
  const el = $(sel);
  if (document.activeElement !== el && el.value !== v) el.value = v;
}

function renderOcrOverlay() {
  const o = state.ocr.get(state.selId);
  $('#ocr-overlay').hidden = !o;
  if (o) {
    $('#ocr-msg').textContent = o.msg || '글자 인식 중…';
    $('#ocr-bar').style.width = `${Math.round((o.p || 0) * 100)}%`;
  }
}

function select(id, { open = true } = {}) {
  state.selId = id;
  editing = false;
  renderList();
  renderDetail();
  if (open && id) $('#app').dataset.view = 'detail';
}

/* 입력 → 자동 저장 */
let saveTimer = null;
const pending = {};
function queueSave(fields) {
  const r = current();
  if (!r) return;
  Object.assign(r, fields); // 화면에 즉시 반영
  Object.assign(pending, fields);
  editing = true;
  $('#save-state').textContent = '저장 중…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
  renderChips();
  renderSummary();
  renderList();
}
async function flushSave() {
  clearTimeout(saveTimer);
  const r = current();
  const fields = { ...pending };
  Object.keys(pending).forEach((k) => delete pending[k]);
  if (!r || !Object.keys(fields).length) return;
  store.patchReceipt(r.id, fields);
  editing = false;
  $('#save-state').textContent = '저장됨';
  renderMonths();
}
const parseAmount = (s) => {
  const n = Number(String(s).replace(/[^\d]/g, ''));
  return n || '';
};

/* ───────── 추가 ───────── */
async function addFiles(files) {
  const imgs = [...files].filter((f) => f.type.startsWith('image/'));
  if (!imgs.length) return;
  if (!state.user) return toast('먼저 로그인해 주세요.');
  let firstId = null;
  for (const file of imgs) {
    try {
      const bitmap = await loadBitmap(file);
      const id = store.newId();
      const blob = await compressImage(bitmap);
      const now = Date.now();
      const rec = { id, date: '', merchant: '', amount: '', status: 'todo', memo: '', ocrText: '', hasImage: true, thumb: makeThumb(bitmap), createdAt: now, updatedAt: now };
      state.ocr.set(id, { p: 0, msg: '글자 인식 준비 중…' });
      state.list.push(rec);
      store.saveImage(id, blob); // 기기 안 사본에 먼저 저장 → 온라인이면 서버로 (기다리지 않음)
      store.saveReceipt(rec);
      if (!firstId) { firstId = id; select(id); }
      runOcr(id, bitmap, false);
    } catch (e) {
      console.error(e);
      toast(`사진을 읽지 못했습니다: ${file.name || ''}`);
    }
  }
  if (imgs.length > 1) toast(`${imgs.length}장을 추가했습니다. 차례로 글자를 인식합니다.`);
  renderAll();
}

function addManual() {
  if (!state.user) return;
  const now = Date.now();
  const rec = { id: store.newId(), date: todayStr(), merchant: '', amount: '', status: 'todo', memo: '', ocrText: '', hasImage: false, thumb: '', createdAt: now, updatedAt: now };
  state.list.push(rec);
  store.saveReceipt(rec);
  select(rec.id);
  renderAll();
  setTimeout(() => $('#f-merchant').focus(), 50);
}

const OCR_MSG = {
  'loading tesseract core': '인식 엔진 불러오는 중…',
  'initializing tesseract': '인식 엔진 준비 중…',
  'loading language traineddata': '한글 자료 받는 중… (처음 한 번)',
  'initializing api': '인식 준비 중…',
  'recognizing text': '글자 인식 중…',
};

/** 글자 인식 → 빈 칸만 채움 (overwrite=true면 일자·가맹점·금액을 새 값으로) */
async function runOcr(id, bitmap, overwrite) {
  state.ocr.set(id, { p: 0, msg: '인식 차례를 기다리는 중…' });
  refreshOcr(id);
  try {
    const res = await recognize(bitmap, (m) => {
      const p = m.status === 'recognizing text' ? 0.15 + 0.85 * (m.progress || 0) : 0.15 * (m.progress || 0);
      state.ocr.set(id, { p, msg: OCR_MSG[m.status] || '준비 중…' });
      refreshOcr(id);
    });
    const r = state.list.find((x) => x.id === id);
    if (!r) return;
    const fields = { ocrText: res.text };
    // 가로로 찍힌 사진이면 바로 세운 사진으로 바꿔 저장
    if (res.rotation) {
      const up = rotateCanvas(bitmap, res.rotation);
      store.forgetImage(id);
      store.saveImage(id, await compressImage(up));
      fields.thumb = makeThumb(up);
      shownId = null;
    }
    for (const k of ['date', 'merchant', 'amount']) {
      if (res[k] && (overwrite || !r[k])) fields[k] = res[k];
    }
    Object.assign(r, fields);
    store.patchReceipt(id, fields);
    const miss = ['date', 'merchant', 'amount'].filter((k) => !r[k]).map((k) => ({ date: '일자', merchant: '가맹점', amount: '금액' }[k]));
    if (state.selId === id) {
      shownId = null; // 칸 다시 채우기
      toast(miss.length ? `인식 완료 — ${miss.join('·')}은(는) 직접 입력해 주세요.` : '인식 완료 — 값이 맞는지 확인해 주세요.');
    }
  } catch (e) {
    console.error('[YB-Receipt] 글자 인식 실패', e);
    toast('글자 인식에 실패했습니다. 인터넷 연결(처음 한 번 필요)을 확인하거나 직접 입력해 주세요.');
  } finally {
    state.ocr.delete(id);
    if (bitmap.close) bitmap.close();
    renderAll();
  }
}

let ocrPaint = 0;
function refreshOcr(id) {
  if (ocrPaint) return;
  ocrPaint = requestAnimationFrame(() => {
    ocrPaint = 0;
    if (state.selId === id) renderOcrOverlay();
    const li = document.querySelector(`.card[data-id="${id}"] .badge`);
    const o = state.ocr.get(id);
    if (li && o) { li.className = 'badge ocr'; li.textContent = `인식 ${Math.round(o.p * 100)}%`; }
  });
}

async function reOcr() {
  const r = current();
  if (!r?.hasImage) return;
  if ((r.date || r.merchant || r.amount) && !confirm('일자·가맹점·금액을 다시 인식한 값으로 바꿀까요?\n(인식하지 못한 칸은 지금 값을 유지합니다)')) return;
  const blob = await store.loadImageBlob(r.id);
  if (!blob) return toast('사진을 불러오지 못했습니다.');
  runOcr(r.id, await loadBitmap(blob), true);
}

async function replacePhoto(file) {
  const r = current();
  if (!r || !file) return;
  const bitmap = await loadBitmap(file);
  const blob = await compressImage(bitmap);
  store.forgetImage(r.id);
  store.saveImage(r.id, blob);
  const fields = { hasImage: true, thumb: makeThumb(bitmap) };
  Object.assign(r, fields);
  store.patchReceipt(r.id, fields);
  shownId = null;
  renderAll();
  runOcr(r.id, bitmap, false);
}

/** 사진 오른쪽으로 90° 돌리기 (돌린 뒤 🔍로 다시 인식 가능) */
async function rotatePhoto() {
  const r = current();
  if (!r?.hasImage) return;
  const blob = await store.loadImageBlob(r.id);
  if (!blob) return;
  const up = rotateCanvas(await loadBitmap(blob), 90);
  store.forgetImage(r.id);
  store.saveImage(r.id, await compressImage(up));
  const fields = { thumb: makeThumb(up) };
  Object.assign(r, fields);
  store.patchReceipt(r.id, fields);
  shownId = null;
  renderAll();
}

async function removeCurrent() {
  const r = current();
  if (!r) return;
  if (!confirm(`이 영수증을 삭제할까요?\n${r.merchant || ''} ${r.amount ? won(r.amount) + '원' : ''}\n(사진도 함께 지워지며 되돌릴 수 없습니다)`)) return;
  state.list = state.list.filter((x) => x.id !== r.id);
  state.checked.delete(r.id);
  store.forgetImage(r.id);
  store.removeReceipt(r.id);
  state.selId = null;
  $('#app').dataset.view = 'list';
  renderAll();
  toast('삭제했습니다.');
}

/* ───────── 내보내기 대상: 선택한 것, 없으면 지금 보이는 목록 ───────── */
function targets() {
  const vis = visible();
  if (state.checked.size) {
    const sel = state.list.filter((r) => state.checked.has(r.id)).sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1));
    return { list: sel, label: `선택${sel.length}건` };
  }
  return { list: vis, label: periodLabel() + (state.status !== 'all' ? `_${STATUS[state.status]}` : '') };
}
// 증빙은 일자 오름차순으로 (정산 서류 관례)
const asc = (a) => [...a].sort((x, y) => (sortKey(x) > sortKey(y) ? 1 : -1));

/* ───────── 작은 메뉴 ───────── */
function openPop(anchor, html, bind) {
  const pop = $('#pop');
  pop.innerHTML = html;
  pop.hidden = false;
  const a = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  let left = Math.min(window.innerWidth - w - 8, Math.max(8, a.right - w));
  let top = a.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 6);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  bind?.(pop);
}
const closePop = () => { $('#pop').hidden = true; };

function addMenu(anchor) {
  openPop(anchor, `
    <button data-a="camera">📷 사진 찍기</button>
    <button data-a="pick">🖼 사진 고르기 <span class="k">여러 장 가능</span></button>
    <button data-a="manual">✍ 직접 입력 <span class="k">사진 없이</span></button>`);
}

function mainMenu(anchor) {
  const t = targets();
  const theme = getTheme();
  openPop(anchor, `
    <button data-a="excel">📊 엑셀로 내보내기 <span class="k">${t.list.length}건</span></button>
    <button data-a="print">🖨 증빙 인쇄·PDF <span class="k">${t.list.length}건</span></button>
    <hr />
    <button data-a="backup">💾 전체 백업 <span class="k">${state.list.length}건</span></button>
    <button data-a="restore">♻ 백업에서 복원</button>
    <hr />
    <div class="pop-row">화면 <select id="sel-theme" class="sel sel-sm">
      <option value="system"${theme === 'system' ? ' selected' : ''}>🌓 시스템 설정 사용</option>
      <option value="dark"${theme === 'dark' ? ' selected' : ''}>🌙 다크모드 켜기</option>
      <option value="light"${theme === 'light' ? ' selected' : ''}>☀ 다크모드 끄기</option></select></div>
    <button data-a="install">📲 앱으로 설치하는 법</button>
    <button data-a="signout" class="danger">로그아웃</button>`, (pop) => {
    $('#sel-theme', pop).onchange = (e) => setTheme(e.target.value);
  });
}

async function doAction(a) {
  closePop();
  if (a === 'camera') return $('#file-camera').click();
  if (a === 'pick') return $('#file-pick').click();
  if (a === 'manual') return addManual();
  if (a === 'restore') return $('#file-restore').click();
  if (a === 'signout') {
    if (confirm('로그아웃할까요? 다시 로그인하면 영수증이 그대로 보입니다.')) await signOutUser();
    return;
  }
  if (a === 'install') {
    return alert('■ PC(크롬·엣지): 주소창 오른쪽의 설치 아이콘(⊕) → 설치\n■ 갤럭시(크롬): 오른쪽 위 ⋮ → 홈 화면에 추가 → 설치\n■ 아이폰(Safari): 아래 공유(□↑) → 홈 화면에 추가');
  }
  await flushSave();
  const t = targets();
  if (!t.list.length && a !== 'backup') return toast('내보낼 영수증이 없습니다.');
  try {
    if (a === 'excel') {
      await exportExcel(asc(t.list), t.label);
      toast(`엑셀 파일로 저장했습니다 (${t.list.length}건).`);
    } else if (a === 'print') {
      toast('인쇄 화면을 준비하는 중…');
      await printEvidence(asc(t.list), t.label.replace(/_/g, ' '));
    } else if (a === 'backup') {
      if (!state.list.length) return toast('백업할 영수증이 없습니다.');
      await exportBackup(state.list, (i, n) => toast(`백업 준비 중… ${i}/${n}`, 0));
      toast(`백업 파일을 저장했습니다 (${state.list.length}건).`);
    }
  } catch (e) {
    console.error(e);
    toast(`처리하지 못했습니다: ${e.message || e}`);
  }
}

async function restore(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'YB-Receipt' || !Array.isArray(data.items)) throw new Error('YB-Receipt 백업 파일이 아닙니다');
    const have = new Set(state.list.map((r) => r.id));
    const add = data.items.filter((r) => r.id && !have.has(r.id));
    if (!confirm(`백업 ${data.items.length}건 중 지금 없는 ${add.length}건을 되살릴까요?\n(이미 있는 영수증은 건드리지 않습니다)`)) return;
    for (let i = 0; i < add.length; i++) {
      const { image, ...rec } = add[i];
      toast(`복원 중… ${i + 1}/${add.length}`, 0);
      if (image) store.saveImage(rec.id, await dataURLToBlob(image));
      store.saveReceipt({ ...rec, hasImage: !!image });
    }
    toast(`${add.length}건을 복원했습니다.`);
  } catch (e) {
    toast(`복원하지 못했습니다: ${e.message || e}`);
  }
}

/* ───────── 알림 ───────── */
let toastTimer = null;
function toast(msg, ms = 3200, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  t.hidden = false;
  if (action) t.querySelector('button').onclick = () => { t.hidden = true; action.run(); };
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => (t.hidden = true), ms);
}

function setSync(s, text) {
  const el = $('#sync');
  el.dataset.s = s;
  el.textContent = text;
}

/* ───────── 이벤트 ───────── */
function bind() {
  $('#btn-add').onclick = (e) => { e.stopPropagation(); addMenu(e.currentTarget); };
  $('#fab').onclick = (e) => { e.stopPropagation(); addMenu(e.currentTarget); };
  $('#btn-menu').onclick = (e) => { e.stopPropagation(); mainMenu(e.currentTarget); };
  $('#pop').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-a]');
    if (b) doAction(b.dataset.a);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#pop')) closePop(); });
  window.addEventListener('resize', closePop);

  $('#file-camera').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  $('#file-pick').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  $('#file-photo').onchange = (e) => { replacePhoto(e.target.files[0]); e.target.value = ''; };
  $('#file-restore').onchange = (e) => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ''; };

  $('#sel-month').onchange = (e) => { state.month = e.target.value; pref.set('month', state.month); state.checked.clear(); renderAll(); };
  $('#search').oninput = (e) => { state.q = e.target.value.trim(); renderChips(); renderSummary(); renderList(); renderSelbar(); };
  $('#chips').onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state.status = b.dataset.status;
    renderChips();
    renderList();
    renderSelbar();
  };

  $('#list').addEventListener('click', (e) => {
    const li = e.target.closest('.card');
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.classList.contains('cb')) {
      if (e.target.checked) state.checked.add(id); else state.checked.delete(id);
      li.classList.toggle('checked', e.target.checked);
      renderSelbar();
      return;
    }
    flushSave();
    select(id);
  });
  $('#chk-all').onchange = (e) => {
    const vis = visible();
    vis.forEach((r) => (e.target.checked ? state.checked.add(r.id) : state.checked.delete(r.id)));
    renderList();
    renderSelbar();
  };
  $('#btn-sel-clear').onclick = () => { state.checked.clear(); renderList(); renderSelbar(); };
  $('#btn-sel-delete').onclick = () => {
    const ids = [...state.checked];
    if (!ids.length) return;
    const sel = state.list.filter((r) => state.checked.has(r.id));
    const total = sel.reduce((t, r) => t + (Number(r.amount) || 0), 0);
    if (!confirm(`선택한 영수증 ${ids.length}건(합계 ${won(total)}원)을 삭제할까요?\n사진도 함께 지워지며 되돌릴 수 없습니다.\n(필요하면 먼저 ⋯ 메뉴의 '전체 백업'을 받아 두세요)`)) return;
    store.removeMany(ids);
    ids.forEach((id) => store.forgetImage(id));
    state.list = state.list.filter((r) => !state.checked.has(r.id));
    if (state.checked.has(state.selId)) { state.selId = null; $('#app').dataset.view = 'list'; }
    state.checked.clear();
    renderAll();
    toast(`${ids.length}건을 삭제했습니다.`);
  };
  $('#sel-bulk').onchange = async (e) => {
    const v = e.target.value;
    e.target.value = '';
    if (!v || !state.checked.size) return;
    const ids = [...state.checked];
    state.list.forEach((r) => { if (state.checked.has(r.id)) r.status = v; });
    store.patchMany(ids, { status: v });
    toast(`${ids.length}건을 '${STATUS[v]}'(으)로 바꿨습니다.`);
    state.checked.clear();
    renderAll();
  };

  document.querySelectorAll('[data-go="list"]').forEach((b) => (b.onclick = () => { flushSave(); $('#app').dataset.view = 'list'; }));

  $('#f-date').addEventListener('change', (e) => { queueSave({ date: e.target.value }); setDow(e.target.value); });
  $('#f-merchant').addEventListener('input', (e) => { queueSave({ merchant: e.target.value.trim() }); $('#detail-title').textContent = e.target.value || '영수증'; });
  $('#f-amount').addEventListener('input', (e) => {
    const el = e.target;
    const digitsBefore = el.value.slice(0, el.selectionStart).replace(/[^\d]/g, '').length;
    const n = parseAmount(el.value);
    el.value = n ? won(n) : '';
    // 쉼표가 들어가도 커서 위치 유지
    let pos = 0;
    for (let seen = 0; pos < el.value.length && seen < digitsBefore; pos++) if (/\d/.test(el.value[pos])) seen++;
    el.setSelectionRange(pos, pos);
    queueSave({ amount: n });
  });
  $('#f-memo').addEventListener('input', (e) => queueSave({ memo: e.target.value }));
  ['#f-date', '#f-merchant', '#f-amount', '#f-memo'].forEach((s) => $(s).addEventListener('blur', () => flushSave()));
  $('#f-status').onclick = (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    queueSave({ status: b.dataset.v });
    flushSave();
    renderDetail();
  };

  $('#btn-delete').onclick = removeCurrent;
  $('#btn-reocr').onclick = reOcr;
  $('#btn-rotate').onclick = rotatePhoto;
  $('#btn-photo').onclick = () => $('#file-photo').click();
  $('#btn-photo2').onclick = () => $('#file-photo').click();

  // 사진 크게 보기
  $('#photo-img').onclick = () => {
    $('#viewer-img').src = $('#photo-img').src;
    $('#viewer').hidden = false;
    $('#viewer').classList.remove('zoom');
  };
  $('#viewer').onclick = (e) => {
    if (e.target.id === 'viewer-img' && !$('#viewer').classList.contains('zoom')) { $('#viewer').classList.add('zoom'); return; }
    $('#viewer').hidden = true;
  };

  // 붙여넣기·끌어놓기 (PC)
  document.addEventListener('paste', (e) => {
    if (document.body.classList.contains('signed-out')) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  let dragN = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragN++; $('#drop').hidden = false; } });
  document.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('#drop').hidden = true; } });
  document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragN = 0;
    $('#drop').hidden = true;
    addFiles(e.dataTransfer.files);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#viewer').hidden) $('#viewer').hidden = true;
      else closePop();
    }
  });
  window.addEventListener('beforeunload', () => flushSave());
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });

  $('#btn-signin').onclick = async () => {
    const btn = $('#btn-signin');
    btn.disabled = true;
    $('#login-msg').textContent = '';
    try { await signIn(); } catch (err) {
      $('#login-msg').textContent = `로그인하지 못했습니다 (${err.code || err.message}). 잠시 후 다시 시도해 주세요.`;
    } finally { btn.disabled = false; }
  };
}

/* ───────── 로그인 상태 ───────── */
function onAuth(user) {
  state.user = user;
  if (!user) {
    store.stop();
    document.body.classList.add('signed-out');
    state.list = [];
    state.loaded = false;
    state.selId = null;
    renderAll();
    return;
  }
  document.body.classList.remove('signed-out');
  $('#account').textContent = user.email || '';
  setSync('pending', '● 연결 중…');
  store.start(user.uid, (list, meta) => {
    // 이 기기에서 아직 저장 전인(입력 중) 값은 유지
    const cur = current();
    const keep = editing && cur ? { ...pending } : null;
    state.list = list.map((r) => (keep && r.id === cur.id ? { ...r, ...keep } : r));
    state.loaded = true;
    if (meta.fromCache && !navigator.onLine) setSync('offline', '● 오프라인 (연결되면 자동 동기화)');
    else if (meta.pending) setSync('pending', '● 동기화 중…');
    else setSync('ok', '● 동기화됨');
    renderAll();
  }, (err) => {
    console.error('[YB-Receipt]', err);
    if (err.code === 'permission-denied') {
      document.body.classList.add('signed-out');
      $('#login-msg').innerHTML = `<b>${esc(user.email || '')}</b><br />이 계정은 사용 허용 목록에 없습니다.<br /><button type="button" class="btn-text" id="btn-denied-out">다른 계정으로 로그인</button>`;
      $('#btn-denied-out').onclick = () => signOutUser();
    } else {
      setSync('error', `● 오류: ${err.code || err.message}`);
    }
  });
}

/* ───────── 새 버전 안내 (서비스 워커) ───────── */
function registerSW() {
  if (!('serviceWorker' in navigator) || location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((reg) => {
    const ask = (w) => toast('새 버전이 있습니다.', 0, { label: '새로고침', run: () => w.postMessage('skipWaiting') });
    if (reg.waiting && navigator.serviceWorker.controller) ask(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ask(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch((e) => console.warn('[YB-Receipt] 서비스 워커', e));
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

window.addEventListener('online', () => setSync('pending', '● 동기화 중…'));
window.addEventListener('offline', () => setSync('offline', '● 오프라인 (연결되면 자동 동기화)'));

$('#version').textContent = `v${VERSION}`;
bind();
renderAll();
if (store.DEMO) onAuth({ uid: 'demo', email: 'demo@local (점검용)' });
else { finishRedirect(); watchAuth(onAuth); }
registerSW();

// 점검용 (개발 서버에서만)
if (import.meta.env.DEV) window.__ybr = { state, renderAll, addFiles, select };
