// ══════════════════════════════════════════════════════════════
// แคชข้อมูลในเครื่อง (IndexedDB) — ให้เปิดเว็บแล้วเห็นข้อมูลทันที แล้วค่อยซิงค์กับ SharePoint เบื้องหลัง
// - เก็บแยกตามบัญชีผู้ใช้ (key ขึ้นต้นด้วย homeAccountId) — คนละบัญชีบนเครื่องเดียวกันไม่เห็นข้อมูลกัน
// - เก็บเฉพาะข้อมูลข้อความของคำร้อง/ข้อมูลหลัก ไม่เก็บไฟล์แนบ ไม่เก็บ token
// - ออกจากระบบ → ลบทิ้งทั้งหมด (clearAllCache)
// - ทุกฟังก์ชันไม่ throw: ถ้าเบราว์เซอร์ปิด IndexedDB (เช่นโหมดส่วนตัวบางตัว) ระบบทำงานแบบเดิม
// ══════════════════════════════════════════════════════════════

const DB_NAME = "ppg-drawing-cache";
const STORE = "kv";
// เปลี่ยนเลขนี้เมื่อรูปแบบข้อมูลที่เก็บเปลี่ยน → แคชเก่าทั้งหมดถูกทิ้งอัตโนมัติ
export const CACHE_VERSION = 1;
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (!("indexedDB" in window)) return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx(mode, run) {
  return openDb().then((db) => new Promise((resolve) => {
    if (!db) return resolve(null);
    try {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const req = run(store);
      t.oncomplete = () => resolve(req?.result ?? null);
      t.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

/** อ่านค่า — คืน null ถ้าไม่มี/หมดอายุ/คนละเวอร์ชัน */
export async function cacheGet(key) {
  const entry = await tx("readonly", (store) => store.get(key));
  if (!entry || entry.v !== CACHE_VERSION) return null;
  if (!entry.savedAt || Date.now() - entry.savedAt > CACHE_MAX_AGE_MS) return null;
  return entry.data;
}

export async function cacheSet(key, data) {
  await tx("readwrite", (store) => store.put({ v: CACHE_VERSION, savedAt: Date.now(), data }, key));
}

export async function cacheDelete(key) {
  await tx("readwrite", (store) => store.delete(key));
}

/** ลบแคชทั้งหมดในเครื่อง (ตอนออกจากระบบ) */
export async function clearAllCache() {
  await tx("readwrite", (store) => store.clear());
}

/** key ของผู้ใช้ปัจจุบัน — ใช้ homeAccountId (ไม่ซ้ำต่อบัญชี) */
export function userCacheKey(account, name) {
  const id = account?.homeAccountId || account?.username || "anon";
  return `${id}::${name}`;
}
