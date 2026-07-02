import { CLOSED_STATUSES, STATUS } from "../../../config/schema.js";
import { getDrawingTeamMembers } from "../services/team-service.js";
import { escapeHtml, formatDateOnly } from "../utils.js";

// ── ค่า OT rate เริ่มต้น (บาท/ชั่วโมง) สำหรับคำนวณ Overdue Cost
const OT_RATE_PER_HOUR = 94; // ค่าแรงขั้นต่ำวิชาชีพเฉพาะ (บาท/ชม.)
const OT_HOURS_PER_DAY = 2;    // ชม. OT ต่อวัน เพื่อเร่งงาน
const WORK_HOURS_PER_DAY = 8;

export function renderReport(view, state) {
  const team = getDrawingTeamMembers();
  view.innerHTML = `
    <!-- ═══ REPORT BUILDER ═══ -->
    <section class="content-section report-builder">
      <div class="section-header report-builder-header">
        <div>
          <h2>สร้างรายงานสรุป</h2>
          <p>รายงานแบบหน้าเดียว สำหรับส่งผู้บริหาร</p>
        </div>
        <div class="report-header-actions">
          <button id="print-executive-report" class="primary-button" type="button">🖨️ พิมพ์ / บันทึกเป็น PDF</button>
        </div>
      </div>
      <div class="report-filter-bar">
        <label class="track-select-filter">
          <span>ขอบเขตรายงาน</span>
          <select id="report-scope">
            <option value="department" selected>ทั้งแผนก</option>
            <option value="individual">รายบุคคล</option>
          </select>
        </label>
        <label class="track-select-filter">
          <span>ช่วงเวลา</span>
          <select id="report-period">
            <option value="all" selected>ทั้งหมด</option>
            <option value="month">รายเดือน</option>
            <option value="day">รายวัน</option>
            <option value="year">รายปี</option>
          </select>
        </label>
        <label id="report-person-field" class="track-select-filter" hidden>
          <span>ผู้รับผิดชอบ</span>
          <select id="report-person">
            ${team.map((user) => `<option value="${escapeHtml(user.email)}">${escapeHtml(user.name)}</option>`).join("")}
          </select>
        </label>
        <label class="track-select-filter">
          <span>รายการท้ายรายงาน</span>
          <select id="report-detail-mode">
            <option value="all">รายละเอียดงานทั้งหมด</option>
            <option value="attention">งานที่ควรติดตาม</option>
          </select>
        </label>
      </div>
    </section>
    <section id="executive-report-preview" class="executive-report-sheet"></section>
  `;

  // ── Report Builder ──
  const scope      = view.querySelector("#report-scope");
  const period     = view.querySelector("#report-period");
  const personField = view.querySelector("#report-person-field");
  const person     = view.querySelector("#report-person");
  const detailMode = view.querySelector("#report-detail-mode");
  const preview    = view.querySelector("#executive-report-preview");

  const update = () => {
    personField.hidden = scope.value !== "individual";
    const selectedPerson = team.find((user) => user.email === person.value);
    const rows = filterReportRows(state.requests, period.value, scope.value === "individual" ? selectedPerson : null);
    preview.innerHTML = renderExecutiveReport(rows, {
      scope: scope.value, period: period.value, person: selectedPerson, detailMode: detailMode.value,
    });
  };

  scope.addEventListener("change", update);
  period.addEventListener("change", update);
  person.addEventListener("change", update);
  detailMode.addEventListener("change", update);
  view.querySelector("#print-executive-report").addEventListener("click", () => window.print());
  update();
}

// ════════════════════════════════════════════════════════════
// KPI DASHBOARD
// ════════════════════════════════════════════════════════════

function filterByKpiPeriod(requests, period, person = null, customRange = null) {
  const now = new Date();
  return requests.filter((r) => {
    if (person) {
      const match = String(r.assignedToEmail || "").toLowerCase() === person.email.toLowerCase();
      if (!match) return false;
    }
    const d = new Date(r.submittedAt || r.dueDate);
    if (isNaN(d)) return false;
    if (customRange) return d >= customRange.from && d <= customRange.to;
    if (period === "all")     return true;
    if (period === "year")    return d.getFullYear() === now.getFullYear();
    if (period === "quarter") {
      const q = Math.floor(now.getMonth() / 3);
      return d.getFullYear() === now.getFullYear() && Math.floor(d.getMonth() / 3) === q;
    }
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
}

function kpiCard(icon, label, value, sub, color = "#005DAC") {
  return `<div style="background:#fff;border-radius:12px;padding:16px 18px;border:1px solid #E2E8F0;box-shadow:0 2px 6px rgba(0,0,0,0.06);display:flex;flex-direction:column;gap:5px;">
    <div style="font-size:18px;">${icon}</div>
    <div style="font-size:11px;color:#64748B;font-weight:500;">${label}</div>
    <div style="font-size:24px;font-weight:800;color:${color};line-height:1.1;">${value}</div>
    <div style="font-size:10px;color:#94A3B8;">${sub}</div>
  </div>`;
}

function mBar(label, pct, color, right) {
  return `<div style="display:grid;grid-template-columns:1fr 120px 60px;align-items:center;gap:8px;margin-bottom:8px;">
    <div style="font-size:12px;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(label)}</div>
    <div style="background:#F1F5F9;border-radius:4px;height:8px;overflow:hidden;">
      <div style="background:${color};height:100%;width:${Math.min(100,Math.max(0,pct))}%;border-radius:4px;"></div>
    </div>
    <div style="font-size:11px;color:#64748B;text-align:right;white-space:nowrap;">${right}</div>
  </div>`;
}

function gauge(label, value, target, desc, invert = false) {
  const pct   = Math.min(100, value);
  const good  = invert ? value <= target : value >= target;
  const warn  = invert ? value <= target * 1.5 : value >= target * 0.7;
  const color = good ? "#0DB14B" : warn ? "#F59E0B" : "#EF4444";
  return `<div style="margin-bottom:12px;">
    <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
      <span style="font-size:12px;color:#334155;font-weight:500;">${label}</span>
      <span style="font-size:12px;font-weight:700;color:${color};">${value}%</span>
    </div>
    <div style="background:#F1F5F9;border-radius:4px;height:10px;overflow:hidden;">
      <div style="background:${color};height:100%;width:${pct}%;border-radius:4px;"></div>
    </div>
    <div style="font-size:10px;color:#94A3B8;margin-top:2px;">${desc} · เป้าหมาย ${invert ? "<" : ">"} ${target}%</div>
  </div>`;
}

function tip(color, border, text) {
  return `<div style="padding:9px 12px;background:${color};border-radius:8px;border-left:3px solid ${border};font-size:11.5px;color:#1E293B;margin-bottom:8px;">${text}</div>`;
}

function pBox(title, content, span = "") {
  return `<div style="background:#fff;border-radius:12px;padding:18px 20px;border:1px solid #E2E8F0;box-shadow:0 2px 6px rgba(0,0,0,0.06);${span}">
    <div style="font-size:13px;font-weight:700;color:#1E293B;margin-bottom:14px;">${title}</div>
    ${content}
  </div>`;
}

export function renderKpiDashboard(allRequests, team, period, person = null, customRange = null) {
  const rows      = filterByKpiPeriod(allRequests, period, person, customRange);
  const total     = rows.length;
  const done      = rows.filter((r) => r.status === STATUS.DONE).length;
  const active    = rows.filter((r) => !CLOSED_STATUSES.includes(r.status)).length;
  const cancelled = rows.filter((r) => [STATUS.CANCELLED, STATUS.REJECTED].includes(r.status)).length;
  const now       = new Date();

  // งานเกินกำหนด (active) — เปรียบเทียบแค่วันที่ ไม่รวมเวลา เพื่อหลีกเลี่ยง timezone offset
  // (dueDate เก็บเป็น UTC midnight → ต้องแปลงเป็น local date ก่อนเปรียบเทียบ)
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  const overdueRows = rows.filter((r) => {
    if (CLOSED_STATUSES.includes(r.status) || !r.dueDate) return false;
    const d = new Date(r.dueDate);
    const dueDateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    return dueDateStr < todayStr; // เกินกำหนดจริง = วันครบกำหนดผ่านไปแล้ว (วันนี้ยังไม่นับ)
  });
  const overdue     = overdueRows.length;

  // Revision / Rework
  const withRevise = rows.filter((r) => r.isRevision || (r.reviseNumber && r.reviseNumber !== "0" && r.reviseNumber !== "")).length;
  const rejected   = rows.filter((r) => r.revisionReason || r.rejectReason).length;

  // FTR — นับจากงานที่ฝ่ายส่งมอบแล้ว (DELIVERED + DONE) ไม่รอ Requester อนุมัติ
  const measurable = rows.filter((r) => [STATUS.DELIVERED, STATUS.DONE].includes(r.status));
  const ftrCount   = measurable.filter((r) => !r.isRevision && !r.revisionReason).length;
  const ftrRate    = measurable.length ? Math.round((ftrCount / measurable.length) * 100) : 0;

  // On-Time — วันเสร็จงานฝ่าย = deliveredAt (วันที่ผู้จัดการส่งมอบ) ไม่ใช่ doneAt (วันที่ Requester กดรับ)
  const withDue    = measurable.filter((r) => r.dueDate && r.deliveredAt);
  const onTime     = withDue.filter((r) => {
    const d = new Date(r.deliveredAt);
    const due = new Date(r.dueDate);
    const deliveredStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const dueStr      = `${due.getFullYear()}-${String(due.getMonth()+1).padStart(2,"0")}-${String(due.getDate()).padStart(2,"0")}`;
    return deliveredStr <= dueStr; // ส่งวันครบกำหนดถือว่าตรงเวลา
  }).length;
  const onTimeRate = withDue.length ? Math.round((onTime / withDue.length) * 100) : 0;

  // Avg Cycle Time — รับ → ผู้จัดการส่งมอบ (ไม่รอ Requester)
  const cycleRows  = measurable.filter((r) => r.submittedAt && r.deliveredAt);
  const avgCycle   = cycleRows.length
    ? Math.round(cycleRows.reduce((s, r) => s + (new Date(r.deliveredAt) - new Date(r.submittedAt)) / 86400000, 0) / cycleRows.length * 10) / 10
    : null;

  // Rework Rate
  const reworkRate = total ? Math.round(((withRevise + rejected) / total) * 100) : 0;

  // ── CANCELLATION KPIs ──
  const CANCEL_HOURS_WASTED = 4;    // ชม. งานที่ทำไปก่อนยกเลิก
  const CANCEL_RATE_PER_HOUR = 62.5; // ค่าแรงเฉลี่ย บาท/ชม.

  const cancelRows   = rows.filter((r) => [STATUS.CANCELLED, STATUS.REJECTED].includes(r.status));
  const cancelCount  = cancelRows.length;
  const cancelRate   = total ? Math.round((cancelCount / total) * 100) : 0;
  const cancelCost   = Math.round(cancelCount * CANCEL_HOURS_WASTED * CANCEL_RATE_PER_HOUR);

  // จำแนกสาเหตุการยกเลิก
  const cancel11 = cancelRows.filter((r) => r.revisionSource === "1.1").length; // ฝ่ายเขียนแบบ
  const cancel12 = cancelRows.filter((r) => r.revisionSource === "1.2").length; // ผู้ส่งคำร้อง
  const cancel13 = cancelRows.filter((r) => r.revisionSource === "1.3").length; // งานติดตั้ง
  const cancel14 = cancelRows.filter((r) => r.revisionSource === "1.4").length; // ลูกค้า
  const cancelNA = cancelCount - cancel11 - cancel12 - cancel13 - cancel14;    // ไม่ระบุ

  const cancelCost11 = Math.round(cancel11 * CANCEL_HOURS_WASTED * CANCEL_RATE_PER_HOUR);
  const cancelCost12 = Math.round(cancel12 * CANCEL_HOURS_WASTED * CANCEL_RATE_PER_HOUR);
  const cancelCost13 = Math.round(cancel13 * CANCEL_HOURS_WASTED * CANCEL_RATE_PER_HOUR);
  const cancelCost14 = Math.round(cancel14 * CANCEL_HOURS_WASTED * CANCEL_RATE_PER_HOUR);
  const cancelCostNA = Math.round(cancelNA * CANCEL_HOURS_WASTED * CANCEL_RATE_PER_HOUR);
  const maxCancelCost = Math.max(1, cancelCost11, cancelCost12, cancelCost13, cancelCost14, cancelCostNA);
  const maxCancelCount = Math.max(1, cancel11, cancel12, cancel13, cancel14, cancelNA);

  // ── OVERDUE KPIs ──
  // Average Overdue Duration (วัน)
  const overdueDurations = overdueRows.map((r) => Math.max(0, Math.round((now - new Date(r.dueDate)) / 86400000)));
  const avgOverdueDays   = overdueDurations.length
    ? Math.round(overdueDurations.reduce((s, v) => s + v, 0) / overdueDurations.length * 10) / 10
    : 0;

  // Overdue Cost of Opportunity (บาท)
  const totalOverdueDays   = overdueDurations.reduce((s, v) => s + v, 0);
  // ต้นทุน OT = ค่าOT × OT_ชม./วัน × วันล่าช้าเฉลี่ย × จำนวนงาน
  const overdueCostBaht    = Math.round(OT_RATE_PER_HOUR * OT_HOURS_PER_DAY * avgOverdueDays * overdue);

  // Root Cause of Overdue
  const overdueRevision    = overdueRows.filter((r) => r.isRevision || r.revisionReason).length;
  const overdueResource    = overdueRows.filter((r) => {
    const email = String(r.assignedToEmail || "").toLowerCase();
    const samePersonOverdue = overdueRows.filter((x) => String(x.assignedToEmail || "").toLowerCase() === email);
    return samePersonOverdue.length >= 3; // คนมีงานเกินกำหนด ≥ 3 ชิ้น = Resource Issue
  }).length;
  const overdueWaiting     = Math.max(0, overdue - overdueRevision - overdueResource);

  // Overdue by member (สำหรับ dept scope)
  const memberOverdue = team.map((u) => {
    const mine    = overdueRows.filter((r) => String(r.assignedToEmail || "").toLowerCase() === u.email.toLowerCase());
    const total_m = rows.filter((r) => String(r.assignedToEmail || "").toLowerCase() === u.email.toLowerCase()).length;
    return { name: u.name, overdue: mine.length, total: total_m,
      avgDays: mine.length ? Math.round(mine.reduce((s, r) => s + Math.max(0, Math.round((now - new Date(r.dueDate)) / 86400000)), 0) / mine.length) : 0 };
  }).filter((m) => m.total > 0).sort((a, b) => b.overdue - a.overdue);
  const maxOverdueMember = Math.max(1, ...memberOverdue.map((m) => m.overdue));

  // Type breakdown
  const typeMap = {};
  rows.forEach((r) => { const t = r.requestType || "ไม่ระบุ"; typeMap[t] = (typeMap[t] || 0) + 1; });
  const typeList = Object.entries(typeMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxType  = Math.max(1, ...typeList.map(([,n]) => n));

  // Workload per member
  const memberStats = team.map((u) => {
    const assigned = rows.filter((r) => String(r.assignedToEmail || "").toLowerCase() === u.email.toLowerCase());
    const closed   = assigned.filter((r) => [STATUS.DELIVERED, STATUS.DONE].includes(r.status)).length;
    const late     = assigned.filter((r) => {
      if (CLOSED_STATUSES.includes(r.status) || !r.dueDate) return false;
      const d = new Date(r.dueDate);
      const dueDateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      return dueDateStr < todayStr; // วันนี้ยังไม่ถือว่าเกิน
    }).length;
    return { name: u.name, total: assigned.length, closed, late };
  }).filter((m) => m.total > 0).sort((a, b) => b.total - a.total);
  const maxMember = Math.max(1, ...memberStats.map((m) => m.total));

  // ── Drawing Quality Score — วัดเฉพาะสาเหตุ 1.1 จากฝ่ายเขียนแบบเอง ──
  const revisionRows      = rows.filter((r) => r.isRevision || (r.reviseNumber && r.reviseNumber !== "0" && r.reviseNumber !== ""));
  const internalFaultRows = revisionRows.filter((r) => r.revisionSource === "1.1");
  const externalFaultRows = revisionRows.filter((r) => ["1.2","1.3","1.4"].includes(r.revisionSource));
  const excludedRows      = revisionRows.filter((r) => !r.revisionSource);
  // Drawing Quality Score:
  // - วัดเฉพาะงานที่มีสาเหตุ 1.1 (ฝ่ายเขียนแบบ)
  // - ถ้าแก้ < 4 ครั้ง = ผ่านเกณฑ์ปกติ (นับเป็น 100%)
  // - ถ้าแก้ ≥ 4 ครั้ง = หักหนัก (นับเป็น 20%)
  // - สาเหตุ 1.2/1.3/1.4 = Excluded (ไม่นำมาคำนวณ)
  // - เป้าหมาย: ผลรวมเฉลี่ย > 80%
  const qualityMeasurable = measurable.filter((r) => r.revisionSource === "1.1");
  const qualityScoreRows  = qualityMeasurable.map((r) => {
    const cnt = parseInt(r.revisionCount || "1") || 1;
    return cnt >= 4 ? 20 : 100;
  });
  // ถ้าไม่มีงาน 1.1 เลย = ถือว่าผ่านเกณฑ์ 100% (ไม่มีความผิดพลาดจากฝ่ายเขียนแบบ)
  const qualityScore = qualityScoreRows.length
    ? Math.round(qualityScoreRows.reduce((s, v) => s + v, 0) / qualityScoreRows.length)
    : 100;
  const qualityPass  = qualityScore >= 80; // ผ่านเกณฑ์ถ้า ≥ 80%
  const ext12    = externalFaultRows.filter((r) => r.revisionSource === "1.2").length;
  const ext13    = externalFaultRows.filter((r) => r.revisionSource === "1.3").length;
  const ext14    = externalFaultRows.filter((r) => r.revisionSource === "1.4").length;
  const extTotal = externalFaultRows.length;
  const maxExt   = Math.max(1, extTotal);

  const periodTh = { month:"เดือนนี้", quarter:"3 เดือนล่าสุด", year:"ปีนี้", all:"ทุกช่วงเวลา" }[period] || period;
  const scopeLabel = person ? person.name : "ฝ่ายเขียนแบบ";

  return `
    <!-- หมายเหตุ สาเหตุ 1.1-1.4 -->
    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:14px 18px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="font-size:14px;">📋</span>
        <span style="font-size:12px;font-weight:700;color:#1E293B;">คำอธิบาย: รหัสสาเหตุ 1.1 – 1.4 และผลต่อ KPI</span>
        <span style="margin-left:auto;font-size:10px;color:#94A3B8;">ใช้ในระบบ Revision · Cancellation · Overdue</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
        <div style="background:#FEE2E2;border-radius:8px;padding:10px 12px;border-left:3px solid #EF4444;">
          <div style="font-size:12px;font-weight:700;color:#991B1B;margin-bottom:4px;">1.1 — ฝ่ายเขียนแบบ</div>
          <div style="font-size:10.5px;color:#7F1D1D;line-height:1.5;">ความผิดพลาดจากทีมเขียนแบบเอง เช่น เขียนผิด ใส่รายละเอียดไม่ครบ</div>
          <div style="margin-top:6px;display:inline-block;background:#EF4444;color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:999px;">🔴 กระทบ KPI ฝ่ายเขียนแบบ</div>
        </div>
        <div style="background:#FEF3C7;border-radius:8px;padding:10px 12px;border-left:3px solid #F59E0B;">
          <div style="font-size:12px;font-weight:700;color:#92400E;margin-bottom:4px;">1.2 — ผู้ส่งคำร้อง</div>
          <div style="font-size:10.5px;color:#78350F;line-height:1.5;">ข้อมูล Spec ไม่ครบ เปลี่ยนความต้องการ หรือส่งคำขอผิดพลาด</div>
          <div style="margin-top:6px;display:inline-block;background:#F59E0B;color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:999px;">🟡 ไม่กระทบ KPI · ปรับปรุงระบบสั่งงาน</div>
        </div>
        <div style="background:#EDE9FE;border-radius:8px;padding:10px 12px;border-left:3px solid #7C3AED;">
          <div style="font-size:12px;font-weight:700;color:#4C1D95;margin-bottom:4px;">1.3 — งานติดตั้ง</div>
          <div style="font-size:10.5px;color:#3B0764;line-height:1.5;">หน้างานสั่งเปลี่ยนแปลงหลังเริ่มติดตั้ง เงื่อนไขหน้างานเปลี่ยน</div>
          <div style="margin-top:6px;display:inline-block;background:#7C3AED;color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:999px;">🟣 ไม่กระทบ KPI · ปรับปรุงความแม่นยำหน้างาน</div>
        </div>
        <div style="background:#DBEAFE;border-radius:8px;padding:10px 12px;border-left:3px solid #3B82F6;">
          <div style="font-size:12px;font-weight:700;color:#1E3A8A;margin-bottom:4px;">1.4 — ลูกค้า</div>
          <div style="font-size:10.5px;color:#1E40AF;line-height:1.5;">ลูกค้าเปลี่ยนแบบ เพิ่ม Scope กลางทาง หรือแก้ไขความต้องการ</div>
          <div style="margin-top:6px;display:inline-block;background:#3B82F6;color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:999px;">🔵 ไม่กระทบ KPI · ความเสี่ยงธุรกิจ</div>
        </div>
      </div>
      <div style="margin-top:10px;padding:8px 12px;background:#F0F9FF;border-radius:6px;font-size:11px;color:#0369A1;border-left:3px solid #0EA5E9;">
        💡 <b>หลักการ:</b> KPI ฝ่ายเขียนแบบวัดจาก <b>สาเหตุ 1.1 เท่านั้น</b> — สาเหตุ 1.2/1.3/1.4 แสดงเพื่อให้ผู้บริหารเห็น "คอขวด" ของแต่ละฝ่าย ไม่ใช้หักคะแนนทีมเขียนแบบ
      </div>
    </div>

    <!-- KPI Note -->
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
      <span style="font-size:10.5px;color:#64748B;background:#F8FAFC;padding:4px 10px;border-radius:6px;border:1px solid #E2E8F0;">
        📌 KPI วัดจาก "ความผิดพลาดที่เกิดจากฝ่ายเขียนแบบ" เท่านั้น
      </span>
    </div>
    <!-- KPI Cards Row 1: Overview -->
    <div id="dash-kpi-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
      ${kpiCard("📋","คำร้องทั้งหมด",total,periodTh+" · "+scopeLabel,"#005DAC")}
      ${kpiCard("✅","เสร็จสิ้น",done,`${total?Math.round(done/total*100):0}% ของทั้งหมด`,"#0DB14B")}
      ${kpiCard("⚙️","กำลังดำเนินการ",active,"งานที่ยังไม่ปิด","#1D4ED8")}
      ${kpiCard("⚠️","เกินกำหนด",overdue,overdue>0?"ต้องติดตามด่วน":"อยู่ในเกณฑ์ดี",overdue>0?"#EF4444":"#0DB14B")}
      ${kpiCard("🎯","FTR Rate",`${ftrRate}%`,"ประสิทธิภาพส่งมอบถูกตั้งแต่ครั้งแรก โดยไม่มีการตีกลับ",ftrRate>=80?"#0DB14B":ftrRate>=60?"#F59E0B":"#EF4444")}
      ${kpiCard("🚀","ส่งตรงเวลา",`${onTimeRate}%`,`จาก ${withDue.length} งานที่วัดผลได้`,onTimeRate>=80?"#0DB14B":"#F59E0B")}
      ${kpiCard("🔄","Rework Rate",`${reworkRate}%`,"งานที่มีการแก้ไข",reworkRate<=20?"#0DB14B":reworkRate<=40?"#F59E0B":"#EF4444")}
      ${kpiCard("⏱️","Avg Cycle Time",avgCycle!==null?`${avgCycle} วัน`:"—","ส่งคำร้อง → เสร็จสิ้น","#7C3AED")}
    </div>
    <!-- Extra cards row — filled by dashboard.js -->
    <div id="dash-extra-row" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;"></div>

    <!-- Row 2: Efficiency + Quality + Types -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:14px;">
      ${pBox("📈 Efficiency KPIs",`
        ${gauge("FTR Ratio (First-Time Right)",ftrRate,80,"% งานผ่านตั้งแต่ครั้งแรก")}
        ${gauge("On-Time Delivery Rate",onTimeRate,85,"% งานส่งตรงตามกำหนด")}
        ${gauge("อัตราปิดงาน",total?Math.round(done/total*100):0,70,"% ของคำร้องทั้งหมด")}
        <div style="margin-top:10px;padding:9px 12px;background:#F0F9FF;border-radius:8px;border-left:3px solid #005DAC;">
          <div style="font-size:10px;color:#005DAC;font-weight:600;">⏱️ Avg Cycle Time</div>
          <div style="font-size:20px;font-weight:800;color:#005DAC;">${avgCycle!==null?avgCycle+" วัน":"ยังไม่มีข้อมูล"}</div>
          <div style="font-size:10px;color:#64748B;">รับคำร้อง → เสร็จสิ้น</div>
        </div>
      `)}
      ${pBox("🔍 Quality KPIs",`
        ${gauge("Rework Rate",reworkRate,20,"% งานที่ต้องแก้ไข",true)}
        ${gauge("Rejection Rate",total?Math.round(rejected/total*100):0,15,"% งานที่ถูกปฏิเสธ",true)}
        ${gauge("Cancellation Rate",total?Math.round(cancelled/total*100):0,10,"% งานที่ยกเลิก",true)}
        <div style="margin-top:10px;padding:9px 12px;background:#FFF7ED;border-radius:8px;border-left:3px solid #F59E0B;">
          <div style="font-size:10px;color:#D97706;font-weight:600;">⚠️ Rework Impact</div>
          <div style="font-size:20px;font-weight:800;color:#D97706;">${withRevise+rejected} งาน</div>
          <div style="font-size:10px;color:#64748B;">ต้องแก้ไขใน${periodTh} (${reworkRate}%)</div>
        </div>
      `)}
      ${pBox(`🏷️ งานแยกตามประเภท <span style="font-size:11px;font-weight:400;color:#94A3B8;">${total} คำร้อง</span>`,`
        ${typeList.length
          ? typeList.map(([t,n]) => mBar(t, Math.round(n/maxType*100), "#005DAC", n+" งาน")).join("")
          : "<div style='color:#94A3B8;font-size:12px;text-align:center;padding:20px 0;'>ไม่มีข้อมูล</div>"}
      `)}
    </div>

    <!-- Row 2.5: Drawing Quality Score + External Blockers -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">

      ${pBox(`🏆 Drawing Quality Score <span style="font-size:11px;font-weight:400;color:#94A3B8;margin-left:6px;">วัดจากสาเหตุความผิดพลาดจากฝ่ายเขียนแบบเท่านั้น</span>`, `
        <div style="display:flex;align-items:center;gap:20px;margin-bottom:14px;">
          <div style="text-align:center;min-width:90px;">
            <div style="font-size:52px;font-weight:900;color:${qualityScore>=80?"#0DB14B":qualityScore>=60?"#F59E0B":"#EF4444"};line-height:1;">${qualityScore}%</div>
            <div style="margin-top:6px;">
              <span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;background:${qualityScore>=80?"#DCFCE7":"#FEE2E2"};color:${qualityScore>=80?"#065F46":"#991B1B"};">
                ${qualityScore>=80?"✅ ผ่านเกณฑ์":"❌ ต่ำกว่าเกณฑ์"}
              </span>
            </div>
          </div>
          <div style="flex:1;">
            <div style="background:#F1F5F9;border-radius:8px;height:14px;overflow:hidden;margin-bottom:6px;position:relative;">
              <div style="background:${qualityScore>=80?"#0DB14B":qualityScore>=60?"#F59E0B":"#EF4444"};height:100%;width:${qualityScore}%;border-radius:8px;transition:width 0.4s;"></div>
              <!-- เส้นเป้าหมาย 80% -->
              <div style="position:absolute;top:0;left:80%;width:2px;height:100%;background:#1E293B;opacity:0.4;"></div>
            </div>
            <div style="font-size:10px;color:#64748B;margin-bottom:8px;">เป้าหมาย &gt; 80% · วัดจาก ${qualityMeasurable.length} งาน (สาเหตุ 1.1)</div>
            <div style="font-size:11px;color:#64748B;line-height:1.8;background:#F8FAFC;border-radius:6px;padding:8px 10px;">
              • แก้ไข &lt; 4 ครั้ง = <b style="color:#0DB14B;">100%</b> (ผ่านเกณฑ์ปกติ)<br>
              • แก้ไข ≥ 4 ครั้ง = <b style="color:#EF4444;">20%</b> (หักหนัก — ปัญหาซ้ำซาก)<br>
              • สาเหตุ 1.2, 1.3, 1.4 = <b style="color:#94A3B8;">Excluded</b> (ไม่นำมาคำนวณ)
            </div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:11px;">
          <div style="background:#FEF2F2;border-radius:8px;padding:8px 10px;text-align:center;border-left:3px solid #EF4444;">
            <div style="font-weight:700;color:#991B1B;font-size:16px;">${internalFaultRows.length}</div>
            <div style="color:#991B1B;">สาเหตุ 1.1<br>ฝ่ายเขียนแบบ</div>
          </div>
          <div style="background:#F0FDF4;border-radius:8px;padding:8px 10px;text-align:center;border-left:3px solid #0DB14B;">
            <div style="font-weight:700;color:#065F46;font-size:16px;">${externalFaultRows.length}</div>
            <div style="color:#065F46;">สาเหตุ 1.2-1.4<br>ภายนอก (ยกเว้น)</div>
          </div>
          <div style="background:#F8FAFC;border-radius:8px;padding:8px 10px;text-align:center;border-left:3px solid #94A3B8;">
            <div style="font-weight:700;color:#475569;font-size:16px;">${excludedRows.length}</div>
            <div style="color:#475569;">ไม่ระบุ<br>สาเหตุ</div>
          </div>
        </div>
      `)}

      ${pBox(`🚧 External Blockers — สาเหตุจากภายนอก <span style="font-size:11px;font-weight:400;color:#94A3B8;margin-left:6px;">ไม่กระทบ KPI ฝ่ายเขียนแบบ</span>`, `
        ${extTotal > 0 ? `
          ${mBar("1.2 ผิดพลาดจากผู้ส่งคำร้อง", Math.round(ext12/maxExt*100), "#3B82F6", ext12+" งาน")}
          ${mBar("1.3 ผิดพลาดจากงานติดตั้ง", Math.round(ext13/maxExt*100), "#8B5CF6", ext13+" งาน")}
          ${mBar("1.4 ผิดพลาดจากลูกค้า", Math.round(ext14/maxExt*100), "#F59E0B", ext14+" งาน")}
          <div style="margin-top:12px;padding:10px 12px;background:#EFF6FF;border-radius:8px;border-left:3px solid #3B82F6;font-size:11px;color:#1E40AF;">
            💡 <b>ใช้ข้อมูลนี้</b>คุยกับแผนกอื่น/ลูกค้าเพื่อแก้ปัญหาคอขวด<br>
            งานเหล่านี้ <b>ไม่ถูกนำมาคิดหักคะแนน</b> Drawing Quality Score
          </div>
        ` : `
          <div style="text-align:center;padding:30px 0;color:#94A3B8;font-size:13px;">
            ✅ ไม่มี External Blocker ในช่วงนี้<br>
            <span style="font-size:11px;">ยังไม่มีข้อมูลสาเหตุ 1.2-1.4</span>
          </div>
        `}
        <div style="margin-top:10px;padding:8px 12px;background:#F0FDF4;border-radius:8px;font-size:11px;color:#065F46;">
          📊 Rework Rate รวม: ${reworkRate}% (นับทุกสาเหตุ) · Drawing Quality Score วัดเฉพาะ 1.1
        </div>
      `)}
    </div>

    <!-- Row 3: OVERDUE KPI SECTION -->
    <div style="background:#FFF1F2;border:1.5px solid #FECACA;border-radius:14px;padding:20px;margin-bottom:14px;">
      <div style="font-size:14px;font-weight:700;color:#991B1B;margin-bottom:14px;">
        🔴 งานเกินกำหนด — KPI เชิงลึก
        <span style="font-size:11px;font-weight:400;color:#B91C1C;margin-left:8px;">${overdue} รายการที่ยังเกินกำหนดอยู่</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
        ${kpiCard("📅","จำนวนงานเกินกำหนด",overdue,`${total?Math.round(overdue/total*100):0}% ของทั้งหมด`,overdue>0?"#EF4444":"#0DB14B")}
        ${kpiCard("⏳","ล่าช้าเฉลี่ย",avgOverdueDays>0?`${avgOverdueDays} วัน`:"—","Average Overdue Duration",avgOverdueDays>7?"#EF4444":avgOverdueDays>3?"#F59E0B":"#0DB14B")}
        ${kpiCard("💸","ต้นทุนโอกาส",overdueCostBaht>0?`~${overdueCostBaht.toLocaleString()} ฿`:"—",`ต้นทุนความเสียหายจากการเร่งงาน (OT) เพื่อลดงานล่าช้าสะสม ${avgOverdueDays} วัน จำนวน ${overdue} รายการ`,"#B91C1C")}
        ${kpiCard("📊","Overdue Rate",`${total?Math.round(overdue/total*100):0}%`,"% งานที่เกินกำหนด ณ ปัจจุบัน",overdue>0?"#EF4444":"#0DB14B")}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">

        <!-- Root Cause -->
        ${pBox("🔎 Root Cause of Overdue",`
          ${overdue > 0 ? `
            ${mBar("🔄 Revision / แก้ไขงานซ้ำ", Math.round(overdueRevision/overdue*100), "#F59E0B", overdueRevision+" งาน")}
            ${mBar("👥 Resource Issue / งานล้นมือ", Math.round(overdueResource/overdue*100), "#7C3AED", overdueResource+" งาน")}
            ${mBar("⏸️ Waiting / รอข้อมูลจากฝ่ายอื่น", Math.round(overdueWaiting/overdue*100), "#EF4444", overdueWaiting+" งาน")}
            <div style="margin-top:12px;background:#fff;border-radius:8px;padding:10px 12px;border:1px solid #FECACA;">
              <div style="font-size:10px;font-weight:600;color:#991B1B;margin-bottom:6px;">🎯 เป้าหมาย KPI</div>
              <div style="font-size:11px;color:#64748B;line-height:1.8;">
                • Waiting → 0% (ใช้แบบฟอร์มรับงานมาตรฐาน)<br>
                • Revision → ลดตาม Rework Rate target<br>
                • Resource → ปรับ Workload ให้สมดุล
              </div>
            </div>
          ` : `<div style="text-align:center;padding:30px 0;color:#94A3B8;font-size:13px;">✅ ไม่มีงานเกินกำหนดในช่วงนี้</div>`}
        `)}

        <!-- Overdue by Member -->
        ${pBox("👤 งานเกินกำหนด รายบุคคล",`
          ${memberOverdue.filter((m) => m.overdue > 0).length ? `
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
              <thead>
                <tr style="background:#FFF1F2;">
                  <th style="padding:6px 8px;text-align:left;color:#991B1B;font-weight:600;border-bottom:1px solid #FECACA;">ชื่อ</th>
                  <th style="padding:6px 8px;text-align:center;color:#991B1B;font-weight:600;border-bottom:1px solid #FECACA;">เกินกำหนด</th>
                  <th style="padding:6px 8px;text-align:center;color:#991B1B;font-weight:600;border-bottom:1px solid #FECACA;">ล่าช้าเฉลี่ย</th>
                  <th style="padding:6px 8px;text-align:left;color:#991B1B;font-weight:600;border-bottom:1px solid #FECACA;">สัดส่วน</th>
                </tr>
              </thead>
              <tbody>
                ${memberOverdue.filter((m) => m.overdue > 0).map((m, i) => `
                  <tr style="background:${i%2===0?"#FFF9F9":"#fff"};">
                    <td style="padding:6px 8px;font-weight:600;color:#1E293B;">${escapeHtml(shortPersonName(m.name))}</td>
                    <td style="padding:6px 8px;text-align:center;font-weight:700;color:#EF4444;">${m.overdue}</td>
                    <td style="padding:6px 8px;text-align:center;color:#F59E0B;">${m.avgDays>0?m.avgDays+" วัน":"—"}</td>
                    <td style="padding:6px 8px;">
                      <div style="background:#F1F5F9;border-radius:4px;height:8px;overflow:hidden;min-width:60px;">
                        <div style="background:#EF4444;height:100%;width:${Math.round(m.overdue/maxOverdueMember*100)}%;border-radius:4px;"></div>
                      </div>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          ` : `<div style="text-align:center;padding:30px 0;color:#94A3B8;font-size:13px;">✅ ทุกคนไม่มีงานเกินกำหนด</div>`}
        `)}
      </div>
    </div>

    <!-- Row 3.7: TOP 10 REVISION — Drawing ที่แก้บ่อยสุด + สาเหตุ -->
    ${(() => {
      const revRows = rows.filter((r) =>
        r.isRevision ||
        (r.revisionSource && r.revisionSource !== "") ||
        (r.revisionCount && r.revisionCount !== "0" && r.revisionCount !== 0) ||
        (r.reviseNumber && r.reviseNumber !== "0" && r.reviseNumber !== "")
      );
      if (!revRows.length) return "";

      // ── LEFT: Top 10 Drawing ที่แก้บ่อยสุด ──
      const drawingMap = {};
      revRows.forEach((r) => {
        const key = r.drawingNo || r.requestNo;
        if (!drawingMap[key]) drawingMap[key] = { drawingNo: r.drawingNo || "—", drawingName: r.drawingName || "—", projectName: r.projectName || "—", count: 0, sources: [] };
        const parseRev = (v) => {
          if (!v || v === "0") return 0;
          const s = String(v).trim().toUpperCase();
          if (/^[A-Z]$/.test(s)) return s.charCodeAt(0) - 64;
          const m = s.match(/\d+/);
          return m ? parseInt(m[0], 10) : 1;
        };
        drawingMap[key].count += Math.max(1, parseRev(r.reviseNumber));
        if (r.revisionSource) drawingMap[key].sources.push(r.revisionSource);
      });
      const top10Drawings = Object.values(drawingMap).sort((a, b) => b.count - a.count).slice(0, 10);
      const maxCount = Math.max(1, top10Drawings[0]?.count || 1);

      const sourceLabel = { "1.1": "🔴 1.1 ฝ่ายเขียนแบบ", "1.2": "🟡 1.2 ผู้ส่งคำร้อง", "1.3": "🟠 1.3 งานดัดแต่ง", "1.4": "🔵 1.4 ลูกค้า" };
      const sourceBadge = { "1.1":"background:#FEE2E2;color:#991B1B", "1.2":"background:#FEF9C3;color:#854D0E", "1.3":"background:#FFEDD5;color:#9A3412", "1.4":"background:#DBEAFE;color:#1E40AF" };

      // ── RIGHT: Top 4 ประเภทสาเหตุ + อัตราส่วน ──
      const srcCount = {};
      revRows.forEach((r) => {
        const k = r.revisionSource || "ไม่ระบุ";
        srcCount[k] = (srcCount[k] || 0) + 1;
      });
      const totalWithSrc = revRows.length;
      const top4Sources = Object.entries(srcCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);
      const maxSrcCount = Math.max(1, top4Sources[0]?.[1] || 1);

      return `
      <div style="background:#FFFBEB;border:1.5px solid #FDE68A;border-radius:14px;padding:20px;margin-bottom:14px;">
        <div style="font-size:14px;font-weight:700;color:#92400E;margin-bottom:14px;">
          🔁 Top 10 — Drawing ที่แก้ไขบ่อยสุด &amp; สาเหตุ
          <span style="font-size:11px;font-weight:400;color:#B45309;margin-left:8px;">${revRows.length} รายการที่มีการแก้ไข</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">

          <!-- LEFT: Top 10 Drawing + badge สาเหตุ -->
          <div style="background:#fff;border-radius:10px;border:1px solid #FDE68A;overflow:hidden;">
            <div style="padding:10px 14px;background:#FEF3C7;font-size:12px;font-weight:700;color:#92400E;border-bottom:1px solid #FDE68A;">
              📐 Drawing ที่แก้ไขบ่อยสุด (Top ${top10Drawings.length})
            </div>
            <div style="padding:6px 14px;background:#FFFBEB;border-bottom:1px solid #FDE68A;display:flex;flex-wrap:wrap;gap:8px;">
              <span style="font-size:10px;font-weight:600;color:#78350F;margin-right:2px;">สาเหตุ:</span>
              <span style="font-size:10px;background:#FEE2E2;color:#991B1B;padding:1px 7px;border-radius:10px;font-weight:600;">1.1 ฝ่ายเขียนแบบ</span>
              <span style="font-size:10px;background:#FEF9C3;color:#854D0E;padding:1px 7px;border-radius:10px;font-weight:600;">1.2 ผู้ส่งคำร้อง</span>
              <span style="font-size:10px;background:#FFEDD5;color:#9A3412;padding:1px 7px;border-radius:10px;font-weight:600;">1.3 งานดัดแต่ง</span>
              <span style="font-size:10px;background:#DBEAFE;color:#1E40AF;padding:1px 7px;border-radius:10px;font-weight:600;">1.4 ลูกค้า</span>
            </div>
            <div style="max-height:340px;overflow-y:auto;">
              <table style="width:100%;border-collapse:collapse;">
                <thead>
                  <tr style="background:#FFFBEB;">
                    <th style="padding:6px 10px;text-align:left;font-size:11px;color:#92400E;border-bottom:1px solid #FDE68A;">#</th>
                    <th style="padding:6px 10px;text-align:left;font-size:11px;color:#92400E;border-bottom:1px solid #FDE68A;">Drawing</th>
                    <th style="padding:6px 10px;text-align:left;font-size:11px;color:#92400E;border-bottom:1px solid #FDE68A;">สาเหตุ</th>
                    <th style="padding:6px 10px;text-align:center;font-size:11px;color:#92400E;border-bottom:1px solid #FDE68A;">ครั้ง</th>
                    <th style="padding:6px 10px;text-align:left;font-size:11px;color:#92400E;border-bottom:1px solid #FDE68A;">สัดส่วน</th>
                  </tr>
                </thead>
                <tbody>
                  ${top10Drawings.map((d, i) => {
                    const uniqSrc = [...new Set(d.sources)];
                    return `
                    <tr style="background:${i%2===0?"#fff":"#FFFBEB"};border-bottom:1px solid #FEF3C7;">
                      <td style="padding:7px 10px;font-weight:700;color:#D97706;font-size:12px;">${i+1}</td>
                      <td style="padding:7px 10px;">
                        <div style="font-size:12px;font-weight:600;color:#1E293B;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(d.drawingNo)}">${escapeHtml(d.drawingNo)}</div>
                        <div style="font-size:10px;color:#64748B;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(d.drawingName)}">${escapeHtml(d.drawingName)}</div>
                        <div style="font-size:10px;color:#94A3B8;">${escapeHtml(d.projectName)}</div>
                      </td>
                      <td style="padding:7px 10px;">
                        ${uniqSrc.length ? uniqSrc.map((s) => `<span style="display:inline-block;font-size:10px;font-weight:600;padding:2px 6px;border-radius:10px;margin:1px;${sourceBadge[s]||"background:#F1F5F9;color:#475569;"}">${s}</span>`).join("") : `<span style="color:#CBD5E1;font-size:11px;">—</span>`}
                      </td>
                      <td style="padding:7px 10px;text-align:center;font-weight:700;color:#EF4444;font-size:14px;">${d.count}</td>
                      <td style="padding:7px 10px;min-width:70px;">
                        <div style="background:#FEF3C7;border-radius:4px;height:8px;overflow:hidden;">
                          <div style="background:#F59E0B;height:100%;width:${Math.round(d.count/maxCount*100)}%;border-radius:4px;"></div>
                        </div>
                      </td>
                    </tr>`;
                  }).join("")}
                </tbody>
              </table>
            </div>
          </div>

          <!-- RIGHT: Top 4 สาเหตุ + อัตราส่วน -->
          <div style="background:#fff;border-radius:10px;border:1px solid #FDE68A;overflow:hidden;">
            <div style="padding:10px 14px;background:#FEF3C7;font-size:12px;font-weight:700;color:#92400E;border-bottom:1px solid #FDE68A;">
              📊 สาเหตุการแก้ไข — Top 4 ประเภท
              <span style="font-size:11px;font-weight:400;color:#B45309;margin-left:6px;">จาก ${totalWithSrc} รายการ</span>
            </div>
            <div style="padding:16px;">
              ${top4Sources.length ? top4Sources.map(([src, cnt]) => {
                const pct = Math.round(cnt / totalWithSrc * 100);
                const lbl = sourceLabel[src] || `⚪ ${src}`;
                const bar = { "1.1":"#EF4444","1.2":"#EAB308","1.3":"#F97316","1.4":"#3B82F6","ไม่ระบุ":"#94A3B8" }[src] || "#94A3B8";
                return `
                  <div style="margin-bottom:14px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
                      <span style="font-size:12px;font-weight:600;color:#92400E;">${escapeHtml(lbl)}</span>
                      <span style="font-size:13px;font-weight:700;color:#1E293B;">${cnt} <span style="font-size:11px;font-weight:400;color:#64748B;">ครั้ง (${pct}%)</span></span>
                    </div>
                    <div style="background:#FEF3C7;border-radius:6px;height:12px;overflow:hidden;">
                      <div style="background:${bar};height:100%;width:${Math.round(cnt/maxSrcCount*100)}%;border-radius:6px;transition:width .3s;"></div>
                    </div>
                  </div>`;
              }).join("") : `<div style="padding:30px;text-align:center;color:#94A3B8;font-size:13px;">✅ ไม่มีสาเหตุที่บันทึกไว้</div>`}
              ${top4Sources.length ? `
              <div style="margin-top:8px;padding-top:12px;border-top:1px solid #FDE68A;">
                <div style="font-size:11px;color:#92400E;font-weight:600;margin-bottom:6px;">สัดส่วนรวม</div>
                <div style="display:flex;height:16px;border-radius:8px;overflow:hidden;gap:1px;">
                  ${top4Sources.map(([src, cnt]) => {
                    const pct = Math.round(cnt/totalWithSrc*100);
                    const bar = { "1.1":"#EF4444","1.2":"#EAB308","1.3":"#F97316","1.4":"#3B82F6","ไม่ระบุ":"#94A3B8" }[src] || "#94A3B8";
                    return `<div style="background:${bar};flex:${cnt};min-width:2px;" title="${src}: ${pct}%"></div>`;
                  }).join("")}
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
                  ${top4Sources.map(([src]) => {
                    const bar = { "1.1":"#EF4444","1.2":"#EAB308","1.3":"#F97316","1.4":"#3B82F6","ไม่ระบุ":"#94A3B8" }[src] || "#94A3B8";
                    const lbl = { "1.1":"1.1","1.2":"1.2","1.3":"1.3","1.4":"1.4" }[src] || src;
                    return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:#64748B;"><span style="width:8px;height:8px;border-radius:50%;background:${bar};display:inline-block;"></span>${lbl}</span>`;
                  }).join("")}
                </div>
              </div>` : ""}
            </div>
          </div>

        </div>
      </div>`;
    })()}

    <!-- Row 3.5: CANCELLATION KPI SECTION -->
    <div style="background:#F5F3FF;border:1.5px solid #DDD6FE;border-radius:14px;padding:20px;margin-bottom:14px;">
      <div style="font-size:14px;font-weight:700;color:#5B21B6;margin-bottom:14px;">
        🚫 งานที่ถูกยกเลิก (Cancellation KPI)
        <span style="font-size:11px;font-weight:400;color:#7C3AED;margin-left:8px;">${cancelCount} รายการที่ยกเลิก · ${periodTh}</span>
        <span style="font-size:10px;font-weight:400;color:#94A3B8;margin-left:6px;">📌 วัดเฉพาะสาเหตุ 1.1 ที่กระทบ KPI ฝ่ายเขียนแบบ</span>
      </div>

      <!-- KPI Cards -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
        ${kpiCard("🚫","Cancellation Rate",`${cancelRate}%`,`${cancelCount} งาน จาก ${total} คำร้องทั้งหมด`,cancelRate<=5?"#0DB14B":cancelRate<=15?"#F59E0B":"#EF4444")}
        ${kpiCard("💸","Wasted Cost",cancelCost>0?`~${cancelCost.toLocaleString()} ฿`:"—",`4ชม. × 62.5฿ × ${cancelCount} งาน`,"#7C3AED")}
        ${kpiCard("🔴","สาเหตุ 1.1 (ฝ่ายเขียนแบบ)",cancel11,`~${cancelCost11.toLocaleString()} ฿ — กระทบ KPI โดยตรง`,cancel11>0?"#EF4444":"#0DB14B")}
        ${kpiCard("🟡","สาเหตุภายนอก (1.2-1.4)",cancel12+cancel13+cancel14,`~${(cancelCost12+cancelCost13+cancelCost14).toLocaleString()} ฿ — ไม่กระทบ KPI`,"#F59E0B")}
      </div>

      <!-- Charts row -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">

        <!-- Donut Chart (SVG) -->
        ${pBox(`🍩 สัดส่วนสาเหตุการยกเลิก`, (() => {
          if (cancelCount === 0) return `<div style="text-align:center;padding:30px 0;color:#94A3B8;font-size:13px;">✅ ไม่มีงานยกเลิกในช่วงนี้</div>`;
          const slices = [
            { label:"1.1 ฝ่ายเขียนแบบ", val:cancel11, color:"#EF4444" },
            { label:"1.2 ผู้ส่งคำร้อง",  val:cancel12, color:"#F59E0B" },
            { label:"1.3 งานติดตั้ง",   val:cancel13, color:"#7C3AED" },
            { label:"1.4 ลูกค้า",        val:cancel14, color:"#3B82F6" },
            { label:"ไม่ระบุ",           val:cancelNA, color:"#94A3B8" },
          ].filter((s) => s.val > 0);
          const total_c = slices.reduce((s, i) => s + i.val, 0) || 1;
          // generate SVG donut
          let svgPaths = ""; let legendHtml = ""; let cumPct = 0;
          const cx = 70, cy = 70, r = 55, ri = 32;
          const toRad = (pct) => (pct / 100) * 2 * Math.PI - Math.PI / 2;
          slices.forEach((sl) => {
            const pct  = sl.val / total_c * 100;
            const sAngle = toRad(cumPct * 3.6);
            const eAngle = toRad((cumPct + pct) * 3.6);
            const large = pct > 50 ? 1 : 0;
            const x1 = cx + r * Math.cos(sAngle), y1 = cy + r * Math.sin(sAngle);
            const x2 = cx + r * Math.cos(eAngle), y2 = cy + r * Math.sin(eAngle);
            const xi1 = cx + ri * Math.cos(sAngle), yi1 = cy + ri * Math.sin(sAngle);
            const xi2 = cx + ri * Math.cos(eAngle), yi2 = cy + ri * Math.sin(eAngle);
            svgPaths += `<path d="M${xi1.toFixed(1)},${yi1.toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large},1 ${x2.toFixed(1)},${y2.toFixed(1)} L${xi2.toFixed(1)},${yi2.toFixed(1)} A${ri},${ri} 0 ${large},0 ${xi1.toFixed(1)},${yi1.toFixed(1)} Z" fill="${sl.color}" opacity="0.9"/>`;
            legendHtml += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;font-size:11px;color:#334155;">
              <div style="width:10px;height:10px;border-radius:50%;background:${sl.color};flex-shrink:0;"></div>
              <span>${escapeHtml(sl.label)}</span>
              <span style="margin-left:auto;font-weight:700;">${sl.val} (${Math.round(pct)}%)</span>
            </div>`;
            cumPct += pct;
          });
          return `<div style="display:flex;align-items:center;gap:20px;">
            <div style="flex-shrink:0;">
              <svg width="140" height="140" viewBox="0 0 140 140">
                ${svgPaths}
                <text x="70" y="65" text-anchor="middle" font-size="18" font-weight="bold" fill="#1E293B">${cancelCount}</text>
                <text x="70" y="82" text-anchor="middle" font-size="9" fill="#64748B">งานยกเลิก</text>
              </svg>
            </div>
            <div style="flex:1;">${legendHtml}
              <div style="margin-top:8px;padding:7px 10px;background:#EDE9FE;border-radius:6px;font-size:10px;color:#5B21B6;">
                🔴 สาเหตุ 1.1 = กระทบ KPI ฝ่ายเขียนแบบโดยตรง<br>🟡 สาเหตุ 1.2-1.4 = ปัจจัยภายนอก ไม่กระทบ KPI
              </div>
            </div>
          </div>`;
        })())}

        <!-- Bar Chart: Wasted Cost by Cause -->
        ${pBox(`📊 Wasted Cost แยกตามสาเหตุ (บาท)`, (() => {
          if (cancelCount === 0) return `<div style="text-align:center;padding:30px 0;color:#94A3B8;font-size:13px;">✅ ไม่มีต้นทุนที่เสียเปล่า</div>`;
          const bars = [
            { label:"1.1 ฝ่ายเขียนแบบ", cost:cancelCost11, count:cancel11, color:"#EF4444", kpi:true },
            { label:"1.2 ผู้ส่งคำร้อง",  cost:cancelCost12, count:cancel12, color:"#F59E0B", kpi:false },
            { label:"1.3 งานติดตั้ง",   cost:cancelCost13, count:cancel13, color:"#7C3AED", kpi:false },
            { label:"1.4 ลูกค้า",        cost:cancelCost14, count:cancel14, color:"#3B82F6", kpi:false },
            { label:"ไม่ระบุ",           cost:cancelCostNA, count:cancelNA, color:"#94A3B8", kpi:false },
          ];
          return bars.map((b) => `
            <div style="margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                <span style="font-size:11px;color:#334155;font-weight:${b.kpi?"700":"400"};">${escapeHtml(b.label)}${b.kpi?" 🔴":""}</span>
                <span style="font-size:11px;font-weight:700;color:${b.cost>0?b.color:"#94A3B8"};">${b.cost>0?"~"+b.cost.toLocaleString()+" ฿":"—"}</span>
              </div>
              <div style="background:#F1F5F9;border-radius:4px;height:10px;overflow:hidden;">
                <div style="background:${b.color};height:100%;width:${b.cost>0?Math.round(b.cost/maxCancelCost*100):0}%;border-radius:4px;opacity:${b.kpi?1:0.6};"></div>
              </div>
              <div style="font-size:9.5px;color:#94A3B8;margin-top:2px;">${b.count} งาน × 4ชม. × 62.5฿${b.kpi?" — กระทบ KPI":""}</div>
            </div>
          `).join("");
        })())}
      </div>

      <div style="margin-top:12px;padding:10px 14px;background:#EDE9FE;border-radius:8px;font-size:11px;color:#5B21B6;">
        💡 <b>คำแนะนำ:</b> ต้นทุนที่เสียเปล่าจากสาเหตุ 1.2-1.4 ควรนำเสนอผู้บริหารเพื่อปรับปรุงกระบวนการสั่งงาน · สาเหตุ 1.1 ใช้ประเมินคุณภาพของฝ่ายเขียนแบบ
      </div>
    </div>

    <!-- Row 4: Workload + Tips -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
      ${pBox("👥 Workload รายบุคคล",`
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:#F8FAFC;">
              <th style="padding:7px 8px;text-align:left;border-bottom:1px solid #E2E8F0;color:#64748B;font-weight:600;">ชื่อ</th>
              <th style="padding:7px 8px;text-align:center;border-bottom:1px solid #E2E8F0;color:#64748B;font-weight:600;">ทั้งหมด</th>
              <th style="padding:7px 8px;text-align:center;border-bottom:1px solid #E2E8F0;color:#0DB14B;font-weight:600;">ปิดแล้ว</th>
              <th style="padding:7px 8px;text-align:center;border-bottom:1px solid #E2E8F0;color:#EF4444;font-weight:600;">เกินกำหนด</th>
              <th style="padding:7px 8px;border-bottom:1px solid #E2E8F0;color:#64748B;font-weight:600;">Workload</th>
            </tr>
          </thead>
          <tbody>
            ${memberStats.map((m, i) => `
              <tr style="background:${i%2===0?"#FAFAFA":"#fff"};">
                <td style="padding:7px 8px;font-weight:600;color:#1E293B;">${escapeHtml(shortPersonName(m.name))}</td>
                <td style="padding:7px 8px;text-align:center;">${m.total}</td>
                <td style="padding:7px 8px;text-align:center;font-weight:600;color:#0DB14B;">${m.closed}</td>
                <td style="padding:7px 8px;text-align:center;font-weight:${m.late>0?"700":"400"};color:${m.late>0?"#EF4444":"#94A3B8"};">${m.late>0?"⚠️ "+m.late:"—"}</td>
                <td style="padding:7px 8px;">
                  <div style="background:#F1F5F9;border-radius:4px;height:8px;overflow:hidden;min-width:70px;">
                    <div style="background:${m.late>0?"#EF4444":"#005DAC"};height:100%;width:${Math.round(m.total/maxMember*100)}%;border-radius:4px;"></div>
                  </div>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="5" style="padding:20px;text-align:center;color:#94A3B8;">ไม่มีข้อมูล</td></tr>`}
          </tbody>
        </table>
      `)}

      ${pBox("💡 คำแนะนำ",`
        ${tip(ftrRate>=80?"#F0FDF4":"#FFF7ED", ftrRate>=80?"#0DB14B":"#F59E0B",
          `<b>FTR Rate ${ftrRate}%</b><br>${ftrRate>=80?"✅ ดีเยี่ยม — ทีมมีความแม่นยำสูง ต้นทุนแฝงต่ำ":ftrRate>=60?"⚠️ ควรปรับปรุง — มีงานแก้ไขอยู่บ้าง ตรวจสอบกระบวนการ Brief":"🔴 ต้องแก้ไขด่วน — ควรทบทวนกระบวนการรับ Scope งาน"}`)}
        ${tip(onTimeRate>=80?"#F0FDF4":"#FFF7ED", onTimeRate>=80?"#0DB14B":"#F59E0B",
          `<b>On-Time Rate ${onTimeRate}%</b><br>${onTimeRate>=80?"✅ ส่งงานตรงเวลาส่วนใหญ่ — การจัดการเวลาดี":"⚠️ มีงานเกินกำหนดหลายชิ้น — ตรวจสอบ Workload และ Deadline"}`)}
        ${tip(overdue===0?"#F0FDF4":"#FEF2F2", overdue===0?"#0DB14B":"#EF4444",
          `<b>งานเกินกำหนด ${overdue} รายการ</b><br>${overdue===0?"✅ ทุกงานอยู่ในกำหนด":"🔴 ล่าช้าเฉลี่ย "+avgOverdueDays+" วัน · ต้นทุนโอกาสสูญเสีย ~"+overdueCostBaht.toLocaleString()+" บาท"}`)}
        ${tip(reworkRate<=20?"#F0FDF4":"#FEF2F2", reworkRate<=20?"#0DB14B":"#EF4444",
          `<b>Rework Rate ${reworkRate}%</b><br>${reworkRate<=20?"✅ อยู่ในเกณฑ์ดี — ต้นทุนการแก้ไขต่ำ":"🔴 สูงกว่าเป้าหมาย (20%) — ควรหาสาเหตุ Root Cause"}`)}
        <div style="padding:9px 12px;background:#F8FAFC;border-radius:8px;font-size:11px;color:#64748B;border:1px solid #E2E8F0;margin-top:4px;">
          📌 <b>SMART Goal:</b> ลด Rework Rate ลง 20% ใน 3 เดือน · ลด Waiting Time เป็น 0% ด้วยแบบฟอร์มมาตรฐาน · เป้าหมาย FTR &gt; 80%
        </div>
      `)}
    </div>
  `;
}

// ════════════════════════════════════════════════════════════
// REPORT BUILDER (เดิม — ไม่เปลี่ยน)
// ════════════════════════════════════════════════════════════

function filterReportRows(requests, period, person) {
  const now = new Date();
  return requests.filter((request) => {
    if (person) {
      const matchesEmail = String(request.assignedToEmail || "").toLowerCase() === person.email.toLowerCase();
      if (!matchesEmail && request.assignedToName !== person.name) return false;
    }
    if (period === "all") return true;
    const date = new Date(request.submittedAt || request.dueDate);
    if (Number.isNaN(date.getTime())) return false;
    if (period === "year") return date.getFullYear() === now.getFullYear();
    if (period === "month") return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    return date.toDateString() === now.toDateString();
  });
}

function renderExecutiveReport(rows, options) {
  const total = rows.length;
  const done = rows.filter((row) => [STATUS.DELIVERED, STATUS.DONE].includes(row.status)).length;
  const cancelled = rows.filter((row) => [STATUS.CANCELLED, STATUS.REJECTED].includes(row.status)).length;
  const active = rows.filter((row) => !CLOSED_STATUSES.includes(row.status)).length;
  const _todayNow2 = new Date();
  const todayStrReport = `${_todayNow2.getFullYear()}-${String(_todayNow2.getMonth()+1).padStart(2,"0")}-${String(_todayNow2.getDate()).padStart(2,"0")}`;
  const overdueRows = rows.filter((row) => {
    if (CLOSED_STATUSES.includes(row.status) || !row.dueDate) return false;
    const d = new Date(row.dueDate);
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    return ds < todayStrReport;
  }).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const allDetailRows = [...rows].sort((a, b) => new Date(b.submittedAt || b.dueDate || 0) - new Date(a.submittedAt || a.dueDate || 0));
  const detailRows = options.detailMode === "attention" ? overdueRows : allDetailRows;
  const completedWithDue = rows.filter((row) => [STATUS.DELIVERED, STATUS.DONE].includes(row.status) && row.dueDate && row.deliveredAt);
  const onTime = completedWithDue.filter((row) => {
    const d = new Date(row.deliveredAt);
    const due = new Date(row.dueDate);
    const ds  = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const dds = `${due.getFullYear()}-${String(due.getMonth()+1).padStart(2,"0")}-${String(due.getDate()).padStart(2,"0")}`;
    return ds <= dds;
  }).length;
  const onTimeRate = completedWithDue.length ? Math.round((onTime / completedWithDue.length) * 100) : 0;
  const typeSummary = groupCount(rows, (row) => row.requestType || "ไม่ระบุ").slice(0, 5);
  const reportTeam = getDrawingTeamMembers();
  const peopleSummary = reportTeam.map((user) => {
    const assignedRows = rows.filter((row) => String(row.assignedToEmail || "").toLowerCase() === user.email.toLowerCase() || row.assignedToName === user.name);
    const closedRows = assignedRows.filter((row) => [STATUS.DELIVERED, STATUS.DONE].includes(row.status));
    const measurableRows = closedRows.filter((row) => row.dueDate && completionDate(row));
    const late = measurableRows.filter((row) => completionDate(row) > new Date(row.dueDate)).length;
    return { label: user.name, count: assignedRows.length, closed: closedRows.length, onTime: measurableRows.length - late, late };
  }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "th"));
  const maxType = Math.max(1, ...typeSummary.map((item) => item.count));
  const maxPeople = Math.max(1, ...peopleSummary.map((item) => item.count));
  const title = options.scope === "individual" ? `รายงานรายบุคคล: ${options.person?.name || "-"}` : "รายงานภาพรวมฝ่ายเขียนแบบ";

  return `
    <header class="executive-report-header">
      <div><span>PPG DRAWING E-SERVICE</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(periodLabel(options.period))} · สร้างเมื่อ ${escapeHtml(formatDateOnly(new Date()))}</p></div>
      <div class="executive-report-mark">EXECUTIVE<br>SUMMARY</div>
    </header>
    <div class="executive-kpi-grid">
      ${reportKpi("งานทั้งหมด", total, "รายการ")}
      ${reportKpi("กำลังดำเนินการ", active, `${percent(active, total)}%`)}
      ${reportKpi("เกินกำหนด", overdueRows.length, overdueRows.length ? "ต้องติดตาม" : "ปกติ", overdueRows.length ? "danger" : "")}
      ${reportKpi("ตรงเวลา", `${onTimeRate}%`, `${completedWithDue.length} งานที่วัดผลได้`)}
    </div>
    <div class="executive-report-grid">
      <section class="executive-report-panel">
        <div class="executive-panel-title"><h3>งานแยกตามประเภท</h3><span>${total} งาน</span></div>
        <div class="executive-bar-list">${typeSummary.length ? typeSummary.map((item) => reportBar(item.label, item.count, maxType)).join("") : emptyReportBlock()}</div>
      </section>
      <section class="executive-report-panel">
        <div class="executive-panel-title"><h3>${options.scope === "individual" ? "สรุปสถานะทั้งหมด" : "ผลงานปิดงานรายบุคคล"}</h3><span>${options.scope === "individual" ? `${cancelled} ยกเลิก` : "ทั้งหมด / ปิด / ตรง / ช้า"}</span></div>
        <div class="executive-bar-list">
          ${options.scope === "individual"
            ? [{ label:"เสร็จสิ้น",count:done },{ label:"กำลังดำเนินการ",count:active },{ label:"ยกเลิก",count:cancelled }].map((item) => reportBar(item.label, item.count, Math.max(1, total))).join("")
            : peopleSummary.length ? peopleSummary.map((item) => reportPersonPerformance(item, maxPeople)).join("") : emptyReportBlock()}
        </div>
      </section>
    </div>
    <section class="executive-report-panel executive-attention-panel">
      <div class="executive-panel-title"><h3>${options.detailMode === "attention" ? "งานที่ควรติดตาม" : "รายละเอียดงานทั้งหมด"}</h3><span>${detailRows.length} รายการ · ${periodLabel(options.period)}</span></div>
      <table class="executive-report-table">
        <thead><tr><th>เลขคำร้อง</th><th>โครงการ / Drawing</th><th>ผู้รับผิดชอบ</th><th>กำหนดส่ง</th><th>สถานะ</th></tr></thead>
        <tbody>
          ${detailRows.length ? detailRows.map((row) => {
            const status = reportStatus(row);
            return `<tr><td><strong>${escapeHtml(row.requestNo)}</strong></td><td>${escapeHtml(row.projectName || "-")}<small>${escapeHtml(row.drawingNo || "-")} · ${escapeHtml(row.drawingName || "")}</small></td><td>${escapeHtml(shortPersonName(row.assignedToName || "ยังไม่มอบหมาย"))}</td><td>${escapeHtml(formatDateOnly(row.dueDate))}</td><td><span class="executive-status ${status.className}">${escapeHtml(status.label)}</span></td></tr>`;
          }).join("") : `<tr><td colspan="5" class="executive-empty-row">ไม่มีงานในช่วงเวลานี้</td></tr>`}
        </tbody>
      </table>
    </section>
    <footer class="executive-report-footer"><span>ข้อมูลจากระบบ PPG Drawing e-Service</span><span>รายงานสำหรับผู้บริหาร · หน้า 1/1</span></footer>
  `;
}

function reportKpi(label, value, note, className = "") {
  return `<article class="executive-kpi ${className}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;
}
function reportStatus(row) {
  const _todayNow3 = new Date();
  const todayStrRS = `${_todayNow3.getFullYear()}-${String(_todayNow3.getMonth()+1).padStart(2,"0")}-${String(_todayNow3.getDate()).padStart(2,"0")}`;
  const overdue = (() => { if (CLOSED_STATUSES.includes(row.status) || !row.dueDate) return false; const d = new Date(row.dueDate); const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; return ds < todayStrRS; })();
  if (overdue) return { label:"เกินกำหนด", className:"overdue" };
  if (row.status === STATUS.DONE) return { label:"เสร็จสิ้น", className:"done" };
  if ([STATUS.CANCELLED, STATUS.REJECTED].includes(row.status)) return { label:"ยกเลิก", className:"cancelled" };
  if (row.status === STATUS.WORKING) return { label:"กำลังดำเนินการ", className:"working" };
  if ([STATUS.DELIVERED, STATUS.MGR_REVIEW].includes(row.status)) return { label:"รอตรวจรับ", className:"review" };
  if (row.status === STATUS.MGR_REJECTED) return { label:"ผู้จัดการส่งกลับแก้ไข", className:"overdue" };
  if ([STATUS.PENDING, STATUS.INPROGRESS_LV1].includes(row.status)) return { label:"รออนุมัติ", className:"approval" };
  return { label:"รอรับงาน", className:"waiting" };
}
function reportBar(label, value, maximum) {
  return `<div class="executive-bar-row"><span title="${escapeHtml(label)}">${escapeHtml(label)}</span><div><i style="width:${Math.max(4, Math.round((value/maximum)*100))}%"></i></div><strong>${value}</strong></div>`;
}
function reportPersonPerformance(item, maximum) {
  return `<div class="executive-person-row"><span title="${escapeHtml(item.label)}">${escapeHtml(shortPersonName(item.label))}</span><div class="executive-person-bar"><i style="width:${Math.max(2, Math.round((item.count/maximum)*100))}%"></i></div><div class="executive-person-stats"><span>ทั้งหมด <b>${item.count}</b></span><span>ปิด <b>${item.closed}</b></span><span class="on-time">ตรง <b>${item.onTime}</b></span><span class="late">ช้า <b>${item.late}</b></span></div></div>`;
}
function completionDate(row) {
  // วันเสร็จงานฝ่าย = deliveredAt (ผู้จัดการส่งมอบ) ไม่รอ doneAt (Requester อนุมัติ)
  const value = row.deliveredAt || row.mgrApprovedAt;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function groupCount(rows, selector) {
  const grouped = rows.reduce((result, row) => { const key = selector(row); result[key] = (result[key]||0)+1; return result; }, {});
  return Object.entries(grouped).map(([label,count]) => ({label,count})).sort((a,b) => b.count-a.count);
}
function percent(value, total) { return total ? Math.round((value/total)*100) : 0; }
function periodLabel(period) {
  const now = new Date();
  if (period === "day") return `รายวัน ${formatDateOnly(now)}`;
  if (period === "year") return `รายปี ${now.getFullYear()+543}`;
  if (period === "all") return "ข้อมูลสะสมทั้งหมด";
  return new Intl.DateTimeFormat("th-TH", {month:"long",year:"numeric"}).format(now);
}
function shortPersonName(name) {
  const nickname = String(name||"").match(/\(([^)]+)\)/)?.[1];
  const clean = String(name||"").replace(/^(นาย|นางสาว|นาง)\s*/,"").replace(/\s*\([^)]+\)\s*$/,"");
  return nickname ? `${clean.split(" ")[0]} (${nickname})` : clean;
}
function emptyReportBlock() { return `<div class="executive-empty">ไม่มีข้อมูลในช่วงเวลานี้</div>`; }
