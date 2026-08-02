import { state } from "../state.js";

const FALLBACK_DRAWING_TEAM = [
  { id: "fallback-1", name: "นาย ภานุวัฒน์ พันโน (ยอร์ช)", email: "phanuwat.p@primepower.co.th", role: "Electrical", isAdmin: false, displayLabel: "" },
  { id: "fallback-2", name: "นาย สฤษดิ์ ศรีบางไทร (ปอนด์)", email: "sarit.s@primepower.co.th", role: "Electrical", isAdmin: false, displayLabel: "" },
  { id: "fallback-3", name: "นางสาว จันทร์จิรา ผองพุทธ (แตงโม)", email: "janjira.p@primepower.co.th", role: "Electrical", isAdmin: false, displayLabel: "" },
  { id: "fallback-4", name: "นางสาว กชกร กุมลา (จ๋า)", email: "kotchakorn.k@primepower.co.th", role: "Civil", isAdmin: false, displayLabel: "" },
];

/**
 * โหลดสมาชิกทีมจาก SharePoint List "DrawingTeam"
 * Column จริง: Title0 = ชื่อ-นามสกุล, Email, Role, IsActive (Yes/No)
 * Column ใหม่: IsAdmin (Yes/No) = สิทธิ์ผู้จัดการ Lv.2, DisplayLabel (text) = ป้ายแสดงผลแทนค่ามาตรฐาน
 */
export function getDrawingTeamMembers() {
  const raw = state.masterData.team || [];
  const members = raw
    .filter((member) => {
      const active = member.IsActive;
      return !(active === false || active === "No" || active === 0);
    })
    .map((member, index) => ({
      id: String(member.id || `team-${index}`),
      name: member.Title0 || member.Title || member.name || "",
      email: String(member.Email || member.email || "").trim(),
      role: member.Role || member.role || "",
      isAdmin: member.IsAdmin === true || member.IsAdmin === "Yes" || member.IsAdmin === 1,
      displayLabel: String(member.DisplayLabel || "").trim(),
    }))
    .filter((member) => member.email);

  return members.length ? members : FALLBACK_DRAWING_TEAM;
}

export function assigneeName(request) {
  if (request.assignedToName) return request.assignedToName;
  const email = String(request.assignedToEmail || "").toLowerCase();
  if (!email) return "";
  return getDrawingTeamMembers().find((member) => member.email.toLowerCase() === email)?.name || request.assignedToEmail || "";
}

/** ตรวจว่า email อยู่ใน DrawingTeam (สำหรับ role detection ตอน login) */
export function isDrawingTeamMember(email) {
  if (!email) return false;
  const lower = email.toLowerCase();
  return getDrawingTeamMembers().some((member) => member.email.toLowerCase() === lower);
}

/**
 * ตรวจสิทธิ์ผู้จัดการ Lv.2 จาก column "IsAdmin" ใน SharePoint List "DrawingTeam" โดยตรง
 * ใช้แทน config.js approverLv2Emails — เปลี่ยนรายชื่อแอดมินได้จาก SharePoint โดยไม่ต้องแก้โค้ด
 */
export function isAdminFromSharePoint(email) {
  if (!email) return false;
  const lower = email.toLowerCase();
  return getDrawingTeamMembers().some((member) => member.email.toLowerCase() === lower && member.isAdmin);
}

/**
 * อ่านป้ายแสดงผลพิเศษ (column "DisplayLabel") สำหรับอีเมลนี้ ถ้ามีตั้งค่าไว้ใน SharePoint
 * คืนค่าว่างถ้าไม่มี (ให้ fallback ไปใช้ label มาตรฐานตาม role แทน)
 */
export function getCustomDisplayLabel(email) {
  if (!email) return "";
  const lower = email.toLowerCase();
  return getDrawingTeamMembers().find((member) => member.email.toLowerCase() === lower)?.displayLabel || "";
}

/**
 * รวมรายชื่ออีเมลผู้จัดการ Lv.2 ทั้งหมด — จาก SharePoint (IsAdmin=true) รวมกับ config.js fallback
 * ใช้ตอนต้องแจ้งเตือนผู้จัดการ "ทุกคน" (เช่น Teams ตอน mgr_review) เพื่อให้ครอบคลุมทั้งคนที่เพิ่ม
 * ผ่าน SharePoint และคนที่ตั้งค่าไว้ใน config.js โดยไม่ซ้ำกัน
 */
export function getAllManagerEmails(configFallbackEmails = []) {
  const fromSharePoint = getDrawingTeamMembers()
    .filter((member) => member.isAdmin)
    .map((member) => member.email.toLowerCase());

  const combined = new Set([...fromSharePoint, ...configFallbackEmails.map((e) => e.toLowerCase())]);
  return [...combined];
}

/**
 * รวมรายชื่อ "ผู้ร้องขอ" ที่รู้จักทั้งหมด สำหรับใช้เป็นตัวเลือกตอนโอนผู้ร้องขอ
 * แหล่งข้อมูล:
 *   1) ผู้ที่เคยส่งคำร้องเข้ามาในระบบ (จาก state.requests) — กลุ่มหลัก เพราะผู้ร้องขอส่วนใหญ่
 *      เป็นฝ่ายขาย/โครงการ ไม่ได้อยู่ใน DrawingTeam
 *   2) สมาชิกฝ่ายเขียนแบบ (DrawingTeam) — เผื่อกรณีต้องโอนมาให้คนในฝ่ายดูแลเอง
 * @param {string} excludeEmail อีเมลที่ไม่ต้องแสดง (ปกติคือผู้ร้องขอคนปัจจุบัน)
 * @returns {Array<{name:string,email:string,source:string,count:number}>}
 */
export function getKnownRequesters(excludeEmail = "") {
  const skip = String(excludeEmail || "").toLowerCase();
  const map = new Map();

  (state.requests || []).forEach((req) => {
    const email = String(req.requesterEmail || "").trim();
    if (!email) return;
    const key = email.toLowerCase();
    if (key === skip) return;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      if (!existing.name && req.requesterName) existing.name = req.requesterName;
    } else {
      map.set(key, { name: req.requesterName || email, email, source: "requester", count: 1 });
    }
  });

  getDrawingTeamMembers().forEach((member) => {
    const key = member.email.toLowerCase();
    if (!key || key === skip || map.has(key)) return;
    map.set(key, { name: member.name || member.email, email: member.email, source: "team", count: 0 });
  });

  return [...map.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count; // คนที่ส่งคำร้องบ่อยขึ้นก่อน
    return String(a.name).localeCompare(String(b.name), "th");
  });
}
