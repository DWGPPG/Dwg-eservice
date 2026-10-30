import { appConfig } from "../../../config/config.js";
import { graphFetch } from "../graph.js";
import { ensureSite } from "../sharepoint.js";
import { escapeHtml } from "../utils.js";
import { requestFolderPath } from "./drawing-service.js";

// ══════════════════════════════════════════════════════════════
// ไฟล์ / ลิงก์ / โฟลเดอร์ของคำร้อง — แยก 2 ฝั่ง
//   📤 จากผู้ส่งคำขอ   : โฟลเดอร์คำร้อง + ไฟล์ที่อัปโหลดตอนส่งคำร้อง (อ่านชื่อจากโฟลเดอร์ใน SharePoint) + ลิงก์แนบ
//   📐 จากฝ่ายเขียนแบบ : ไฟล์ที่แนบตอนกด "ส่งงาน" (DWG / PDF / อื่นๆ ทุกไฟล์ พร้อมชื่อ) + โฟลเดอร์งานที่ส่ง
// ══════════════════════════════════════════════════════════════

/** URL โฟลเดอร์คำร้องบน SharePoint (Revision ซ้อนใต้คำขอเดิม: .../DWG-XXX-0001/Rev.01) */
export function requestFolderUrl(requestNo) {
  const sp = appConfig.sharePoint;
  const path = requestFolderPath(requestNo);
  return `https://${sp.hostname}${sp.sitePath}/Shared%20Documents/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** แยกหมายเหตุ กับรายการไฟล์อื่นๆ ที่ sendwork ต่อท้ายไว้ในรูป "<หมายเหตุ>|||[{name,url}]" */
export function parseNoteAndFiles(raw = "") {
  const sep = String(raw).indexOf("|||");
  if (sep === -1) return { note: raw, otherFiles: [] };
  try {
    const otherFiles = JSON.parse(raw.slice(sep + 3).trim());
    return { note: raw.slice(0, sep).trim(), otherFiles: Array.isArray(otherFiles) ? otherFiles : [] };
  } catch {
    return { note: raw, otherFiles: [] };
  }
}

/** ชื่อไฟล์จาก URL (ส่วนท้ายของ path) — ถ้าไม่มีนามสกุลไฟล์ (เช่นลิงก์แชร์) ใช้ fallback */
export function fileNameFromUrl(url, fallback = "ไฟล์") {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "");
    return /\.[a-z0-9]{2,5}$/i.test(last) ? last : fallback;
  } catch {
    return fallback;
  }
}

/** ลิงก์ทั้งหมดในช่อง "ลิงก์แนบ" (เป็นข้อความหลายบรรทัด ใส่ได้หลายลิงก์) */
export function extractLinks(text = "") {
  const found = String(text).match(/https?:\/\/[^\s<>"']+/g) || [];
  return [...new Set(found.map((u) => u.replace(/[),.;]+$/, "")))];
}

const fileIcon = (name = "") => {
  const ext = name.split(".").pop().toLowerCase();
  if (ext === "pdf") return { icon: "📄", cls: "pdf-btn" };
  if (["dwg", "dxf"].includes(ext)) return { icon: "📐", cls: "dwg-btn" };
  if (["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)) return { icon: "🖼️", cls: "other-btn" };
  if (["zip", "rar", "7z"].includes(ext)) return { icon: "🗜️", cls: "other-btn" };
  return { icon: "📎", cls: "other-btn" };
};

/** ไฟล์ทั้งหมดที่ฝ่ายเขียนแบบแนบตอนส่งงาน (ไม่ซ้ำ URL) + โฟลเดอร์งานที่ส่ง */
export function drawingDeptFiles(item) {
  const files = [];
  const seen = new Set();
  const add = (url, name) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    files.push({ url, name });
  };
  add(item.dwgFileUrl, fileNameFromUrl(item.dwgFileUrl, "ไฟล์ DWG"));
  add(item.pdfFileUrl, fileNameFromUrl(item.pdfFileUrl, "ไฟล์ PDF"));
  parseNoteAndFiles(item.noteFromDrawing || "").otherFiles.forEach((f) => add(f.url, f.name || fileNameFromUrl(f.url, "ไฟล์แนบ")));

  // โฟลเดอร์งานที่ส่ง = โฟลเดอร์ของไฟล์ที่อยู่ใต้โฟลเดอร์คำร้อง (เช่น .../DWG-XXX-0001/E001-SLD-R1/)
  const base = requestFolderUrl(item.requestNo).toLowerCase();
  const inRequestFolder = files.map((f) => f.url).find((u) => u.toLowerCase().startsWith(`${base}/`));
  const folderUrl = inRequestFolder ? inRequestFolder.slice(0, inRequestFolder.lastIndexOf("/")) : "";
  return { files, folderUrl };
}

// ── ชื่อไฟล์ที่ผู้ร้องขออัปโหลด: อ่านจากโฟลเดอร์คำร้อง (ไม่ได้เก็บไว้ในรายการคำร้อง) ──
// cache ต่อเลขคำร้องตลอด session — หน้าถูกวาดใหม่ทุกครั้งที่ polling เจอข้อมูลใหม่ จะได้ไม่ยิง Graph ซ้ำ
const requesterFileCache = new Map(); // requestNo → { files } | Promise

export function requesterFilesCached(requestNo) {
  const hit = requesterFileCache.get(requestNo);
  return hit && !(hit instanceof Promise) ? hit.files : null;
}

export function loadRequesterFiles(requestNo) {
  const hit = requesterFileCache.get(requestNo);
  if (hit) return hit instanceof Promise ? hit : Promise.resolve(hit.files);
  const promise = (async () => {
    try {
      const siteId = await ensureSite();
      const path = requestFolderPath(requestNo).split("/").map(encodeURIComponent).join("/");
      const res = await graphFetch(`/sites/${siteId}/drive/root:/${path}:/children?$select=name,webUrl,file&$top=200`);
      return (res?.value || [])
        .filter((entry) => entry.file) // เฉพาะไฟล์ — ข้ามโฟลเดอร์งานที่ส่ง / Rev.xx
        .map((entry) => ({ name: entry.name, url: entry.webUrl }))
        .sort((a, b) => a.name.localeCompare(b.name, "th", { numeric: true }));
    } catch (error) {
      // 404 = ยังไม่มีโฟลเดอร์/ไม่มีไฟล์ — ไม่ใช่ error ที่ต้องแจ้งผู้ใช้
      if (!String(error.message).includes("404")) console.warn(`อ่านไฟล์ของ ${requestNo} ไม่สำเร็จ:`, error.message);
      return [];
    }
  })().then((files) => {
    requesterFileCache.set(requestNo, { files });
    return files;
  });
  requesterFileCache.set(requestNo, promise);
  return promise;
}

/** ล้าง cache ของคำร้อง (เช่นหลังผู้ร้องขอส่ง revision พร้อมไฟล์ใหม่) */
export function forgetRequesterFiles(requestNo) {
  requesterFileCache.delete(requestNo);
}

// ══════════════════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════════════════

function fileChip(file, maxLen) {
  const { icon, cls } = fileIcon(file.name);
  const short = file.name.length > maxLen ? `${file.name.slice(0, maxLen - 1)}…` : file.name;
  return `<a href="${escapeHtml(file.url)}" target="_blank" rel="noopener noreferrer" class="mgr-file-btn ${cls} file-chip-named" title="${escapeHtml(file.name)}">${icon} <span>${escapeHtml(short)}</span></a>`;
}

export function requesterFileChips(files, maxLen = 26) {
  return files.length ? files.map((f) => fileChip(f, maxLen)).join("") : "";
}

/**
 * เซลล์ไฟล์ 2 ส่วน — ใช้ในตารางติดตามงาน / ป๊อปอัปรายละเอียด / ตารางตรวจสอบของผู้จัดการ
 * ไฟล์ของผู้ร้องขอโหลดภายหลัง: ใส่ placeholder [data-requester-files] แล้วเรียก hydrateRequesterFiles(root)
 */
export function renderFileGroups(item, { maxLen = 26, showRequester = true } = {}) {
  const dept = drawingDeptFiles(item);
  const links = extractLinks(item.dataLink);
  const cached = requesterFilesCached(item.requestNo);

  const requesterSection = showRequester ? `
    <div class="file-group">
      <div class="file-group-title">📤 จากผู้ส่งคำขอ</div>
      <div class="file-group-items">
        <a href="${escapeHtml(requestFolderUrl(item.requestNo))}" target="_blank" rel="noopener noreferrer" class="mgr-file-btn folder-btn file-chip-named">📁 <span>โฟลเดอร์คำร้อง</span></a>
        ${links.map((url, i) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="mgr-file-btn ref-btn file-chip-named" title="${escapeHtml(url)}">🔗 <span>ลิงก์แนบ${links.length > 1 ? ` ${i + 1}` : ""}</span></a>`).join("")}
        <span class="file-group-async" data-requester-files="${escapeHtml(item.requestNo)}" data-max-len="${maxLen}">${cached
          ? requesterFileChips(cached, maxLen)
          : `<span class="file-group-loading">⏳ กำลังโหลดรายชื่อไฟล์…</span>`}</span>
      </div>
    </div>` : "";

  const deptSection = (dept.files.length || dept.folderUrl) ? `
    <div class="file-group file-group-dept">
      <div class="file-group-title">📐 จากฝ่ายเขียนแบบ <small>(${dept.files.length} ไฟล์)</small></div>
      <div class="file-group-items">
        ${dept.folderUrl ? `<a href="${escapeHtml(dept.folderUrl)}" target="_blank" rel="noopener noreferrer" class="mgr-file-btn folder-btn file-chip-named">📁 <span>โฟลเดอร์งานที่ส่ง</span></a>` : ""}
        ${dept.files.map((f) => fileChip(f, maxLen)).join("")}
      </div>
    </div>` : "";

  return `<div class="file-groups">${requesterSection}${deptSection}</div>`;
}

/** เติมรายชื่อไฟล์ของผู้ร้องขอในทุก placeholder ใต้ root — โหลดเฉพาะแถวที่เลื่อนมาเห็น */
let hydrateObserver = null;
export function hydrateRequesterFiles(root) {
  const fill = async (el) => {
    const files = await loadRequesterFiles(el.dataset.requesterFiles);
    if (!el.isConnected) return;
    el.innerHTML = requesterFileChips(files, Number(el.dataset.maxLen) || 26);
  };
  hydrateObserver ||= new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      hydrateObserver.unobserve(entry.target);
      fill(entry.target);
    });
  }, { rootMargin: "200px 0px" });
  root.querySelectorAll("[data-requester-files]").forEach((el) => {
    if (requesterFilesCached(el.dataset.requesterFiles)) return; // วาดจาก cache แล้ว
    hydrateObserver.observe(el);
  });
}
