// ══════════════════════════════════════════════════════════════
// ขอเลื่อนกำหนดส่ง — ผู้เขียนแบบขอ → ผู้ส่งคำร้องยอมรับ/ไม่ยอมรับ → กำหนดส่งเปลี่ยนเมื่อยอมรับเท่านั้น
//  - เก็บใน List ตั้งค่า (AppSettings) 1 แถวต่อคำร้อง: Title = "DueChange:<เลขคำร้อง>", ค่า = JSON
//    (ไม่ต้องเพิ่มคอลัมน์ใน DrawingRequests · ทุกคนอ่านได้พร้อมข้อมูลหลักตอนเปิดเว็บ)
//  - ระหว่างรอ: กำหนดส่งเดิมยังมีผล (นับเหลือ/เกินกำหนดตามวันเดิม)
//  - ทุกขั้นบันทึก AuditLog + แจ้งอีกฝ่ายทาง Teams
// ══════════════════════════════════════════════════════════════

import { sendTeams1on1 } from "../graph.js";
import { getListItems, saveSetting } from "../sharepoint.js";
import { lists } from "../../../config/schema.js";
import { state } from "../state.js";
import { writeAudit } from "./audit-service.js";
import { patchRequest } from "./request-service.js";
import { getAllManagerEmails } from "./team-service.js";
import { workingDaysUntil } from "../utils.js";

export const DUE_CHANGE_PREFIX = "DueChange:";
export const DUE_CHANGE_CAUSES = [
  "ข้อมูลจากผู้ส่งคำร้องไม่ครบ / รอข้อมูลเพิ่ม",
  "งานแทรกเร่งด่วน / ภาระงานสูง",
  "ขอบเขตงานเพิ่มจากที่ขอ",
  "ปัญหาด้านเทคนิค / ต้องประสานหน่วยงานอื่น",
  "อื่นๆ",
];
export const DUE_REJECT_IMPACTS = [
  "พลาดกำหนดยื่นหน่วยงานราชการ / ขออนุญาต",
  "กระทบแผนก่อสร้าง / ติดตั้ง",
  "ลูกค้าเร่งรัด / มีค่าปรับ",
  "อื่นๆ",
];
export const MIN_REASON = 15;
export const MGR_APPROVAL_DAYS = 3; // เลื่อนเกินกี่วันทำการต้องให้ผู้จัดการอนุมัติก่อน
export const MIN_REJECT_REASON = 30;
const SHOW_RESULT_DAYS = 3; // ผลยอมรับ/ไม่ยอมรับ แสดงในตารางกี่วัน (หลังจากนั้นดูได้ในประวัติ)

const norm = (v) => String(v || "").trim().toLowerCase();
const keyOf = (requestNo) => `${DUE_CHANGE_PREFIX}${requestNo}`;
const thDate = (iso) => (iso ? new Date(iso).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" }) : "—");

/** คำขอเลื่อนล่าสุดของคำร้อง (หรือ null) */
export function getDueChange(requestNo) {
  const raw = state.masterData?.settings?.[keyOf(requestNo)];
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

export const isPendingDueChange = (requestNo) => getDueChange(requestNo)?.status === "pending";
export const isMgrPendingDueChange = (requestNo) => getDueChange(requestNo)?.status === "mgr_pending";

const holidaySet = () => new Set((state.masterData?.holidays || []).map((h) => h.holidayDate || h.HolidayDate || "").filter(Boolean).map((d) => new Date(d).toDateString()));
/** จำนวนวันทำการที่เลื่อน */
export function extensionWorkingDays(oldDue, newDue) {
  const n = workingDaysUntil(oldDue, newDue, holidaySet());
  return n === null ? 0 : Math.max(0, n);
}

/**
 * ต้องให้ผู้จัดการอนุมัติก่อนส่งถึงผู้ส่งคำร้องหรือไม่ (ISO 9001 — ผู้มีอำนาจตัดสินใจเมื่อการเลื่อนกระทบมาก)
 * คืน [] = ไม่ต้อง · หรือรายการเหตุผลที่ต้องอนุมัติ
 */
export function mgrApprovalReasons(request, newDueKey) {
  if (state.user?.role === "manager") return []; // ผู้จัดการขอเอง → ข้ามขั้นอนุมัติ
  const reasons = [];
  const newDue = new Date(`${newDueKey}T00:00:00`);
  const days = extensionWorkingDays(request.dueDate, newDue);
  if (days > MGR_APPROVAL_DAYS) reasons.push(`เลื่อน ${days} วันทำการ (เกิน ${MGR_APPROVAL_DAYS} วัน)`);
  const prev = getDueChange(request.requestNo);
  if (prev && ["accepted", "rejected", "mgr_rejected"].includes(prev.status)) reasons.push(`ขอเลื่อนครั้งที่ ${(prev.round || 1) + 1}`);
  if (String(request.priority || "").includes("เร่งด่วนมาก")) reasons.push("ความเร่งด่วน: เร่งด่วนมาก");
  const due = new Date(request.dueDate); due.setHours(23, 59, 59, 999);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (request.dueDate && due.getTime() < today.getTime() + 86400000) reasons.push("ขอในวันครบกำหนด / เลยกำหนดแล้ว");
  if (/ขออนุญาต/.test(String(request.requestType || ""))) reasons.push("ประเภทขออนุญาตก่อสร้าง (ผูกกำหนดยื่นหน่วยงาน)");
  return reasons;
}

/** คำขอที่รอผู้จัดการอนุมัติ */
export function pendingForManager() {
  if (state.user?.role !== "manager") return [];
  return (state.requests || []).filter((r) => isMgrPendingDueChange(r.requestNo));
}

/** ผลที่ยังควรแสดงในตาราง (pending เสมอ · ผลตอบกลับแสดง 3 วัน) */
export function visibleDueChange(requestNo) {
  const c = getDueChange(requestNo);
  if (!c || c.status === "cancelled") return null;
  if (c.status === "pending" || c.status === "mgr_pending") return c;
  const age = (Date.now() - new Date(c.responseAt || c.at).getTime()) / 86400000;
  return age <= SHOW_RESULT_DAYS ? c : null;
}

/** คำขอที่รอผู้ใช้คนนี้ยืนยัน (ในฐานะผู้ส่งคำร้อง) */
export function pendingForRequester(user = state.user) {
  const me = norm(user?.email);
  return (state.requests || []).filter((r) => norm(r.requesterEmail) === me && isPendingDueChange(r.requestNo));
}

function setLocal(requestNo, record) {
  const md = state.masterData || (state.masterData = {});
  md.settings = { ...(md.settings || {}), [keyOf(requestNo)]: JSON.stringify(record) };
}

/** โหลดคำขอเลื่อนล่าสุดจาก SharePoint (เรียกตอนเปิดหน้าติดตามงาน) — คืน true ถ้ามีการเปลี่ยนแปลง */
let lastRefresh = 0;
export async function refreshDueChanges(force = false) {
  if (!force && Date.now() - lastRefresh < 30000) return false;
  lastRefresh = Date.now();
  const rows = await getListItems(lists.settings).catch(() => null);
  if (!rows) return false;
  const md = state.masterData || (state.masterData = {});
  const before = JSON.stringify(Object.entries(md.settings || {}).filter(([k]) => k.startsWith(DUE_CHANGE_PREFIX)).sort());
  const next = { ...(md.settings || {}) };
  rows.forEach((r) => { if (r.Title) next[r.Title] = r.SettingValue ?? ""; });
  md.settings = next;
  const after = JSON.stringify(Object.entries(next).filter(([k]) => k.startsWith(DUE_CHANGE_PREFIX)).sort());
  return before !== after;
}

function refHead(r) {
  return [
    ["📋", "เลขคำขอ", r.requestNo], ["📂", "ประเภทแบบ", r.requestType], ["🏗️", "โครงการ", r.projectName],
    ["📐", "Drawing No.", r.drawingNo], ["📄", "Drawing Name", r.drawingName],
  ].filter(([, , v]) => String(v || "").trim()).map(([i, l, v]) => `${i} <b>${l}:</b> ${escapeHtml(v)}`).join("<br>");
}
const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const appLink = () => `${location.origin}${location.pathname}#/track`;

/** ผู้เขียนแบบขอเลื่อน */
export async function requestDueChange(request, { newDue, cause, reason }) {
  const gate = mgrApprovalReasons(request, newDue);
  const record = {
    v: 1,
    requestNo: request.requestNo,
    status: gate.length ? "mgr_pending" : "pending",
    mgrReasons: gate,
    oldDue: request.dueDate || "",
    newDue: new Date(`${newDue}T00:00:00`).toISOString(),
    cause,
    reason: String(reason).trim(),
    by: state.user?.name || "",
    byEmail: state.user?.email || "",
    at: new Date().toISOString(),
    round: (getDueChange(request.requestNo)?.round || 0) + 1,
  };
  await saveSetting(keyOf(request.requestNo), JSON.stringify(record));
  setLocal(request.requestNo, record);
  writeAudit({ requestNo: request.requestNo, action: `ขอเลื่อนกำหนดส่ง ${thDate(record.oldDue)} → ${thDate(record.newDue)}${gate.length ? " (รอผู้จัดการอนุมัติ)" : ""}`, detail: `${cause} — ${record.reason}` }).catch(() => {});
  notifyManagers(request, record, gate);
  if (!gate.length) notifyRequester(request, record);
  return record;
}

/** แจ้งผู้จัดการ: ต้องอนุมัติ (gate) หรือแจ้งให้ทราบ (ยกเลิกคำขอได้) */
function notifyManagers(request, record, gate) {
  const me = norm(state.user?.email);
  getAllManagerEmails().filter((e) => norm(e) !== me).forEach((email) => {
    sendTeams1on1(email, `${refHead(request)}<br>──────────<br>${gate.length
      ? `🛡️ <b>ขออนุมัติเลื่อนกำหนดส่ง ${thDate(record.oldDue)} → ${thDate(record.newDue)}</b><br>เหตุที่ต้องอนุมัติ: ${escapeHtml(gate.join(" · "))}`
      : `ℹ️ แจ้งให้ทราบ: ขอเลื่อนกำหนดส่ง ${thDate(record.oldDue)} → ${thDate(record.newDue)} (ส่งให้ผู้ส่งคำร้องยืนยันแล้ว)`}<br>สาเหตุ: ${escapeHtml(record.cause)}<br>เหตุผล: ${escapeHtml(record.reason)}<br>โดย: ${escapeHtml(record.by)}<br>👉 <a href="${appLink()}">${gate.length ? "อนุมัติ / ไม่อนุมัติในระบบ" : "ดูในระบบ (ยกเลิกคำขอได้)"}</a>`).catch(() => {});
  });
}

function notifyRequester(request, record) {
  if (request.requesterEmail) {
    sendTeams1on1(request.requesterEmail, `${refHead(request)}<br>──────────<br>📅 <b>ขอเลื่อนกำหนดส่ง ${thDate(record.oldDue)} → ${thDate(record.newDue)}</b><br>สาเหตุ: ${escapeHtml(record.cause)}<br>เหตุผล: ${escapeHtml(record.reason)}<br>โดย: ${escapeHtml(record.by)}<br>👉 <a href="${appLink()}">กรุณากดยอมรับ / ไม่ยอมรับในระบบ</a> (กำหนดส่งจะเปลี่ยนเมื่อคุณยอมรับเท่านั้น)${record.mgrBy ? `<br>✔ ผู้จัดการอนุมัติแล้ว: ${escapeHtml(record.mgrBy)}` : ""}`).catch(() => {});
  }
}

/** ผู้จัดการอนุมัติ (ปรับวันได้) → ส่งต่อให้ผู้ส่งคำร้องยืนยัน · ไม่อนุมัติ (ต้องมีเหตุผล) → จบ คงวันเดิม */
export async function managerDecideDueChange(request, approve, { newDue = "", note = "" } = {}) {
  const c = getDueChange(request.requestNo);
  if (!c || c.status !== "mgr_pending") throw new Error("คำขอนี้ไม่ได้รอผู้จัดการอนุมัติแล้ว");
  const record = {
    ...c,
    status: approve ? "pending" : "mgr_rejected",
    newDue: approve && newDue ? new Date(`${newDue}T00:00:00`).toISOString() : c.newDue,
    requestedDue: c.newDue,
    mgrBy: state.user?.name || "",
    mgrAt: new Date().toISOString(),
    mgrNote: String(note).trim(),
  };
  if (!approve) { record.responseAt = record.mgrAt; record.responseBy = record.mgrBy; }
  await saveSetting(keyOf(request.requestNo), JSON.stringify(record));
  setLocal(request.requestNo, record);
  const adjusted = approve && record.newDue !== c.newDue;
  writeAudit({
    requestNo: request.requestNo,
    action: approve ? `ผู้จัดการอนุมัติขอเลื่อน → ${thDate(record.newDue)}${adjusted ? ` (ปรับจาก ${thDate(c.newDue)})` : ""}` : "ผู้จัดการไม่อนุมัติการขอเลื่อน — คงวันเดิม",
    detail: record.mgrNote,
  }).catch(() => {});
  if (approve) notifyRequester(request, record);
  const to = c.byEmail || request.assignedToEmail;
  if (to && norm(to) !== norm(state.user?.email)) {
    sendTeams1on1(to, `${refHead(request)}<br>──────────<br>${approve
      ? `🛡️ <b>ผู้จัดการอนุมัติขอเลื่อน</b> → ${thDate(record.newDue)}${adjusted ? ` (ปรับจาก ${thDate(c.newDue)})` : ""} — ส่งให้ผู้ส่งคำร้องยืนยันแล้ว`
      : `⛔ <b>ผู้จัดการไม่อนุมัติการขอเลื่อน</b> — กำหนดส่งคงเดิม ${thDate(c.oldDue)}`}${record.mgrNote ? `<br>หมายเหตุ: ${escapeHtml(record.mgrNote)}` : ""}`).catch(() => {});
  }
  return record;
}

/** ผู้เขียนแบบยกเลิกคำขอที่ยังรออยู่ */
export async function cancelDueChange(request) {
  const c = getDueChange(request.requestNo);
  if (!c || !["pending", "mgr_pending"].includes(c.status)) return;
  const record = { ...c, status: "cancelled", responseAt: new Date().toISOString(), responseBy: state.user?.name || "" };
  await saveSetting(keyOf(request.requestNo), JSON.stringify(record));
  setLocal(request.requestNo, record);
  writeAudit({ requestNo: request.requestNo, action: "ยกเลิกคำขอเลื่อนกำหนดส่ง", detail: `${thDate(c.oldDue)} → ${thDate(c.newDue)}` }).catch(() => {});
  if (request.requesterEmail) {
    sendTeams1on1(request.requesterEmail, `${refHead(request)}<br>──────────<br>↩️ ฝ่ายเขียนแบบ<b>ยกเลิกคำขอเลื่อน</b>กำหนดส่งแล้ว — กำหนดส่งคงเดิม ${thDate(c.oldDue)}`).catch(() => {});
  }
}

/** ผู้ส่งคำร้องตอบ: accept = เปลี่ยนกำหนดส่งเป็นวันใหม่ · reject = คงวันเดิม (ต้องมีเหตุผล + ผลกระทบ) */
export async function respondDueChange(request, accept, { reason = "", impact = "", note = "" } = {}) {
  const c = getDueChange(request.requestNo);
  if (!c || c.status !== "pending") throw new Error("คำขอนี้ไม่ได้รอการยืนยันแล้ว");
  if (accept) await patchRequest(request, { dueDate: c.newDue }, "");
  const record = {
    ...c,
    status: accept ? "accepted" : "rejected",
    responseAt: new Date().toISOString(),
    responseBy: state.user?.name || "",
    responseReason: String(accept ? note : reason).trim(),
    impact: accept ? "" : impact,
  };
  await saveSetting(keyOf(request.requestNo), JSON.stringify(record));
  setLocal(request.requestNo, record);
  writeAudit({
    requestNo: request.requestNo,
    action: accept ? `ผู้ส่งคำร้องยอมรับการเลื่อน → ${thDate(c.newDue)}` : `ผู้ส่งคำร้องไม่ยอมรับการเลื่อน — คงวันเดิม ${thDate(c.oldDue)}`,
    detail: accept ? record.responseReason : `ผลกระทบ: ${impact} — ${record.responseReason}`,
  }).catch(() => {});
  const to = c.byEmail || request.assignedToEmail;
  if (to) {
    sendTeams1on1(to, `${refHead(request)}<br>──────────<br>${accept
      ? `✅ <b>ผู้ส่งคำร้องยอมรับการเลื่อน</b> — กำหนดส่งใหม่ ${thDate(c.newDue)}${record.responseReason ? `<br>หมายเหตุ: ${escapeHtml(record.responseReason)}` : ""}`
      : `⛔ <b>ผู้ส่งคำร้องไม่ยอมรับการเลื่อน</b> — ต้องส่งตามกำหนดเดิม ${thDate(c.oldDue)}<br>ผลกระทบ: ${escapeHtml(impact)}<br>เหตุผล: ${escapeHtml(record.responseReason)}`}`).catch(() => {});
  }
  return record;
}


/** สถิติการขอเลื่อน (สำหรับ KPI) — จากคำขอล่าสุดของแต่ละคำร้อง */
export function dueChangeStats(requests = state.requests || []) {
  const byNo = new Map(requests.map((r) => [r.requestNo, r]));
  const rows = Object.entries(state.masterData?.settings || {})
    .filter(([k]) => k.startsWith(DUE_CHANGE_PREFIX))
    .map(([, v]) => { try { return JSON.parse(v); } catch (_) { return null; } })
    .filter((c) => c && byNo.has(c.requestNo) && c.status !== "cancelled");
  const st = { total: rows.length, rounds: 0, accepted: 0, rejected: 0, mgrRejected: 0, pending: 0, mgrPending: 0, daysAccepted: 0, byPerson: {}, byCause: {} };
  rows.forEach((c) => {
    st.rounds += c.round || 1;
    if (c.status === "accepted") { st.accepted += 1; st.daysAccepted += extensionWorkingDays(c.oldDue, c.newDue); }
    if (c.status === "rejected") st.rejected += 1;
    if (c.status === "mgr_rejected") st.mgrRejected += 1;
    if (c.status === "pending") st.pending += 1;
    if (c.status === "mgr_pending") st.mgrPending += 1;
    const who = c.by || "—";
    st.byPerson[who] = (st.byPerson[who] || 0) + 1;
    st.byCause[c.cause || "—"] = (st.byCause[c.cause || "—"] || 0) + 1;
  });
  return st;
}
