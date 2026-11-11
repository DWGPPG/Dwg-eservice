// ══════════════════════════════════════════════════════════════
// เอกสาร ISO ฝ่ายเขียนแบบ — เก็บใน SharePoint ฝ่ายเขียนแบบ: Documents/ISO-DWG/
//  โครงสร้างตามแฟ้ม ISO เดิม (1-SP … 8-Project) + 8-Project แยกตามปี → Presale / Project → โครงการ
//  ดูได้จากเมนูคู่มือ (ฝ่ายเขียนแบบ/ผู้จัดการ) · แก้ไข/อัปโหลดได้ที่หน้าจัดการข้อมูล (ผู้จัดการ)
// ══════════════════════════════════════════════════════════════

import { ensureDriveFolder, graphFetch, uploadDriveFile } from "../graph.js";
import { ensureSite } from "../sharepoint.js";
import { readZipEntries } from "./xlsx-reader.js";

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

// โฟลเดอร์มาตรฐานในแต่ละโครงการ (ตามแฟ้มเดิม) — Presale มีแค่ขั้นเสนอแบบ
export const PROJECT_SUBFOLDERS = [
  "00-Ref",
  "01-Document/1-RFD/1-รับมา",
  "01-Document/1-RFD/2-ส่งออก",
  "02-DWG Concept design",
  "03-DWG Permission",
  "04-DWG Construction",
  "05-DWG As-built",
];
export const PRESALE_SUBFOLDERS = [
  "00-Ref",
  "01-Document/1-RFD/1-รับมา",
  "01-Document/1-RFD/2-ส่งออก",
  "02-DWG Concept design",
];
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

/** ตรวจความครบถ้วนสำหรับ Audit: แต่ละโครงการในโฟลเดอร์ Presale/Project มีไฟล์ในโฟลเดอร์มาตรฐานกี่ไฟล์ */
export async function auditKindFolder(kindPath) {
  const kind = /Presale$/.test(kindPath) ? "presale" : "project";
  const subs = kind === "presale" ? PRESALE_SUBFOLDERS : PROJECT_SUBFOLDERS;
  const projects = ((await listIso(kindPath)) || []).filter((it) => it.isFolder);
  const rows = [];
  for (const project of projects) {
    const counts = [];
    for (const sub of subs) {
      const items = await listIso(joinPath(kindPath, project.name, sub));
      counts.push(items === null ? null : items.filter((it) => !it.isFolder).length);
    }
    rows.push({ name: project.name, counts });
  }
  return { kind, subs, rows };
}
