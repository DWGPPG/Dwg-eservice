import { state } from "../state.js";

const FALLBACK_DRAWING_TEAM = [
  { id: "fallback-1", name: "นาย ภานุวัฒน์ พันโน (ยอร์ช)", email: "phanuwat.p@primepower.co.th", role: "Electrical" },
  { id: "fallback-2", name: "นาย สฤษดิ์ ศรีบางไทร (ปอนด์)", email: "sarit.s@primepower.co.th", role: "Electrical" },
  { id: "fallback-3", name: "นางสาว จันทร์จิรา ผองพุทธ (แตงโม)", email: "janjira.p@primepower.co.th", role: "Electrical" },
  { id: "fallback-4", name: "นางสาว กชกร กุมลา (จ๋า)", email: "kotchakorn.k@primepower.co.th", role: "Civil" },
];

/**
 * โหลดสมาชิกทีมจาก SharePoint List "DrawingTeam"
 * Column จริง: Title0 = ชื่อ-นามสกุล, Email, Role, IsActive (Yes/No)
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
