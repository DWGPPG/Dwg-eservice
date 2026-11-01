import { appConfig } from "../../config/config.js";
import { lists } from "../../config/schema.js";
import {
  createListItem,
  getListByName,
  getSiteByPath,
  graphFetch,
  listItems,
  updateListItem,
} from "./graph.js";
import { cacheGet, cacheSet, userCacheKey } from "./idb-cache.js";
import { readTeamCache, saveTeamCache } from "./services/team-service.js";
import { setState, state } from "./state.js";

// ── เก็บ Site / List ID เป็น Promise — ตอนเข้าระบบโหลดหลาย List พร้อมกัน ถ้าเก็บแค่ผลลัพธ์
//    ทุก List จะยิงค้นหา Site ซ้ำพร้อมกันหมด (ช้า + เปลืองโควตา Graph) ──
const listIdCache = {};
let sitePromise = null;

export async function ensureSite() {
  if (state.siteId) return state.siteId;
  sitePromise ||= getSiteByPath(appConfig.sharePoint.hostname, appConfig.sharePoint.sitePath)
    .then((site) => {
      setState({ siteId: site.id });
      return site.id;
    })
    .catch((error) => {
      sitePromise = null; // ให้ลองใหม่ได้ครั้งหน้า
      throw error;
    });
  return sitePromise;
}

export async function ensureListId(listName) {
  if (listIdCache[listName]) return listIdCache[listName];
  listIdCache[listName] = (async () => {
    const siteId = await ensureSite();
    const result = await getListByName(siteId, listName);
    return result?.value?.[0]?.id || null;
  })();
  try {
    const listId = await listIdCache[listName];
    if (!listId) delete listIdCache[listName]; // ไม่เจอ List — ไม่จำไว้ เผื่อสร้างทีหลัง
    return listId;
  } catch (error) {
    delete listIdCache[listName];
    throw error;
  }
}

export async function getListItems(listName) {
  const siteId = await ensureSite();
  const listId = await ensureListId(listName);
  if (!listId) {
    console.warn(`SharePoint list not found: ${listName}`);
    return [];
  }
  const response = await listItems(siteId, listId);
  return (response.value || []).map((item) => ({ id: item.id, ...item.fields }));
}

export async function addItem(listName, fieldsPayload) {
  const siteId = await ensureSite();
  const listId = await ensureListId(listName);
  if (!listId) throw new Error(`ไม่พบ List "${listName}" บน SharePoint — กรุณาสร้างก่อนใช้งาน`);

  // ใช้ unknownFieldsCache เดียวกับ patchItem เพื่อข้าม field ที่ไม่มีใน SharePoint
  const known = unknownFieldsCache[listName] || new Set();
  let payload = Object.fromEntries(
    Object.entries(fieldsPayload).filter(([k]) => !known.has(k))
  );

  // Retry loop — ถ้า 400 "Field 'XYZ' is not recognized" ให้ตัด field นั้นออกแล้วลองใหม่
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const response = await createListItem(siteId, listId, payload);
      notifyRequestWrite(listName);
      return { id: response.id, ...response.fields };
    } catch (err) {
      const msg = err.message || "";
      // parse ชื่อ field ที่ไม่รู้จักจาก error message
      const match = msg.match(/Field '([^']+)' is not recognized/) ||
                    msg.match(/"([^"]+)" is not a valid field/);
      if (match && match[1]) {
        const bad = match[1];
        if (!unknownFieldsCache[listName]) unknownFieldsCache[listName] = new Set();
        unknownFieldsCache[listName].add(bad);
        console.warn(`addItem [${listName}]: field "${bad}" ไม่มีใน SharePoint — ข้ามและลองใหม่`);
        const { [bad]: _removed, ...rest } = payload;
        payload = rest;
        continue;
      }
      throw err; // error อื่น → 던ける
    }
  }
  throw new Error(`addItem [${listName}]: retry เกิน 10 ครั้ง`);
}

/**
 * ลบ List Item — ใช้สำหรับ rollback เมื่อขั้นตอนหลังเกิด error
 */
export async function deleteItem(listName, itemId) {
  const siteId = await ensureSite();
  const listId = await ensureListId(listName);
  if (!listId) throw new Error(`ไม่พบ List "${listName}"`);
  await graphFetch(`/sites/${siteId}/lists/${listId}/items/${itemId}`, {
    method: "DELETE",
  });
}

// ── cache ชื่อ field ที่ไม่มีจริงใน List แต่ละตัว เพื่อไม่ต้อง retry ซ้ำ ──
const unknownFieldsCache = {};

// ส่งคำสั่งแก้ไขรายการเดียวกันทีละคำสั่ง — คำสั่งที่ซ้อนกัน (เช่นเปลี่ยนสถานะซ้ำเร็วๆ) ทำให้ SharePoint ตอบ 409
const itemPatchQueues = new Map();

// ตัวกันบันทึกทับจากข้อมูลเก่าในแคช (ลงทะเบียนโดย request-sync.js) — ใช้กับ List คำร้องเท่านั้น
let requestWriteGuard = null;
export function setRequestWriteGuard(fn) {
  requestWriteGuard = fn;
}
// แจ้ง request-sync ทุกครั้งที่เขียนคำร้องสำเร็จ — รอบซิงค์ที่เริ่มก่อนบันทึกเสร็จจะได้ไม่เอาข้อมูลเก่ามาทับ
let requestWriteNotifier = null;
export function setRequestWriteNotifier(fn) {
  requestWriteNotifier = fn;
}
const notifyRequestWrite = (listName) => { if (listName === lists.requests) requestWriteNotifier?.(); };

export async function patchItem(listName, itemId, fieldsPayload) {
  if (requestWriteGuard && listName === lists.requests) await requestWriteGuard(itemId);
  const key = `${listName}:${itemId}`;
  const previous = itemPatchQueues.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(() => patchItemNow(listName, itemId, fieldsPayload))
    .then((result) => { notifyRequestWrite(listName); return result; });
  itemPatchQueues.set(key, run);
  try {
    return await run;
  } finally {
    if (itemPatchQueues.get(key) === run) itemPatchQueues.delete(key);
  }
}

async function patchItemNow(listName, itemId, fieldsPayload) {
  const siteId = await ensureSite();
  const listId = await ensureListId(listName);
  if (!listId) throw new Error(`ไม่พบ List "${listName}" บน SharePoint`);

  // กรอง field ที่รู้อยู่แล้วว่าไม่มีใน List ออกก่อน (จาก cache ครั้งก่อน)
  const known = unknownFieldsCache[listName] || new Set();
  let payload = Object.fromEntries(
    Object.entries(fieldsPayload).filter(([k]) => !known.has(k))
  );

  // ลอง PATCH ถ้า 400 "Field 'XYZ' is not recognized" → ตัดออกแล้ว retry
  while (Object.keys(payload).length > 0) {
    try {
      return await updateListItem(siteId, listId, itemId, payload);
    } catch (err) {
      const msg = err.message || "";

      // Log payload เพื่อ debug เมื่อเกิด 400
      if (msg.includes("400") || msg.includes("invalidRequest")) {
        console.error("patchItem 400 — payload ที่ส่งไป:", JSON.stringify(payload, null, 2));
      }

      const m = msg.match(/Field '([^']+)' is not recognized/i)
             || msg.match(/field '([^']+)' does not exist/i)
             || msg.match(/"([A-Za-z0-9_]+)" is not a (valid|recognized) field/i);
      if (m) {
        const bad = m[1];
        if (!unknownFieldsCache[listName]) unknownFieldsCache[listName] = new Set();
        unknownFieldsCache[listName].add(bad);
        delete payload[bad];
        console.warn(`patchItem [${listName}]: field "${bad}" ไม่มีใน SharePoint — ข้ามและลองใหม่`);
        continue;
      }

      // ยังไม่รู้ว่า field ไหนผิด (Graph API ตอบ 400 แบบทั่วไป ไม่ระบุชื่อ field) —
      // ถ้าเหลือมากกว่า 1 field ให้ลอง patch ทีละตัวแยกกัน เพื่อหาตัวที่ทำให้พัง
      // แล้วข้ามเฉพาะตัวนั้น ฟิลด์อื่นที่ถูกต้องจะยังบันทึกสำเร็จ ไม่เสียข้อมูลทั้งหมดเพราะฟิลด์เดียวมีปัญหา
      // (เช่น ข้อความยาวเกิน limit ของคอลัมน์ Single line of text บางคอลัมน์)
      if ((msg.includes("400") || msg.includes("invalidRequest")) && Object.keys(payload).length > 1) {
        console.warn(`patchItem [${listName}]: 400 แบบไม่ระบุ field — ลอง patch ทีละฟิลด์เพื่อหาตัวที่พัง`);
        let result = null;
        const skipped = [];
        for (const [key, val] of Object.entries(payload)) {
          try {
            result = await updateListItem(siteId, listId, itemId, { [key]: val });
          } catch (fieldErr) {
            skipped.push(key);
            console.error(`patchItem [${listName}]: field "${key}" ทำให้เกิด 400 — ข้ามฟิลด์นี้ (ค่าที่ส่ง: ${JSON.stringify(val)?.slice(0, 200)})`, fieldErr.message);
          }
        }
        if (skipped.length) {
          console.warn(`patchItem [${listName}]: บันทึกสำเร็จบางส่วน — ข้ามฟิลด์ [${skipped.join(", ")}] เพราะทำให้เกิด error`);
          return { ...(result || {}), __skippedFields: skipped };
        }
        return result;
      }

      throw err;
    }
  }
  return null;
}

export async function loadMasterData() {
  let [projects, drawingNumbers, drawingNames, kwp, team, holidays, settingRows, projectOwners, staffLeave] = await Promise.all([
    getListItems(lists.projects).catch(() => []),
    getListItems(lists.drawingNumbers).catch(() => []),
    getListItems(lists.drawingNames).catch(() => []),
    getListItems(lists.kwp).catch(() => []),
    getListItems(lists.team).catch(() => []),
    getListItems(lists.holidays).catch(() => []),
    getListItems(lists.settings).catch(() => []),
    getListItems(lists.projectOwners).catch(() => []),
    getListItems(lists.staffLeave).catch(() => []),
  ]);

  // ทีมโหลดไม่ได้ (เน็ต/สิทธิ์ SharePoint มีปัญหาชั่วคราว) → ใช้รายชื่อชุดล่าสุดที่เคยโหลดสำเร็จแทน
  // teamSource บอกหน้าจัดการข้อมูลว่ากำลังใช้ข้อมูลจริงหรือสำรอง
  let teamSource = "sharepoint";
  if (team.length) {
    saveTeamCache(team);
  } else {
    const cached = readTeamCache();
    team = cached?.team || [];
    teamSource = cached ? "cache" : "none";
  }

  const settings = settingsFromRows(settingRows);
  const masterData = { projects, drawingNumbers, drawingNames, kwp, team, holidays, teamSource, settings, settingRows, projectOwners, staffLeave };
  setState({ masterData });
  if (state.account && teamSource === "sharepoint") cacheSet(masterCacheKey(state.account), masterData);
  return masterData;
}

// ══════════════════════════════════════════════════════════════
// การตั้งค่าระบบ (List "AppSettings": Title = ชื่อค่า, SettingValue = ค่า)
// ══════════════════════════════════════════════════════════════

const SETTING_VALUE_FIELD = "SettingValue";

function settingsFromRows(rows = []) {
  return Object.fromEntries(rows.filter((r) => r.Title).map((r) => [r.Title, r[SETTING_VALUE_FIELD] ?? ""]));
}

/**
 * สร้าง List ถ้ายังไม่มี (ใช้สิทธิ์ Sites.ReadWrite.All ที่ระบบมีอยู่แล้ว) — คืน listId
 * @param {string} listName
 * @param {string[]} textColumns ชื่อคอลัมน์ข้อความ (Title มีอยู่แล้วทุก List)
 */
export async function ensureList(listName, textColumns = []) {
  const existing = await ensureListId(listName);
  if (existing) return existing;
  const siteId = await ensureSite();
  await graphFetch(`/sites/${siteId}/lists`, {
    method: "POST",
    body: JSON.stringify({
      displayName: listName,
      columns: textColumns.map((name) => ({ name, text: { allowMultipleLines: true } })),
      list: { template: "genericList" },
    }),
  });
  const created = await ensureListId(listName);
  if (!created) throw new Error(`สร้าง List "${listName}" ไม่สำเร็จ`);
  return created;
}

const ensureSettingsList = () => ensureList(lists.settings, [SETTING_VALUE_FIELD]);

/** บันทึกค่าตั้งค่า 1 รายการ (สร้าง List/รายการให้อัตโนมัติถ้ายังไม่มี) */
export async function saveSetting(key, value) {
  await ensureSettingsList();
  const rows = await getListItems(lists.settings);
  const row = rows.find((r) => r.Title === key);
  if (row) await patchItem(lists.settings, row.id, { [SETTING_VALUE_FIELD]: value });
  else await addItem(lists.settings, { Title: key, [SETTING_VALUE_FIELD]: value });
}

function masterCacheKey(account) {
  return userCacheKey(account, `master@${appConfig.sharePoint.hostname}${appConfig.sharePoint.sitePath}`);
}

/** ข้อมูลหลัก (ทีม/โครงการ/วันหยุด) จากสำเนาในเครื่อง — ให้เปิดเว็บได้ทันทีก่อนโหลดจริงเสร็จ */
export async function hydrateMasterFromCache(account) {
  const data = await cacheGet(masterCacheKey(account));
  if (!data?.team) return false;
  setState({ masterData: { ...data, teamSource: data.teamSource || "sharepoint" } });
  return true;
}
