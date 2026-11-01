// ══════════════════════════════════════════════════════════════
// ซิงค์คำร้องกับ SharePoint แบบ "โหลดเฉพาะที่เปลี่ยน" (Delta sync) + แคชในเครื่อง
//
// เดิม: ทุก 10 วินาที ทุกเครื่องโหลดคำร้อง "ทั้งหมด" ใหม่ (5,000 รายการ = 10 รอบ API ต่อครั้ง)
// ใหม่: โหลดครบครั้งเดียว → จดสำเนาไว้ในเครื่อง (IndexedDB) → รอบต่อไปถาม SharePoint แค่ "มีอะไรเปลี่ยน"
//
// ทางสำรองในตัว (ไม่ทำให้ระบบใช้งานไม่ได้):
// - ถ้า SharePoint ไม่รองรับ delta → กลับไปโหลดทั้งหมดแบบเดิม (แต่ถี่น้อยลง ดู pollIntervalMs)
// - ถ้า delta token หมดอายุ (410) / ข้อมูลเปลี่ยนเยอะมาก → โหลดทั้งหมดใหม่ครั้งเดียวแล้วกลับมาใช้ delta
// - ถ้าเลือกคอลัมน์ ($select) แล้ว SharePoint ปฏิเสธ → โหลดทุกคอลัมน์แทน
// - โหลดทั้งหมดใหม่อัตโนมัติทุก 6 ชั่วโมงกันข้อมูลคลาดเคลื่อนสะสม
// ══════════════════════════════════════════════════════════════

import { appConfig } from "../../../config/config.js";
import { fields, lists } from "../../../config/schema.js";
import { fetchAllPages, graphBatchGet } from "../graph.js";
import { cacheGet, cacheSet, userCacheKey } from "../idb-cache.js";
import { ensureListId, ensureSite, setRequestWriteGuard } from "../sharepoint.js";

const FULL_RESYNC_MS = 6 * 60 * 60 * 1000;
const MAX_DELTA_CHANGES = 400;     // เปลี่ยนเกินนี้ในรอบเดียว → โหลดทั้งหมดเร็วกว่ายิงทีละรายการ
const FRESH_WAIT_MS = 20000;

let rawById = new Map();           // id → { id, ...fields } (รูปแบบเดียวกับ getListItems)
let deltaLink = null;
let deltaSupported = null;         // null = ยังไม่รู้, true/false หลังลองครั้งแรก
const selectOk = { delta: true, list: true };
let lastFullAt = 0;
let inflight = null;
let cacheKey = null;
let saveTimer = null;

let isFresh = false;               // ซิงค์กับ SharePoint สำเร็จแล้วอย่างน้อย 1 ครั้งในรอบการเปิดเว็บนี้
let resolveFresh;
let freshPromise = new Promise((resolve) => { resolveFresh = resolve; });

// ── สถานะสำหรับป้าย "อัปเดตล่าสุด" ──
export const syncInfo = { phase: "idle", lastSyncAt: 0, source: "none", mode: "unknown", error: "", count: 0 };
const listeners = new Set();
function emit(patch) {
  Object.assign(syncInfo, patch, { count: rawById.size });
  listeners.forEach((fn) => { try { fn(syncInfo); } catch { /* ignore */ } });
}
export function onSyncStatus(fn) {
  listeners.add(fn);
  fn(syncInfo);
  return () => listeners.delete(fn);
}

/** รอบ polling ที่เหมาะกับโหมดตอนนี้ — delta เบามาก ถามถี่ได้, โหลดทั้งหมดต้องเว้นห่าง */
export function pollIntervalMs() {
  return deltaSupported === false ? 30 * 1000 : 10 * 1000;
}

// ── คอลัมน์ที่หน้าเว็บใช้จริง (fromSharePoint) — ไม่ดึงคอลัมน์ระบบ/คอลัมน์อื่นที่ไม่ใช้ ──
function selectList() {
  return [...new Set([...Object.values(fields.requests), "Modified", "Created"])].join(",");
}
function itemsQuery(useSelect) {
  return useSelect ? `?$expand=fields($select=${selectList()})&$top=500` : "?$expand=fields&$top=500";
}
function flatten(item) {
  return { id: String(item.id), ...(item.fields || {}) };
}
function isDeleted(item) {
  return Boolean(item?.deleted || item?.["@removed"]);
}
function hasUsableFields(item) {
  return Boolean(item?.fields && fields.requests.title in item.fields);
}

async function itemsRoot() {
  const siteId = await ensureSite();
  const listId = await ensureListId(lists.requests);
  if (!listId) throw new Error(`ไม่พบ List "${lists.requests}" บน SharePoint`);
  return `/sites/${siteId}/lists/${listId}/items`;
}

/** ลองแบบเลือกคอลัมน์ก่อน ถ้า SharePoint ตอบ 400 → ไม่เลือกคอลัมน์ (จำไว้ทั้งรอบการเปิดเว็บ) */
async function withSelect(kind, run) {
  if (!selectOk[kind]) return run(false);
  try {
    return await run(true);
  } catch (error) {
    if (error.status !== 400) throw error;
    selectOk[kind] = false;
    return run(false);
  }
}

const DELTA_UNSUPPORTED = new Set([400, 404, 405, 501]);

async function fullLoad() {
  const root = await itemsRoot();
  let items = null;
  let link = null;

  if (deltaSupported !== false) {
    try {
      // ไล่ delta ตั้งแต่ต้น = ได้ข้อมูลครบ + ได้ token สำหรับรอบต่อไปในการโหลดรอบเดียว
      const res = await withSelect("delta", (sel) => fetchAllPages(`${root}/delta${itemsQuery(sel)}`));
      if (!res.deltaLink) throw Object.assign(new Error("delta: no deltaLink"), { status: 501 });
      link = res.deltaLink;
      const live = res.value.filter((item) => !isDeleted(item));
      if (live.every(hasUsableFields)) items = live.map(flatten);
      deltaSupported = true;
    } catch (error) {
      if (!DELTA_UNSUPPORTED.has(error.status)) throw error;
      console.warn("Delta sync ไม่พร้อมใช้งาน — ใช้การโหลดทั้งหมดแทน:", error.message?.slice(0, 120));
      deltaSupported = false;
      link = null;
    }
  }

  if (!items) {
    const res = await withSelect("list", (sel) => fetchAllPages(`${root}${itemsQuery(sel)}`));
    items = res.value.map(flatten);
  }

  rawById = new Map(items.map((item) => [item.id, item]));
  deltaLink = link;
  lastFullAt = Date.now();
}

/** ถามเฉพาะที่เปลี่ยนตั้งแต่รอบที่แล้ว — คืน true ถ้ามีข้อมูลเปลี่ยน */
async function deltaPoll() {
  const res = await fetchAllPages(deltaLink);
  let mutated = false;
  const changed = [];
  for (const item of res.value) {
    if (isDeleted(item)) {
      if (rawById.delete(String(item.id))) mutated = true;
    } else {
      changed.push(item);
    }
  }
  if (changed.length > MAX_DELTA_CHANGES) {
    await fullLoad();
    return true;
  }

  const needFetch = [];
  for (const item of changed) {
    if (hasUsableFields(item)) {
      rawById.set(String(item.id), flatten(item));
      mutated = true;
    } else {
      needFetch.push(String(item.id));
    }
  }

  // delta บางแบบคืนแค่ id ที่เปลี่ยน — ดึงข้อมูลรายการนั้นมาครั้งละ 20 รายการ (batch)
  if (needFetch.length) {
    const root = await itemsRoot();
    const query = selectOk.list ? `?$expand=fields($select=${selectList()})` : "?$expand=fields";
    const results = await graphBatchGet(needFetch.map((id) => ({ id, url: `${root}/${id}${query}` })));
    for (const id of needFetch) {
      const result = results.get(id);
      if (!result) continue;
      if (result.status === 200 && result.body) {
        rawById.set(id, flatten(result.body));
        mutated = true;
      } else if (result.status === 404) {
        if (rawById.delete(id)) mutated = true;
      } else {
        throw Object.assign(new Error(`batch item ${id} → ${result.status}`), { status: result.status });
      }
    }
  }

  deltaLink = res.deltaLink || deltaLink;
  return mutated;
}

/**
 * ซิงค์คำร้อง — เรียกซ้อนกันได้ (คืน Promise เดียวกัน ไม่ยิงซ้อน)
 * @returns {Promise<{mutated:boolean, items:object[]}>}
 */
export function syncRequests({ full = false } = {}) {
  if (inflight) {
    // ขอโหลดทั้งหมดระหว่างที่รอบปกติกำลังวิ่ง → รอรอบนั้นจบก่อนแล้วค่อยโหลดทั้งหมด
    return full ? inflight.catch(() => {}).then(() => syncRequests({ full: true })) : inflight;
  }
  inflight = (async () => {
    emit({ phase: "syncing", error: "" });
    try {
      let mutated;
      const needFull = full || !deltaLink || deltaSupported === false || Date.now() - lastFullAt > FULL_RESYNC_MS;
      if (needFull) {
        await fullLoad();
        mutated = true;
      } else {
        try {
          mutated = await deltaPoll();
        } catch (error) {
          // token หมดอายุ (410 resyncRequired) หรือ token ใช้ไม่ได้ → เริ่มใหม่
          if (![400, 404, 410].includes(error.status) && !/resync/i.test(error.message || "")) throw error;
          await fullLoad();
          mutated = true;
        }
      }
      markFresh();
      emit({ phase: "ok", lastSyncAt: Date.now(), source: "network", mode: deltaSupported ? "delta" : "full" });
      if (mutated) scheduleSave();
      return { mutated, items: [...rawById.values()] };
    } catch (error) {
      emit({ phase: navigator.onLine === false ? "offline" : "error", error: error.message || String(error) });
      throw error;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** ซิงค์ให้ "สดจริง ณ ตอนนี้" — ถ้ามีรอบที่เริ่มไปก่อนหน้า รอให้จบแล้วถามอีกรอบ (ใช้ตอนออกเลขคำร้อง) */
export async function syncRequestsNow() {
  if (inflight) await inflight.catch(() => {});
  return syncRequests();
}

// ══════════════════════════════════════════════════════════════
// แคชในเครื่อง
// ══════════════════════════════════════════════════════════════

/** ตั้งเจ้าของแคช + อ่านสำเนาเดิม — คืนรายการดิบ หรือ null ถ้าไม่มี/หมดอายุ */
export async function initRequestCache(account) {
  cacheKey = userCacheKey(account, `requests@${appConfig.sharePoint.hostname}${appConfig.sharePoint.sitePath}`);
  const data = await cacheGet(cacheKey);
  if (!data?.items?.length) return null;
  rawById = new Map(data.items.map((item) => [String(item.id), item]));
  deltaLink = data.deltaLink || null;
  lastFullAt = data.lastFullAt || 0;
  deltaSupported = data.deltaSupported ?? null;
  emit({ phase: "cached", source: "cache", lastSyncAt: data.syncedAt || 0 });
  return [...rawById.values()];
}

function scheduleSave() {
  if (!cacheKey) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    cacheSet(cacheKey, {
      items: [...rawById.values()],
      deltaLink,
      lastFullAt,
      deltaSupported,
      syncedAt: syncInfo.lastSyncAt,
    });
  }, 1500);
}

// ══════════════════════════════════════════════════════════════
// กันบันทึกทับจากข้อมูลเก่า — ช่วงไม่กี่วินาทีแรกที่หน้าเว็บยังแสดงสำเนาในเครื่อง
// ══════════════════════════════════════════════════════════════

function markFresh() {
  if (isFresh) return;
  isFresh = true;
  resolveFresh(true);
}

export function isRequestsFresh() {
  return isFresh;
}

function whenFresh(timeoutMs = FRESH_WAIT_MS) {
  if (isFresh) return Promise.resolve(true);
  return Promise.race([freshPromise, new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))]);
}

/**
 * เรียกก่อนแก้ไขคำร้อง: ถ้ายังซิงค์ไม่เสร็จ → รอให้เสร็จก่อน
 * แล้วถ้ารายการนั้นถูกคนอื่นแก้ไประหว่างที่เราดูสำเนาเก่าอยู่ → หยุด ให้ผู้ใช้ตรวจสอบข้อมูลล่าสุดก่อน
 */
async function guardStaleWrite(itemId) {
  if (isFresh) return;
  const before = rawById.get(String(itemId))?.Modified;
  await whenFresh();
  const after = rawById.get(String(itemId))?.Modified;
  if (before && after && before !== after) {
    throw new Error("คำร้องนี้เพิ่งมีการเปลี่ยนแปลงจากผู้ใช้อื่น — ระบบอัปเดตข้อมูลล่าสุดแล้ว กรุณาตรวจสอบอีกครั้งก่อนทำรายการ");
  }
}

setRequestWriteGuard(guardStaleWrite);
