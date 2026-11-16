// 회의록 저장 위치 — 한 번 고른 폴더를 기억해 두고 묻지 않고 그 폴더에 바로 저장 (PC의 Chrome·Edge)
// 폴더를 지정하지 않았으면 저장할 때마다 위치를 물음. 두 기능이 없는 브라우저(휴대폰 등)는 일반 다운로드
const DB = 'ybr-savedir';
const STORE = 'kv';
const KEY = 'minutes';
const RW = { mode: 'readwrite' };

export const canPickDir = () => typeof window.showDirectoryPicker === 'function';
export const canPickFile = () => typeof window.showSaveFilePicker === 'function';

function idb(mode, fn) {
  return new Promise((res, rej) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => rej(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, mode);
      const rq = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); res(rq?.result); };
      tx.onerror = () => { db.close(); rej(tx.error); };
    };
  });
}

/** 기억해 둔 폴더 (없으면 null) */
export const getDir = () => idb('readonly', (s) => s.get(KEY)).then((h) => h || null).catch(() => null);
/** 폴더 고르고 기억하기 — 고르지 않고 닫으면 AbortError */
export async function pickDir() {
  const h = await window.showDirectoryPicker({ id: 'ybr-minutes', mode: 'readwrite', startIn: 'documents' });
  await idb('readwrite', (s) => s.put(h, KEY));
  return h;
}
export const forgetDir = () => idb('readwrite', (s) => s.delete(KEY)).catch(() => {});

/** 폴더 쓰기 권한 확인 — 단추를 누른 직후에 불러야 허용 창이 뜸 */
export async function allowDir(h) {
  if ((await h.queryPermission(RW)) === 'granted') return true;
  return (await h.requestPermission(RW)) === 'granted';
}
async function exists(h, name) {
  try { await h.getFileHandle(name); return true; } catch (e) { if (e.name === 'NotFoundError') return false; throw e; }
}
async function write(fh, blob) {
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}
/** 폴더에 저장 — 같은 이름이 있으면 덮어쓰지 않고 _v.2, _v.3 … 을 붙임. 실제 저장한 이름을 돌려줌 */
export async function saveToDir(h, name, blob) {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let final = name;
  for (let v = 2; await exists(h, final); v++) final = `${stem}_v.${v}${ext}`;
  await write(await h.getFileHandle(final, { create: true }), blob);
  return final;
}
/** 저장 위치 묻기 — 단추를 누른 직후에 불러야 함. 닫으면 AbortError */
export const askFile = (name) => window.showSaveFilePicker({
  id: 'ybr-minutes', suggestedName: name,
  types: [{ description: '한글 문서 (HWPX)', accept: { 'application/hwp+zip': ['.hwpx'] } }],
});
export async function writeFile(fh, blob) { await write(fh, blob); return fh.name; }
