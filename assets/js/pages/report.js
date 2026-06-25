import { CLOSED_STATUSES, STATUS } from "../../../config/schema.js";
import { getDrawingTeamMembers } from "../services/team-service.js";
import { escapeHtml, formatDateOnly } from "../utils.js";

export function renderReport(view, state) {
  const team = getDrawingTeamMembers();
  view.innerHTML = `
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
