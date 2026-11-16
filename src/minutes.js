// 회의록 만들기 — 올려 둔 영수증을 골라 혁신사업 지출결의 양식(회의록·서명부·영수증 붙임, HWPX)을 채워 저장
// 양식 틀은 public/minutes 에 있고, 압축은 브라우저 기본 기능(CompressionStream)으로 처리
import { loadImageBlob } from './store.js';

const BASE = `${import.meta.env.BASE_URL}minutes/`;
const DRAFT_URL = 'https://claude.ai/artifact/JznaLYCjLERJUzYPnehGFo'; // 본문 초안을 만드는 Claude 회의록 생성기
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const MAX_ATT = 40;
const WORK_START = 9 * 60;   // 업무시간 시작 09:00
const WORK_END = 18 * 60;    // 업무시간 종료 18:00
const MEET_MIN = 90;         // 회의 시간 기본 1시간 30분
// [묶음 안 이름, 틀 파일, 압축 여부]
const PARTS = [
  ['mimetype', 'mimetype.txt', 0], ['version.xml', 'version.xml', 0], ['Contents/header.xml', 'header.xml', 1],
  ['BinData/image1.BMP', 'image1.bmp', 1], ['BinData/image2.BMP', 'image2.bmp', 1], ['Contents/section0.xml', 'section0.xml', 1],
  ['Preview/PrvText.txt', null, 1], ['settings.xml', 'settings.xml', 1], ['Preview/PrvImage.png', 'prv.png', 0],
  ['META-INF/container.rdf', 'container.rdf.xml', 1], ['Contents/content.hpf', 'content.hpf.xml', 1],
  ['META-INF/container.xml', 'container.xml', 1], ['META-INF/manifest.xml', 'manifest.xml', 1],
];

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const xml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const won = (n) => (Number(n) || 0).toLocaleString('ko-KR');
/** '2026-10-27' → '2026.10.27.(화)' */
export function kdate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[1]}.${m[2]}.${m[3]}.(${DOW[new Date(+m[1], +m[2] - 1, +m[3]).getDay()]})` : '';
}
const fmtWon = (v) => { const n = String(v).replace(/[^\d]/g, ''); return n ? `${Number(n).toLocaleString('ko-KR')}원` : ''; };
/** 인식 원문에서 결제 시각(HH:MM) 찾기 — 일자 바로 뒤에 오는 시각만 */
export function payTime(text) {
  const m = /\d{2,4}[-./]\s?\d{1,2}[-./]\s?\d{1,2}\D{0,8}?(\d{1,2}):(\d{2})/.exec(text || '');
  return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}
const toMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); return m ? +m[1] * 60 + +m[2] : null; };
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** 시작 시각 + 1시간 30분 (자정을 넘기지 않음) */
export const endOf = (start) => { const m = toMin(start); return m == null ? '' : toHHMM(Math.min(m + MEET_MIN, 23 * 60 + 59)); };
/**
 * 결제 시각에 가까운 업무시간 안의 1시간 30분을 회의 시간으로 제안 — 되도록 결제 조금 전에 끝나도록
 * 예) 결제 19:35 → 16:30~18:00, 결제 12:40 → 11:00~12:30, 결제 08:10 → 09:00~10:30
 */
export function suggestTime(pay) {
  const t = toMin(pay);
  if (t == null) return null;
  let end = Math.floor(t / 30) * 30;      // 결제 시각 직전의 정각·30분
  if (end === t) end -= 30;
  end = Math.min(end, WORK_END);
  let start = end - MEET_MIN;
  if (start < WORK_START) { start = WORK_START; end = start + MEET_MIN; }
  return { t1: toHHMM(start), t2: toHHMM(end) };
}
/** 한 줄에 한 명 '소속 성명 직위' */
export function parseAttendees(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const p = l.split(/\s+/);
    return p.length === 1 ? { dept: '', name: p[0], position: '' } : { dept: p[0], name: p[1], position: p.slice(2).join(' ') };
  });
}
const attLine = (a) => a.map((x) => [x.dept, x.name, x.position].filter(Boolean).join(' ')).join(', ');
const useOf = (d) => `[${d.code}] ${d.topic} 식대(${d.att.length}인)`;

/* ───────── HWPX 채우기 ───────── */
const bodyXml = (lines) => lines.map((ln, i) => {
  const t = ln.replace(/\s+$/, '');
  return `<hp:p id="${i === 0 ? '2147483648' : '0'}" paraPrIDRef="29" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="25">${t ? `<hp:t>${xml(t)}</hp:t>` : ''}</hp:run></hp:p>`;
}).join('');

function picXml(im) {
  const ow = im.w * 75, oh = im.h * 75; // 1px = 75 HWPUNIT
  const sc = Math.min(30000 / ow, 41000 / oh, 1); // 영수증 칸 안에 들어가는 크기
  const cw = Math.floor(ow * sc), ch = Math.floor(oh * sc), s6 = sc.toFixed(6);
  return `<hp:pic id="1974185501" zOrder="20" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="900443601" reverse="0"><hp:offset x="0" y="0"/>`
    + `<hp:orgSz width="${ow}" height="${oh}"/><hp:curSz width="${cw}" height="${ch}"/><hp:flip horizontal="0" vertical="0"/>`
    + `<hp:rotationInfo angle="0" centerX="${Math.floor(cw / 2)}" centerY="${Math.floor(ch / 2)}" rotateimage="1"/><hp:renderingInfo>`
    + `<hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="${s6}" e2="0" e3="0" e4="0" e5="${s6}" e6="0"/>`
    + `<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>`
    + `<hc:img binaryItemIDRef="image5" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>`
    + `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${ow}" y="0"/><hc:pt2 x="${ow}" y="${oh}"/><hc:pt3 x="0" y="${oh}"/></hp:imgRect>`
    + `<hp:imgClip left="0" right="${ow}" top="0" bottom="${oh}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>`
    + `<hp:imgDim dimwidth="${ow}" dimheight="${oh}"/><hp:effects/>`
    + `<hp:sz width="${cw}" widthRelTo="ABSOLUTE" height="${ch}" heightRelTo="ABSOLUTE" protect="0"/>`
    + `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>`
    + `<hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:pic><hp:t/>`;
}

export function fillSection(tpl, d) {
  const n = d.att.length;
  const v = {
    CODE: d.code, DATE: d.date, DATETIME: `${d.date} ${d.time}`.trim(), PLACE: d.place, COUNT: String(n),
    W_NAME: d.writer.name, W_DEPT: d.writer.dept, W_POS: d.writer.position, ATTENDEES: attLine(d.att),
    R_DEPT: d.writer.dept, R_AMOUNT: d.amount, R_APPROVAL: d.approval || d.date, R_PURPOSE: useOf(d),
  };
  for (let i = 1; i <= MAX_ATT; i++) {
    const a = d.att[i - 1];
    v[`N${i}`] = a ? String(i) : ''; v[`D${i}`] = a ? a.dept : ''; v[`M${i}`] = a ? a.name : '';
  }
  return tpl
    .replace(/@@SIG_OPEN@@[\s\S]*?@@SIG_CLOSE@@/g, '') // 서명 그림은 넣지 않음(직접 서명)
    .replace('@@BODY@@', () => bodyXml(d.lines))
    .replace('@@R_IMAGE@@', () => (d.img ? picXml(d.img) : ''))
    .replace(/@@(\w+)@@/g, (m, k) => { if (!(k in v)) throw new Error(`양식 항목 없음: ${k}`); return xml(v[k]); })
    .replace(/<hp:t><\/hp:t>/g, '<hp:t/>');
}

/* ───────── ZIP (저장 또는 deflate) ───────── */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function deflate(u8) {
  const cs = new CompressionStream('deflate-raw');
  return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(cs)).arrayBuffer());
}
/** @param {{name:string, data:Uint8Array, deflate:boolean}[]} files */
export async function zip(files) {
  const enc = new TextEncoder();
  const chunks = []; const central = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const body = f.deflate ? await deflate(f.data) : f.data;
    const method = f.deflate ? 8 : 0;
    const crc = crc32(f.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x5c21, true); // 2026-01-01
    lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true);
    ch.setUint16(12, 0, true); ch.setUint16(14, 0x5c21, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, off, true);
    chunks.push(new Uint8Array(lh.buffer), name, body);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/octet-stream' });
}

let tplCache = null;
async function loadTemplate() {
  if (tplCache) return tplCache;
  const bufs = await Promise.all(PARTS.map(async ([, file]) => {
    if (!file) return null;
    const res = await fetch(BASE + file);
    if (!res.ok) throw new Error(`양식 틀을 불러오지 못했습니다 (${file})`);
    return new Uint8Array(await res.arrayBuffer());
  }));
  tplCache = bufs;
  return bufs;
}

/** 영수증 사진을 한글 양식에 넣을 수 있는 형식(JPEG·PNG)과 크기 정보로 */
async function prepImage(blob) {
  const bm = await createImageBitmap(blob);
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : '';
  if (ext) return { data: new Uint8Array(await blob.arrayBuffer()), w: bm.width, h: bm.height, ext };
  const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
  c.getContext('2d').drawImage(bm, 0, 0);
  const jpg = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
  return { data: new Uint8Array(await jpg.arrayBuffer()), w: bm.width, h: bm.height, ext: 'jpg' };
}

export async function buildHwpx(d) {
  const bufs = await loadTemplate();
  const enc = new TextEncoder(); const dec = new TextDecoder('utf-8');
  const files = PARTS.map(([name, , z], i) => {
    let data = bufs[i];
    if (name === 'Contents/section0.xml') data = enc.encode(fillSection(dec.decode(bufs[i]), d));
    else if (name === 'Preview/PrvText.txt') data = enc.encode(['<회 의 록>', `<일시><${`${d.date} ${d.time}`.trim()}><장소><${d.place}>`, `<회의참석자><${attLine(d.att)}>`, '<안건 및 회의결과>', ...d.lines].join('\r\n'));
    else if (name === 'Contents/content.hpf' && d.img) data = enc.encode(dec.decode(bufs[i]).replace('<opf:item id="section0"', `<opf:item id="image5" href="BinData/image5.${d.img.ext}" media-type="image/${d.img.ext}" isEmbeded="1"/><opf:item id="section0"`));
    return { name, data, deflate: !!z };
  });
  if (d.img) files.push({ name: `BinData/image5.${d.img.ext}`, data: d.img.data, deflate: false });
  return zip(files);
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ───────── 화면 ───────── */
const pref = {
  get: () => { try { return JSON.parse(localStorage.getItem('ybr-minutes') || '{}'); } catch { return {}; } },
  set: (v) => { try { localStorage.setItem('ybr-minutes', JSON.stringify(v)); } catch { /* 무시 */ } },
};
const SKELETON = '1. 주요 논의 내용\n * 소주제\n   - 세부 내용\n\n2. 부서별 역할 분담\n * 부서명: 역할\n\n3. 향후 일정 및 후속 조치\n * 항목: 내용';

/**
 * 회의록 만들기 화면 열기
 * @param {{list:object[], selId:string|null}} opt list=올려 둔 영수증 전체, selId=먼저 골라 둘 영수증
 */
export function openMinutes({ list, selId }) {
  $('#minutes')?.remove();
  const rcs = [...list].sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1));
  const p = pref.get();
  const root = document.createElement('div');
  root.id = 'minutes';
  root.className = 'mn';
  root.innerHTML = `
  <div class="mn-in">
    <header class="mn-head"><h1>📝 회의록 만들기</h1><button class="icon-btn" id="mn-x" aria-label="닫기">✕</button></header>

    <section class="mn-sec">
      <h2>영수증 불러오기</h2>
      <select id="mn-rc" class="sel mn-wide" aria-label="올려 둔 영수증에서 선택">
        <option value="">영수증 없이 작성</option>
        ${rcs.map((r) => `<option value="${esc(r.id)}">${esc((r.date || '일자 없음').replace(/-/g, '.'))} · ${esc(r.merchant || '가맹점 미입력')} · ${won(r.amount)}원${r.hasImage ? '' : ' (사진 없음)'}</option>`).join('')}
      </select>
      <div class="mn-rc" id="mn-rcbox" hidden><img id="mn-thumb" alt="영수증 사진" hidden /><div id="mn-rcinfo"></div></div>
      <div class="mn-row">
        <label class="field"><span>사용총액</span><input id="mn-amt" inputmode="numeric" placeholder="예) 113,000" /></label>
        <label class="field"><span>카드승인일</span><input type="date" id="mn-apv" /></label>
      </div>
      <p class="mn-warn" id="mn-diff" hidden>카드승인일과 회의 일자가 다릅니다.</p>
    </section>

    <section class="mn-sec">
      <h2>회의 정보</h2>
      <div class="mn-row">
        <label class="field"><span>회의 일자</span><input type="date" id="mn-date" /></label>
        <label class="field"><span>사업관리코드</span><input id="mn-code" value="${esc(p.code || 'LP18-1-2')}" /></label>
      </div>
      <div class="mn-row">
        <label class="field"><span>시작</span><input type="time" id="mn-t1" value="${esc(p.t1 || '16:30')}" /></label>
        <label class="field"><span>종료 <em id="mn-pay" class="mn-pay"></em></span><input type="time" id="mn-t2" value="${esc(p.t2 || '18:00')}" /></label>
      </div>
      <label class="field"><span>장소</span><input id="mn-place" value="${esc(p.place || '신양관 2층 회의실')}" /></label>
      <label class="field"><span>회의 주제</span><input id="mn-topic" placeholder="예) 교육혁신 성과과제 준비회의" /></label>
      <label class="field"><span>참석자 (한 줄에 한 명: 소속 성명 직위, 첫 줄이 작성자)</span><textarea id="mn-att" rows="4">${esc(p.att || '교육과정혁신팀 김영배 팀장')}</textarea></label>
    </section>

    <section class="mn-sec">
      <h2>안건 및 회의결과 <a class="mn-link" href="${DRAFT_URL}" target="_blank" rel="noopener">Claude 생성기 열기 ↗</a></h2>
      <label class="field"><span>실제 논의한 요지 (키워드 3~5개 이상)</span><textarea id="mn-gist" rows="4" placeholder="예) 성과지표 관리 기준이 부서마다 달라 일원화 필요&#10;참여 인원 외 만족도·후속 참여도 지표 추가&#10;성과관리팀이 제출 양식 마련, 학생서비스팀이 간담회 지원"></textarea></label>
      <div class="mn-gen"><button class="btn-ghost" id="mn-gen">✨ 초안 만들기</button><span class="mn-meta">적은 요지만 풀어 씁니다. 요지에 없는 역할 분담·후속 조치에는 [확인 필요]가 붙습니다.</span></div>
      <textarea id="mn-body" class="mn-body" rows="18" placeholder="${esc(SKELETON)}"></textarea>
      <p class="mn-meta"><span id="mn-lines">본문 0줄</span> · <span id="mn-chk">확인 필요 0건</span></p>
      <label class="chk mn-agree"><input type="checkbox" id="mn-agree" /><span>회의 일시와 본문이 실제 회의와 일치함을 확인했습니다.</span></label>
    </section>

    <footer class="mn-foot">
      <p class="mn-msg" id="mn-msg" role="status"></p>
      <button class="btn-ghost" id="mn-close">닫기</button>
      <button class="btn-primary" id="mn-save" disabled>한글 양식(HWPX) 저장</button>
    </footer>
  </div>`;
  document.body.appendChild(root);

  const q = (s) => $(s, root);
  let dateTouched = false;
  let timeTouched = false;
  const msg = (t, err) => { q('#mn-msg').textContent = t; q('#mn-msg').classList.toggle('err', !!err); };
  const receipt = () => rcs.find((r) => r.id === q('#mn-rc').value) || null;

  function collect() {
    const att = parseAttendees(q('#mn-att').value);
    const date = kdate(q('#mn-date').value);
    const t1 = q('#mn-t1').value, t2 = q('#mn-t2').value;
    return {
      code: q('#mn-code').value.trim() || 'LP18-1-2', date, time: t1 && t2 ? `${t1}~${t2}` : '', place: q('#mn-place').value.trim(),
      topic: q('#mn-topic').value.trim(), att, writer: att[0] || { dept: '', name: '', position: '' },
      amount: fmtWon(q('#mn-amt').value), approval: kdate(q('#mn-apv').value),
      lines: q('#mn-body').value.replace(/\r/g, '').replace(/\s+$/, '').split('\n'),
    };
  }
  function refresh() {
    const d = collect();
    const body = q('#mn-body').value;
    const n = body.split('\n').filter((l) => l.trim()).length;
    const c = (body.match(/\[확인 필요\]/g) || []).length;
    q('#mn-lines').textContent = `본문 ${n}줄`;
    q('#mn-chk').textContent = `확인 필요 ${c}건`;
    q('#mn-chk').classList.toggle('bad', c > 0);
    q('#mn-diff').hidden = !(q('#mn-apv').value && q('#mn-date').value && q('#mn-apv').value !== q('#mn-date').value);
    q('#mn-save').disabled = !(n > 0 && c === 0 && q('#mn-agree').checked && d.att.length > 0 && d.date && d.topic);
    pref.set({ code: q('#mn-code').value, place: q('#mn-place').value, t1: q('#mn-t1').value, t2: q('#mn-t2').value, att: q('#mn-att').value });
  }
  function pick() {
    const r = receipt();
    q('#mn-rcbox').hidden = !r;
    q('#mn-pay').textContent = '';
    if (!r) { refresh(); return; }
    q('#mn-amt').value = r.amount ? won(r.amount) : '';
    q('#mn-apv').value = r.date || '';
    if (r.date && !dateTouched) q('#mn-date').value = r.date;
    const t = payTime(r.ocrText);
    const sug = suggestTime(t);
    if (sug && !timeTouched) { q('#mn-t1').value = sug.t1; q('#mn-t2').value = sug.t2; }
    if (t) q('#mn-pay').textContent = `결제 ${t} 기준 제안값`;
    const img = q('#mn-thumb');
    img.hidden = !r.thumb;
    if (r.thumb) img.src = r.thumb;
    q('#mn-rcinfo').innerHTML = `<b>${esc(r.merchant || '가맹점 미입력')}</b><br>${esc(kdate(r.date) || '일자 없음')}${t ? ` ${t}` : ''}<br><b>${won(r.amount)}원</b>${r.hasImage ? '' : '<br>사진 없음'}${r.memo ? `<br><span class="mn-memo">${esc(r.memo)}</span>` : ''}`;
    refresh();
  }

  const close = () => root.remove();
  q('#mn-x').onclick = close;
  q('#mn-close').onclick = close;
  q('#mn-rc').onchange = pick;
  q('#mn-date').addEventListener('input', () => { dateTouched = true; });
  // 시작 시각을 바꾸면 종료는 1시간 30분 뒤로 맞춤. 종료는 그 뒤에 따로 고칠 수 있음
  q('#mn-t1').addEventListener('input', () => { timeTouched = true; const e = endOf(q('#mn-t1').value); if (e) q('#mn-t2').value = e; });
  q('#mn-t2').addEventListener('input', () => { timeTouched = true; });
  root.addEventListener('input', refresh);
  root.addEventListener('change', refresh);

  q('#mn-gen').onclick = async () => {
    const d = collect();
    const gist = q('#mn-gist').value.trim();
    if (!d.topic) return msg('회의 주제를 먼저 적어 주세요.', true);
    if (gist.length < 10) return msg('실제 논의한 요지를 조금 더 적어 주세요. 주제만으로는 초안을 만들지 않습니다.', true);
    if (q('#mn-body').value.trim() && !confirm('지금 본문을 새 초안으로 바꿀까요?')) return;
    const btn = q('#mn-gen');
    btn.disabled = true;
    msg('초안을 만드는 중…');
    try {
      const { draftMinutes } = await import('./ai.js');
      const depts = [...new Set(d.att.map((a) => a.dept).filter(Boolean))];
      q('#mn-body').value = await draftMinutes({ topic: d.topic, depts, gist });
      q('#mn-agree').checked = false;
      msg('초안이 나왔습니다. 읽고 실제와 다른 줄은 고쳐 주세요.');
    } catch (e) {
      console.error(e);
      msg(`초안을 만들지 못했습니다. Firebase 콘솔의 AI Logic 설정을 확인해 주세요. (${String(e.message || e).slice(0, 160)})`, true);
    } finally {
      btn.disabled = false;
      refresh();
    }
  };

  q('#mn-save').onclick = async () => {
    const d = collect();
    if (d.att.length > MAX_ATT) return msg(`서명부는 ${MAX_ATT}명까지 들어갑니다.`, true);
    q('#mn-save').disabled = true;
    msg('양식에 채우는 중…');
    try {
      const r = receipt();
      d.img = null;
      if (r?.hasImage) {
        const blob = await loadImageBlob(r.id).catch(() => null);
        if (!blob) throw new Error('영수증 사진을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
        d.img = await prepImage(blob);
      }
      const blob = await buildHwpx(d);
      const name = `YB_C_회의록_${d.date.replace(/\(.*?\)/, '').replace(/\.$/, '')}_${d.topic.replace(/[\\/:*?"<>|]/g, ' ').trim()}.hwpx`;
      download(blob, name);
      msg(`저장했습니다: ${name}`);
    } catch (e) {
      console.error(e);
      msg(`저장하지 못했습니다: ${e.message || e}`, true);
    } finally {
      refresh();
    }
  };

  q('#mn-date').value = '';
  if (selId && rcs.some((r) => r.id === selId)) q('#mn-rc').value = selId;
  pick();
  if (!q('#mn-date').value) {
    const n = new Date();
    q('#mn-date').value = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    refresh();
  }
}
