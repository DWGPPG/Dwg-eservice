import { appConfig } from "../../../config/config.js";
import { isDrawingTeamMember } from "./team-service.js";

/**
 * ตรงกับ isMgr() ใน index__5_.html — เช็คว่าเป็นผู้จัดการ Lv.2 หรือไม่
 * (Jeerapat / Narakorn / Archan)
 */
export function isMgr(email) {
  if (!email) return false;
  const lower = email.toLowerCase();
  const mgrs = appConfig.approverLv2Emails || [appConfig.approverLv2Email];
  return mgrs.some((e) => e.toLowerCase() === lower);
}

/**
 * ตรงกับ isApprover() ใน index__5_.html — เช็คว่าอยู่ในทีมเขียนแบบ (Lv.1 ที่เป็นไปได้)
 */
export function isApprover(email) {
  return isDrawingTeamMember(email);
}

/**
 * คำนวณ "role" เดียวที่ DWG PRIME UI ใช้ทั้งระบบ จาก permission จริง
 * ลำดับความสำคัญ: manager (Lv.2) > designer (DrawingTeam) > requester
 * หมายเหตุ: ไม่มี "admin" role แยกในระบบจริง — ทุกคนใน DrawingTeam ทำหน้าที่ Lv.1 ได้
 */
export function computeRole(email) {
  if (!email) return "viewer";
  if (isMgr(email)) return "manager";
  if (isApprover(email)) return "designer";
  return "requester";
}

/** ป้ายชื่อ role สำหรับแสดงผล */
export function roleLabel(role) {
  return {
    manager: "ผู้จัดการ Lv.2",
    designer: "ฝ่ายเขียนแบบ (Lv.1)",
    requester: "ผู้ร้องขอ",
    viewer: "ผู้เข้าชม",
  }[role] || role;
}
