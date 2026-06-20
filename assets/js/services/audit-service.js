import { fields, lists } from "../../../config/schema.js";
import { addItem } from "../sharepoint.js";
import { state } from "../state.js";

/**
 * บันทึก audit log ลง SharePoint List "AuditLog"
 * ตรงกับฟังก์ชัน auditLog() ใน index__5_.html
 * action เช่น 'ส่งคำร้อง', 'อนุมัติ Lv.1', 'นำส่งงาน'
 */
export async function writeAudit({ requestNo, action, detail = "" }) {
  const user = state.user || {};
  const item = {
    [fields.audit.title]: action,
    [fields.audit.requestId]: requestNo || "",
    [fields.audit.userEmail]: user.email || "",
    [fields.audit.userName]: user.name || "",
    [fields.audit.detail]: detail,
    [fields.audit.actionAt]: new Date().toISOString(),
  };

  try {
    return await addItem(lists.auditLog, item);
  } catch (error) {
    console.warn("writeAudit failed (non-critical):", error.message);
    return null;
  }
}
