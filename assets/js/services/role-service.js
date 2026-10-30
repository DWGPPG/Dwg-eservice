import { appConfig } from "../../../config/config.js";
import { getCustomDisplayLabel, isAdminFromSharePoint, isDrawingTeamMember } from "./team-service.js";

/**
 * เช็คว่าเป็นผู้จัดการ Lv.2 (แอดมิน) หรือไม่
 * แหล่งหลัก: column "IsAdmin" ใน SharePoint List "DrawingTeam" — ตั้ง/ถอดได้จากหน้า "จัดการข้อมูล"
 * config.js bootstrapAdminEmails: รายชื่อเดิมที่ยังมีผลอยู่ (กันคนเสียสิทธิ์ตอนเปลี่ยนระบบ)
 *   ขั้นตอน: กด "ย้ายเข้า SharePoint" ในหน้าจัดการข้อมูล → ลบรายชื่อออกจาก config → ดูแลจากหน้าเว็บอย่างเดียว
 */
export function isMgr(email) {
  if (!email) return false;
  if (isAdminFromSharePoint(email)) return true;
  return isBootstrapAdmin(email);
}

/** ได้สิทธิ์ผู้จัดการจากรายชื่อใน config.js (ถอดจากหน้าเว็บไม่ได้จนกว่าจะลบออกจาก config) */
export function isBootstrapAdmin(email) {
  const lower = String(email || "").toLowerCase();
  return Boolean(lower) && (appConfig.bootstrapAdminEmails || []).some((e) => e.toLowerCase() === lower);
}

/**
 * ตรงกับ isApprover() ใน index__5_.html — เช็คว่าอยู่ในฝ่ายเขียนแบบ (Lv.1 ที่เป็นไปได้)
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

/**
 * ป้ายชื่อ role สำหรับแสดงผล — ลำดับการตรวจสอบ:
 * 1) column "DisplayLabel" ใน SharePoint List "DrawingTeam" (แก้ได้จาก SharePoint โดยตรง)
 * 2) bootstrapRoleLabels ใน config.js (ใช้จนกว่าจะกด "ย้ายเข้า SharePoint" ในหน้าจัดการข้อมูล)
 * 3) label มาตรฐานตาม role
 * (เฉพาะข้อความที่แสดงผลเท่านั้น ไม่กระทบสิทธิ์การใช้งานจริงซึ่งยังคำนวณจาก role ปกติเสมอ)
 */
export function roleLabel(role, email = "") {
  const fromSharePoint = getCustomDisplayLabel(email);
  if (fromSharePoint) return fromSharePoint;

  const fromConfig = appConfig.bootstrapRoleLabels?.[String(email).toLowerCase()];
  if (fromConfig) return fromConfig;

  return {
    manager: "ผู้จัดการ Lv.2",
    designer: "ฝ่ายเขียนแบบ (Lv.1)",
    requester: "ผู้ร้องขอ",
    viewer: "ผู้เข้าชม",
  }[role] || role;
}
