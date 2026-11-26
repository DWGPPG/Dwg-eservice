// ══════════════════════════════════════════════════════════════
// เกณฑ์ภาระงานกลาง — ใช้ร่วมกันทุกหน้า (ส่งคำร้อง · KPI Workload · การ์ดทีม)
//  ISO 9001 (8.2.3/8.1 ทบทวนความสามารถรับงาน · 9.1 ติดตามด้วยเกณฑ์ที่กำหนด)
//  ISO 45001 (6.1.2.1 ภาระงาน/การจัดงานเป็นความเสี่ยงที่ต้องควบคุม)
//  2 มิติ: (1) งานที่ต้องส่งในวันเดียวกัน  (2) งานค้างทั้งหมดที่ยังไม่ส่ง
//  แก้เกณฑ์ได้ที่ จัดการข้อมูล → ตั้งค่าระบบ (List AppSettings)
// ══════════════════════════════════════════════════════════════

import { STATUS } from "../../../config/schema.js";
import { state } from "../state.js";
import { toDateKey } from "./due-date.js";
import { getDrawingTeamMembers } from "./team-service.js";

export const WORKLOAD_DUE_KEY = "workloadDueDay"; // "ปกติสูงสุด,ปานกลางสูงสุด" เช่น "3,4"
export const WORKLOAD_OPEN_KEY = "workloadOpen";  // เช่น "8,12"
export const DEFAULT_DUE = [3, 4];
export const DEFAULT_OPEN = [8, 12];
export const HIGH_STREAK_ALERT = 3; // สูงต่อเนื่องเกินกี่วันทำการให้เตือน

// งานที่ยัง "ต้องทำ/ต้องส่ง" (ตรงกับนิยามหน้า KPI: ไม่นับที่ส่งผู้จัดการตรวจ/ส่งมอบ/ปิด/ยกเลิก)
const OPEN = new Set([STATUS.PENDING, STATUS.INPROGRESS_LV1, STATUS.APPROVED, STATUS.WORKING, STATUS.MGR_REJECTED].filter(Boolean));
export const isOpenWork = (r) => OPEN.has(r.status);
const norm = (v) => String(v || "").trim().toLowerCase();

export const LEVELS = {
  low: { key: "low", text: "ภาระงานปกติ", short: "ปกติ", color: "#059669", bg: "#ECFDF5", icon: "🟢" },
  mid: { key: "mid", text: "ภาระงานปานกลาง", short: "ปานกลาง", color: "#D97706", bg: "#FFFBEB", icon: "🟠" },
  high: { key: "high", text: "ภาระงานสูง — เสี่ยงส่งไม่ทัน", short: "สูง", color: "#DC2626", bg: "#FEF2F2", icon: "🔴" },
};
const RANK = { low: 0, mid: 1, high: 2 };
export const worse = (a, b) => (RANK[a] >= RANK[b] ? a : b);

function parsePair(raw, fallback) {
  const nums = String(raw || "").split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  return nums.length === 2 && nums[0] < nums[1] ? nums : fallback;
}

/** เกณฑ์ปัจจุบัน { due:[ปกติ,ปานกลาง], open:[ปกติ,ปานกลาง] } — เกินปานกลาง = สูง */
export function thresholds() {
  const s = state.masterData?.settings || {};
  return { due: parsePair(s[WORKLOAD_DUE_KEY], DEFAULT_DUE), open: parsePair(s[WORKLOAD_OPEN_KEY], DEFAULT_OPEN) };
}

/** ระดับจากจำนวน · factor = สัดส่วนเวลาทำงานวันนั้น (ลาครึ่งวัน 0.5 · ลาเต็มวัน 0) */
export function levelOf(count, [normal, medium], factor = 1) {
  if (factor <= 0) return count > 0 ? "high" : "low";
  const n = Math.max(1, Math.floor(normal * factor));
  const m = Math.max(n + 1, Math.floor(medium * factor));
  if (count <= n) return "low";
  if (count <= m) return "mid";
  return "high";
}

/** สัดส่วนเวลาทำงานในวันนั้น ตามวันลา (เต็มวัน 0 · ครึ่งวัน/ช่วงเวลา 0.5) */
export function workFactor(email, dateKey) {
  const row = (state.masterData?.staffLeave || []).find((l) => {
    if (norm(l.Email) !== norm(email)) return false;
    const s = toDateKey(l.LeaveStart); const e = toDateKey(l.LeaveEnd || l.LeaveStart);
    return s && dateKey >= s && dateKey <= e;
  });
  if (!row) return 1;
  return /เต็มวัน/.test(String(row.Period || "เต็มวัน")) ? 0 : 0.5;
}

/** ภาระงานของคน ณ วันหนึ่ง (ค่าเริ่มต้น = วันนี้) */
export function personLoad(email, dateKey = toDateKey(new Date()), extraDue = 0) {
  const t = thresholds();
  const mine = (state.requests || []).filter((r) => isOpenWork(r) && norm(r.assignedToEmail) === norm(email));
  const due = mine.filter((r) => r.dueDate && toDateKey(r.dueDate) === dateKey).length + extraDue;
  const open = mine.length + extraDue;
  const factor = workFactor(email, dateKey);
  const dueLevel = levelOf(due, t.due, factor);
  const openLevel = levelOf(open, t.open);
  return { email, due, open, factor, dueLevel, openLevel, level: worse(dueLevel, openLevel) };
}

// ── ย้อนหลัง: คำนวณระดับรายวันจากเวลาในคำร้อง (ไม่ต้องเก็บสแนปช็อต) ──
const startOf = (r) => r.approvedLv2At || r.assignedAt || r.submittedAt || "";
const endOf = (r) => r.deptFinishedAt || r.deliveredAt || r.doneAt || r.mgrApprovedAt || r.cancelledAt || "";

/**
 * จำนวนวันทำการที่อยู่ระดับ "สูง" + ต่อเนื่องสูงสุด ในช่วงวันที่ (สูงสุด 120 วันทำการ ย้อนจากวันสิ้นสุด)
 * @returns {{ highDays:number, maxStreak:number, currentStreak:number, workdays:number }}
 */
export function highLoadHistory(email, from, to = new Date(), holidays = new Set()) {
  const t = thresholds();
  const mine = (state.requests || []).filter((r) => norm(r.assignedToEmail) === norm(email) && startOf(r) && r.status !== STATUS.CANCELLED);
  const end = new Date(Math.min(new Date(to).getTime(), Date.now())); end.setHours(0, 0, 0, 0);
  const start = new Date(from || end); start.setHours(0, 0, 0, 0);
  const days = [];
  for (const d = new Date(end); d >= start && days.length < 120; d.setDate(d.getDate() - 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6 || holidays.has(d.toDateString())) continue;
    days.unshift(new Date(d));
  }
  let highDays = 0; let streak = 0; let maxStreak = 0;
  days.forEach((d) => {
    const key = toDateKey(d);
    const dayEnd = new Date(d); dayEnd.setHours(23, 59, 59, 999);
    const openOn = mine.filter((r) => new Date(startOf(r)) <= dayEnd && (!endOf(r) || new Date(endOf(r)) > dayEnd));
    const due = openOn.filter((r) => r.dueDate && toDateKey(r.dueDate) === key).length;
    const lvl = worse(levelOf(due, t.due, workFactor(email, key)), levelOf(openOn.length, t.open));
    if (lvl === "high") { highDays += 1; streak += 1; maxStreak = Math.max(maxStreak, streak); } else streak = 0;
  });
  return { highDays, maxStreak, currentStreak: streak, workdays: days.length };
}

/** คนในทีมที่ภาระงานสูง ณ วันนี้ */
export function highLoadNow() {
  return getDrawingTeamMembers().map((m) => ({ ...personLoad(m.email), name: m.name })).filter((p) => p.level === "high");
}

/** ป้ายระดับ (HTML) */
export function levelBadge(level, text = "") {
  const L = LEVELS[level] || LEVELS.low;
  return `<span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap;color:${L.color};background:${L.bg};border:1px solid ${L.color}55;">${L.icon} ${text || L.short}</span>`;
}
