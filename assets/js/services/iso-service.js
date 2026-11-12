// ══════════════════════════════════════════════════════════════
// เอกสาร ISO ฝ่ายเขียนแบบ — เก็บใน SharePoint ฝ่ายเขียนแบบ: Documents/ISO-DWG/
//  โครงสร้างตามแฟ้ม ISO เดิม (1-SP … 8-Project) + 8-Project แยกตามปี → Presale / Project → โครงการ
//  ดูได้จากเมนูคู่มือ (ฝ่ายเขียนแบบ/ผู้จัดการ) · แก้ไข/อัปโหลดได้ที่หน้าจัดการข้อมูล (ผู้จัดการ)
// ══════════════════════════════════════════════════════════════

import { ensureDriveFolder, graphFetch, uploadDriveFile } from "../graph.js";
import { ensureSite } from "../sharepoint.js";
import { buildZip, readZipEntries } from "./xlsx-reader.js";
import { requestFolderPath } from "./drawing-service.js";

export const ISO_ROOT = "ISO-DWG";
export const ISO_ROOT_LABEL = "DWG เขียนแบบ (ISO)";
export const PROJECT_FOLDER = "8-Project";

/** หมวดเอกสารหลัก (ตามแฟ้ม ISO เดิม) — คำอธิบายใช้แสดงในหน้าคู่มือ */
export const ISO_SECTIONS = [
  { name: "1-SP", label: "ระเบียบปฏิบัติ (Standard Procedure)", hint: "SP-DWG-xxx ระเบียบปฏิบัติการควบคุมการเขียนแบบ" },
  { name: "2-SD", label: "เอกสารสนับสนุน (Supporting Document)", hint: "คู่มือการใช้งานระบบ DWG e-Service" },
  { name: "3-FM", label: "แบบฟอร์ม (Form)", hint: "DWG-FM-xxx แบบฟอร์มที่ใช้ในฝ่าย" },
  { name: "4-Action Plan", label: "แผนปฏิบัติการ (Action Plan)", hint: "DWG-FM-SMR-010" },
  { name: "5-Target Graph", label: "กราฟเป้าหมาย (Target Graph)", hint: "ผลการดำเนินงานเทียบเป้าหมาย" },
  { name: "6-ประเมินความเสี่ยง", label: "ประเมินความเสี่ยงและโอกาส", hint: "แยกโฟลเดอร์ตามปี — SHE-001 / SHE-004 / SMR-011" },
  { name: "7-KPI", label: "KPI", hint: "KPI QES ของฝ่าย" },
  { name: PROJECT_FOLDER, label: "เอกสารโครงการ", hint: "แยกปี → 1-Presale / 2-Project → โครงการ" },
];

// หมวดงานในแต่ละขั้นแบบ → ในหมวดแยกโฟลเดอร์ตาม Drawing "เลขDrawing-ชื่อDrawing"
export const DISCIPLINES = [
  { code: "GE", label: "General" },
  { code: "EE", label: "Electrical" },
  { code: "CE", label: "Civil / Structural / Architectural" },
  { code: "ME", label: "Mechanical" },
];
export const DRAWING_STAGES = ["02-DWG Concept design", "03-DWG Permission", "04-DWG Construction", "05-DWG As-built"];
const DOC_FOLDERS = ["00-Ref", "01-Document/1-RFD/1-รับมา", "01-Document/1-RFD/2-ส่งออก"];
export const PERMIT_STAGE = "03-DWG Permission";
// หมวดขออนุญาต — อยู่เฉพาะใน 03-DWG Permission (แยกจาก GE) ตามหมวดขออนุญาตในระบบ e-Service
export const PERMIT_FOLDERS = [
  { name: "P1-ขออนุญาต อ.1", match: /อ\.1/ },
  { name: "P2-ขออนุญาต PEA-MEA", match: /PEA|MEA/i },
  { name: "P3-ขออนุญาต กกพ-พค.2", match: /กกพ|พค/ },
  { name: "P4-ขออนุญาต COP-รง.4", match: /COP|รง/i },
  { name: "P5-ขออนุญาต อื่นๆ", match: /./ },
];
/** โฟลเดอร์หมวดในขั้นแบบหนึ่ง (03-DWG Permission = GE/EE/CE/ME + หมวดขออนุญาต) */
export const categoryFoldersOf = (stage) => [...DISCIPLINES.map((d) => d.code), ...(stage === PERMIT_STAGE ? PERMIT_FOLDERS.map((f) => f.name) : [])];
const withDisciplines = (stages) => stages.flatMap((stage) => categoryFoldersOf(stage).map((f) => `${stage}/${f}`));

// โฟลเดอร์มาตรฐานในแต่ละโครงการ — Presale มีแค่ขั้นเสนอแบบ (02)
export const PROJECT_STAGES = DRAWING_STAGES;
export const PRESALE_STAGES = DRAWING_STAGES.slice(0, 1);
export const PROJECT_SUBFOLDERS = [...DOC_FOLDERS, ...withDisciplines(PROJECT_STAGES)];
export const PRESALE_SUBFOLDERS = [...DOC_FOLDERS, ...withDisciplines(PRESALE_STAGES)];

export const isPermitCategory = (category) => /ขออนุญาต/.test(String(category || ""));

/** หมวด Drawing ในระบบ e-Service → ชื่อโฟลเดอร์หมวด (หมวดขออนุญาต → P1–P5 ใช้ได้เฉพาะใน 03-DWG Permission) */
export function disciplineOfCategory(category) {
  const c = String(category || "");
  if (isPermitCategory(c)) return PERMIT_FOLDERS.find((f) => f.match.test(c.replace(/ขออนุญาต/, ""))).name;
  if (/Electrical/i.test(c)) return "EE";
  if (/Mechanical/i.test(c)) return "ME";
  if (/Structural|Architectural|Civil/i.test(c)) return "CE";
  return "GE";
}

/** ชื่อโฟลเดอร์ Drawing: "เลขDrawing-ชื่อDrawing" */
export const drawingFolderName = (no, name) => safeName([no, name].filter((v) => String(v || "").trim()).join("-"), 80);
export const KINDS = { presale: "1-Presale", project: "2-Project" };

const yearFolderRe = (year) => new RegExp(`(^|-)\\s*Project ปี ${year}$`);
const pad2 = (n) => String(n).padStart(2, "0");
export const joinPath = (...parts) => parts.filter(Boolean).join("/").replace(/\/+/g, "/");
const encodePath = (path) => path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
/** ชื่อโฟลเดอร์/ไฟล์ที่ SharePoint ยอมรับ: ตัดอักขระต้องห้าม/อักขระควบคุม, ห้ามลงท้ายด้วยจุดหรือช่องว่าง
 *  (เช่น "Co., Ltd." → "Co., Ltd"), เลี่ยงชื่อสงวน และจำกัดความยาว (path รวมต้องไม่เกิน 400 ตัวอักษร) */
const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d|desktop\.ini|_vti_.*|forms)$/i;
export const safeName = (name, max = 100) => {
  let out = String(name || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f\u200b-\u200d\ufeff]/g, "")
    .replace(/[\\/:*?"<>|#%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^~\$/, "")
    .replace(/[.\s]+$/, "");
  if (out.length > max) out = out.slice(0, max).replace(/[.\s]+$/, "");
  return RESERVED_NAMES.test(out) ? `${out}_` : out;
};

async function siteId() { return ensureSite(); }

/** รายการในโฟลเดอร์ (path นับจาก ISO_ROOT; "" = ราก) — โฟลเดอร์ก่อน แล้วไฟล์ เรียงตามชื่อ */
export async function listIso(path = "") {
  const id = await siteId();
  const full = encodePath(joinPath(ISO_ROOT, path));
  const items = [];
  let next = `/sites/${id}/drive/root:/${full}:/children?$top=200&$select=id,name,size,folder,file,webUrl,lastModifiedDateTime,lastModifiedBy,@microsoft.graph.downloadUrl`;
  try {
    while (next) {
      const res = await graphFetch(next);
      (res?.value || []).forEach((it) => items.push({
        id: it.id,
        name: it.name,
        isFolder: Boolean(it.folder),
        childCount: it.folder?.childCount ?? 0,
        size: it.size || 0,
        webUrl: it.webUrl || "",
        downloadUrl: it["@microsoft.graph.downloadUrl"] || "",
        modified: it.lastModifiedDateTime || "",
        modifiedBy: it.lastModifiedBy?.user?.displayName || "",
      }));
      next = res?.["@odata.nextLink"] || null;
    }
  } catch (error) {
    if (/404|itemNotFound/i.test(String(error.message))) return null; // ยังไม่มีโฟลเดอร์
    throw error;
  }
  const visible = items.filter((it) => !/^(thumbs\.db|desktop\.ini|\.ds_store)$/i.test(it.name));
  return visible.sort((a, b) => (Number(b.isFolder) - Number(a.isFolder)) || a.name.localeCompare(b.name, "th", { numeric: true }));
}

export async function createIsoFolder(path) {
  const id = await siteId();
  return ensureDriveFolder(id, joinPath(ISO_ROOT, path));
}

/** สร้างโครงสร้างมาตรฐานทั้งหมด (โฟลเดอร์ที่มีอยู่แล้วไม่ถูกแตะ) */
export async function createStandardTree(year = new Date().getFullYear()) {
  for (const section of ISO_SECTIONS) await createIsoFolder(section.name);
  await ensureYearFolder(year);
}

/** โฟลเดอร์ปีใน 8-Project ("1-Project ปี 2026") + 1-Presale / 2-Project — คืน path ของโฟลเดอร์ปี */
export async function ensureYearFolder(year) {
  const items = (await listIso(PROJECT_FOLDER)) || [];
  const existing = items.find((it) => it.isFolder && yearFolderRe(year).test(it.name));
  const yearFolders = items.filter((it) => it.isFolder && /Project ปี \d{4}$/.test(it.name));
  const name = existing?.name || `${yearFolders.length + 1}-Project ปี ${year}`;
  const path = joinPath(PROJECT_FOLDER, name);
  await createIsoFolder(joinPath(path, KINDS.presale));
  await createIsoFolder(joinPath(path, KINDS.project));
  return path;
}

/** โครงการใหม่: 8-Project/<ปี>/<1-Presale|2-Project>/<NN-ชื่อ>/ + โฟลเดอร์มาตรฐาน — คืน path */
export async function createProjectFolder({ year, kind, name }) {
  const yearPath = await ensureYearFolder(year);
  const kindPath = joinPath(yearPath, KINDS[kind]);
  const items = (await listIso(kindPath)) || [];
  const clean = safeName(name);
  if (!clean) throw new Error("กรุณาระบุชื่อโครงการ");
  const dup = items.find((it) => it.isFolder && it.name.replace(/^\d+-/, "").toLowerCase() === clean.toLowerCase());
  if (dup) throw new Error(`มีโครงการ "${dup.name}" อยู่แล้ว`);
  const maxNo = items.reduce((m, it) => Math.max(m, Number(it.name.match(/^(\d+)-/)?.[1] || 0)), 0);
  const path = joinPath(kindPath, `${pad2(maxNo + 1)}-${clean}`);
  for (const sub of kind === "presale" ? PRESALE_SUBFOLDERS : PROJECT_SUBFOLDERS) await createIsoFolder(joinPath(path, sub));
  return path;
}

/** เลื่อนโครงการจาก Presale → Project (ย้ายทั้งโฟลเดอร์พร้อมไฟล์ แล้วเติมโฟลเดอร์ที่ขาด) */
export async function promotePresale(presalePath) {
  const parts = presalePath.split("/");
  const name = parts.pop();
  const yearPath = parts.slice(0, -1).join("/");
  const targetKind = joinPath(yearPath, KINDS.project);
  await createIsoFolder(targetKind);
  const targets = (await listIso(targetKind)) || [];
  const maxNo = targets.reduce((m, it) => Math.max(m, Number(it.name.match(/^(\d+)-/)?.[1] || 0)), 0);
  const newName = `${pad2(maxNo + 1)}-${name.replace(/^\d+-/, "")}`;
  const id = await siteId();
  const item = await graphFetch(`/sites/${id}/drive/root:/${encodePath(joinPath(ISO_ROOT, presalePath))}`);
  const parent = await graphFetch(`/sites/${id}/drive/root:/${encodePath(joinPath(ISO_ROOT, targetKind))}`);
  await graphFetch(`/sites/${id}/drive/items/${item.id}`, {
    method: "PATCH",
    body: JSON.stringify({ parentReference: { id: parent.id }, name: newName }),
  });
  const newPath = joinPath(targetKind, newName);
  for (const sub of PROJECT_SUBFOLDERS) await createIsoFolder(joinPath(newPath, sub));
  return newPath;
}

export async function renameIsoItem(itemId, newName) {
  const id = await siteId();
  return graphFetch(`/sites/${id}/drive/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ name: safeName(newName) }) });
}

/** ลิงก์ดาวน์โหลดไฟล์ (ขอใหม่ทุกครั้ง — ลิงก์จาก SharePoint หมดอายุในราว 1 ชั่วโมง) */
export async function isoDownloadUrl(itemId) {
  const id = await siteId();
  const item = await graphFetch(`/sites/${id}/drive/items/${itemId}`);
  const url = item?.["@microsoft.graph.downloadUrl"];
  if (!url) throw new Error("ไม่พบลิงก์ดาวน์โหลดของไฟล์นี้");
  return url;
}

export const ZIP_LIMIT_BYTES = 2 * 1024 * 1024 * 1024; // ZIP ในเบราว์เซอร์ — ใหญ่กว่านี้ให้ดาวน์โหลดจาก SharePoint

/** ไฟล์ทั้งหมดในโฟลเดอร์ (ทุกชั้น) → [{ id, path, size, modified, downloadUrl }] */
export async function listIsoTree(itemId) {
  const id = await siteId();
  const out = [];
  const walk = async (folderId, prefix) => {
    let next = `/sites/${id}/drive/items/${folderId}/children?$top=200`;
    while (next) {
      const res = await graphFetch(next);
      for (const it of res?.value || []) {
        if (/^(thumbs\.db|desktop\.ini|\.ds_store)$/i.test(it.name)) continue;
        if (it.folder) await walk(it.id, `${prefix}${it.name}/`);
        else if (it.file) out.push({ id: it.id, path: `${prefix}${it.name}`, size: it.size || 0, modified: it.lastModifiedDateTime || "", downloadUrl: it["@microsoft.graph.downloadUrl"] || "" });
      }
      next = res?.["@odata.nextLink"] || null;
    }
  };
  await walk(itemId, "");
  return out;
}

/** รวมไฟล์ในโฟลเดอร์เป็น ZIP (โครงสร้างโฟลเดอร์ย่อยครบ) — onProgress(n, total, name) */
export async function zipIsoFolder(itemId, folderName, onProgress, files = null) {
  files = files || await listIsoTree(itemId);
  if (!files.length) throw new Error("โฟลเดอร์นี้ยังไม่มีไฟล์");
  const entries = [];
  let n = 0;
  const queue = [...files];
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift();
      let resp = f.downloadUrl ? await fetch(f.downloadUrl).catch(() => null) : null;
      if (!resp || !resp.ok) resp = await fetch(await isoDownloadUrl(f.id)); // ลิงก์หมดอายุ → ขอใหม่
      if (!resp.ok) throw new Error(`ดาวน์โหลดไม่สำเร็จ (${resp.status}): ${f.path}`);
      entries.push({ name: `${folderName}/${f.path}`, data: new Uint8Array(await resp.arrayBuffer()), date: new Date(f.modified) });
      n += 1;
      onProgress?.(n, files.length, f.path);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
  entries.sort((a, b) => a.name.localeCompare(b.name, "th", { numeric: true }));
  return buildZip(entries);
}

export async function deleteIsoItem(itemId) {
  const id = await siteId();
  return graphFetch(`/sites/${id}/drive/items/${itemId}`, { method: "DELETE" });
}

/** อัปโหลดไฟล์หลายไฟล์เข้าโฟลเดอร์ (ชื่อซ้ำ = แทนที่ไฟล์เดิม — SharePoint เก็บเวอร์ชันเก่าไว้ให้) */
export async function uploadIsoFiles(path, files, onProgress) {
  const id = await siteId();
  const folder = joinPath(ISO_ROOT, path);
  await ensureDriveFolder(id, folder);
  let done = 0;
  for (const file of files) {
    await uploadDriveFile(id, folder, file);
    done += 1;
    onProgress?.(done, files.length, file.name);
  }
}

/** นำเข้า ZIP: แตกในเบราว์เซอร์ แล้วสร้างโฟลเดอร์/อัปโหลดไฟล์ตามโครงสร้างใน ZIP */
export async function importIsoZip(path, zipFile, onProgress) {
  const entries = await readZipEntries(zipFile);
  const skip = (n) => /(^|\/)(thumbs\.db|desktop\.ini|\.ds_store|__macosx\/.*)$/i.test(n);
  const files = entries.filter((e) => !e.isDir && !skip(e.name));
  const dirs = new Set(entries.filter((e) => e.isDir).map((e) => e.name.replace(/\/$/, "")));
  files.forEach((e) => { const d = e.name.split("/").slice(0, -1).join("/"); if (d) dirs.add(d); });
  const id = await siteId();
  const base = joinPath(ISO_ROOT, path);
  const sortedDirs = [...dirs].filter(Boolean).sort((a, b) => a.split("/").length - b.split("/").length);
  let step = 0;
  const total = sortedDirs.length + files.length;
  for (const d of sortedDirs) {
    await ensureDriveFolder(id, joinPath(base, d));
    onProgress?.(++step, total, d);
  }
  for (const e of files) {
    const parts = e.name.split("/");
    const fileName = parts.pop();
    const data = await e.read();
    await uploadDriveFile(id, joinPath(base, parts.join("/")), new File([data], fileName));
    onProgress?.(++step, total, e.name);
  }
  return { folders: sortedDirs.length, files: files.length };
}

/** ตรวจความครบถ้วนสำหรับ Audit: แต่ละโครงการ → ต่อโฟลเดอร์หลัก (00-Ref, 01-Document, 02–05)
 *  ใช้ขนาดรวมของโฟลเดอร์จาก SharePoint (รวมไฟล์ทุกชั้นข้างใน) — 1 ครั้งต่อโครงการ ไม่ต้องไล่ทุกโฟลเดอร์ย่อย */
export async function auditKindFolder(kindPath) {
  const kind = /Presale$/.test(kindPath) ? "presale" : "project";
  const cols = ["00-Ref", "01-Document", ...(kind === "presale" ? PRESALE_STAGES : PROJECT_STAGES)];
  const projects = ((await listIso(kindPath)) || []).filter((it) => it.isFolder);
  const rows = [];
  for (const project of projects) {
    const children = (await listIso(joinPath(kindPath, project.name))) || [];
    const cells = cols.map((col) => {
      const f = children.find((c) => c.isFolder && c.name === col);
      return f ? { size: f.size || 0 } : null;
    });
    rows.push({ name: project.name, cells });
  }
  return { kind, subs: cols, rows };
}

/** สร้างโฟลเดอร์ Drawing ในหมวด (path = .../<ขั้นแบบ>/<หมวด>) — ข้ามชื่อที่มีอยู่แล้ว */
export async function createDrawingFolders(path, drawings) {
  const existing = new Set(((await listIso(path)) || []).map((it) => it.name.toLowerCase()));
  let created = 0;
  for (const d of drawings) {
    const name = drawingFolderName(d.no, d.name);
    if (!name || existing.has(name.toLowerCase())) continue;
    await createIsoFolder(joinPath(path, name));
    existing.add(name.toLowerCase());
    created += 1;
  }
  return created;
}

// ══════════════════════════════════════════════════════════════
// จัดเก็บไฟล์งานอัตโนมัติ: ผู้จัดการ "อนุมัติ + ส่งมอบ" → คัดลอกไฟล์ที่ฝ่ายเขียนแบบส่ง
// (DrawingRequests/<เลขคำร้อง>/<Drawing>-<Rev>/) ไปที่
// ISO-DWG/8-Project/<ปี>/<1-Presale|2-Project>/<NN-โครงการ>/<ขั้นแบบ>/<หมวด>/<เลขDrawing-ชื่อDrawing>/
//  - ปี = ปีที่โครงการนี้มีคำร้องครั้งแรกในระบบ (โครงการเดียวอยู่ปีเดียว ตรวจ Audit ง่าย)
//  - ชื่อไฟล์ใส่ Rev ต่อท้าย · ฉบับเก่าในโฟลเดอร์ Drawing ย้ายเข้า _Superseded
//  - คัดลอกภายใน SharePoint (ไม่ดาวน์โหลดลงเครื่อง) · ไฟล์ต้นฉบับในโฟลเดอร์คำร้องยังอยู่ครบ
// ══════════════════════════════════════════════════════════════

const STAGE_OF_TYPE = [
  [/Proposal/i, "02-DWG Concept design"],
  [/ขออนุญาต/, "03-DWG Permission"],
  [/As-?Built/i, "05-DWG As-built"],
  [/ก่อสร้าง/, "04-DWG Construction"],
];
export const stageOfRequestType = (type) => STAGE_OF_TYPE.find(([re]) => re.test(String(type || "")))?.[1] || null;
// คีย์เทียบชื่อโครงการ: ผ่าน safeName เหมือนตอนตั้งชื่อโฟลเดอร์ (ชื่อที่มีจุดท้าย/อักขระต้องห้ามจะจับคู่โฟลเดอร์เดิมได้)
const keyOf = (name) => safeName(name, 80).toLowerCase();
const folderKeyOf = (folderName) => keyOf(String(folderName || "").replace(/^\d+-/, ""));


// ── บริบทการจัดเก็บ (ใช้ซ้ำทั้งรอบ): จำ id โฟลเดอร์ที่มี/สร้างแล้ว + รายชื่อโครงการ → เรียก SharePoint น้อยลงมาก ──
export function createFilingContext(allRequests = []) {
  const firstYear = new Map();
  allRequests.forEach((r) => {
    if (!r.projectName || !r.submittedAt) return;
    const k = keyOf(r.projectName);
    const y = new Date(r.submittedAt).getFullYear();
    if (y && (!firstYear.has(k) || y < firstYear.get(k))) firstYear.set(k, y);
  });
  return { folders: new Map(), kindLists: new Map(), projects: new Map(), locks: new Map(), firstYear, driveId: null };
}

/** id ของโฟลเดอร์ (path เต็มจากรากไดรฟ์) — มีแล้วใช้เลย ไม่มีค่อยสร้าง · จำผลไว้ (รวมระหว่างทำพร้อมกันหลายงาน) */
function folderId(ctx, path) {
  if (ctx.folders.has(path)) return ctx.folders.get(path);
  const promise = (async () => {
    const id = await siteId();
    const parts = path.split("/");
    const name = parts.pop();
    const parentId = parts.length ? await folderId(ctx, parts.join("/")) : "root";
    try {
      const it = await graphFetch(`/sites/${id}/drive/items/${parentId}:/${encodeURIComponent(name)}?$select=id`);
      return it.id;
    } catch (error) {
      if (!/404|itemNotFound/i.test(String(error.message))) throw error;
    }
    try {
      const created = await graphFetch(`/sites/${id}/drive/items/${parentId}/children`, {
        method: "POST",
        body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
      });
      return created.id;
    } catch (error) {
      if (!/409|nameAlreadyExists/i.test(String(error.message))) throw error;
      const it = await graphFetch(`/sites/${id}/drive/items/${parentId}:/${encodeURIComponent(name)}?$select=id`);
      return it.id;
    }
  })();
  ctx.folders.set(path, promise);
  promise.catch(() => ctx.folders.delete(path));
  return promise;
}

/** ทำทีละงานต่อ key (กันเลขลำดับโครงการชนกันตอนทำพร้อมกัน) */
function withLock(ctx, key, fn) {
  const prev = ctx.locks.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  ctx.locks.set(key, next);
  return next;
}

/** หา/สร้างโฟลเดอร์โครงการใน ISO (ชื่อตรงกันโดยไม่สนเลขนำหน้า/ช่องว่าง/ตัวพิมพ์) */
export async function ensureIsoProject(projectName, kind, year, ctx = createFilingContext()) {
  const cacheKey = `${kind}|${year}|${keyOf(projectName)}`;
  if (ctx.projects.has(cacheKey)) return ctx.projects.get(cacheKey);
  const job = (async () => {
    const yearPath = await withLock(ctx, `year|${year}`, async () => {
      if (!ctx.projects.has(`year|${year}`)) ctx.projects.set(`year|${year}`, ensureYearFolder(year));
      return ctx.projects.get(`year|${year}`);
    });
    const kindPath = joinPath(yearPath, KINDS[kind]);
    return withLock(ctx, kindPath, async () => {
      if (!ctx.kindLists.has(kindPath)) ctx.kindLists.set(kindPath, ((await listIso(kindPath)) || []).filter((it) => it.isFolder).map((it) => it.name));
      const names = ctx.kindLists.get(kindPath);
      const found = names.find((n) => folderKeyOf(n) === keyOf(projectName));
      if (found) return joinPath(kindPath, found);
      const maxNo = names.reduce((m, n) => Math.max(m, Number(n.match(/^(\d+)-/)?.[1] || 0)), 0);
      const clean = safeName(projectName, 80);
      if (!clean) throw new Error(`ชื่อโครงการใช้ตั้งชื่อโฟลเดอร์ไม่ได้: "${projectName}"`);
      const name = `${pad2(maxNo + 1)}-${clean}`;
      names.push(name);
      const path = joinPath(kindPath, name);
      const subs = kind === "presale" ? PRESALE_SUBFOLDERS : PROJECT_SUBFOLDERS;
      for (const sub of subs) await folderId(ctx, joinPath(ISO_ROOT, path, sub));
      return path;
    });
  })();
  ctx.projects.set(cacheKey, job);
  job.catch(() => ctx.projects.delete(cacheKey));
  return job;
}

const revOf = (v) => String(v || "0").replace(/^rev\.?\s*/i, "").replace(/^r(?=\d)/i, "").replace(/[\\/:*?"<>|#%]+/g, "").trim() || "0";

/** ตำแหน่งในโฟลเดอร์ ISO ที่คำร้องนี้จัดเก็บ (ไม่รวมปี/Presale-Project) — ใช้ทั้งตอนจัดเก็บและตอนหาคำร้องจากไฟล์ */
export function isoTargetOf(request) {
  const stage = stageOfRequestType(request.requestType);
  if (!stage || !request.projectName) return null;
  const kind = /Proposal/i.test(request.requestType) ? "presale" : "project";
  const category = disciplineOfCategory(request.drawingCategory);
  const catFolder = stage === PERMIT_STAGE || !PERMIT_FOLDERS.some((f) => f.name === category) ? category : "GE";
  const drawingName = drawingFolderName(request.drawingNo || (kind === "presale" ? "Proposal" : request.requestNo), request.drawingName);
  return { stage, catFolder, drawingName, projectKey: keyOf(request.projectName), rev: revOf(request.currentRevise || request.reviseNumber) };
}

/** ดัชนี "โครงการ|ขั้นแบบ|หมวด|Drawing" → คำร้อง (ไม่รวมที่ยกเลิก) สำหรับแสดงเลขคำร้องข้างไฟล์ในเอกสาร ISO */
export function buildIsoRequestIndex(requests = []) {
  const index = new Map();
  requests.forEach((r) => {
    if (r.status === "cancelled") return;
    const t = isoTargetOf(r);
    if (!t) return;
    const key = [t.projectKey, t.stage, t.catFolder.toLowerCase(), t.drawingName.toLowerCase()].join("|");
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ request: r, rev: t.rev });
  });
  index.forEach((list) => list.sort((a, b) => String(b.request.submittedAt || "").localeCompare(String(a.request.submittedAt || ""))));
  return index;
}

/**
 * คำร้องของไฟล์/โฟลเดอร์ Drawing ในเอกสาร ISO
 * @param {string} folderPath path ของโฟลเดอร์ที่รายการอยู่ (นับจาก ISO_ROOT)
 * @param {string} name ชื่อไฟล์หรือโฟลเดอร์
 * @param {boolean} isFolder
 */
export function requestsForIsoItem(index, folderPath, name, isFolder) {
  if (!index || !index.size) return [];
  const parts = [...String(folderPath || "").split("/").filter(Boolean), ...(isFolder ? [name] : [])];
  // 8-Project / 1-Project ปี yyyy / 1-Presale|2-Project / โครงการ / ขั้นแบบ / หมวด / Drawing [/ _Superseded]
  if (parts.length < 7 || parts[0] !== PROJECT_FOLDER) return [];
  if (isFolder && parts.length !== 7) return [];
  const key = [folderKeyOf(parts[3]), parts[4], parts[5].toLowerCase(), parts[6].toLowerCase()].join("|");
  const list = index.get(key) || [];
  if (isFolder || list.length <= 1) return list.map((x) => x.request);
  const m = String(name).match(/_Rev\.?([^_.]+)(?:\.[^.]*)?$/i);
  const sameRev = m ? list.filter((x) => x.rev.toLowerCase() === revOf(m[1]).toLowerCase()) : [];
  return (sameRev.length ? sameRev : list).map((x) => x.request);
}

/**
 * คัดลอกไฟล์งานของคำร้องที่ส่งมอบแล้วไปเก็บในโฟลเดอร์ ISO — คืน { path, copied, superseded, already } หรือ { skipped }
 * @param {object} request คำร้อง (ต้องมี requestNo, projectName, requestType, drawingNo/drawingName, drawingCategory)
 * @param {Array} allRequests ใช้หาปีที่โครงการเริ่ม
 * @param {object} [ctx] บริบทจาก createFilingContext() — ส่งตัวเดียวกันเมื่อจัดเก็บหลายงาน (เร็วขึ้นมาก)
 */
export async function fileDeliveryToIso(request, allRequests = [], ctx = null) {
  ctx = ctx || createFilingContext(allRequests);
  const stage = stageOfRequestType(request.requestType);
  if (!stage || !request.projectName) return { skipped: "ประเภทงานนี้ไม่มีโฟลเดอร์ขั้นแบบ" };
  const kind = /Proposal/i.test(request.requestType) ? "presale" : "project";
  const year = ctx.firstYear.get(keyOf(request.projectName)) || new Date(request.submittedAt || Date.now()).getFullYear() || new Date().getFullYear();

  // ไฟล์ที่ฝ่ายเขียนแบบส่ง: (1) โฟลเดอร์ย่อยล่าสุดในโฟลเดอร์คำร้อง (อัปโหลดผ่านระบบ)
  //                       (2) ถ้าไม่มี — ตามลิงก์ SharePoint/OneDrive ที่แนบตอนส่งงาน (DWG / PDF / ไฟล์อื่น)
  const id = await siteId();
  const reqFolder = requestFolderPath(request.requestNo);
  const children = await graphFetch(`/sites/${id}/drive/root:/${encodePath(reqFolder)}:/children?$top=200&$select=id,name,folder,lastModifiedDateTime`).then((r) => r?.value || []).catch(() => []);
  const prefix = String(request.drawingNo || "").replace(/["*:<>?/\\|,().]/g, "").trim().toLowerCase();
  const workFolders = children.filter((c) => c.folder && !/^Rev\.\d+$/i.test(c.name) && (!prefix || c.name.toLowerCase().startsWith(prefix)))
    .sort((a, b) => String(b.lastModifiedDateTime).localeCompare(String(a.lastModifiedDateTime)));
  const work = workFolders[0];
  let files = [];
  if (work) {
    files = await graphFetch(`/sites/${id}/drive/items/${work.id}/children?$top=200&$select=id,name,file,size,parentReference`)
      .then((r) => (r?.value || []).filter((f) => f.file).map((f) => ({ id: f.id, driveId: f.parentReference?.driveId, name: f.name, size: f.size })))
      .catch(() => []);
  }
  if (!files.length) files = await filesFromLinks(sentLinks(request));
  if (!files.length) {
    const links = sentLinks(request);
    return { skipped: links.length ? "ลิงก์ที่แนบเปิดไม่ได้/ไม่ใช่ SharePoint-OneDrive ขององค์กร" : "ไม่มีไฟล์หรือลิงก์งานที่ฝ่ายเขียนแบบส่ง" };
  }
  const rev = revOf(request.currentRevise || request.reviseNumber || work?.name.split("-").pop());

  const projectPath = await ensureIsoProject(request.projectName, kind, year, ctx);
  const { catFolder, drawingName } = isoTargetOf(request);
  const drawingPath = joinPath(projectPath, stage, catFolder, drawingName);
  const targetId = await folderId(ctx, joinPath(ISO_ROOT, drawingPath));
  if (!ctx.driveId) ctx.driveId = (await graphFetch(`/sites/${id}/drive?$select=id`)).id;
  const newNames = files.map((f) => {
    const dot = f.name.lastIndexOf(".");
    const base = dot > 0 ? f.name.slice(0, dot) : f.name;
    const ext = dot > 0 ? f.name.slice(dot) : "";
    return /_Rev[^_]*$/i.test(base) ? f.name : `${base}_Rev.${rev}${ext}`;
  });

  const existing = await graphFetch(`/sites/${id}/drive/items/${targetId}/children?$top=200&$select=id,name,file,size`).then((r) => r?.value || []).catch(() => []);
  // จัดเก็บไปแล้ว (ชื่อ + ขนาดตรงกันครบ) → ข้าม ไม่คัดลอกซ้ำ
  const existingByName = new Map(existing.filter((f) => f.file).map((f) => [f.name, f]));
  if (newNames.every((n, i) => existingByName.has(n) && (!files[i].size || existingByName.get(n).size === files[i].size))) {
    return { path: drawingPath, copied: 0, superseded: 0, already: true };
  }

  // ฉบับเก่า (ไฟล์ที่ไม่ใช่ชุดนี้) → _Superseded
  const oldFiles = existing.filter((f) => f.file && !newNames.includes(f.name));
  let superseded = 0;
  if (oldFiles.length) {
    const supId = await folderId(ctx, joinPath(ISO_ROOT, drawingPath, "_Superseded"));
    for (const f of oldFiles) {
      await graphFetch(`/sites/${id}/drive/items/${f.id}?@microsoft.graph.conflictBehavior=rename`, {
        method: "PATCH",
        body: JSON.stringify({ parentReference: { id: supId } }),
      }).then(() => { superseded += 1; }).catch((e) => console.warn("ย้ายฉบับเก่าไม่สำเร็จ:", f.name, e.message));
    }
  }

  // คัดลอก (SharePoint ทำงานเบื้องหลัง — ตอบ 202 ไม่มีเนื้อหา)
  let copied = 0;
  for (let i = 0; i < files.length; i += 1) {
    const srcPath = files[i].driveId ? `/drives/${files[i].driveId}/items/${files[i].id}` : `/sites/${id}/drive/items/${files[i].id}`;
    await graphFetch(`${srcPath}/copy?@microsoft.graph.conflictBehavior=replace`, {
      method: "POST",
      body: JSON.stringify({ parentReference: { driveId: ctx.driveId, id: targetId }, name: newNames[i] }),
    }).catch((e) => { if (!(e instanceof SyntaxError)) throw e; });
    copied += 1;
  }
  return { path: drawingPath, copied, superseded };
}

/** ลิงก์ไฟล์งานที่ฝ่ายเขียนแบบแนบตอนส่งงาน (DWG, PDF, ไฟล์อื่นใน noteFromDrawing หลัง |||) */
function sentLinks(request) {
  const links = [request.dwgFileUrl, request.pdfFileUrl];
  const raw = String(request.noteFromDrawing || "");
  const sep = raw.indexOf("|||");
  if (sep >= 0) {
    try { JSON.parse(raw.slice(sep + 3)).forEach((f) => links.push(f.url)); } catch (_) { /* ไม่ใช่ JSON */ }
  }
  return [...new Set(links.map((u) => String(u || "").trim()).filter((u) => /^https:\/\//i.test(u)))];
}

/** ลิงก์ SharePoint/OneDrive → ไฟล์ (ลิงก์โฟลเดอร์ = ไฟล์ทุกไฟล์ในโฟลเดอร์นั้นชั้นเดียว) ผ่าน Graph shares API */
async function filesFromLinks(urls) {
  const out = [];
  for (const url of urls) {
    if (!/sharepoint\.com|1drv\.ms|onedrive\.live\.com/i.test(url)) continue;
    const token = "u!" + btoa(unescape(encodeURIComponent(url))).replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
    try {
      const item = await graphFetch(`/shares/${token}/driveItem`);
      const driveId = item?.parentReference?.driveId;
      if (item?.file) out.push({ id: item.id, driveId, name: item.name });
      else if (item?.folder && driveId) {
        const kids = await graphFetch(`/drives/${driveId}/items/${item.id}/children?$top=200`);
        (kids?.value || []).filter((f) => f.file).forEach((f) => out.push({ id: f.id, driveId, name: f.name }));
      }
    } catch (error) {
      console.warn("เปิดลิงก์ไฟล์งานไม่ได้:", url, error.message);
    }
  }
  const seen = new Set();
  return out.filter((f) => !seen.has(f.id) && seen.add(f.id));
}

/** สร้างโฟลเดอร์ ISO ให้ทุกโครงการที่มีคำร้องในระบบ (แม้ยังไม่มีไฟล์) — ปี = ปีที่มีคำร้องแรก · มีแต่ Proposal = Presale */
export async function ensureAllProjectFolders(requests, onProgress, ctx = createFilingContext(requests)) {
  const groups = new Map();
  requests.filter((r) => !r.legacy && r.projectName && stageOfRequestType(r.requestType)).forEach((r) => {
    const k = keyOf(r.projectName);
    const g = groups.get(k) || { name: r.projectName.trim(), first: r.submittedAt || "", project: false };
    if (r.submittedAt && (!g.first || r.submittedAt < g.first)) g.first = r.submittedAt;
    if (!/Proposal/i.test(r.requestType)) g.project = true;
    groups.set(k, g);
  });
  let i = 0;
  const failures = [];
  for (const g of groups.values()) {
    onProgress?.(++i, groups.size, g.name);
    const year = new Date(g.first || Date.now()).getFullYear() || new Date().getFullYear();
    try {
      await ensureIsoProject(g.name, g.project ? "project" : "presale", year, ctx);
    } catch (error) {
      failures.push({ name: g.name, error: error.message });
    }
  }
  return { count: groups.size, failures };
}

/** ค้นหาไฟล์/โฟลเดอร์ใต้โฟลเดอร์ (path นับจาก ISO_ROOT) ทุกชั้น ด้วย SharePoint search — คืนสูงสุด 200 รายการ พร้อม path ที่อยู่ */
export async function searchIso(path, query) {
  const id = await siteId();
  const full = encodePath(joinPath(ISO_ROOT, path));
  const q = encodeURIComponent(String(query).replace(/'/g, "''"));
  const res = await graphFetch(`/sites/${id}/drive/root:/${full}:/search(q='${q}')?$top=200&$select=id,name,size,folder,file,webUrl,lastModifiedDateTime,lastModifiedBy,parentReference`);
  const rootMarker = `root:/${ISO_ROOT}`;
  return (res?.value || [])
    .map((it) => {
      const parent = decodeURIComponent(String(it.parentReference?.path || ""));
      const at = parent.indexOf(rootMarker);
      if (at < 0) return null; // อยู่นอกโฟลเดอร์เอกสาร ISO
      const rel = parent.slice(at + rootMarker.length).replace(/^\/+/, "");
      return {
        id: it.id,
        name: it.name,
        isFolder: Boolean(it.folder),
        childCount: it.folder?.childCount ?? 0,
        size: it.size || 0,
        webUrl: it.webUrl || "",
        downloadUrl: "",
        modified: it.lastModifiedDateTime || "",
        modifiedBy: it.lastModifiedBy?.user?.displayName || "",
        path: rel,
      };
    })
    .filter((it) => it && !/^(thumbs\.db|desktop\.ini)$/i.test(it.name) && it.name.toLowerCase().includes(String(query).toLowerCase()))
    .sort((a, b) => (Number(b.isFolder) - Number(a.isFolder)) || a.path.localeCompare(b.path, "th", { numeric: true }) || a.name.localeCompare(b.name, "th", { numeric: true }));
}
