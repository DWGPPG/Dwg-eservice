// ══════════════════════════════════════════════════════════════
// ผู้รับผิดชอบโครงการ + วันลาของบุคลากรฝ่ายเขียนแบบ
//  - ProjectOwners: ProjectName, OwnerEmail, RequestTypes (ว่าง = ทุกประเภท), Note
//  - StaffLeave:    Title(ชื่อ), Email, LeaveStart, LeaveEnd (YYYY-MM-DD), Period, Note
//  - งาน "📋 เขียนแบบ Proposal" → appConfig.proposalOwners เสมอ
//  - ผู้รับผิดชอบโครงการ "ไม่เปลี่ยน" เมื่อมีการดึงงาน/โอนงานระหว่างบุคคล (เป็นข้อมูลแยกจากผู้รับงานของคำร้อง)
// ══════════════════════════════════════════════════════════════

import { appConfig } from "../../../config/config.js";
import { state } from "../state.js";
import { escapeHtml } from "../utils.js";
import { toDateKey } from "./due-date.js";
import { getDrawingTeamMembers } from "./team-service.js";

export const LEAVE_PERIODS = ["เต็มวัน", "ครึ่งวันเช้า", "ครึ่งวันบ่าย"];

const norm = (v) => String(v ?? "").trim().toLowerCase();
export const isProposalType = (type) => String(type || "").includes("Proposal");
export const todayKey = () => toDateKey(new Date());

/** ชื่อจากรายชื่อทีม (ไม่เจอใช้ส่วนหน้าของอีเมล) */
export function personName(email) {
  const member = getDrawingTeamMembers().find((m) => norm(m.email) === norm(email));
  return member?.name || String(email || "").split("@")[0];
}

/** ตัวเลือกสมาชิกฝ่ายเขียนแบบสำหรับ dropdown: [{ value: email, label: ชื่อ }] */
export function teamOptions() {
  return getDrawingTeamMembers()
    .map((m) => ({ value: m.email.toLowerCase(), label: m.name || m.email }))
    .sort((a, b) => a.label.localeCompare(b.label, "th"));
}

export function splitTypes(text) {
  return String(text || "").split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
}

/**
 * ผู้รับผิดชอบงานตามโครงการ + ประเภทคำร้อง
 * @returns {Array<{email:string, name:string, source:"proposal"|"project"}>}
 */
export function ownersFor(projectName, requestType) {
  if (isProposalType(requestType)) {
    return (appConfig.proposalOwners || []).map((email) => ({ email: norm(email), name: personName(email), source: "proposal" }));
  }
  if (!projectName) return [];
  const seen = new Set();
  return (state.masterData.projectOwners || [])
    .filter((row) => norm(row.ProjectName) === norm(projectName) && row.OwnerEmail)
    .filter((row) => {
      const types = splitTypes(row.RequestTypes);
      return !types.length || !requestType || types.includes(requestType);
    })
    .map((row) => ({ email: norm(row.OwnerEmail), name: personName(row.OwnerEmail), source: "project" }))
    .filter((o) => !seen.has(o.email) && seen.add(o.email));
}

/** รายการลาที่ครอบคลุมวันนั้น */
export function leavesOn(dateKey = todayKey()) {
  return (state.masterData.staffLeave || []).filter((row) => {
    const start = String(row.LeaveStart || "").slice(0, 10);
    const end = String(row.LeaveEnd || row.LeaveStart || "").slice(0, 10);
    return start && start <= dateKey && dateKey <= end;
  });
}

export function leaveOf(email, dateKey = todayKey()) {
  return leavesOn(dateKey).find((row) => norm(row.Email) === norm(email)) || null;
}

/** กล่องแจ้งผู้รับผิดชอบ + เตือนเมื่อผู้รับผิดชอบลาวันนี้ (HTML) — คืน "" ถ้ายังไม่มีข้อมูลผู้รับผิดชอบ */
export function ownerNoticeHtml(projectName, requestType, dateKey = todayKey()) {
  const owners = ownersFor(projectName, requestType).map((o) => ({ ...o, leave: leaveOf(o.email, dateKey) }));
  if (!owners.length) return "";
  const away = owners.filter((o) => o.leave);
  const contact = appConfig.drawingContact || "ห้องฝ่ายเขียนแบบ";
  const chips = owners.map((o) => `
    <span class="owner-chip ${o.leave ? "is-away" : ""}">
      <b>${escapeHtml(o.name)}</b>${o.leave ? ` <em>ลา${o.leave.Period && o.leave.Period !== "เต็มวัน" ? escapeHtml(o.leave.Period) : "วันนี้"}</em>` : ""}
    </span>`).join("");
  return `
    <div class="owner-notice ${away.length ? "has-away" : ""}">
      <div class="owner-notice-row">
        <span class="owner-notice-label">👷 ผู้รับผิดชอบ${isProposalType(requestType) ? "งาน Proposal" : "โครงการ"}</span>
        <span class="owner-chips">${chips}</span>
      </div>
      ${away.length ? `
        <div class="owner-notice-warn">
          ⚠️ <b>${away.map((o) => escapeHtml(o.name)).join(", ")}</b> ลางานวันนี้${away.length === owners.length ? "" : " (ผู้รับผิดชอบคนอื่นยังรับงานได้)"}
          — กรุณา<b>เผื่อวันกำหนดส่ง</b>
          <br>หากเร่งด่วน ติดต่อฝ่ายเขียนแบบได้ที่ <b>${escapeHtml(contact)}</b>
        </div>` : ""}
    </div>`;
}

/** ข้อความสั้นสำหรับตาราง/ป๊อปอัป: "Narakorn, Janjira (ลาวันนี้)" */
export function ownerSummaryText(projectName, requestType, dateKey = todayKey()) {
  return ownersFor(projectName, requestType)
    .map((o) => `${o.name}${leaveOf(o.email, dateKey) ? " (ลาวันนี้)" : ""}`)
    .join(", ");
}
