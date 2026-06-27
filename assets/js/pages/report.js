import { CLOSED_STATUSES, STATUS } from "../../../config/schema.js";
import { getDrawingTeamMembers } from "../services/team-service.js";
import { escapeHtml, formatDateOnly } from "../utils.js";

export function renderReport(view, state) {
  const team = getDrawingTeamMembers();
  view.innerHTML = `
    <!-- ═══ KPI DASHBOARD ═══ -->
    <section class="content-section kpi-dashboard-section">
      <div class="section-header">
        <div>
          <h2>📊 Dashboard — ภาพรวมประสิทธิภาพ</h2>
          <p>KPI สำหรับ HR และผู้บริหาร · อัปเดต real-time จากข้อมูลในระบบ</p>
        </div>
        <div style="display:flex;gap:8px;">
          <select id="kpi-period" class="track-select-filter" style="height:36px;padding:0 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;">
            <option value="month">เดือนนี้</option>
            <option value="quarter">3 เดือนล่าสุด</option>
            <option value="year">ปีนี้</option>
            <option value="all">ทั้งหมด</option>
          </select>
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
  const kpiPeriodEl = view.querySelector("#kpi-period");
  const renderDashboard = () => {
    const body = view.querySelector("#kpi-dashboard-body");
    if (body) body.innerHTML = renderKpiDashboard(state.requests, team, kpiPeriodEl.value);
  };
  kpiPeriodEl.addEventListener("change", renderDashboard);
  renderDashboard();

  const scope = view.querySelector("#report-scope");
  const period = view.querySelector("#report-period");
  const personField = view.querySelector("#report-person-field");
  const person = view.querySelector("#report-person");
  const detailMode = view.querySelector("#report-detail-mode");
  const preview = view.querySelector("#executive-report-preview");

  const update = () => {
    personField.hidden = scope.value !== "individual";
    const selectedPerson = team.find((user) => user.email === person.value);
    const rows = filterReportRows(state.requests, period.value, scope.value === "individual" ? selectedPerson : null);
    preview.innerHTML = renderExecutiveReport(rows, {
      scope: scope.value,
      period: period.value,
      person: selectedPerson,
      detailMode: detailMode.value,
    });
  };

  scope.addEventListener("change", update);
  period.addEventListener("change", update);
  person.addEventListener("change", update);
  detailMode.addEventListener("change", update);
  view.querySelector("#print-executive-report").addEventListener("click", () => window.print());
  update();
}

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
  const overdueRows = rows
    .filter((row) => !CLOSED_STATUSES.includes(row.status) && row.dueDate && new Date(row.dueDate) < new Date())
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const allDetailRows = [...rows].sort((a, b) =>
    new Date(b.submittedAt || b.dueDate || 0) - new Date(a.submittedAt || a.dueDate || 0)
  );
  const detailRows = options.detailMode === "attention" ? overdueRows : allDetailRows;
  const completedWithDue = rows.filter((row) => row.status === STATUS.DONE && row.dueDate);
  const onTime = completedWithDue.filter((row) => new Date(row.doneAt || row.deliveredAt || row.dueDate) <= new Date(row.dueDate)).length;
  const onTimeRate = completedWithDue.length ? Math.round((onTime / completedWithDue.length) * 100) : 0;
  const typeSummary = groupCount(rows, (row) => row.requestType || "ไม่ระบุ").slice(0, 5);
  const reportTeam = getDrawingTeamMembers();
  const peopleSummary = reportTeam.map((user) => {
    const assignedRows = rows.filter((row) =>
      String(row.assignedToEmail || "").toLowerCase() === user.email.toLowerCase()
      || row.assignedToName === user.name
    );
    const closedRows = assignedRows.filter((row) => row.status === STATUS.DONE);
    const measurableRows = closedRows.filter((row) => row.dueDate && completionDate(row));
    const late = measurableRows.filter((row) => completionDate(row) > new Date(row.dueDate)).length;
    return {
      label: user.name,
      count: assignedRows.length,
      closed: closedRows.length,
      onTime: measurableRows.length - late,
      late,
    };
  }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "th"));
  const maxType = Math.max(1, ...typeSummary.map((item) => item.count));
  const maxPeople = Math.max(1, ...peopleSummary.map((item) => item.count));
  const title = options.scope === "individual" ? `รายงานรายบุคคล: ${options.person?.name || "-"}` : "รายงานภาพรวมฝ่ายเขียนแบบ";

  return `
    <header class="executive-report-header">
      <div>
        <span>PPG DRAWING E-SERVICE</span>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(periodLabel(options.period))} · สร้างเมื่อ ${escapeHtml(formatDateOnly(new Date()))}</p>
      </div>
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
        <div class="executive-bar-list">
          ${typeSummary.length ? typeSummary.map((item) => reportBar(item.label, item.count, maxType)).join("") : emptyReportBlock()}
        </div>
      </section>
      <section class="executive-report-panel">
        <div class="executive-panel-title"><h3>${options.scope === "individual" ? "สรุปสถานะทั้งหมด" : "ผลงานปิดงานรายบุคคล"}</h3><span>${options.scope === "individual" ? `${cancelled} ยกเลิก` : "ทั้งหมด / ปิด / ตรง / ช้า"}</span></div>
        <div class="executive-bar-list">
          ${options.scope === "individual"
            ? [
                { label: "เสร็จสิ้น", count: done },
                { label: "กำลังดำเนินการ", count: active },
                { label: "ยกเลิก", count: cancelled },
              ].map((item) => reportBar(item.label, item.count, Math.max(1, total))).join("")
            : peopleSummary.length
              ? peopleSummary.map((item) => reportPersonPerformance(item, maxPeople)).join("")
              : emptyReportBlock()}
        </div>
      </section>
    </div>

    <section class="executive-report-panel executive-attention-panel">
      <div class="executive-panel-title">
        <h3>${options.detailMode === "attention" ? "งานที่ควรติดตาม" : "รายละเอียดงานทั้งหมด"}</h3>
        <span>${detailRows.length} รายการ · ${periodLabel(options.period)}</span>
      </div>
      <table class="executive-report-table">
        <thead><tr><th>เลขคำร้อง</th><th>โครงการ / Drawing</th><th>ผู้รับผิดชอบ</th><th>กำหนดส่ง</th><th>สถานะ</th></tr></thead>
        <tbody>
          ${detailRows.length
            ? detailRows.map((row) => {
              const status = reportStatus(row);
              return `
              <tr>
                <td><strong>${escapeHtml(row.requestNo)}</strong></td>
                <td>${escapeHtml(row.projectName || "-")}<small>${escapeHtml(row.drawingNo || "-")} · ${escapeHtml(row.drawingName || "")}</small></td>
                <td>${escapeHtml(shortPersonName(row.assignedToName || "ยังไม่มอบหมาย"))}</td>
                <td>${escapeHtml(formatDateOnly(row.dueDate))}</td>
                <td><span class="executive-status ${status.className}">${escapeHtml(status.label)}</span></td>
              </tr>
            `;
            }).join("")
            : `<tr><td colspan="5" class="executive-empty-row">ไม่มีงานในช่วงเวลานี้</td></tr>`}
        </tbody>
      </table>
    </section>

    <footer class="executive-report-footer">
      <span>ข้อมูลจากระบบ PPG Drawing e-Service</span>
      <span>รายงานสำหรับผู้บริหาร · หน้า 1/1</span>
    </footer>
  `;
}

function reportKpi(label, value, note, className = "") {
  return `<article class="executive-kpi ${className}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;
}

function reportStatus(row) {
  const overdue = !CLOSED_STATUSES.includes(row.status) && row.dueDate && new Date(row.dueDate) < new Date();
  if (overdue) return { label: "เกินกำหนด", className: "overdue" };
  if (row.status === STATUS.DONE) return { label: "เสร็จสิ้น", className: "done" };
  if ([STATUS.CANCELLED, STATUS.REJECTED].includes(row.status)) return { label: "ยกเลิก", className: "cancelled" };
  if (row.status === STATUS.WORKING) return { label: "กำลังดำเนินการ", className: "working" };
  if ([STATUS.DELIVERED, STATUS.MGR_REVIEW].includes(row.status)) return { label: "รอตรวจรับ", className: "review" };
  if (row.status === STATUS.MGR_REJECTED) return { label: "ผู้จัดการส่งกลับแก้ไข", className: "overdue" };
  if ([STATUS.PENDING, STATUS.INPROGRESS_LV1].includes(row.status)) return { label: "รออนุมัติ", className: "approval" };
  return { label: "รอรับงาน", className: "waiting" };
}

function reportBar(label, value, maximum) {
  return `
    <div class="executive-bar-row">
      <span title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      <div><i style="width:${Math.max(4, Math.round((value / maximum) * 100))}%"></i></div>
      <strong>${value}</strong>
    </div>
  `;
}

function reportPersonPerformance(item, maximum) {
  return `
    <div class="executive-person-row">
      <span title="${escapeHtml(item.label)}">${escapeHtml(shortPersonName(item.label))}</span>
      <div class="executive-person-bar"><i style="width:${Math.max(2, Math.round((item.count / maximum) * 100))}%"></i></div>
      <div class="executive-person-stats">
        <span>ทั้งหมด <b>${item.count}</b></span>
        <span>ปิด <b>${item.closed}</b></span>
        <span class="on-time">ตรง <b>${item.onTime}</b></span>
        <span class="late">ช้า <b>${item.late}</b></span>
      </div>
    </div>
  `;
}

function completionDate(row) {
  const value = row.doneAt || row.requesterReviewedAt || row.deliveredAt;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function groupCount(rows, selector) {
  const grouped = rows.reduce((result, row) => {
    const key = selector(row);
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
  return Object.entries(grouped)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function percent(value, total) {
  return total ? Math.round((value / total) * 100) : 0;
}

function periodLabel(period) {
  const now = new Date();
  if (period === "day") return `รายวัน ${formatDateOnly(now)}`;
  if (period === "year") return `รายปี ${now.getFullYear() + 543}`;
  if (period === "all") return "ข้อมูลสะสมทั้งหมด";
  return new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric" }).format(now);
}

function shortPersonName(name) {
  const nickname = String(name || "").match(/\(([^)]+)\)/)?.[1];
  const clean = String(name || "").replace(/^(นาย|นางสาว|นาง)\s*/, "").replace(/\s*\([^)]+\)\s*$/, "");
  return nickname ? `${clean.split(" ")[0]} (${nickname})` : clean;
}

function emptyReportBlock() {
  return `<div class="executive-empty">ไม่มีข้อมูลในช่วงเวลานี้</div>`;
}

// ══════════════════════════════════════════════════════════════
// KPI DASHBOARD
// ══════════════════════════════════════════════════════════════

function filterByKpiPeriod(requests, period) {
  const now = new Date();
  return requests.filter((r) => {
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

function kpiCard(icon, label, value, sub, color = "#005DAC", trend = null) {
  const trendHtml = trend !== null
    ? `<span style="font-size:11px;color:${trend >= 0 ? "#0DB14B" : "#EF4444"};margin-left:6px;">${trend >= 0 ? "▲" : "▼"} ${Math.abs(trend)}%</span>`
    : "";
  return `
    <div style="background:#fff;border-radius:12px;padding:18px 20px;border:1px solid #E2E8F0;box-shadow:0 2px 8px rgba(0,0,0,0.06);display:flex;flex-direction:column;gap:6px;">
      <div style="font-size:20px;">${icon}</div>
      <div style="font-size:12px;color:#64748B;font-weight:500;">${label}</div>
      <div style="font-size:26px;font-weight:800;color:${color};line-height:1;">${value}${trendHtml}</div>
      <div style="font-size:11px;color:#94A3B8;">${sub}</div>
    </div>`;
}

function miniBar(label, pct, color, value) {
  return `
    <div style="display:grid;grid-template-columns:130px 1fr 40px;align-items:center;gap:8px;margin-bottom:8px;">
      <div style="font-size:12px;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(label)}</div>
      <div style="background:#F1F5F9;border-radius:4px;height:8px;overflow:hidden;">
        <div style="background:${color};height:100%;width:${Math.min(100, pct)}%;border-radius:4px;transition:width 0.4s;"></div>
      </div>
      <div style="font-size:12px;color:#64748B;text-align:right;">${value}</div>
    </div>`;
}

function sectionTitle(title, sub = "") {
  return `<div style="font-size:13px;font-weight:700;color:#1E293B;margin-bottom:12px;">${title}${sub ? `<span style="font-size:11px;font-weight:400;color:#94A3B8;margin-left:8px;">${sub}</span>` : ""}</div>`;
}

function panel(content, cols = 1) {
  return `<div style="background:#fff;border-radius:12px;padding:20px;border:1px solid #E2E8F0;box-shadow:0 2px 8px rgba(0,0,0,0.06);${cols > 1 ? `grid-column:span ${cols};` : ""}">${content}</div>`;
}

function renderKpiDashboard(allRequests, team, period) {
  const rows = filterByKpiPeriod(allRequests, period);
  const total       = rows.length;
  const done        = rows.filter((r) => r.status === STATUS.DONE).length;
  const cancelled   = rows.filter((r) => [STATUS.CANCELLED, STATUS.REJECTED].includes(r.status)).length;
  const active      = rows.filter((r) => !CLOSED_STATUSES.includes(r.status)).length;
  const overdue     = rows.filter((r) => !CLOSED_STATUSES.includes(r.status) && r.dueDate && new Date(r.dueDate) < new Date()).length;
  const withRevise  = rows.filter((r) => r.isRevision || (r.reviseNumber && r.reviseNumber !== "0" && r.reviseNumber !== "")).length;
  const rejected    = rows.filter((r) => [STATUS.REJECTED, "revise"].includes(r.status) || r.revisionReason).length;

  // ── FTR (First Time Right) — งานที่ไม่มี Revision และไม่ถูก Reject
  const measurable  = rows.filter((r) => r.status === STATUS.DONE);
  const ftrCount    = measurable.filter((r) => !r.isRevision && !r.revisionReason).length;
  const ftrRate     = measurable.length ? Math.round((ftrCount / measurable.length) * 100) : 0;

  // ── On-Time Delivery Rate
  const withDue     = measurable.filter((r) => r.dueDate && (r.doneAt || r.deliveredAt));
  const onTime      = withDue.filter((r) => new Date(r.doneAt || r.deliveredAt) <= new Date(r.dueDate)).length;
  const onTimeRate  = withDue.length ? Math.round((onTime / withDue.length) * 100) : 0;

  // ── Avg Cycle Time (วัน) จากส่งคำร้อง → เสร็จสิ้น
  const cycleRows   = measurable.filter((r) => r.submittedAt && r.doneAt);
  const avgCycle    = cycleRows.length
    ? Math.round(cycleRows.reduce((s, r) => s + (new Date(r.doneAt) - new Date(r.submittedAt)) / 86400000, 0) / cycleRows.length * 10) / 10
    : null;

  // ── Rework Rate — % ของงานที่มี Revision / ถูก Reject
  const reworkRate  = total ? Math.round(((withRevise + rejected) / total) * 100) : 0;

  // ── Workload per member
  const memberStats = team.map((u) => {
    const assigned = rows.filter((r) => String(r.assignedToEmail || "").toLowerCase() === u.email.toLowerCase());
    const closed   = assigned.filter((r) => r.status === STATUS.DONE).length;
    const lateWork = assigned.filter((r) => !CLOSED_STATUSES.includes(r.status) && r.dueDate && new Date(r.dueDate) < new Date()).length;
    return { name: u.name, total: assigned.length, closed, late: lateWork };
  }).sort((a, b) => b.total - a.total);
  const maxMember = Math.max(1, ...memberStats.map((m) => m.total));

  // ── Issue source (เดาจากข้อมูลที่มี: Revision = แก้ตามลูกค้า, Reject = ส่งกลับจากผู้จัดการ)
  const issueSources = [
    { label: "Revision จากผู้ร้องขอ", count: withRevise,                         color: "#F59E0B" },
    { label: "Reject จากผู้จัดการ",   count: rejected,                            color: "#EF4444" },
    { label: "งานเกินกำหนด",           count: overdue,                             color: "#7C3AED" },
    { label: "ยกเลิกคำร้อง",          count: cancelled,                           color: "#94A3B8" },
  ].filter((s) => s.count > 0);
  const maxIssue = Math.max(1, ...issueSources.map((s) => s.count));

  // ── Type breakdown
  const typeMap = {};
  rows.forEach((r) => { const t = r.requestType || "ไม่ระบุ"; typeMap[t] = (typeMap[t] || 0) + 1; });
  const typeList = Object.entries(typeMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxType = Math.max(1, ...typeList.map((t) => t[1]));

  const periodTh = { month: "เดือนนี้", quarter: "3 เดือนล่าสุด", year: "ปีนี้", all: "ทุกช่วงเวลา" }[period] || period;

  return `
    <!-- ── KPI Cards ── -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:20px;">
      ${kpiCard("📋", "คำร้องทั้งหมด",   total,        periodTh, "#005DAC")}
      ${kpiCard("✅", "เสร็จสิ้น",        done,         `${total ? Math.round(done/total*100) : 0}% ของทั้งหมด`, "#0DB14B")}
      ${kpiCard("⚙️", "กำลังดำเนินการ", active,       "งานที่ยังไม่ปิด", "#1D4ED8")}
      ${kpiCard("⚠️", "เกินกำหนด",        overdue,      "ต้องติดตาม", overdue > 0 ? "#EF4444" : "#0DB14B")}
      ${kpiCard("🎯", "FTR Rate",          `${ftrRate}%`, "First-Time Right", ftrRate >= 80 ? "#0DB14B" : ftrRate >= 60 ? "#F59E0B" : "#EF4444")}
      ${kpiCard("🚀", "ส่งตรงเวลา",       `${onTimeRate}%`, `จาก ${withDue.length} งานที่วัดผลได้`, onTimeRate >= 80 ? "#0DB14B" : "#F59E0B")}
      ${kpiCard("🔄", "Rework Rate",       `${reworkRate}%`, "งานที่มีการแก้ไข", reworkRate <= 20 ? "#0DB14B" : reworkRate <= 40 ? "#F59E0B" : "#EF4444")}
      ${kpiCard("⏱️", "Avg Cycle Time",    avgCycle !== null ? `${avgCycle} วัน` : "—", "ส่งคำร้อง → เสร็จสิ้น", "#7C3AED")}
    </div>

    <!-- ── Panels ── -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px;">

      <!-- Efficiency Panel -->
      ${panel(`
        ${sectionTitle("📈 Efficiency KPIs", "ประสิทธิภาพการทำงาน")}
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${kpiGauge("FTR Ratio (First-Time Right)", ftrRate, 80, "% งานผ่านตั้งแต่ครั้งแรก ไม่ต้องแก้")}
          ${kpiGauge("On-Time Delivery Rate", onTimeRate, 85, "% งานส่งตรงตามกำหนด")}
          ${kpiGauge("งานเสร็จสิ้น / ทั้งหมด", total ? Math.round(done/total*100) : 0, 70, "% อัตราปิดงานสำเร็จ")}
        </div>
        <div style="margin-top:14px;padding:10px 12px;background:#F0F9FF;border-radius:8px;border-left:3px solid #005DAC;">
          <div style="font-size:11px;color:#005DAC;font-weight:600;">💡 Avg Cycle Time</div>
          <div style="font-size:20px;font-weight:800;color:#005DAC;">${avgCycle !== null ? avgCycle + " วัน" : "ยังไม่มีข้อมูล"}</div>
          <div style="font-size:10px;color:#64748B;">ระยะเวลาเฉลี่ยตั้งแต่รับคำร้อง → เสร็จสิ้น</div>
        </div>
      `)}

      <!-- Quality Panel -->
      ${panel(`
        ${sectionTitle("🔍 Quality KPIs", "คุณภาพงาน")}
        ${issueSources.length ? issueSources.map((s) => miniBar(s.label, Math.round(s.count/maxIssue*100), s.color, s.count + " ครั้ง")).join("") : "<div style='color:#94A3B8;font-size:12px;'>ไม่พบปัญหาในช่วงนี้ ✅</div>"}
        <div style="margin-top:14px;padding:10px 12px;background:#FFF7ED;border-radius:8px;border-left:3px solid #F59E0B;">
          <div style="font-size:11px;color:#D97706;font-weight:600;">⚠️ Rework Impact</div>
          <div style="font-size:20px;font-weight:800;color:#D97706;">${withRevise + rejected} งาน</div>
          <div style="font-size:10px;color:#64748B;">ต้องแก้ไขหรือส่งกลับใน${periodTh} (${reworkRate}% ของทั้งหมด)</div>
        </div>
        <div style="margin-top:8px;padding:8px 12px;background:#F0FDF4;border-radius:8px;font-size:11px;color:#065F46;">
          🎯 เป้าหมาย: Rework Rate &lt; 20% · FTR &gt; 80%
        </div>
      `)}

      <!-- Type Breakdown Panel -->
      ${panel(`
        ${sectionTitle("🏷️ งานแยกตามประเภท", `${total} คำร้อง`)}
        ${typeList.length
          ? typeList.map(([t, n]) => miniBar(t, Math.round(n/maxType*100), "#005DAC", n + " งาน")).join("")
          : "<div style='color:#94A3B8;font-size:12px;'>ไม่มีข้อมูล</div>"}
      `)}
    </div>

    <!-- Workload per member -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      ${panel(`
        ${sectionTitle("👥 Workload รายบุคคล", "งานที่ได้รับมอบหมาย")}
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="background:#F8FAFC;">
                <th style="padding:8px 10px;text-align:left;border-bottom:1px solid #E2E8F0;color:#64748B;font-weight:600;">ชื่อ</th>
                <th style="padding:8px 10px;text-align:center;border-bottom:1px solid #E2E8F0;color:#64748B;font-weight:600;">ทั้งหมด</th>
                <th style="padding:8px 10px;text-align:center;border-bottom:1px solid #E2E8F0;color:#64748B;font-weight:600;">ปิดแล้ว</th>
                <th style="padding:8px 10px;text-align:center;border-bottom:1px solid #E2E8F0;color:#EF4444;font-weight:600;">เกินกำหนด</th>
                <th style="padding:8px 10px;text-align:left;border-bottom:1px solid #E2E8F0;color:#64748B;font-weight:600;">Workload</th>
              </tr>
            </thead>
            <tbody>
              ${memberStats.filter((m) => m.total > 0).map((m, i) => `
                <tr style="background:${i%2===0?"#FAFAFA":"#fff"};">
                  <td style="padding:8px 10px;font-weight:600;color:#1E293B;">${escapeHtml(m.name)}</td>
                  <td style="padding:8px 10px;text-align:center;color:#1E293B;">${m.total}</td>
                  <td style="padding:8px 10px;text-align:center;color:#0DB14B;font-weight:600;">${m.closed}</td>
                  <td style="padding:8px 10px;text-align:center;color:${m.late > 0 ? "#EF4444" : "#94A3B8"};font-weight:${m.late > 0 ? "700" : "400"};">${m.late > 0 ? "⚠️ "+m.late : "—"}</td>
                  <td style="padding:8px 10px;">
                    <div style="background:#F1F5F9;border-radius:4px;height:8px;overflow:hidden;min-width:80px;">
                      <div style="background:${m.late > 0 ? "#EF4444" : "#005DAC"};height:100%;width:${Math.round(m.total/maxMember*100)}%;border-radius:4px;"></div>
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="5" style="padding:20px;text-align:center;color:#94A3B8;">ไม่มีข้อมูลในช่วงนี้</td></tr>`}
            </tbody>
          </table>
        </div>
      `, 1)}

      <!-- Issue Source + Tips -->
      ${panel(`
        ${sectionTitle("💡 คำแนะนำสำหรับผู้บริหาร")}
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div style="padding:10px 12px;background:#F0FDF4;border-radius:8px;border-left:3px solid #0DB14B;font-size:12px;color:#065F46;">
            <b>FTR Rate ${ftrRate}%</b><br>
            ${ftrRate >= 80 ? "✅ ดีเยี่ยม — ทีมเขียนแบบมีความแม่นยำสูง ต้นทุนแฝงจากการแก้ไขต่ำ" : ftrRate >= 60 ? "⚠️ ควรปรับปรุง — มีงานที่ต้องแก้ไขอยู่บ้าง ลองตรวจสอบ Rework source" : "🔴 ต้องแก้ไขด่วน — งานส่วนใหญ่ต้องแก้ไข ควรตรวจสอบกระบวนการรับ Brief"}
          </div>
          <div style="padding:10px 12px;background:${onTimeRate >= 80 ? "#F0FDF4" : "#FFF7ED"};border-radius:8px;border-left:3px solid ${onTimeRate >= 80 ? "#0DB14B" : "#F59E0B"};font-size:12px;color:${onTimeRate >= 80 ? "#065F46" : "#92400E"};">
            <b>On-Time Rate ${onTimeRate}%</b><br>
            ${onTimeRate >= 80 ? "✅ ส่งงานตรงเวลาส่วนใหญ่ — กำหนดการทำงานมีประสิทธิภาพ" : "⚠️ มีงานเกินกำหนดหลายชิ้น — ควรตรวจสอบการตั้งกำหนดเวลาและ Workload ของทีม"}
          </div>
          <div style="padding:10px 12px;background:${reworkRate <= 20 ? "#F0FDF4" : "#FEF2F2"};border-radius:8px;border-left:3px solid ${reworkRate <= 20 ? "#0DB14B" : "#EF4444"};font-size:12px;color:${reworkRate <= 20 ? "#065F46" : "#991B1B"};">
            <b>Rework Rate ${reworkRate}%</b><br>
            ${reworkRate <= 20 ? "✅ อยู่ในเกณฑ์ดี — ต้นทุนการแก้ไขงานต่ำ" : "🔴 สูงกว่าเป้าหมาย (20%) — ควรหาสาเหตุและวางแผนลด Revision Rate"}
          </div>
          <div style="padding:10px 12px;background:#F8FAFC;border-radius:8px;font-size:11px;color:#64748B;border:1px solid #E2E8F0;">
            📌 <b>SMART Goal แนะนำ:</b> ลด Rework Rate ลง 20% ภายใน 3 เดือน โดยกำหนดให้ทุกคำร้องต้องระบุ Specification ให้ครบก่อนส่ง
          </div>
        </div>
      `, 1)}
    </div>
  `;
}

function kpiGauge(label, value, target, desc) {
  const pct  = Math.min(100, value);
  const good = value >= target;
  const warn = value >= target * 0.7;
  const color = good ? "#0DB14B" : warn ? "#F59E0B" : "#EF4444";
  return `
    <div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
        <span style="font-size:12px;color:#334155;font-weight:500;">${label}</span>
        <span style="font-size:12px;font-weight:700;color:${color};">${value}%</span>
      </div>
      <div style="background:#F1F5F9;border-radius:4px;height:8px;overflow:hidden;">
        <div style="background:${color};height:100%;width:${pct}%;border-radius:4px;transition:width 0.4s;"></div>
      </div>
      <div style="font-size:10px;color:#94A3B8;margin-top:2px;">${desc} · เป้าหมาย ${target}%</div>
    </div>`;
}
