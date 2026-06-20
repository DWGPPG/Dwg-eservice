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

/**
 * อัปโหลดไฟล์เข้าโฟลเดอร์คำร้อง — ถ้ามี reviseTag จะตั้งชื่อไฟล์เป็น {requestNo}_{reviseTag}.{ext}
 * ตรงกับ swSubmitWork() ใน index__5_.html
 */
export async function uploadRequestFiles(requestNo, files = [], reviseTag = "") {
  if (!files.length) return [];
  const siteId = await ensureSite();
  const folder = `${appConfig.sharePoint.uploadFolder}/${requestNo}`;
  await ensureDriveFolder(siteId, folder);

  const uploaded = await Promise.all(
    Array.from(files).map(async (file) => {
      let uploadFile = file;
      if (reviseTag) {
        const ext = (file.name || "").split(".").pop()?.toLowerCase() || "";
        const renamed = `${requestNo}_${reviseTag}.${ext}`;
        uploadFile = new File([file], renamed, { type: file.type });
      }
      const result = await uploadDriveFile(siteId, folder, uploadFile);
      return { ...result, name: uploadFile.name };
    })
  );
  return uploaded;
}

export async function ensureRequestFolder(requestNo) {
  const siteId = await ensureSite();
  const folder = `${appConfig.sharePoint.uploadFolder}/${requestNo}`;
  return ensureDriveFolder(siteId, folder);
}
