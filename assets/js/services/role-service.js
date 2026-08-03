import { appConfig } from "../../../config/config.js";
import { getCustomDisplayLabel, isAdminFromSharePoint, isDrawingTeamMember } from "./team-service.js";

/**
 * เช็คว่าเป็นผู้จัดการ Lv.2 (แอดมิน) หรือไม่
 * แหล่งข้อมูลหลัก: column "IsAdmin" ใน SharePoint List "DrawingTeam" — เปลี่ยนรายชื่อได้จาก
 * SharePoint โดยตรงไม่ต้องแก้โค้ด
 * แหล่งสำรอง (fallback): config.js approverLv2Emails — ใช้เฉพาะตอน SharePoint ยังโหลดไม่เสร็จ
 * (เช่นจังหวะแรกตอน login ก่อน loadMasterData() จะเสร็จ) หรือเข้าถึงไม่ได้ ป้องกันระบบล็อกผู้จัดการ
 * ออกไปทั้งหมดถ้า SharePoint มีปัญหาชั่วคราว
 */
export function isMgr(email) {
  if (!email) return false;
  const lower = email.toLowerCase();

  if (isAdminFromSharePoint(email)) return true;

  const fallbackMgrs = appConfig.approverLv2Emails || [appConfig.approverLv2Email];
  return fallbackMgrs.some((e) => e.toLowerCase() === lower);
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
 * 2) customRoleLabels ใน config.js (fallback สำหรับตอน SharePoint ยังโหลดไม่เสร็จ)
 * 3) label มาตรฐานตาม role
 * (เฉพาะข้อความที่แสดงผลเท่านั้น ไม่กระทบสิทธิ์การใช้งานจริงซึ่งยังคำนวณจาก role ปกติเสมอ)
 */
export function roleLabel(role, email = "") {
  const fromSharePoint = getCustomDisplayLabel(email);
  if (fromSharePoint) return fromSharePoint;

  const fromConfig = appConfig.customRoleLabels?.[String(email).toLowerCase()];
  if (fromConfig) return fromConfig;

  return {
    manager: "ผู้จัดการ Lv.2",
    designer: "ฝ่ายเขียนแบบ (Lv.1)",
    requester: "ผู้ร้องขอ",
    viewer: "ผู้เข้าชม",
  }[role] || role;
}
