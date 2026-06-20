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

export async function patchItem(listName, itemId, fieldsPayload) {
  const siteId = await ensureSite();
  const listId = await ensureListId(listName);
  if (!listId) throw new Error(`ไม่พบ List "${listName}" บน SharePoint`);
  return updateListItem(siteId, listId, itemId, fieldsPayload);
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
