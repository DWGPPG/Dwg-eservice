import { state } from "../state.js";
import { appConfig } from "../../../config/config.js";
import { ensureDriveFolder, uploadDriveFile } from "../graph.js";
import { ensureSite } from "../sharepoint.js";

// ── Project / Drawing Number / Drawing Name master data ──
// field "ProjectName" ใน DrawingNumberList/DrawingNameList = ชื่อโครงการ (ไม่ใช่ ProjectCode)
export function getProjects() {
  return (state.masterData.projects || []).filter((item) => !item.IsHidden);
}

export function getDrawingNumbers(projectName, category = "") {
  return (state.masterData.drawingNumbers || [])
    .filter((item) => !item.IsHidden)
    .filter((item) => !projectName || item.ProjectName === projectName)
    .filter((item) => !category || item.DrawingCategory === category);
}

export function getDrawingNames(projectName, category = "") {
  return (state.masterData.drawingNames || [])
    .filter((item) => !item.IsHidden)
    .filter((item) => !projectName || item.ProjectName === projectName)
    .filter((item) => !category || item.DrawingCategory === category);
}

export function getDrawingTeam() {
  return (state.masterData.team || []).filter((member) => member.IsActive !== false);
}

// ══════════════════════════════════════════════════════════════
// FOLDER PATH HELPERS
// โครงสร้างจริงบน SharePoint:
//   DrawingRequests/
//     DWG-DES-2569-0001/                       ← คำร้องแรก (base)
//       <ไฟล์ที่ผู้ร้องขอแนบตอนส่งคำร้อง>
//       E001-SLD-Single Line Diagram-R1/        ← sendwork (DrawingNumber-DrawingName-Revise)
//       Rev.01/                                 ← คำร้อง Revision ซ้อนใต้คำขอเดิม
//         <ไฟล์ที่ผู้ร้องขอแนบตอน Rev.01>
//         E001-SLD-Single Line Diagram-R2/      ← sendwork ของ Rev.01
// ══════════════════════════════════════════════════════════════

/**
 * แยกเลขคำร้อง "DWG-DES-2569-0001-Rev.01" ออกเป็น
 * { baseRequestNo: "DWG-DES-2569-0001", revisionSegment: "Rev.01" }
 * ถ้าไม่ใช่ revision จะได้ revisionSegment เป็น ""
 */
function splitRequestNo(requestNo) {
  const match = String(requestNo || "").match(/^(.*)-(Rev\.\d+)$/);
  if (!match) return { baseRequestNo: requestNo, revisionSegment: "" };
  return { baseRequestNo: match[1], revisionSegment: match[2] };
}

/**
 * คำนวณ path โฟลเดอร์หลักของคำร้อง (ไม่รวม sendwork subfolder)
 * คำร้องแรก → DrawingRequests/DWG-XXX-0001
 * Revision  → DrawingRequests/DWG-XXX-0001/Rev.01  (ซ้อนใต้คำขอเดิมเสมอ)
 */
function requestFolderPath(requestNo) {
  const { baseRequestNo, revisionSegment } = splitRequestNo(requestNo);
  const base = `${appConfig.sharePoint.uploadFolder}/${baseRequestNo}`;
  return revisionSegment ? `${base}/${revisionSegment}` : base;
}

/** ทำความสะอาดข้อความให้ใช้เป็นชื่อโฟลเดอร์/ไฟล์บน SharePoint ได้ปลอดภัย */
function sanitizeFolderSegment(text) {
  return String(text || "")
    .replace(/["*:<>?/\\|]/g, "-") // ตัวอักษรที่ SharePoint ห้ามใช้ในชื่อไฟล์/โฟลเดอร์
    .replace(/\s+/g, " ")
    .trim();
}

export async function ensureRequestFolder(requestNo) {
  const siteId = await ensureSite();
  return ensureDriveFolder(siteId, requestFolderPath(requestNo));
}

/**
 * อัปโหลดไฟล์ที่ผู้ร้องขอแนบตอนส่งคำร้อง (ครั้งแรก หรือ Revision)
 * เก็บที่ root ของโฟลเดอร์คำร้องนั้นๆ ตรงๆ ไม่สร้าง subfolder เพิ่ม
 */
export async function uploadRequestFiles(requestNo, files = [], onProgress = null) {
  if (!files.length) return [];
  const siteId = await ensureSite();
  const folder = requestFolderPath(requestNo);
  await ensureDriveFolder(siteId, folder);

  const fileArray = Array.from(files);
  const results   = [];

  for (let i = 0; i < fileArray.length; i++) {
    const file = fileArray[i];
    const result = await uploadDriveFile(siteId, folder, file, (pct) => {
      if (onProgress) onProgress({ fileIndex: i, fileName: file.name, fileCount: fileArray.length, percent: pct });
    });
    results.push({ ...result, name: file.name });
  }

  return results;
}

/**
 * อัปโหลดไฟล์งานตอน "นำส่งงาน" (sendwork)
 * สร้าง subfolder ชื่อ "{DrawingNumber}-{DrawingName}-{Revise}" ซ้อนใต้โฟลเดอร์คำร้อง
 * เช่น DWG-DES-2569-0001/E001-SLD-Single Line Diagram-R1/
 */
export async function uploadSendworkFiles(request, files = [], reviseTag = "") {
  if (!files.length) return [];
  const siteId = await ensureSite();

  const drawingNo = sanitizeFolderSegment(request.drawingNo);
  const drawingName = sanitizeFolderSegment(request.drawingName);
  const revise = sanitizeFolderSegment(reviseTag || request.currentRevise || request.reviseNumber || "R0");
  const subfolderName = [drawingNo, drawingName, revise].filter(Boolean).join("-");

  const baseFolder = requestFolderPath(request.requestNo);
  const folder = subfolderName ? `${baseFolder}/${subfolderName}` : baseFolder;
  await ensureDriveFolder(siteId, folder);

  return Promise.all(
    Array.from(files).map(async (file) => {
      const result = await uploadDriveFile(siteId, folder, file);
      return { ...result, name: file.name };
    })
  );
}

