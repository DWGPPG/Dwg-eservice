import { fields, lists } from "../../../config/schema.js";
import { addItem, getListItems } from "../sharepoint.js";
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

/**
 * ดึงประวัติ audit log ของคำร้องหนึ่งใบ เรียงจากล่าสุดไปเก่าสุด (สำหรับ timeline)
 * คืนค่า array ว่างถ้าโหลดไม่สำเร็จ (ไม่ throw — ไม่ critical ต่อการแสดงรายละเอียดคำร้องหลัก)
 */
export async function getAuditHistory(requestNo) {
  if (!requestNo) return [];
  try {
    const items = await getListItems(lists.auditLog);
    return items
      .filter((item) => item[fields.audit.requestId] === requestNo)
      .map((item) => ({
        action: item[fields.audit.title] || "",
        userName: item[fields.audit.userName] || "",
        userEmail: item[fields.audit.userEmail] || "",
        detail: item[fields.audit.detail] || "",
        actionAt: item[fields.audit.actionAt] || "",
      }))
      .sort((a, b) => new Date(b.actionAt || 0) - new Date(a.actionAt || 0));
  } catch (error) {
    console.warn("getAuditHistory failed (non-critical):", error.message);
    return [];
  }
}
