import { CLOSED_STATUSES, getCancelSource, STATUS } from "../../../config/schema.js";
import { showToast } from "../components/toast.js";
import { COST_RATES, computeCosts, stageDurations } from "../services/cost-service.js";
import { escapeHtml, workingDaysUntil } from "../utils.js";

// ══════════════════════════════════════════════════════════════
// บทสรุปผู้บริหาร (หน้าภาพรวม) — อ่านจุดเดียวเข้าใจทั้งหมด + คัดลอกไปใช้เป็นวาระประชุมได้
// นิยามตัวชี้วัดตรงกับ KPI ใน report.js (On-time / FTR / เกินกำหนด / ระยะเวลาเฉลี่ย)
// ══════════════════════════════════════════════════════════════

// เป้าหมาย/เกณฑ์ — ปรับได้ที่นี่ที่เดียว
const TARGET_ON_TIME = 90;      // % ส่งมอบตรงเวลา
const TARGET_FTR = 80;          // % ผ่านครั้งแรก (ไม่ต้องแก้ไข)
const WAIT_ALERT_WORKDAYS = 2;  // รออนุมัติ/รอตรวจนานเกินกี่วันทำการถึงยกเป็นประเด็น
const OVERLOAD_FACTOR = 1.5;    // ถืองานมากกว่าค่าเฉลี่ยทีมกี่เท่าถึงถือว่าภาระไม่สมดุล

const PERIODS = {
  month: { label: "เดือนนี้", prevLabel: "เดือนก่อน" },
  quarter: { label: "ไตรมาสนี้", prevLabel: "ไตรมาสก่อน" },
  year: { label: "ปีนี้", prevLabel: "ปีก่อน" },
};

const DEPT_FINISHED = [STATUS.MGR_REVIEW, STATUS.DELIVERED, STATUS.DONE];
const DELIVERED = [STATUS.DELIVERED, STATUS.DONE];
const REVISION_SOURCES = {
  "1.1": "ฝ่ายเขียนแบบ",
  "1.2": "ผู้ส่งคำร้อง",
  "1.3": "งานติดตั้ง",
  "1.4": "ลูกค้า",
};

let selectedPeriod = "month";

// ── ช่วงเวลา ──
function periodRange(key, offset = 0) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (key === "year") return { from: new Date(y - offset, 0, 1), to: new Date(y - offset + 1, 0, 1) };
  if (key === "quarter") {
    const q = Math.floor(m / 3) - offset;
    return { from: new Date(y, q * 3, 1), to: new Date(y, q * 3 + 3, 1) };
  }
  return { from: new Date(y, m - offset, 1), to: new Date(y, m - offset + 1, 1) };
}

function periodName(key, range) {
  const fmt = (opts) => new Intl.DateTimeFormat("th-TH", opts).format(range.from);
  if (key === "year") return `ปี ${fmt({ year: "numeric" }).replace(/\D+/g, "")}`;
  if (key === "quarter") return `ไตรมาส ${Math.floor(range.from.getMonth() / 3) + 1}/${fmt({ year: "numeric" }).replace(/\D+/g, "")}`;
  return fmt({ month: "long", year: "numeric" });
}

const inRange = (value, range) => {
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && d >= range.from && d < range.to;
};

const dayKey = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);

// ══════════════════════════════════════════════════════════════
// คำนวณ
// ══════════════════════════════════════════════════════════════

function periodStats(requests, range) {
  const submitted = requests.filter((r) => inRange(r.submittedAt, range));
  const delivered = requests.filter((r) => DELIVERED.includes(r.status) && inRange(r.deliveredAt, range));
  const withDue = delivered.filter((r) => r.dueDate);
  const onTime = withDue.filter((r) => dayKey(r.deliveredAt) <= dayKey(r.dueDate)).length;
  const ftr = delivered.filter((r) => !r.isRevision && !r.revisionReason).length;
  const cycle = delivered.filter((r) => r.submittedAt);
  const avgCycleDays = cycle.length
    ? Math.round((cycle.reduce((s, r) => s + (new Date(r.deliveredAt) - new Date(r.submittedAt)) / 86400000, 0) / cycle.length) * 10) / 10
    : null;
  const cancelled = requests.filter((r) => r.status === STATUS.CANCELLED && inRange(r.cancelledAt || r.submittedAt, range));
  const revisions = submitted.filter((r) => r.isRevision);
  return {
    submitted: submitted.length,
    delivered: delivered.length,
    onTimeRate: pct(onTime, withDue.length),
    ftrRate: pct(ftr, delivered.length),
    avgCycleDays,
    cancelled,
    revisions,
  };
}

export function buildExecutiveSummary(requests, holidaySet, periodKey = selectedPeriod) {
  const range = periodRange(periodKey, 0);
  const prevRange = periodRange(periodKey, 1);
  const cur = periodStats(requests, range);
  const prev = periodStats(requests, prevRange);
  const today = new Date();

  // ── สถานะ ณ ตอนนี้ (ไม่ขึ้นกับช่วงเวลา) ──
  const open = requests.filter((r) => !CLOSED_STATUSES.includes(r.status) && r.status !== STATUS.DELIVERED);
  const overdue = open
    .filter((r) => !DEPT_FINISHED.includes(r.status) && r.dueDate && dayKey(r.dueDate) < dayKey(today))
    .map((r) => ({ r, days: Math.abs(workingDaysUntil(today, r.dueDate, holidaySet) ?? 0) }))
    .sort((a, b) => b.days - a.days);

  const waitingLv2 = requests.filter((r) => r.status === STATUS.INPROGRESS_LV1)
    .map((r) => ({ r, days: workingDaysUntil(r.submittedAt, today, holidaySet) ?? 0 }));
  const waitingReview = requests.filter((r) => r.status === STATUS.MGR_REVIEW)
    .map((r) => ({ r, days: workingDaysUntil(r.deptFinishedAt || r.submittedAt, today, holidaySet) ?? 0 }));
  const waitingRequester = requests.filter((r) => r.status === STATUS.DELIVERED);
  const pendingPickup = requests.filter((r) => r.status === STATUS.PENDING);

  // ภาระงานรายคน — งานที่ยังอยู่ในมือฝ่ายเขียนแบบ
  const inHand = open.filter((r) => [STATUS.APPROVED, STATUS.WORKING, STATUS.MGR_REJECTED].includes(r.status) && r.assignedToName);
  const loadMap = new Map();
  inHand.forEach((r) => loadMap.set(r.assignedToName, (loadMap.get(r.assignedToName) || 0) + 1));
  const loads = [...loadMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  const avgLoad = loads.length ? inHand.length / loads.length : 0;

  const revisionBySource = Object.entries(REVISION_SOURCES)
    .map(([code, label]) => ({ code, label, count: cur.revisions.filter((r) => r.revisionSource === code).length }))
    .filter((x) => x.count);
  const cancelBySource = new Map();
  cur.cancelled.forEach((r) => {
    const meta = getCancelSource(r.cancelledSource);
    const label = meta ? meta.short : "ไม่ระบุต้นเหตุ";
    cancelBySource.set(label, (cancelBySource.get(label) || 0) + 1);
  });

  // ── ต้นทุน (สูตรเดียวกับ KPI — ชุดคำร้องที่ส่งเข้ามาในช่วง) ──
  const submittedIn = (range) => requests.filter((r) => inRange(r.submittedAt || r.dueDate, range));
  const curRows = submittedIn(range);
  const costs = computeCosts(curRows, holidaySet, today);
  const prevCosts = computeCosts(submittedIn(prevRange), holidaySet, today);

  // ── เวลาแต่ละขั้น (จากงานที่ส่งมอบในช่วงนี้) → คอขวด ──
  const deliveredIn = requests.filter((r) => DELIVERED.includes(r.status) && inRange(r.deliveredAt, range));
  const stages = stageDurations(deliveredIn, holidaySet);
  const bottleneck = stages.filter((x) => x.avg !== null).sort((a, b) => b.avg - a.avg)[0] || null;

  // ── โครงการที่ใช้กำลังคนมากสุด ──
  const projectMap = new Map();
  curRows.forEach((r) => {
    const name = r.projectName || "ไม่ระบุโครงการ";
    projectMap.set(name, (projectMap.get(name) || 0) + 1);
  });
  const topProjects = [...projectMap.entries()].map(([name, count]) => ({ name, count, share: pct(count, curRows.length) }))
    .sort((a, b) => b.count - a.count).slice(0, 3);

  // ── โอกาสลดต้นทุน (เรียงตามมูลค่า) ──
  const baht = (n) => `${Math.round(n).toLocaleString("th-TH")} ฿`;
  const externalRework = costs.rework.bySource.filter((x) => !x.internal && x.count);
  const opportunities = [
    costs.late.ongoingCount && {
      value: costs.late.ongoingCost,
      title: `งานที่ยังเกินกำหนด ${costs.late.ongoingCount} งาน — ถ้าต้อง OT เร่งให้ทัน ~${baht(costs.late.ongoingCost)}`,
      action: "เกลี่ยงานให้คนที่ภาระน้อย และตั้งกำหนดส่งให้สมจริงตั้งแต่ตอนรับงาน",
    },
    costs.rework.internalCost && {
      value: costs.rework.internalCost,
      title: `แก้ไขจากฝ่ายเขียนแบบเอง (1.1) ${costs.rework.bySource.find((x) => x.code === "1.1").count} ครั้ง ~${baht(costs.rework.internalCost)} — ควบคุมได้เอง`,
      action: `ใช้ checklist ตรวจแบบก่อนส่ง ลดได้ครึ่งหนึ่ง = ประหยัด ~${baht(costs.rework.internalCost / 2)}`,
    },
    externalRework.length && {
      value: externalRework.reduce((sum, x) => sum + x.cost, 0),
      title: `แก้ไขจากภายนอก ${externalRework.map((x) => `${x.label} ${x.count}`).join(", ")} ครั้ง ~${baht(externalRework.reduce((sum, x) => sum + x.cost, 0))}`,
      action: "ขอข้อมูลให้ครบก่อนเริ่มงาน / ยืนยันแบบกับลูกค้าเร็วขึ้น / พิจารณาคิดค่าแก้ไขกับโครงการ",
    },
    costs.wasted.count && {
      value: costs.wasted.cost,
      title: `ยกเลิกหลังลงมือทำแล้ว ${costs.wasted.count} งาน (${costs.wasted.hours} ชม.) ~${baht(costs.wasted.cost)}`,
      action: "ยืนยันแผน/ข้อมูลกับผู้ร้องขอก่อนอนุมัติเริ่มงาน",
    },
  ].filter(Boolean).sort((a, b) => b.value - a.value);

  // ── สถานะรวม (ไฟจราจร) ──
  const overdueShare = open.length ? overdue.length / open.length : 0;
  let level = "green";
  if (overdueShare >= 0.15 || (cur.onTimeRate !== null && cur.onTimeRate < 70)) level = "red";
  else if (overdue.length || (cur.onTimeRate !== null && cur.onTimeRate < TARGET_ON_TIME)
    || waitingLv2.some((w) => w.days > WAIT_ALERT_WORKDAYS) || waitingReview.some((w) => w.days > WAIT_ALERT_WORKDAYS)) level = "yellow";

  // ── ประเด็นเสนอเข้าวาระประชุม ──
  const agenda = [];
  if (overdue.length) {
    const top = overdue[0];
    agenda.push({
      tone: "red",
      title: `งานเกินกำหนด ${overdue.length} รายการ`,
      detail: `นานสุด ${top.days} วันทำงาน — ${top.r.requestNo} ${top.r.projectName || ""} (${top.r.assignedToName || "ยังไม่มีผู้รับผิดชอบ"})`,
      action: "ทบทวนกำหนดส่งกับผู้ร้องขอ และจัดคนช่วยงานที่ค้างนานที่สุด",
    });
  }
  if (costs.total > 0 && opportunities.length) {
    const costGrowth = prevCosts.total ? Math.round(((costs.total - prevCosts.total) / prevCosts.total) * 100) : null;
    agenda.push({
      tone: "amber",
      title: `ต้นทุนที่ควบคุมได้ ~${baht(costs.total)}${costGrowth !== null ? ` (${costGrowth >= 0 ? "+" : ""}${costGrowth}% จาก${PERIODS[periodKey].prevLabel})` : ""}`,
      detail: `งานล่าช้า ${baht(costs.late.cost)} · งานแก้ไข ${baht(costs.rework.cost)} · งานที่ถูกยกเลิก ${baht(costs.wasted.cost)}`,
      action: opportunities[0].action,
    });
  }
  const overloaded = loads.filter((l) => avgLoad && l.count >= Math.max(3, avgLoad * OVERLOAD_FACTOR));
  if (overloaded.length) {
    agenda.push({
      tone: "amber",
      title: "ภาระงานไม่สมดุล",
      detail: `${overloaded.map((l) => `${l.name} ${l.count} งาน`).join(", ")} (เฉลี่ยทีม ${avgLoad.toFixed(1)} งาน/คน)`,
      action: "กระจายงานใหม่ หรือให้ผู้จัดการมอบหมายงานถัดไปให้คนที่ภาระน้อยกว่า",
    });
  }
  const slowLv2 = waitingLv2.filter((w) => w.days > WAIT_ALERT_WORKDAYS);
  const slowReview = waitingReview.filter((w) => w.days > WAIT_ALERT_WORKDAYS);
  if (slowLv2.length || slowReview.length) {
    agenda.push({
      tone: "amber",
      title: "งานรอผู้จัดการนานเกิน " + WAIT_ALERT_WORKDAYS + " วันทำการ",
      detail: [slowLv2.length && `รออนุมัติเริ่มงาน ${slowLv2.length} รายการ`, slowReview.length && `รอตรวจ+ส่งมอบ ${slowReview.length} รายการ`].filter(Boolean).join(" · "),
      action: "กำหนดรอบอนุมัติประจำวัน / มอบสิทธิ์ผู้อนุมัติสำรอง",
    });
  }
  if (cur.onTimeRate !== null && cur.onTimeRate < TARGET_ON_TIME) {
    agenda.push({
      tone: cur.onTimeRate < 70 ? "red" : "amber",
      title: `ส่งมอบตรงเวลา ${cur.onTimeRate}% (เป้า ${TARGET_ON_TIME}%)`,
      detail: `${PERIODS[periodKey].label}ส่งมอบ ${cur.delivered} รายการ${prev.onTimeRate !== null ? ` · ${PERIODS[periodKey].prevLabel} ${prev.onTimeRate}%` : ""}`,
      action: "วิเคราะห์สาเหตุงานช้า (ข้อมูลไม่ครบ / รออนุมัติ / ภาระงาน) และกำหนดกำหนดส่งให้สมจริง",
    });
  }
  const deptRevisions = revisionBySource.find((x) => x.code === "1.1");
  const ftrBelowTarget = cur.ftrRate !== null && cur.ftrRate < TARGET_FTR;
  if (ftrBelowTarget || deptRevisions) {
    agenda.push({
      tone: ftrBelowTarget ? "amber" : "gray",
      title: ftrBelowTarget
        ? `คุณภาพงาน — ผ่านครั้งแรก ${cur.ftrRate}% (เป้า ${TARGET_FTR}%)`
        : `มีคำขอแก้ไขสาเหตุจากฝ่ายเขียนแบบ ${deptRevisions.count} ครั้ง (FTR ${cur.ftrRate ?? "—"}% ผ่านเป้า)`,
      detail: revisionBySource.length
        ? `คำขอแก้ไข${PERIODS[periodKey].label}: ${revisionBySource.map((x) => `${x.code} ${x.label} ${x.count}`).join(", ")}`
        : "ยังไม่มีคำขอแก้ไขในช่วงนี้",
      action: deptRevisions ? "ทบทวน checklist ตรวจแบบก่อนส่ง (สาเหตุ 1.1 นับเป็น KPI ฝ่าย)" : "ติดตามสาเหตุการแก้ไขจากผู้ร้องขอ/ลูกค้า",
    });
  }
  const growth = prev.submitted ? Math.round(((cur.submitted - prev.submitted) / prev.submitted) * 100) : null;
  if (growth !== null && growth >= 20) {
    agenda.push({
      tone: "blue",
      title: `คำร้องใหม่เพิ่มขึ้น ${growth}%`,
      detail: `${cur.submitted} รายการ เทียบ ${prev.submitted} รายการ${PERIODS[periodKey].prevLabel}`,
      action: "ประเมินกำลังคน / ลำดับความสำคัญของโครงการช่วงถัดไป",
    });
  }
  if (cur.cancelled.length) {
    agenda.push({
      tone: "gray",
      title: `ยกเลิกคำร้อง ${cur.cancelled.length} รายการ`,
      detail: [...cancelBySource.entries()].map(([k, v]) => `${k} ${v}`).join(", "),
      action: "ตรวจต้นเหตุการยกเลิกที่ทำให้เสียแรงงาน",
    });
  }

  return {
    periodKey,
    periodName: periodName(periodKey, range),
    prevName: periodName(periodKey, prevRange),
    cur, prev, growth,
    open: open.length, overdue, waitingLv2, waitingReview, waitingRequester, pendingPickup,
    loads, avgLoad, level, agenda: agenda.slice(0, 5),
    costs, prevCosts, opportunities, stages, bottleneck, topProjects, deliveredCount: deliveredIn.length,
  };
}

// ══════════════════════════════════════════════════════════════
// แสดงผล
// ══════════════════════════════════════════════════════════════

const LEVELS = {
  green: { icon: "🟢", label: "ปกติ", note: "งานเดินตามแผน" },
  yellow: { icon: "🟡", label: "ต้องติดตาม", note: "มีบางจุดที่ควรเร่ง" },
  red: { icon: "🔴", label: "ต้องเร่งแก้", note: "งานล่าช้าเกินเกณฑ์" },
};

function trend(cur, prev, { invert = false, unit = "", money = false } = {}) {
  if (cur === null || prev === null || prev === undefined) return "";
  const diff = Math.round((cur - prev) * 10) / 10;
  if (!diff) return `<small class="exec-trend is-flat">เท่าเดิม</small>`;
  const good = invert ? diff < 0 : diff > 0;
  const amount = money ? `${Math.round(Math.abs(diff)).toLocaleString("th-TH")} ฿` : `${Math.abs(diff)}${unit}`;
  return `<small class="exec-trend ${good ? "is-good" : "is-bad"}">${diff > 0 ? "▲" : "▼"} ${amount}</small>`;
}

function headline(s) {
  const p = PERIODS[s.periodKey];
  const growthText = s.growth === null ? "" : ` (${s.growth >= 0 ? "เพิ่มขึ้น" : "ลดลง"} ${Math.abs(s.growth)}% จาก${p.prevLabel})`;
  const onTime = s.cur.onTimeRate === null ? "" : ` ตรงเวลา ${s.cur.onTimeRate}%`;
  return `${s.periodName} รับคำร้องใหม่ ${s.cur.submitted} รายการ${growthText} ส่งมอบแล้ว ${s.cur.delivered} รายการ${onTime}`
    + ` · ปัจจุบันมีงานค้าง ${s.open} รายการ เกินกำหนด ${s.overdue.length} รายการ`;
}

export function renderExecutiveSummary(state) {
  const holidaySet = new Set((state.masterData?.holidays || [])
    .map((h) => h.HolidayDate || h.holidayDate).filter(Boolean).map((d) => new Date(d).toDateString()));
  const s = buildExecutiveSummary(state.requests || [], holidaySet, selectedPeriod);
  const lv = LEVELS[s.level];
  const p = PERIODS[s.periodKey];

  const watch = [
    ...s.overdue.slice(0, 3).map(({ r, days }) => ({
      icon: "⏰", tone: "red",
      text: `<b>${escapeHtml(r.requestNo)}</b> ${escapeHtml(r.projectName || "")} — เกิน ${days} วันทำงาน · ${escapeHtml(r.assignedToName || "ยังไม่มีผู้รับผิดชอบ")}`,
    })),
    s.pendingPickup.length && { icon: "📥", tone: "amber", text: `รอฝ่ายเขียนแบบรับงาน <b>${s.pendingPickup.length}</b> รายการ` },
    s.waitingLv2.length && { icon: "✅", tone: "amber", text: `รอผู้จัดการอนุมัติเริ่มงาน <b>${s.waitingLv2.length}</b> รายการ` },
    s.waitingReview.length && { icon: "🔍", tone: "amber", text: `รอผู้จัดการตรวจ+ส่งมอบ <b>${s.waitingReview.length}</b> รายการ` },
    s.waitingRequester.length && { icon: "📦", tone: "blue", text: `ส่งมอบแล้ว รอผู้ร้องขอตรวจรับ <b>${s.waitingRequester.length}</b> รายการ` },
    s.loads[0] && { icon: "👥", tone: "gray", text: `ภาระสูงสุด <b>${escapeHtml(s.loads[0].name)}</b> ${s.loads[0].count} งาน (เฉลี่ยทีม ${s.avgLoad.toFixed(1)})` },
  ].filter(Boolean);

  const section = document.createElement("section");
  section.className = "exec-summary";
  section.innerHTML = `
    <header class="exec-head">
      <div>
        <p class="exec-kicker">บทสรุปผู้บริหาร</p>
        <h2>📌 สรุปสถานการณ์งานเขียนแบบ — ${escapeHtml(s.periodName)}</h2>
      </div>
      <div class="exec-controls">
        <div class="exec-period" role="tablist">
          ${Object.entries(PERIODS).map(([key, v]) => `<button type="button" data-exec-period="${key}" class="${key === s.periodKey ? "is-active" : ""}">${v.label}</button>`).join("")}
        </div>
        <button type="button" class="secondary-button exec-copy" data-exec-copy>📋 คัดลอกเป็นวาระประชุม</button>
      </div>
    </header>

    <div class="exec-status exec-level-${s.level}">
      <span class="exec-light">${lv.icon}</span>
      <div>
        <strong>สถานะรวม: ${lv.label}</strong>
        <p>${escapeHtml(headline(s))}</p>
      </div>
    </div>

    <div class="exec-kpis">
      <div class="exec-kpi"><span>คำร้องใหม่</span><strong>${s.cur.submitted}</strong>${trend(s.cur.submitted, s.prev.submitted)}<small>${p.prevLabel} ${s.prev.submitted}</small></div>
      <div class="exec-kpi"><span>ส่งมอบแล้ว</span><strong>${s.cur.delivered}</strong>${trend(s.cur.delivered, s.prev.delivered)}<small>${p.prevLabel} ${s.prev.delivered}</small></div>
      <div class="exec-kpi"><span>ส่งตรงเวลา</span><strong>${s.cur.onTimeRate ?? "—"}${s.cur.onTimeRate !== null ? "%" : ""}</strong>${trend(s.cur.onTimeRate, s.prev.onTimeRate, { unit: "%" })}<small>เป้า ${TARGET_ON_TIME}%</small></div>
      <div class="exec-kpi"><span>ผ่านครั้งแรก (FTR)</span><strong>${s.cur.ftrRate ?? "—"}${s.cur.ftrRate !== null ? "%" : ""}</strong>${trend(s.cur.ftrRate, s.prev.ftrRate, { unit: "%" })}<small>เป้า ${TARGET_FTR}%</small></div>
      <div class="exec-kpi ${s.overdue.length ? "is-alert" : ""}"><span>เกินกำหนด (ตอนนี้)</span><strong>${s.overdue.length}</strong><small>จากงานค้าง ${s.open} รายการ</small></div>
      <div class="exec-kpi"><span>เวลาเฉลี่ย รับ→ส่งมอบ</span><strong>${s.cur.avgCycleDays ?? "—"}</strong>${trend(s.cur.avgCycleDays, s.prev.avgCycleDays, { invert: true })}<small>วัน (ปฏิทิน)</small></div>
    </div>

${renderCostBlock(s)}

    <div class="exec-cols">
      <div class="exec-col">
        <h3>⚠️ สิ่งที่ต้องติดตามตอนนี้</h3>
        ${watch.length
          ? `<ul class="exec-watch">${watch.map((w) => `<li class="tone-${w.tone}"><span>${w.icon}</span><p>${w.text}</p></li>`).join("")}</ul>`
          : `<p class="exec-empty">✅ ไม่มีงานค้างที่ต้องติดตาม</p>`}
      </div>
      <div class="exec-col">
        <h3>🗓️ ประเด็นเสนอเข้าวาระประชุม</h3>
        ${s.agenda.length
          ? `<ol class="exec-agenda">${s.agenda.map((a) => `
              <li class="tone-${a.tone}">
                <strong>${escapeHtml(a.title)}</strong>
                <p>${escapeHtml(a.detail)}</p>
                <p class="exec-action">➜ ${escapeHtml(a.action)}</p>
              </li>`).join("")}</ol>`
          : `<p class="exec-empty">✅ ไม่มีประเด็นเร่งด่วน — งานเป็นไปตามเป้าหมาย</p>`}
      </div>
    </div>
    <p class="exec-foot">ตัวเลข${p.label}นับจากวันส่งคำร้อง/วันส่งมอบในช่วง ${escapeHtml(s.periodName)} เทียบ ${escapeHtml(s.prevName)} · งานค้าง/เกินกำหนด/รออนุมัติ เป็นสถานะ ณ ตอนนี้ · นิยามเดียวกับส่วน KPI ด้านล่าง</p>
  `;

  section.querySelectorAll("[data-exec-period]").forEach((btn) => btn.addEventListener("click", () => {
    selectedPeriod = btn.dataset.execPeriod;
    section.replaceWith(renderExecutiveSummary(state));
  }));
  section.querySelector("[data-exec-copy]").addEventListener("click", () => copyAgenda(s, watch));
  return section;
}

const baht = (n) => `${Math.round(n || 0).toLocaleString("th-TH")} ฿`;

function renderCostBlock(s) {
  const c = s.costs;
  const p = PERIODS[s.periodKey];
  const maxStage = Math.max(1, ...s.stages.map((x) => x.avg || 0));
  return `
    <div class="exec-cost">
      <h3>💰 ต้นทุนที่ควบคุมได้ <small>(ประมาณการ · คำร้องที่เข้ามา${p.label})</small></h3>
      <div class="exec-cost-tiles">
        <div class="exec-kpi exec-cost-total"><span>รวม</span><strong>${baht(c.total)}</strong>${trend(c.total, s.prevCosts.total, { invert: true, money: true })}<small>${p.prevLabel} ${baht(s.prevCosts.total)}</small></div>
        <div class="exec-kpi"><span>⏰ งานล่าช้า (OT)</span><strong>${baht(c.late.cost)}</strong><small>${c.late.count} งาน · ช้าเฉลี่ย ${c.late.avgLateDays} วันทำงาน</small></div>
        <div class="exec-kpi"><span>✏️ งานแก้ไข (Rework)</span><strong>${baht(c.rework.cost)}</strong><small>${c.rework.count} ครั้ง · ควบคุมได้เอง ${baht(c.rework.internalCost)}</small></div>
        <div class="exec-kpi"><span>🗑️ งานที่ถูกยกเลิก</span><strong>${baht(c.wasted.cost)}</strong><small>${c.wasted.count} งาน · ${c.wasted.hours} ชม.</small></div>
      </div>
      <div class="exec-cols">
        <div class="exec-col">
          <h3>💡 โอกาสลดต้นทุน</h3>
          ${s.opportunities.length
            ? `<ul class="exec-watch">${s.opportunities.map((o) => `<li class="tone-amber"><span>💡</span><p><b>${escapeHtml(o.title)}</b><br><small>➜ ${escapeHtml(o.action)}</small></p></li>`).join("")}</ul>`
            : `<p class="exec-empty">✅ ไม่มีต้นทุนที่ควบคุมได้ในช่วงนี้</p>`}
        </div>
        <div class="exec-col">
          <h3>⏱️ เวลาแต่ละขั้นตอน <small>(วันทำงานเฉลี่ย · ${s.deliveredCount} งานที่ส่งมอบ${p.label})</small></h3>
          <div class="exec-stages">
            ${s.stages.map((x) => `
              <div class="exec-stage ${s.bottleneck && x.key === s.bottleneck.key ? "is-bottleneck" : ""}">
                <span>${escapeHtml(x.label)}${s.bottleneck && x.key === s.bottleneck.key ? " · คอขวด" : ""}</span>
                <div class="exec-stage-bar"><i style="width:${x.avg === null ? 0 : Math.max(4, (x.avg / maxStage) * 100)}%"></i></div>
                <b>${x.avg === null ? "—" : `${x.avg} วัน`}</b>
              </div>`).join("")}
          </div>
          ${s.topProjects.length ? `
            <h3 style="margin-top:14px;">🏗️ โครงการที่ใช้กำลังคนมากสุด</h3>
            <ul class="exec-projects">
              ${s.topProjects.map((x) => `<li><span>${escapeHtml(x.name)}</span><b>${x.count} คำร้อง · ${x.share}%</b></li>`).join("")}
            </ul>` : ""}
        </div>
      </div>
      <p class="exec-foot">สมมติฐาน: OT ${COST_RATES.otRatePerHour} ฿/ชม. × ${COST_RATES.otHoursPerLateDay} ชม. ต่อวันทำงานที่ล่าช้า · ค่าแรง ${COST_RATES.laborRatePerHour} ฿/ชม. · แก้ไข ${COST_RATES.reworkHoursPerRevision} ชม./ครั้ง · ยกเลิกคิดชั่วโมงตามขั้นที่ทำไปแล้ว (รหัส 2.1–2.4) — ตัวเลขประมาณการเพื่อดูแนวโน้ม ปรับอัตราได้ใน config.js</p>
    </div>`;
}

// ── ข้อความสำหรับวาระประชุม (วางใน Teams / Email / Word ได้) ──
function agendaText(s) {
  const lv = LEVELS[s.level];
  const p = PERIODS[s.periodKey];
  const today = new Intl.DateTimeFormat("th-TH", { dateStyle: "long" }).format(new Date());
  const lines = [
    `สรุปสถานการณ์งานเขียนแบบ (PPG Drawing e-Service) — ${s.periodName}`,
    `ข้อมูล ณ ${today}`,
    "",
    `สถานะรวม: ${lv.icon} ${lv.label} — ${lv.note}`,
    headline(s),
    "",
    "ตัวเลขหลัก",
    `• คำร้องใหม่ ${s.cur.submitted} รายการ (${p.prevLabel} ${s.prev.submitted})`,
    `• ส่งมอบแล้ว ${s.cur.delivered} รายการ (${p.prevLabel} ${s.prev.delivered})`,
    `• ส่งมอบตรงเวลา ${s.cur.onTimeRate ?? "—"}${s.cur.onTimeRate !== null ? "%" : ""} (เป้า ${TARGET_ON_TIME}%)`,
    `• ผ่านครั้งแรก (FTR) ${s.cur.ftrRate ?? "—"}${s.cur.ftrRate !== null ? "%" : ""} (เป้า ${TARGET_FTR}%)`,
    `• เวลาเฉลี่ยรับ→ส่งมอบ ${s.cur.avgCycleDays ?? "—"} วัน`,
    `• งานค้าง ${s.open} รายการ · เกินกำหนด ${s.overdue.length} รายการ · รออนุมัติเริ่มงาน ${s.waitingLv2.length} · รอตรวจส่งมอบ ${s.waitingReview.length} · รอผู้ร้องขอตรวจรับ ${s.waitingRequester.length}`,
    "",
    "ต้นทุนที่ควบคุมได้ (ประมาณการ)",
    `• รวม ${baht(s.costs.total)} (${p.prevLabel} ${baht(s.prevCosts.total)})`,
    `• งานล่าช้า (OT) ${baht(s.costs.late.cost)} — ${s.costs.late.count} งาน ช้าเฉลี่ย ${s.costs.late.avgLateDays} วันทำงาน`,
    `• งานแก้ไข ${baht(s.costs.rework.cost)} — ${s.costs.rework.count} ครั้ง (ควบคุมได้เอง ${baht(s.costs.rework.internalCost)})`,
    `• งานที่ถูกยกเลิกหลังลงมือ ${baht(s.costs.wasted.cost)} — ${s.costs.wasted.count} งาน`,
    ...(s.opportunities.length ? ["", "โอกาสลดต้นทุน", ...s.opportunities.map((o) => `- ${o.title}\n  ➜ ${o.action}`)] : []),
    ...(s.bottleneck ? ["", `คอขวด: ${s.bottleneck.label} เฉลี่ย ${s.bottleneck.avg} วันทำงาน (${s.stages.map((x) => `${x.label} ${x.avg ?? "—"}`).join(" / ")})`] : []),
    ...(s.topProjects.length ? [`โครงการหลัก: ${s.topProjects.map((x) => `${x.name} ${x.count} คำร้อง (${x.share}%)`).join(", ")}`] : []),
    "",
    "ประเด็นเสนอเข้าวาระประชุม",
  ];
  if (s.agenda.length) {
    s.agenda.forEach((a, i) => {
      lines.push(`${i + 1}. ${a.title}`);
      lines.push(`   - ${a.detail}`);
      lines.push(`   - ข้อเสนอ: ${a.action}`);
    });
  } else {
    lines.push("- ไม่มีประเด็นเร่งด่วน งานเป็นไปตามเป้าหมาย");
  }
  if (s.overdue.length) {
    lines.push("", "งานเกินกำหนดที่ค้างนานที่สุด");
    s.overdue.slice(0, 5).forEach(({ r, days }) => lines.push(`- ${r.requestNo} ${r.projectName || ""} — เกิน ${days} วันทำงาน (${r.assignedToName || "ยังไม่มีผู้รับผิดชอบ"})`));
  }
  return lines.join("\n");
}

async function copyAgenda(s) {
  const text = agendaText(s);
  try {
    await navigator.clipboard.writeText(text);
    showToast("คัดลอกสรุปสำหรับวาระประชุมแล้ว — วางใน Teams / Email / Word ได้เลย", "success");
  } catch {
    // บางเบราว์เซอร์/สิทธิ์ไม่ให้เขียน clipboard — ใช้ textarea ชั่วคราวแทน
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:0;";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    showToast(ok ? "คัดลอกสรุปสำหรับวาระประชุมแล้ว" : "คัดลอกไม่สำเร็จ — กรุณาลองใหม่", ok ? "success" : "error");
  }
}
