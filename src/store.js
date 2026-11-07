// 저장소 — Firestore users/{uid}/receipts(영수증 정보) · users/{uid}/receiptImages(사진)
// 쓰기는 기기 안 사본에 먼저 반영되고, 온라인이 되면 서버로 자동 전송됩니다.
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, getDoc, writeBatch, Bytes,
} from 'firebase/firestore';
import { fs } from './firebase.js';

let uid = null;
let unsub = null;
const col = () => collection(fs, 'users', uid, 'receipts');
const ref = (id) => doc(fs, 'users', uid, 'receipts', id);
const imgRef = (id) => doc(fs, 'users', uid, 'receiptImages', id);
const clean = (o) => JSON.parse(JSON.stringify(o));
const report = (what) => (err) => {
  console.error(`[YB-Receipt] ${what} 실패`, err);
  onError?.(err);
};
let onError = null;

// 점검용 가짜 저장소 (개발 서버 + 주소 끝 ?demo 일 때만)
export const DEMO = import.meta.env.DEV && new URLSearchParams(location.search).has('demo');
const mem = { recs: new Map(), imgs: new Map(), cb: null };
const memEmit = () => setTimeout(() => mem.cb?.([...mem.recs.values()].map((r) => ({ ...r })), { fromCache: false, pending: false }), 0);

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/**
 * 로그인한 사용자의 영수증 목록을 실시간으로 받음
 * @param {(list:object[], meta:{fromCache:boolean, pending:boolean})=>void} cb
 */
export function start(userId, cb, errCb) {
  stop();
  uid = userId;
  if (DEMO) { mem.cb = cb; memEmit(); return; }
  onError = errCb;
  unsub = onSnapshot(
    col(),
    { includeMetadataChanges: true },
    (snap) => {
      const list = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      cb(list, { fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites });
    },
    (err) => errCb?.(err)
  );
}

export function stop() {
  unsub?.();
  unsub = null;
  uid = null;
}

export function saveReceipt(r) {
  const { id, ...rest } = r;
  if (DEMO) { mem.recs.set(id, { ...(mem.recs.get(id) || {}), ...clean(rest), id, updatedAt: Date.now() }); memEmit(); return Promise.resolve(); }
  return setDoc(ref(id), clean({ ...rest, updatedAt: Date.now() }), { merge: true }).catch(report('저장'));
}

export function patchReceipt(id, fields) {
  if (DEMO) return saveReceipt({ id, ...fields });
  return updateDoc(ref(id), clean({ ...fields, updatedAt: Date.now() })).catch(report('수정'));
}

export function patchMany(ids, fields) {
  if (DEMO) { ids.forEach((id) => saveReceipt({ id, ...fields })); return Promise.resolve(); }
  const b = writeBatch(fs);
  const now = Date.now();
  ids.forEach((id) => b.update(ref(id), clean({ ...fields, updatedAt: now })));
  return b.commit().catch(report('일괄 수정'));
}

export function removeReceipt(id) {
  if (DEMO) { mem.recs.delete(id); mem.imgs.delete(id); memEmit(); return Promise.resolve(); }
  return Promise.all([deleteDoc(ref(id)), deleteDoc(imgRef(id))]).catch(report('삭제'));
}

export async function saveImage(id, blob) {
  if (DEMO) { mem.imgs.set(id, blob); return; }
  const buf = new Uint8Array(await blob.arrayBuffer());
  return setDoc(imgRef(id), { data: Bytes.fromUint8Array(buf), mime: blob.type || 'image/jpeg', size: buf.length }).catch(report('사진 저장'));
}

const imgCache = new Map(); // id → object URL

/** 사진을 object URL로 (한 번 받은 사진은 기억) */
export async function loadImageURL(id) {
  if (imgCache.has(id)) return imgCache.get(id);
  if (DEMO) { const b = mem.imgs.get(id); if (!b) return null; const u = URL.createObjectURL(b); imgCache.set(id, u); return u; }
  const snap = await getDoc(imgRef(id));
  if (!snap.exists()) return null;
  const { data, mime } = snap.data();
  const url = URL.createObjectURL(new Blob([data.toUint8Array()], { type: mime || 'image/jpeg' }));
  imgCache.set(id, url);
  return url;
}

export async function loadImageBlob(id) {
  const url = await loadImageURL(id);
  return url ? (await fetch(url)).blob() : null;
}

export function forgetImage(id) {
  const u = imgCache.get(id);
  if (u) URL.revokeObjectURL(u);
  imgCache.delete(id);
}
