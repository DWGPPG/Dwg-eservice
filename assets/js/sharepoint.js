import { appConfig } from "../../config/config.js";
import { lists } from "../../config/schema.js";
import {
  createListItem,
  getListByName,
  getSiteByPath,
  listItems,
  updateListItem,
} from "./graph.js";
import { setState, state } from "./state.js";

// ── เก็บ List ID แยกตามชื่อ List กัน fetch ซ้ำ ──
const listIdCache = {};

export async function ensureSite() {
  if (state.siteId) return state.siteId;
  const site = await getSiteByPath(appConfig.sharePoint.hostname, appConfig.sharePoint.sitePath);
  setState({ siteId: site.id });
  return site.id;
}

export async function ensureListId(listName) {
  if (listIdCache[listName]) return listIdCache[listName];
  const siteId = await ensureSite();
  const result = await getListByName(siteId, listName);
  const listId = result?.value?.[0]?.id || null;
  if (listId) listIdCache[listName] = listId;
  return listId;
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
  const response = await createListItem(siteId, listId, fieldsPayload);
  return { id: response.id, ...response.fields };
}

// ── cache ชื่อ field ที่ไม่มีจริงใน List แต่ละตัว เพื่อไม่ต้อง retry ซ้ำ ──
const unknownFieldsCache = {};

export async function patchItem(listName, itemId, fieldsPayload) {
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
      const m = msg.match(/Field '([^']+)' is not recognized/i)
             || msg.match(/field '([^']+)' does not exist/i)
             || msg.match(/"([A-Za-z0-9_]+)" is not a (valid|recognized) field/i);
      if (m) {
        const bad = m[1];
        // เก็บ cache ไว้ไม่ต้อง retry field เดิมรอบหน้า
        if (!unknownFieldsCache[listName]) unknownFieldsCache[listName] = new Set();
        unknownFieldsCache[listName].add(bad);
        delete payload[bad];
        console.warn(`patchItem [${listName}]: field "${bad}" ไม่มีใน SharePoint — ข้ามและลองใหม่`);
        continue;
      }
      throw err;
    }
  }
  return null;
}

export async function loadMasterData() {
  const [projects, drawingNumbers, drawingNames, kwp, team, holidays] = await Promise.all([
    getListItems(lists.projects).catch(() => []),
    getListItems(lists.drawingNumbers).catch(() => []),
    getListItems(lists.drawingNames).catch(() => []),
    getListItems(lists.kwp).catch(() => []),
    getListItems(lists.team).catch(() => []),
    getListItems(lists.holidays).catch(() => []),
  ]);

  const masterData = { projects, drawingNumbers, drawingNames, kwp, team, holidays };
  setState({ masterData });
  return masterData;
}
