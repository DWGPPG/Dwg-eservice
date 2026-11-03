// ══════════════════════════════════════════════════════════════
// ข้อมูลคำขอก่อนเริ่มใช้ระบบ (นำเข้าจาก Excel "ENGINEERING DRAWING REQUEST FORM (การตอบกลับ)")
//  - ผู้จัดการอัปโหลดไฟล์ Excel ในหน้าจัดการข้อมูล → แปลงเป็น JSON ในเบราว์เซอร์
//  - เก็บใน SharePoint ฝ่ายเขียนแบบ: Documents/DrawingLegacy/
//      legacy-requests.json  (ข้อมูลที่ใช้คำนวณสถิติ)
//      <ชื่อไฟล์เดิม>.xlsx    (สำรองไฟล์ต้นฉบับ)
//  - หน้าภาพรวมรวมข้อมูลนี้เข้ากับสถิติรายบุคคล/ทั้งฝ่ายโดยอัตโนมัติ
//    (ไม่นับเป็นภาระงานปัจจุบัน — เป็นสถิติย้อนหลังเท่านั้น)
// ══════════════════════════════════════════════════════════════

import { STATUS } from "../../../config/schema.js";
import { ensureDriveFolder, graphFetch, uploadDriveFile } from "../graph.js";
import { cacheGet, cacheSet } from "../idb-cache.js";
import { ensureSite } from "../sharepoint.js";
import { state } from "../state.js";
import { getDrawingTeamMembers } from "./team-service.js";
import { excelDate, readFirstSheet } from "./xlsx-reader.js";

export const LEGACY_FOLDER = "DrawingLegacy";
export const LEGACY_JSON = "legacy-requests.json";
export const LEGACY_STATUS = "legacy_open"; // งานที่ค้างในไฟล์เดิม (รออัพเดท/ยังไม่เสร็จ) — ไม่นับเป็นภาระงาน
const CACHE_KEY = "legacy-requests";
const REQUEST_TYPES = ["📋 เขียนแบบ Proposal", "🏛️ ขออนุญาตก่อสร้าง", "🏗️ เขียนแบบก่อสร้าง", "🏁 As-Built Drawing", "📁 อื่นๆ"];

let payload = null;       // { meta, records }
let loading = null;
const listeners = new Set();

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const norm = (v) => clean(v).toLowerCase();

export function onLegacyChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function legacyMeta() { return payload?.meta || null; }
export function legacyRecords() { return payload?.records || []; }

// ══════════════════════════════════════════════════════════════
// แปลงแถว Excel → รายการ
// ══════════════════════════════════════════════════════════════

const COLUMNS = {
  assignee: (h) => h.includes("ผู้รับผิดชอบ"),
  dueText: (h) => h.includes("ครบกำหนด"),
  status: (h) => h === "สถานะ" || h.startsWith("สถานะ"),
  submittedAt: (h) => h.includes("วันเวลาส่งคำขอ") || h === "timestamp" || h.includes("ประทับเวลา"),
  type: (h) => h.includes("ประเภทงาน"),
  building: (h) => h.includes("ชื่ออาคาร"),
  area: (h) => h.includes("พื้นที่ติดตั้ง"),
  project: (h) => /^โครงการ/.test(h),
  detail: (h) => h.includes("รายละเอียดแบบ"),
  location: (h) => h.includes("สถานที่ตั้ง"),
  requester: (h) => h.includes("ผู้มอบหมาย"),
  requiredDate: (h) => h.includes("วันที่ต้องการ"),
};

function normalizeType(text) {
  const t = clean(text);
  if (!t) return "📁 อื่นๆ";
  return REQUEST_TYPES.find((type) => t === type || t.includes(type.replace(/^\S+\s/, ""))) || t;
}

function normalizeStatus(statusText, dueText) {
  const s = clean(statusText);
  const d = clean(dueText);
  if (s.includes("ยกเลิก") || d.includes("ยกเลิก")) return "cancelled";
  if (s.includes("เสร็จแล้ว") || d === "ส่งแล้ว") return "done";
  if (s.includes("รออัพเดท") || d.includes("พักไว้")) return "hold";
  return "open";
}

/** แถว Excel → { meta, records } (records ใช้ชื่อคีย์สั้นเพื่อให้ไฟล์เล็ก) */
export function buildLegacyPayload(rows, sourceName) {
  const header = (rows[0] || []).map((h) => norm(h));
  const idx = {};
  Object.entries(COLUMNS).forEach(([key, test]) => { idx[key] = header.findIndex((h) => h && test(h)); });
  if (idx.assignee < 0 || idx.type < 0 || idx.submittedAt < 0) {
    throw new Error("ไม่พบคอลัมน์ที่ต้องใช้ (ชื่อผู้รับผิดชอบเขียนแบบ / ประเภทงาน / วันเวลาส่งคำขอ) — กรุณาใช้ไฟล์การตอบกลับของฟอร์มเดิม");
  }
  const cell = (row, key) => (idx[key] >= 0 ? row[idx[key]] : "");
  const records = [];
  rows.slice(1).forEach((row, i) => {
    if (!row || !row.some((v) => clean(v))) return;
    const submittedAt = excelDate(cell(row, "submittedAt"));
    const type = clean(cell(row, "type"));
    if (!submittedAt && !type) return;
    const names = [...new Set(clean(cell(row, "assignee")).split(/\s*(?:,|\/|&|\s-\s|-(?=[A-Zก-๙]))\s*/).map(clean).filter(Boolean))];
    const dueText = clean(cell(row, "dueText"));
    const overdue = Number(dueText.match(/เกินกำหนด\s*(\d+)/)?.[1] || 0);
    records.push({
      n: i + 2,                                  // เลขแถวในไฟล์เดิม
      a: names,                                  // ผู้รับผิดชอบเขียนแบบ
      t: normalizeType(type),
      p: clean(cell(row, "project")),
      b: clean(cell(row, "building")),
      ar: clean(cell(row, "area")),
      s: normalizeStatus(cell(row, "status"), dueText),
      at: submittedAt,
      due: excelDate(cell(row, "requiredDate")).slice(0, 10),
      od: overdue,                               // เกินกำหนดกี่วันทำการ (งานที่ค้างในไฟล์เดิม)
      by: clean(cell(row, "requester")),
      d: clean(cell(row, "detail")).slice(0, 240),
    });
  });
  const dates = records.map((r) => r.at).filter(Boolean).sort();
  return {
    meta: {
      source: sourceName || "",
      importedAt: new Date().toISOString(),
      importedBy: state.user?.email || "",
      count: records.length,
      from: dates[0] || "",
      to: dates[dates.length - 1] || "",
    },
    records,
  };
}

// ══════════════════════════════════════════════════════════════
// บันทึก / โหลดจาก SharePoint
// ══════════════════════════════════════════════════════════════

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const isLocked = (error) => /\b423\b|resourceLocked|locked/i.test(String(error?.message || ""));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** อัปโหลด — ไฟล์ถูกล็อก (423: เปิดค้างใน Excel / SharePoint กำลังประมวลผล) → รอแล้วลองใหม่ */
async function uploadWithRetry(siteId, file, tries = 3) {
  for (let i = 0; ; i += 1) {
    try { return await uploadDriveFile(siteId, LEGACY_FOLDER, file); } catch (error) {
      if (!isLocked(error) || i >= tries - 1) throw error;
      await wait(2000 * (i + 1));
    }
  }
}

/** อัปโหลด Excel → แปลง → เก็บ JSON + สำรองไฟล์ต้นฉบับใน SharePoint
 *  - JSON (ข้อมูลที่ใช้จริง) บันทึกก่อน · ถ้าไฟล์เดิมถูกล็อก บันทึกเป็นชื่อใหม่ (ระบบอ่านไฟล์ล่าสุดเสมอ)
 *  - ไฟล์ต้นฉบับตั้งชื่อตามวันเวลา ไม่ทับไฟล์เดิมที่อาจเปิดค้างอยู่ · สำรองไม่สำเร็จไม่ทำให้นำเข้าล้ม */
export async function importLegacyFile(file) {
  if (!/\.xlsx$/i.test(file?.name || "")) throw new Error("กรุณาเลือกไฟล์ Excel (.xlsx)");
  const rows = await readFirstSheet(file);
  const next = buildLegacyPayload(rows, file.name);
  if (!next.records.length) throw new Error("ไม่พบรายการในไฟล์");
  const siteId = await ensureSite();
  await ensureDriveFolder(siteId, LEGACY_FOLDER);

  const body = JSON.stringify(next);
  try {
    await uploadWithRetry(siteId, new File([body], LEGACY_JSON, { type: "application/json" }));
  } catch (error) {
    if (!isLocked(error)) throw error;
    await uploadWithRetry(siteId, new File([body], LEGACY_JSON.replace(/\.json$/, `-${stamp()}.json`), { type: "application/json" }), 1);
  }

  const base = file.name.replace(/\.xlsx$/i, "").replace(/[\\/:*?"<>|#%]+/g, "_").slice(0, 80);
  next.backupOk = true;
  try {
    await uploadWithRetry(siteId, new File([file], `${base} (สำรอง ${stamp()}).xlsx`, { type: file.type }), 2);
  } catch (error) {
    console.warn("สำรองไฟล์ต้นฉบับไม่สำเร็จ:", error.message);
    next.backupOk = false;
  }

  setPayload(next);
  cacheSet(CACHE_KEY, { etag: "", payload: next }).catch(() => {});
  return next;
}

/** โหลดข้อมูล (แคชในเครื่องก่อน แล้วเช็คไฟล์ล่าสุดใน SharePoint ว่ามีเวอร์ชันใหม่ไหม) */
export function loadLegacy(force = false) {
  if (loading && !force) return loading;
  loading = (async () => {
    const cached = await cacheGet(CACHE_KEY).catch(() => null);
    if (cached?.payload && !payload) setPayload(cached.payload);
    try {
      const siteId = await ensureSite();
      // ไฟล์ข้อมูลล่าสุดในโฟลเดอร์ (legacy-requests.json หรือชื่อสำรองกรณีไฟล์เดิมถูกล็อก)
      const res = await graphFetch(`/sites/${siteId}/drive/root:/${LEGACY_FOLDER}:/children?$top=200`);
      const item = (res?.value || [])
        .filter((f) => f.file && /^legacy-requests.*\.json$/i.test(f.name))
        .sort((a, b) => String(b.lastModifiedDateTime).localeCompare(String(a.lastModifiedDateTime)))[0];
      if (!item) return payload;
      const etag = `${item.id}|${item.eTag || item.lastModifiedDateTime || ""}`;
      if (!force && cached?.payload && cached.etag && cached.etag === etag) return payload;
      const url = item["@microsoft.graph.downloadUrl"];
      if (!url) return payload;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const next = await resp.json();
      if (Array.isArray(next?.records)) {
        setPayload(next);
        cacheSet(CACHE_KEY, { etag, payload: next }).catch(() => {});
      }
    } catch (error) {
      if (!/404|itemNotFound/i.test(String(error.message))) console.warn("โหลดข้อมูลสถิติเดิมไม่สำเร็จ:", error.message);
    }
    return payload;
  })();
  return loading;
}

/** ลิงก์ดาวน์โหลดไฟล์สำรองใน SharePoint (ไฟล์ต้นฉบับ .xlsx และ .json) */
export async function legacyBackupFiles() {
  const siteId = await ensureSite();
  const res = await graphFetch(`/sites/${siteId}/drive/root:/${LEGACY_FOLDER}:/children?$top=50`).catch(() => null);
  return (res?.value || []).filter((f) => f.file).map((f) => ({
    name: f.name,
    size: f.size,
    modified: f.lastModifiedDateTime,
    url: f["@microsoft.graph.downloadUrl"] || "",
    webUrl: f.webUrl || "",
  }));
}

function setPayload(next) {
  payload = next;
  cachedRequests = null;
  // วนจากสำเนา — ผู้ฟังที่วาดหน้าใหม่จะลงทะเบียนผู้ฟังตัวใหม่ระหว่างวน (ไม่ให้เรียกซ้ำไม่รู้จบจนหน้าค้าง)
  [...listeners].forEach((fn) => { try { fn(); } catch (_) { /* ignore */ } });
}

// ══════════════════════════════════════════════════════════════
// แปลงเป็นรูปแบบเดียวกับคำร้องในระบบ (ใช้คำนวณสถิติร่วมกัน)
// ══════════════════════════════════════════════════════════════

let cachedRequests = null;
let cachedTeamSig = "";

/** จับคู่ชื่อในไฟล์เดิม → อีเมลสมาชิกฝ่ายเขียนแบบ (ชื่อเต็ม → ชื่อต้น) */
function nameMatcher() {
  const team = getDrawingTeamMembers();
  const full = new Map();
  const first = new Map();
  team.forEach((m) => {
    const name = norm(m.name);
    if (name) full.set(name, m);
    const head = name.split(" ")[0];
    if (head && !first.has(head)) first.set(head, m); else if (head) first.set(head, null); // ชื่อต้นซ้ำ → ไม่เดา
  });
  return (raw) => {
    const name = norm(raw);
    return full.get(name) || first.get(name.split(" ")[0]) || null;
  };
}

/** รายการข้อมูลเดิมในรูปคำร้อง (legacy: true) — จับคู่กับรายชื่อทีมปัจจุบัน */
export function legacyRequests() {
  const records = legacyRecords();
  if (!records.length) return [];
  const team = getDrawingTeamMembers();
  const sig = `${records.length}|${team.map((m) => m.email).join(",")}`;
  if (cachedRequests && cachedTeamSig === sig) return cachedRequests;
  const match = nameMatcher();
  cachedRequests = records.map((r) => {
    const people = r.a.map((name) => {
      const m = match(name);
      return m ? { email: m.email.toLowerCase(), name: m.name || name } : { email: `legacy:${norm(name)}`, name };
    });
    const status = r.s === "done" ? STATUS.DONE : r.s === "cancelled" ? STATUS.CANCELLED : LEGACY_STATUS;
    return {
      legacy: true,
      requestNo: `ข้อมูลเดิม-${r.n}`,
      assignees: people.map((p) => p.email),
      assignedToEmail: people[0]?.email || "",
      assignedToName: people.map((p) => p.name).join(", "),
      requestType: r.t,
      projectName: r.p,
      requesterName: r.by,
      status,
      submittedAt: r.at,
      dueDate: r.due,
      legacyOverdue: r.od || 0,
      drawingName: r.d,
    };
  });
  cachedTeamSig = sig;
  return cachedRequests;
}
