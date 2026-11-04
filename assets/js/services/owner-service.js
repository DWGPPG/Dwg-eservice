// ══════════════════════════════════════════════════════════════
// ผู้รับผิดชอบโครงการ + วันลาของบุคลากรฝ่ายเขียนแบบ
//  - ProjectOwners: ProjectName, OwnerEmail, RequestTypes (ว่าง = ทุกประเภท), Note
//  - StaffLeave:    Title(ชื่อ), Email, LeaveStart, LeaveEnd (YYYY-MM-DD), Period, Note
//  - งาน "📋 เขียนแบบ Proposal" → ผู้รับผิดชอบงาน Proposal (ตั้งในหน้าจัดการข้อมูล → ตั้งค่าระบบ) เสมอ
//  - ผู้รับผิดชอบโครงการ "ไม่เปลี่ยน" เมื่อมีการดึงงาน/โอนงานระหว่างบุคคล (เป็นข้อมูลแยกจากผู้รับงานของคำร้อง)
// ══════════════════════════════════════════════════════════════

import { appConfig } from "../../../config/config.js";
import { state } from "../state.js";
import { escapeHtml } from "../utils.js";
import { toDateKey } from "./due-date.js";
import { getDrawingTeamMembers } from "./team-service.js";

// ค่าที่แก้ได้จากหน้า "จัดการข้อมูล → ตั้งค่าระบบ" (List AppSettings) — ไม่เคยตั้ง = ใช้ค่าใน config.js
export const PROPOSAL_OWNERS_KEY = "proposalOwners";
export const DRAWING_CONTACT_KEY = "drawingContact";

/** อีเมลผู้รับผิดชอบงาน Proposal */
export function proposalOwnerEmails() {
  const custom = String(state.masterData?.settings?.[PROPOSAL_OWNERS_KEY] || "").trim();
  const list = custom ? custom.split(/[,\s]+/) : (appConfig.proposalOwners || []);
  return [...new Set(list.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
}

/** ช่องทางติดต่อฝ่ายเขียนแบบ (แสดงตอนผู้รับผิดชอบลา) */
export function drawingContact() {
  return String(state.masterData?.settings?.[DRAWING_CONTACT_KEY] || "").trim() || appConfig.drawingContact || "ห้องฝ่ายเขียนแบบ";
}

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
    return proposalOwnerEmails().map((email) => ({ email, name: personName(email), source: "proposal" }));
  }
  if (!projectName) return [];
  const seen = new Set();
  const configured = (state.masterData.projectOwners || [])
    .filter((row) => norm(row.ProjectName) === norm(projectName) && row.OwnerEmail)
    .filter((row) => {
      const types = splitTypes(row.RequestTypes);
      return !types.length || !requestType || types.includes(requestType);
    })
    .map((row) => ({ email: norm(row.OwnerEmail), name: personName(row.OwnerEmail), source: "project" }))
    .filter((o) => !seen.has(o.email) && seen.add(o.email));
  if (configured.length) return configured;
  // ยังไม่ได้กำหนดในหน้าจัดการข้อมูล → ใช้คนที่รับงานโครงการนี้บ่อยในหน้าติดตามงาน (อ้างอิงเท่านั้น)
  return historyOwners(projectName, requestType).map((h) => ({ email: h.email, name: personName(h.email), source: "history", count: h.count }));
}

// ══════════════════════════════════════════════════════════════
// ผู้รับผิดชอบจาก "ประวัติงาน" (คำร้องในหน้าติดตามงาน)
// ══════════════════════════════════════════════════════════════

const HISTORY_SHARE = 0.25;   // ต้องรับงานอย่างน้อย 25% ของงานโครงการนั้น
const HISTORY_MAX = 3;

function assignedRequests(projectName) {
  return (state.requests || []).filter((r) => norm(r.projectName) === norm(projectName) && r.assignedToEmail && !isProposalType(r.requestType));
}

/** คนที่รับงานโครงการนี้บ่อย (ประเภทเดียวกันก่อน ถ้าข้อมูลประเภทนั้นน้อยใช้ทุกประเภท) */
export function historyOwners(projectName, requestType = "") {
  const all = assignedRequests(projectName);
  const sameType = requestType ? all.filter((r) => r.requestType === requestType) : all;
  const pool = sameType.length >= 2 ? sameType : all;
  if (!pool.length) return [];
  const counts = new Map();
  pool.forEach((r) => {
    const email = norm(r.assignedToEmail);
    counts.set(email, (counts.get(email) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([email, count]) => ({ email, count, share: count / pool.length }))
    .filter((x) => x.share >= HISTORY_SHARE || counts.size === 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, HISTORY_MAX);
}

/**
 * ข้อเสนอสำหรับนำเข้า: ทุกโครงการที่มีคำร้อง (ไม่รวม Proposal) → คน + ประเภทงานที่เคยรับ + จำนวน
 * primary = ผ่านเกณฑ์ historyOwners (ติ๊กไว้ให้ก่อน)
 */
export function historySuggestions() {
  const byProject = new Map();
  (state.requests || []).forEach((r) => {
    if (!r.projectName || !r.assignedToEmail || isProposalType(r.requestType)) return;
    const key = r.projectName.trim();
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(r);
  });
  const existing = new Set((state.masterData.projectOwners || []).map((row) => `${norm(row.ProjectName)}|${norm(row.OwnerEmail)}`));
  const out = [];
  [...byProject.entries()].sort((a, b) => a[0].localeCompare(b[0], "th", { numeric: true })).forEach(([project, rows]) => {
    const primary = new Set(historyOwners(project).map((h) => h.email));
    const people = new Map();
    rows.forEach((r) => {
      const email = norm(r.assignedToEmail);
      const p = people.get(email) || { email, count: 0, types: new Set(), last: "" };
      p.count += 1;
      if (r.requestType) p.types.add(r.requestType);
      if (String(r.submittedAt || "") > p.last) p.last = String(r.submittedAt || "");
      people.set(email, p);
    });
    [...people.values()].sort((a, b) => b.count - a.count).forEach((p) => {
      out.push({
        project,
        email: p.email,
        name: personName(p.email),
        count: p.count,
        total: rows.length,
        types: [...p.types],
        last: p.last,
        primary: primary.has(p.email),
        exists: existing.has(`${norm(project)}|${p.email}`),
      });
    });
  });
  return out;
}

/** รายการลาที่ครอบคลุมวันนั้น */
export function leavesOn(dateKey = todayKey()) {
  return (state.masterData.staffLeave || []).filter((row) => {
    const start = String(row.LeaveStart || "").slice(0, 10);
    const end = String(row.LeaveEnd || row.LeaveStart || "").slice(0, 10);
    return start && start <= dateKey && dateKey <= end;
  });
}

/** เวลาสิ้นสุดการลาของวันนั้น (นาทีนับจากเที่ยงคืน) — null = ทั้งวัน/ครึ่งวันบ่าย (หมดเมื่อสิ้นวัน)
 *  ครึ่งวันเช้า → 12:00 · พิมพ์เวลาเอง เช่น "09:00–11:30" / "9.00-11.30" → เวลาท้ายช่วง */
export const MORNING_LEAVE_ENDS = "12:00";
export function leaveEndMinutes(row) {
  const period = String(row?.Period || "").trim();
  if (period.startsWith("ครึ่งวันเช้า")) {
    const [h, m] = MORNING_LEAVE_ENDS.split(":").map(Number);
    return h * 60 + m;
  }
  const times = [...period.matchAll(/(\d{1,2})[:.](\d{2})/g)];
  if (times.length) {
    const last = times[times.length - 1];
    return Number(last[1]) * 60 + Number(last[2]);
  }
  return null;
}

/** ยังลาอยู่ ณ ตอนนี้ไหม (วันนี้ + ยังไม่ถึงเวลาสิ้นสุดช่วงที่ลา) */
export function leaveActiveNow(email, now = new Date()) {
  const row = leaveOf(email, toDateKey(now));
  if (!row) return null;
  const end = leaveEndMinutes(row);
  if (end !== null && now.getHours() * 60 + now.getMinutes() >= end) return null;
  return row;
}

export function leaveOf(email, dateKey = todayKey()) {
  return leavesOn(dateKey).find((row) => norm(row.Email) === norm(email)) || null;
}

/** กล่องแจ้งผู้รับผิดชอบ + เตือนเมื่อผู้รับผิดชอบลาวันนี้ (HTML) — คืน "" ถ้ายังไม่มีข้อมูลผู้รับผิดชอบ */
export function ownerNoticeHtml(projectName, requestType, dateKey = todayKey()) {
  const owners = ownersFor(projectName, requestType).map((o) => ({ ...o, leave: leaveOf(o.email, dateKey) }));
  if (!owners.length) return "";
  const away = owners.filter((o) => o.leave);
  const contact = drawingContact();
  const chips = owners.map((o) => `
    <span class="owner-chip ${o.leave ? "is-away" : ""}">
      <b>${escapeHtml(o.name)}</b>${o.leave ? ` <em>ลา${o.leave.Period && o.leave.Period !== "เต็มวัน" ? escapeHtml(o.leave.Period) : "วันนี้"}</em>` : ""}
    </span>`).join("");
  return `
    <div class="owner-notice ${away.length ? "has-away" : ""}">
      <div class="owner-notice-row">
        <span class="owner-notice-label">👷 ผู้รับผิดชอบ${isProposalType(requestType) ? "งาน Proposal" : "โครงการ"}${owners[0]?.source === "history" ? ' <small class="owner-source">(จากประวัติงาน)</small>' : ""}</span>
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
  const owners = ownersFor(projectName, requestType);
  const text = owners.map((o) => `${o.name}${leaveOf(o.email, dateKey) ? " (ลาวันนี้)" : ""}`).join(", ");
  return text && owners[0]?.source === "history" ? `${text} · จากประวัติงาน` : text;
}
