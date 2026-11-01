import { appConfig } from "../../../config/config.js";
import { state } from "../state.js";

// ค่าตั้งค่าระบบที่แก้ได้จากหน้า "จัดการข้อมูล" → แท็บ "ตั้งค่าระบบ" (เก็บใน SharePoint List "AppSettings")
// ถ้ายังไม่เคยตั้ง ใช้ค่าใน config.js

export const VERSION_KEY = "appVersion";

/** ตัด v/V นำหน้าออก — ป้ายแสดงเป็น "V" + เลขเวอร์ชันเสมอ */
export function normalizeVersion(value) {
  return String(value || "").trim().replace(/^v\s*/i, "");
}

export function displayVersion(nextState = state) {
  return normalizeVersion(nextState.masterData?.settings?.[VERSION_KEY]) || normalizeVersion(appConfig.app.version);
}
