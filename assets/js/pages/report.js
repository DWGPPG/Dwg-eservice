import { CLOSED_STATUSES, STATUS } from "../../../config/schema.js";
import { getDrawingTeamMembers } from "../services/team-service.js";
import { escapeHtml, formatDateOnly } from "../utils.js";

// ── ค่า OT rate เริ่มต้น (บาท/ชั่วโมง) สำหรับคำนวณ Overdue Cost
const OT_RATE_PER_HOUR = 150;
const WORK_HOURS_PER_DAY = 8;

export function renderReport(view, state) {
  const team = getDrawingTeamMembers();
  view.innerHTML = `
    <!-- ═══ KPI DASHBOARD ═══ -->
    <section class="content-section kpi-dashboard-section">
      <div class="section-header" style="flex-wrap:wrap;gap:10px;">
        <div>
          <h2>📊 KPI ฝ่ายเขียนแบบ</h2>
          <p>อัปเดต real-time จากข้อมูลในระบบ</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <select id="kpi-scope" style="height:36px;padding:0 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:#fff;">
            <option value="department">ฝ่ายเขียนแบบ</option>
            <option value="individual">รายบุคคล</option>
          </select>
          <select id="kpi-person" style="height:36px;padding:0 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:#fff;display:none;">
            ${team.map((u) => `<option value="${escapeHtml(u.email)}">${escapeHtml(u.name)}</option>`).join("")}
          </select>
          <select id="kpi-period" style="height:36px;padding:0 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:#fff;">
            <option value="month">เดือนนี้</option>
            <option value="quarter">3 เดือนล่าสุด</option>
            <option value="year">ปีนี้</option>
            <option value="all">ทั้งหมด</option>
          </select>
          <button id="kpi-print" type="button" class="primary-button" style="height:36px;padding:0 14px;font-size:13px;">
            🖨️ Preview / Export PDF
          </button>
        </div>
      </div>
      <div id="kpi-dashboard-body"></div>
    </section>

    <hr style="border:none;border-top:2px solid var(--line);margin:2rem 0;">

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
            <option value="department">ทั้งแผนก</option>
            <option value="individual">รายบุคคล</option>
          </select>
        </label>
        <label class="track-select-filter">
          <span>ช่วงเวลา</span>
          <select id="report-period">
            <option value="month">รายเดือน</option>
            <option value="day">รายวัน</option>
            <option value="year">รายปี</option>
            <option value="all">ทั้งหมด</option>
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

  // ── KPI Dashboard ──
  const kpiScopeEl  = view.querySelector("#kpi-scope");
  const kpiPersonEl = view.querySelector("#kpi-person");
  const kpiPeriodEl = view.querySelector("#kpi-period");

  const renderDashboard = () => {
    const scope  = kpiScopeEl.value;
    const period = kpiPeriodEl.value;
    kpiPersonEl.style.display = scope === "individual" ? "block" : "none";
    const person = scope === "individual" ? team.find((u) => u.email === kpiPersonEl.value) : null;
    const body = view.querySelector("#kpi-dashboard-body");
    if (body) body.innerHTML = renderKpiDashboard(state.requests, team, period, person);
  };

  kpiScopeEl.addEventListener("change", renderDashboard);
  kpiPersonEl.addEventListener("change", renderDashboard);
  kpiPeriodEl.addEventListener("change", renderDashboard);
  view.querySelector("#kpi-print").addEventListener("click", () => {
    const body = view.querySelector("#kpi-dashboard-body");
    if (!body) return;
    const w = window.open("", "_blank");
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>KPI ฝ่ายเขียนแบบ</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:15mm;background:#fff;}
        @page{size:A4;margin:10mm;}
        @media print{body{margin:0;}}
        h1{font-size:18px;color:#005DAC;margin-bottom:4px;}
        .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;}
        .card{border:1px solid #E2E8F0;border-radius:8px;padding:12px;}
        .val{font-size:22px;font-weight:800;}
        .row{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
        .bar-bg{flex:1;background:#F1F5F9;border-radius:4px;height:8px;overflow:hidden;}
        .bar-fill{height:100%;border-radius:4px;}
        table{width:100%;border-collapse:collapse;font-size:11px;}
        th{background:#005DAC;color:#fff;padding:6px 8px;text-align:left;}
        td{border:0.5px solid #ddd;padding:5px 8px;}
        tr:nth-child(even) td{background:#F8FAFC;}
        .panel{border:1px solid #E2E8F0;border-radius:8px;padding:14px;margin-bottom:14px;}
        .panel h3{font-size:13px;color:#1E293B;margin:0 0 10px;}
        .red{color:#EF4444;} .green{color:#0DB14B;} .orange{color:#F59E0B;}
      </style>
    </head><body>
      <h1>📊 KPI ฝ่ายเขียนแบบ — PPG Drawing e-Service</h1>
      <p style="color:#64748B;font-size:11px;">สร้างเมื่อ ${new Date().toLocaleDateString("th-TH",{year:"numeric",month:"long",day:"numeric"})} · ช่วงเวลา: ${kpiPeriodEl.options[kpiPeriodEl.selectedIndex].text}${kpiPersonEl.style.display!=="none"?" · "+kpiPersonEl.options[kpiPersonEl.selectedIndex]?.text:""}</p>
      <hr>
      ${body.innerHTML}
    </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 800);
  });

  renderDashboard();

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

function filterByKpiPeriod(requests, period, person = null) {
  const now = new Date();
  return requests.filter((r) => {
    if (person) {
      const match = String(r.assignedToEmail || "").toLowerCase() === person.email.toLowerCase();
      if (!match) return false;
    }
    const d = new Date(r.submittedAt || r.dueDate);
    if (isNaN(d)) return false;
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
  return `<div style="display:grid;grid-template-columns:140px 1fr 52px;align-items:center;gap:8px;margin-bottom:8px;">
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

function renderKpiDashboard(allRequests, team, period, person = null) {
  const rows      = filterByKpiPeriod(allRequests, period, person);
  const total     = rows.length;
  const done      = rows.filter((r) => r.status === STATUS.DONE).length;
  const active    = rows.filter((r) => !CLOSED_STATUSES.includes(r.status)).length;
  const cancelled = rows.filter((r) => [STATUS.CANCELLED, STATUS.REJECTED].includes(r.status)).length;
  const now       = new Date();

  // งานเกินกำหนด (active)
  const overdueRows = rows.filter((r) => !CLOSED_STATUSES.includes(r.status) && r.dueDate && new Date(r.dueDate) < now);
  const overdue     = overdueRows.length;

  // Revision / Rework
  const withRevise = rows.filter((r) => r.isRevision || (r.reviseNumber && r.reviseNumber !== "0" && r.reviseNumber !== "")).length;
  const rejected   = rows.filter((r) => r.revisionReason || r.rejectReason).length;

  // FTR
  const measurable = rows.filter((r) => r.status === STATUS.DONE);
  const ftrCount   = measurable.filter((r) => !r.isRevision && !r.revisionReason).length;
  const ftrRate    = measurable.length ? Math.round((ftrCount / measurable.length) * 100) : 0;

  // On-Time
  const withDue    = measurable.filter((r) => r.dueDate && (r.doneAt || r.deliveredAt));
  const onTime     = withDue.filter((r) => new Date(r.doneAt || r.deliveredAt) <= new Date(r.dueDate)).length;
  const onTimeRate = withDue.length ? Math.round((onTime / withDue.length) * 100) : 0;

  // Avg Cycle Time
  const cycleRows  = measurable.filter((r) => r.submittedAt && r.doneAt);
  const avgCycle   = cycleRows.length
    ? Math.round(cycleRows.reduce((s, r) => s + (new Date(r.doneAt) - new Date(r.submittedAt)) / 86400000, 0) / cycleRows.length * 10) / 10
    : null;

  // Rework Rate
  const reworkRate = total ? Math.round(((withRevise + rejected) / total) * 100) : 0;

  // ── OVERDUE KPIs ──
  // Average Overdue Duration (วัน)
  const overdueDurations = overdueRows.map((r) => Math.max(0, Math.round((now - new Date(r.dueDate)) / 86400000)));
  const avgOverdueDays   = overdueDurations.length
    ? Math.round(overdueDurations.reduce((s, v) => s + v, 0) / overdueDurations.length * 10) / 10
    : 0;

  // Overdue Cost of Opportunity (บาท)
  const totalOverdueDays   = overdueDurations.reduce((s, v) => s + v, 0);
  const overdueCostBaht    = Math.round(totalOverdueDays * WORK_HOURS_PER_DAY * OT_RATE_PER_HOUR);

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
    const closed   = assigned.filter((r) => r.status === STATUS.DONE).length;
    const late     = assigned.filter((r) => !CLOSED_STATUSES.includes(r.status) && r.dueDate && new Date(r.dueDate) < now).length;
    return { name: u.name, total: assigned.length, closed, late };
  }).filter((m) => m.total > 0).sort((a, b) => b.total - a.total);
  const maxMember = Math.max(1, ...memberStats.map((m) => m.total));

  const periodTh = { month:"เดือนนี้", quarter:"3 เดือนล่าสุด", year:"ปีนี้", all:"ทุกช่วงเวลา" }[period] || period;
  const scopeLabel = person ? person.name : "ฝ่ายเขียนแบบ";

  return `
    <!-- KPI Cards Row 1: Overview -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px;margin-bottom:16px;">
      ${kpiCard("📋","คำร้องทั้งหมด",total,periodTh+" · "+scopeLabel,"#005DAC")}
      ${kpiCard("✅","เสร็จสิ้น",done,`${total?Math.round(done/total*100):0}% ของทั้งหมด`,"#0DB14B")}
      ${kpiCard("⚙️","กำลังดำเนินการ",active,"งานที่ยังไม่ปิด","#1D4ED8")}
      ${kpiCard("⚠️","เกินกำหนด",overdue,overdue>0?"ต้องติดตามด่วน":"อยู่ในเกณฑ์ดี",overdue>0?"#EF4444":"#0DB14B")}
      ${kpiCard("🎯","FTR Rate",`${ftrRate}%`,"First-Time Right",ftrRate>=80?"#0DB14B":ftrRate>=60?"#F59E0B":"#EF4444")}
      ${kpiCard("🚀","ส่งตรงเวลา",`${onTimeRate}%`,`จาก ${withDue.length} งานที่วัดผลได้`,onTimeRate>=80?"#0DB14B":"#F59E0B")}
      ${kpiCard("🔄","Rework Rate",`${reworkRate}%`,"งานที่มีการแก้ไข",reworkRate<=20?"#0DB14B":reworkRate<=40?"#F59E0B":"#EF4444")}
      ${kpiCard("⏱️","Avg Cycle Time",avgCycle!==null?`${avgCycle} วัน`:"—","ส่งคำร้อง → เสร็จสิ้น","#7C3AED")}
    </div>

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

    <!-- Row 3: OVERDUE KPI SECTION -->
    <div style="background:#FFF1F2;border:1.5px solid #FECACA;border-radius:14px;padding:20px;margin-bottom:14px;">
      <div style="font-size:14px;font-weight:700;color:#991B1B;margin-bottom:14px;">
        🔴 งานเกินกำหนด — KPI เชิงลึก
        <span style="font-size:11px;font-weight:400;color:#B91C1C;margin-left:8px;">${overdue} รายการที่ยังเกินกำหนดอยู่</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:16px;">
        ${kpiCard("📅","จำนวนงานเกินกำหนด",overdue,`${total?Math.round(overdue/total*100):0}% ของทั้งหมด`,overdue>0?"#EF4444":"#0DB14B")}
        ${kpiCard("⏳","ล่าช้าเฉลี่ย",avgOverdueDays>0?`${avgOverdueDays} วัน`:"—","Average Overdue Duration",avgOverdueDays>7?"#EF4444":avgOverdueDays>3?"#F59E0B":"#0DB14B")}
        ${kpiCard("💸","ต้นทุนโอกาส",overdueCostBaht>0?`~${overdueCostBaht.toLocaleString()} ฿`:"—",`OT ${OT_RATE_PER_HOUR}฿/ชม. × ${totalOverdueDays} วัน-งาน`,"#B91C1C")}
        ${kpiCard("📊","Overdue Rate",`${total?Math.round(overdue/total*100):0}%`,"% งานที่เกินกำหนด ณ ปัจจุบัน",overdue>0?"#EF4444":"#0DB14B")}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">

        <!-- Root Cause -->
        ${pBox("🔎 Root Cause of Overdue — สาเหตุที่งานเกินกำหนด",`
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
  const done = rows.filter((row) => row.status === STATUS.DONE).length;
  const cancelled = rows.filter((row) => [STATUS.CANCELLED, STATUS.REJECTED].includes(row.status)).length;
  const active = rows.filter((row) => !CLOSED_STATUSES.includes(row.status)).length;
  const overdueRows = rows.filter((row) => !CLOSED_STATUSES.includes(row.status) && row.dueDate && new Date(row.dueDate) < new Date()).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const allDetailRows = [...rows].sort((a, b) => new Date(b.submittedAt || b.dueDate || 0) - new Date(a.submittedAt || a.dueDate || 0));
  const detailRows = options.detailMode === "attention" ? overdueRows : allDetailRows;
  const completedWithDue = rows.filter((row) => row.status === STATUS.DONE && row.dueDate);
  const onTime = completedWithDue.filter((row) => new Date(row.doneAt || row.deliveredAt || row.dueDate) <= new Date(row.dueDate)).length;
  const onTimeRate = completedWithDue.length ? Math.round((onTime / completedWithDue.length) * 100) : 0;
  const typeSummary = groupCount(rows, (row) => row.requestType || "ไม่ระบุ").slice(0, 5);
  const reportTeam = getDrawingTeamMembers();
  const peopleSummary = reportTeam.map((user) => {
    const assignedRows = rows.filter((row) => String(row.assignedToEmail || "").toLowerCase() === user.email.toLowerCase() || row.assignedToName === user.name);
    const closedRows = assignedRows.filter((row) => row.status === STATUS.DONE);
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
  const overdue = !CLOSED_STATUSES.includes(row.status) && row.dueDate && new Date(row.dueDate) < new Date();
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
  const value = row.doneAt || row.requesterReviewedAt || row.deliveredAt;
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
