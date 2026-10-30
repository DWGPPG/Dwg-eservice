import { appConfig } from "../../../config/config.js";
import { CLOSED_STATUSES, getCancelSource, STATUS, WASTED_HOURS_BY_STAGE } from "../../../config/schema.js";
import { workingDaysUntil } from "../utils.js";

// ══════════════════════════════════════════════════════════════
// ต้นทุนที่ควบคุมได้ — สูตรเดียวกับ KPI ในหน้ารายงาน (report.js) ใช้กับคำร้องชุดเดียวกันได้ตัวเลขตรงกัน
// อัตราอยู่ที่ config.js → costRates (เป็นตัวเลขประมาณการเพื่อดูแนวโน้ม ไม่ใช่ต้นทุนบัญชีจริง)
// ══════════════════════════════════════════════════════════════

export const COST_RATES = appConfig.costRates;

const DEPT_FINISHED = [STATUS.MGR_REVIEW, STATUS.DELIVERED, STATUS.DONE];
const WORK_STARTED = [STATUS.APPROVED, STATUS.WORKING, STATUS.MGR_REVIEW, STATUS.MGR_REJECTED, STATUS.DELIVERED];

const dayKey = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const deptFinishedAt = (r) => r.deptFinishedAt || r.deliveredAt || r.mgrApprovedAt || r.doneAt || "";
const round = (n, digits = 0) => Math.round(n * 10 ** digits) / 10 ** digits;

export const REWORK_SOURCES = {
  "1.1": { label: "ฝ่ายเขียนแบบ", internal: true },
  "1.2": { label: "ผู้ส่งคำร้อง", internal: false },
  "1.3": { label: "งานติดตั้ง", internal: false },
  "1.4": { label: "ลูกค้า", internal: false },
};

/**
 * ต้นทุนของคำร้องชุดหนึ่ง (ปกติ = คำร้องที่ "ส่งเข้ามา" ในช่วงเวลา เหมือน KPI)
 * - late    : งานที่เคยเกินกำหนด (ยังค้าง + ส่งช้า) → OT rate × ชม.OT/วัน × วันทำงานที่ช้า
 * - wasted  : งานที่ถูกยกเลิกหลังลงมือแล้ว (รหัส 2.1–2.4) → ชม.ตามขั้นที่ยกเลิก × ค่าแรง
 * - rework  : คำร้องแก้ไข (Revision) แยกตามสาเหตุ 1.1–1.4 → ชม.แก้ไข/ครั้ง × ค่าแรง
 */
export function computeCosts(rows, holidaySet = new Set(), now = new Date()) {
  const todayKey = dayKey(now);

  // ── งานล่าช้า ──
  const currentOverdue = rows.filter((r) => !CLOSED_STATUSES.includes(r.status) && !DEPT_FINISHED.includes(r.status)
    && r.dueDate && dayKey(r.dueDate) < todayKey);
  const lateFinished = rows.filter((r) => DEPT_FINISHED.includes(r.status) && r.dueDate && deptFinishedAt(r)
    && dayKey(deptFinishedAt(r)) > dayKey(r.dueDate));
  const lateDaysOf = (r) => {
    const end = DEPT_FINISHED.includes(r.status) ? new Date(deptFinishedAt(r) || now) : now;
    return Math.max(0, workingDaysUntil(new Date(r.dueDate), end, holidaySet) ?? 0);
  };
  const everLate = [...currentOverdue, ...lateFinished];
  const lateDays = everLate.map(lateDaysOf);
  const avgLateDays = lateDays.length ? round(lateDays.reduce((s, v) => s + v, 0) / lateDays.length, 1) : 0;
  const lateCost = Math.round(COST_RATES.otRatePerHour * COST_RATES.otHoursPerLateDay * avgLateDays * everLate.length);
  const ongoingDays = currentOverdue.map(lateDaysOf).reduce((s, v) => s + v, 0);
  const ongoingCost = Math.round(COST_RATES.otRatePerHour * COST_RATES.otHoursPerLateDay * ongoingDays);

  // ── งานที่ถูกยกเลิกหลังลงมือ ──
  const startedAtCancel = (r) => (r.cancelledStage ? WORK_STARTED.includes(r.cancelledStage) : Boolean(r.approvedLv2At));
  const wastedRows = rows.filter((r) => r.status === STATUS.CANCELLED && startedAtCancel(r) && getCancelSource(r.cancelledSource)?.countsAsWasted);
  const wastedHours = round(wastedRows.reduce((s, r) => s + (WASTED_HOURS_BY_STAGE[r.cancelledStage] ?? 5), 0), 1);
  const wastedCost = Math.round(wastedHours * COST_RATES.laborRatePerHour);
  const wastedBySource = new Map();
  wastedRows.forEach((r) => {
    const meta = getCancelSource(r.cancelledSource);
    const hours = WASTED_HOURS_BY_STAGE[r.cancelledStage] ?? 5;
    const prev = wastedBySource.get(meta.code) || { code: meta.code, label: meta.short, count: 0, cost: 0, deptFault: meta.countsAsDeptFault };
    prev.count += 1;
    prev.cost += Math.round(hours * COST_RATES.laborRatePerHour);
    wastedBySource.set(meta.code, prev);
  });

  // ── งานแก้ไข (Rework) ──
  const perRevision = COST_RATES.reworkHoursPerRevision * COST_RATES.laborRatePerHour;
  const revisions = rows.filter((r) => r.isRevision);
  const reworkBySource = Object.entries(REWORK_SOURCES).map(([code, meta]) => {
    const count = revisions.filter((r) => r.revisionSource === code).length;
    return { code, ...meta, count, cost: Math.round(count * perRevision) };
  });
  const unknownRework = revisions.filter((r) => !REWORK_SOURCES[r.revisionSource]).length;
  const reworkCost = Math.round(revisions.length * perRevision);
  const reworkInternal = reworkBySource.filter((x) => x.internal).reduce((s, x) => s + x.cost, 0);

  return {
    late: { count: everLate.length, ongoingCount: currentOverdue.length, avgLateDays, cost: lateCost, ongoingCost },
    wasted: { count: wastedRows.length, hours: wastedHours, cost: wastedCost, bySource: [...wastedBySource.values()] },
    rework: { count: revisions.length, cost: reworkCost, internalCost: reworkInternal, bySource: reworkBySource, unknown: unknownRework },
    total: lateCost + wastedCost + reworkCost,
  };
}

/**
 * เวลาเฉลี่ย (วันทำงาน) ของแต่ละขั้น — จากงานที่ส่งมอบแล้วในชุดนี้ ใช้หาคอขวด
 * ใช้เฉพาะคำร้องที่มี timestamp ครบทั้งสองปลายของขั้นนั้น
 */
export function stageDurations(rows, holidaySet = new Set()) {
  const stages = [
    { key: "approve", label: "รับงาน + รออนุมัติเริ่มงาน", from: (r) => r.submittedAt, to: (r) => r.approvedLv2At },
    { key: "draw", label: "เขียนแบบ", from: (r) => r.approvedLv2At, to: (r) => r.deptFinishedAt },
    { key: "review", label: "ผู้จัดการตรวจ + ส่งมอบ", from: (r) => r.deptFinishedAt, to: (r) => r.deliveredAt || r.mgrApprovedAt },
    { key: "accept", label: "ผู้ร้องขอตรวจรับ", from: (r) => r.deliveredAt, to: (r) => r.doneAt },
  ];
  return stages.map((stage) => {
    const values = rows
      .map((r) => {
        const a = stage.from(r);
        const b = stage.to(r);
        if (!a || !b) return null;
        const days = workingDaysUntil(a, b, holidaySet);
        return days === null || days < 0 || days > 260 ? null : days;
      })
      .filter((v) => v !== null);
    return { ...stage, count: values.length, avg: values.length ? round(values.reduce((s, v) => s + v, 0) / values.length, 1) : null };
  });
}
