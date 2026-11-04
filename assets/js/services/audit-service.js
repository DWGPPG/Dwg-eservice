import { fields, lists } from "../../../config/schema.js";
import { addItem, getListItems } from "../sharepoint.js";
import { state } from "../state.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const WRITE_RETRY_MS = [800, 2000, 4500];
const RETRYABLE = /\b(429|503|504|500)\b|throttl|timeout|Failed to fetch|NetworkError/i;

/**
 * บันทึก audit log ลง SharePoint List "AuditLog"
 * action เช่น 'ส่งคำร้อง', 'อนุมัติ Lv.1', 'นำส่งงาน'
 * - SharePoint จำกัดความถี่ (429/503) ตอนมีหลายรายการพร้อมกัน → ลองใหม่อัตโนมัติ (เดิมพลาดแล้วหายเงียบ)
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

  for (let attempt = 0; ; attempt += 1) {
    try {
      const saved = await addItem(lists.auditLog, item);
      auditCache = null; // ให้ประวัติที่เปิดดูครั้งถัดไปเห็นรายการใหม่
      return saved;
    } catch (error) {
      if (RETRYABLE.test(String(error.message)) && attempt < WRITE_RETRY_MS.length) {
        await wait(WRITE_RETRY_MS[attempt] + Math.random() * 300);
        continue;
      }
      console.warn("writeAudit failed (non-critical):", error.message);
      return null;
    }
  }
}

// ── อ่าน AuditLog ทั้ง List ครั้งเดียวแล้วใช้ซ้ำ 60 วินาที (เปิดหลายคำร้องติดกันไม่ต้องโหลดใหม่ทุกครั้ง) ──
let auditCache = null; // { at, promise }
const AUDIT_TTL_MS = 60 * 1000;

function loadAuditItems() {
  if (auditCache && Date.now() - auditCache.at < AUDIT_TTL_MS) return auditCache.promise;
  const promise = getListItems(lists.auditLog).catch((error) => {
    auditCache = null;
    throw error;
  });
  auditCache = { at: Date.now(), promise };
  return promise;
}

const norm = (v) => String(v ?? "").trim().toLowerCase();

/**
 * ดึงประวัติ audit log ของคำร้องหนึ่งใบ เรียงจากล่าสุดไปเก่าสุด (สำหรับ timeline)
 * โหลดไม่สำเร็จ → throw (ให้หน้าจอบอกว่า "โหลดไม่สำเร็จ" แทน "ยังไม่มีประวัติ")
 */
export async function getAuditHistory(requestNo) {
  if (!requestNo) return [];
  const key = norm(requestNo);
  const items = await loadAuditItems();
  return items
    .filter((item) => {
      const id = norm(item[fields.audit.requestId]);
      if (id) return id === key;
      // รายการเก่าที่ไม่มีรหัสคำร้อง — ดูจากข้อความแทน
      return norm(item[fields.audit.title]).includes(key) || norm(item[fields.audit.detail]).includes(key);
    })
    .map((item) => ({
      action: item[fields.audit.title] || "",
      userName: item[fields.audit.userName] || "",
      userEmail: item[fields.audit.userEmail] || "",
      detail: item[fields.audit.detail] || "",
      actionAt: item[fields.audit.actionAt] || item.Created || "",
    }))
    .sort((a, b) => new Date(b.actionAt || 0) - new Date(a.actionAt || 0));
}

/**
 * ประวัติหลักที่สร้างจากวันเวลาที่บันทึกในตัวคำร้องเอง (ส่ง / อนุมัติ / ส่งงาน / ตรวจ / ส่งมอบ / ตรวจรับ / ยกเลิก)
 * ใช้เติมขั้นที่ไม่มีใน AuditLog — ประวัติจึงไม่ว่างแม้บันทึก AuditLog บางรายการหายไป
 */
export function requestEvents(r) {
  const ev = (at, action, userName = "", detail = "") => (at ? { action, userName, detail, actionAt: at, derived: true } : null);
  return [
    ev(r.submittedAt, "ส่งคำร้อง", r.requesterName),
    ev(r.approvedLv2At, "อนุมัติเริ่มงาน", r.reviewerLv2 || "", r.assignedToName ? `ผู้รับผิดชอบ: ${r.assignedToName}` : ""),
    ev(r.deptFinishedAt, "ฝ่ายเขียนแบบส่งงานให้ผู้จัดการตรวจ", r.assignedToName),
    ev(r.mgrRejectedAt, "ผู้จัดการส่งกลับแก้ไข", r.mgrRejectedBy || "", r.mgrRejectReason || ""),
    ev(r.mgrApprovedAt || r.deliveredAt, "ผู้จัดการตรวจและส่งมอบงาน", r.mgrApprovedBy || ""),
    ev(r.reviewedAt && r.reviewResult && r.reviewResult !== "approved" ? r.reviewedAt : "", "ผู้ร้องขอขอแก้ไข", r.requesterName, r.reviseComment || r.deliveryRejectReason || ""),
    ev(r.doneAt, r.autoApproved ? "ตรวจรับอัตโนมัติ (ครบกำหนด)" : "ผู้ร้องขอตรวจรับงาน", r.autoApproved ? "" : r.requesterName),
    ev(r.cancelledAt, "ยกเลิกคำร้อง", r.cancelledByName || "", r.rejectReason || ""),
  ].filter(Boolean);
}

/** รวมประวัติจาก AuditLog + จากตัวคำร้อง (ตัดขั้นที่ซ้ำ: มีบันทึก AuditLog ภายใน 5 นาทีของเวลาเดียวกันแล้ว) */
export function mergeHistory(auditEntries, derived) {
  const times = auditEntries.map((e) => new Date(e.actionAt).getTime()).filter((t) => !Number.isNaN(t));
  const extra = derived.filter((d) => {
    const t = new Date(d.actionAt).getTime();
    return !Number.isNaN(t) && !times.some((x) => Math.abs(x - t) < 5 * 60 * 1000);
  });
  return [...auditEntries, ...extra].sort((a, b) => new Date(b.actionAt || 0) - new Date(a.actionAt || 0));
}
