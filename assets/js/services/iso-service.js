// ══════════════════════════════════════════════════════════════
// เอกสาร ISO ฝ่ายเขียนแบบ — เก็บใน SharePoint ฝ่ายเขียนแบบ: Documents/ISO-DWG/
//  โครงสร้างตามแฟ้ม ISO เดิม (1-SP … 8-Project) + 8-Project แยกตามปี → Presale / Project → โครงการ
//  ดูได้จากเมนูคู่มือ (ฝ่ายเขียนแบบ/ผู้จัดการ) · แก้ไข/อัปโหลดได้ที่หน้าจัดการข้อมูล (ผู้จัดการ)
// ══════════════════════════════════════════════════════════════

import { ensureDriveFolder, graphFetch, uploadDriveFile } from "../graph.js";
import { ensureSite } from "../sharepoint.js";
import { readZipEntries } from "./xlsx-reader.js";
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
export const drawingFolderName = (no, name) => safeName([no, name].filter((v) => String(v || "").trim()).join("-")).slice(0, 150);
export const KINDS = { presale: "1-Presale", project: "2-Project" };

const yearFolderRe = (year) => new RegExp(`(^|-)\\s*Project ปี ${year}$`);
const pad2 = (n) => String(n).padStart(2, "0");
export const joinPath = (...parts) => parts.filter(Boolean).join("/").replace(/\/+/g, "/");
const encodePath = (path) => path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
export const safeName = (name) => String(name || "").replace(/[\\/:*?"<>|#%]+/g, " ").replace(/\s+/g, " ").trim();

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
const keyOf = (name) => String(name || "").replace(/^\d+-/, "").normalize("NFC").replace(/[\s ​]+/g, " ").trim().toLowerCase();

async function itemByPath(fullPath) {
  const id = await siteId();
  return graphFetch(`/sites/${id}/drive/root:/${encodePath(fullPath)}`);
}

/** หา/สร้างโฟลเดอร์โครงการใน ISO (ชื่อตรงกันโดยไม่สนเลขนำหน้า/ช่องว่าง/ตัวพิมพ์) */
export async function ensureIsoProject(projectName, kind, year) {
  const yearPath = await ensureYearFolder(year);
  const kindPath = joinPath(yearPath, KINDS[kind]);
  const items = (await listIso(kindPath)) || [];
  const found = items.find((it) => it.isFolder && keyOf(it.name) === keyOf(projectName));
  if (found) return joinPath(kindPath, found.name);
  return createProjectFolder({ year, kind, name: projectName });
}

/**
 * คัดลอกไฟล์งานของคำร้องที่ส่งมอบแล้วไปเก็บในโฟลเดอร์ ISO — คืน { path, copied, superseded } หรือ { skipped }
 * @param {object} request คำร้อง (ต้องมี requestNo, projectName, requestType, drawingNo/drawingName, drawingCategory)
 * @param {Array} allRequests ใช้หาปีที่โครงการเริ่ม
 */
export async function fileDeliveryToIso(request, allRequests = []) {
  const stage = stageOfRequestType(request.requestType);
  if (!stage || !request.projectName) return { skipped: "ประเภทงานนี้ไม่มีโฟลเดอร์ขั้นแบบ" };
  const kind = /Proposal/i.test(request.requestType) ? "presale" : "project";
  const projectReqs = allRequests.filter((r) => keyOf(r.projectName) === keyOf(request.projectName) && r.submittedAt);
  const firstAt = projectReqs.map((r) => r.submittedAt).sort()[0] || request.submittedAt || new Date().toISOString();
  const year = new Date(firstAt).getFullYear() || new Date().getFullYear();

  // ไฟล์ที่ฝ่ายเขียนแบบส่ง: โฟลเดอร์ย่อยล่าสุดในโฟลเดอร์คำร้อง (ชื่อขึ้นต้นด้วยเลข Drawing) — ไม่มีก็ข้าม
  const reqFolder = requestFolderPath(request.requestNo);
  const id = await siteId();
  const children = await graphFetch(`/sites/${id}/drive/root:/${encodePath(reqFolder)}:/children?$top=200`).then((r) => r?.value || []).catch(() => []);
  const prefix = String(request.drawingNo || "").replace(/["*:<>?/\\|,().]/g, "").trim().toLowerCase();
  const workFolders = children.filter((c) => c.folder && (!prefix || c.name.toLowerCase().startsWith(prefix)))
    .sort((a, b) => String(b.lastModifiedDateTime).localeCompare(String(a.lastModifiedDateTime)));
  const work = workFolders[0];
  if (!work) return { skipped: "ไม่พบไฟล์งานที่ฝ่ายเขียนแบบส่ง" };
  const files = await graphFetch(`/sites/${id}/drive/items/${work.id}/children?$top=200`).then((r) => (r?.value || []).filter((f) => f.file)).catch(() => []);
  if (!files.length) return { skipped: "โฟลเดอร์งานไม่มีไฟล์" };
  const rev = String(request.currentRevise || request.reviseNumber || work.name.split("-").pop() || "0").replace(/^rev\.?\s*/i, "").replace(/^r(?=\d)/i, "").replace(/[\\/:*?"<>|#%]+/g, "") || "0";

  const projectPath = await ensureIsoProject(request.projectName, kind, year);
  const category = disciplineOfCategory(request.drawingCategory);
  const catFolder = stage === PERMIT_STAGE || !PERMIT_FOLDERS.some((f) => f.name === category) ? category : "GE";
  const drawingName = drawingFolderName(request.drawingNo || (kind === "presale" ? "Proposal" : request.requestNo), request.drawingName);
  const drawingPath = joinPath(projectPath, stage, catFolder, drawingName);
  await createIsoFolder(drawingPath);

  const target = await itemByPath(joinPath(ISO_ROOT, drawingPath));
  const driveId = target.parentReference?.driveId;
  const newNames = files.map((f) => {
    const dot = f.name.lastIndexOf(".");
    const base = dot > 0 ? f.name.slice(0, dot) : f.name;
    const ext = dot > 0 ? f.name.slice(dot) : "";
    return /_Rev[^_]*$/i.test(base) ? f.name : `${base}_Rev.${rev}${ext}`;
  });

  // ฉบับเก่า (ไฟล์ที่ไม่ใช่ชุดนี้) → _Superseded
  const existing = await graphFetch(`/sites/${id}/drive/items/${target.id}/children?$top=200`).then((r) => r?.value || []).catch(() => []);
  const oldFiles = existing.filter((f) => f.file && !newNames.includes(f.name));
  let superseded = 0;
  if (oldFiles.length) {
    const sup = await createIsoFolder(joinPath(drawingPath, "_Superseded")).catch(() => null);
    const supItem = sup?.id ? sup : await itemByPath(joinPath(ISO_ROOT, drawingPath, "_Superseded"));
    for (const f of oldFiles) {
      await graphFetch(`/sites/${id}/drive/items/${f.id}?@microsoft.graph.conflictBehavior=rename`, {
        method: "PATCH",
        body: JSON.stringify({ parentReference: { id: supItem.id } }),
      }).then(() => { superseded += 1; }).catch((e) => console.warn("ย้ายฉบับเก่าไม่สำเร็จ:", f.name, e.message));
    }
  }

  // คัดลอก (SharePoint ทำงานเบื้องหลัง — ตอบ 202 ไม่มีเนื้อหา)
  let copied = 0;
  for (let i = 0; i < files.length; i += 1) {
    await graphFetch(`/sites/${id}/drive/items/${files[i].id}/copy?@microsoft.graph.conflictBehavior=replace`, {
      method: "POST",
      body: JSON.stringify({ parentReference: { driveId, id: target.id }, name: newNames[i] }),
    }).catch((e) => { if (!(e instanceof SyntaxError)) throw e; });
    copied += 1;
  }
  return { path: drawingPath, copied, superseded };
}
