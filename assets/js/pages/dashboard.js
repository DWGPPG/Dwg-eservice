import { STATUS, STATUS_LABELS } from "../../../config/schema.js";
import { renderTable } from "../components/table.js";
import { assigneeName, getDrawingTeamMembers } from "../services/team-service.js";
import { escapeHtml, formatDate } from "../utils.js";
import { renderKpiDashboard } from "./report.js";

const chartPeriods = [
  { key: "weekly", label: "รายอาทิตย์" },
  { key: "monthly", label: "รายเดือน" },
  { key: "yearly", label: "รายปี" },
];

let dashboardChartPeriod = "monthly";

export function renderDashboard(view, state) {
  const requests = state.requests || [];
  const total = requests.length;
  const active = requests.filter((item) => ![STATUS.DONE, STATUS.CANCELLED, STATUS.REJECTED].includes(item.status)).length;
  const queued = requests.filter((item) =>
    !item.assignedToEmail && !item.assignedToName
    && ![STATUS.DONE, STATUS.CANCELLED, STATUS.REJECTED].includes(item.status)
  ).length;

  const recent = [...requests]
    .sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0))
    .slice(0, 20);

  let workload = [];
  try { workload = buildTeamWorkload(requests); } catch (_) {}
  const topWorkload = workload[0] || { name: "—", role: "—", count: 0, urgent: 0 };

  let pipeline = { proposal: 0, construction: 0 };
  try { pipeline = buildPipelineTotals(requests); } catch (_) {}

  let chartSvg = "";
  try { chartSvg = cleanLineChartSvg(buildChartSeries(requests, dashboardChartPeriod)); } catch (_) {
    chartSvg = `<p style="color:#94a3b8;padding:20px 0">ไม่มีข้อมูลกราฟ</p>`;
  }

  const team = getDrawingTeamMembers();

  // ── KPI Section ──
  const kpiWrapper = document.createElement("div");
  kpiWrapper.style.cssText = "margin-bottom:2rem;";
  kpiWrapper.innerHTML = `
    <div class="section-header" style="margin-bottom:12px;flex-wrap:wrap;gap:8px;">
      <div>
        <h2 style="margin:0;">📊 KPI ฝ่ายเขียนแบบ</h2>
        <p style="margin:0;color:var(--muted,#64748b);font-size:13px;">อัปเดต real-time จากข้อมูลในระบบ</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <select id="dash-kpi-scope" style="height:34px;padding:0 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:#fff;">
          <option value="department">ฝ่ายเขียนแบบ</option>
          <option value="individual">รายบุคคล</option>
        </select>
        <select id="dash-kpi-person" style="height:34px;padding:0 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:#fff;display:none;">
          ${team.map((u) => `<option value="${escapeHtml(u.email)}">${escapeHtml(u.name)}</option>`).join("")}
        </select>
        <select id="dash-kpi-period" style="height:34px;padding:0 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:#fff;">
          <option value="month">เดือนนี้</option>
          <option value="quarter">3 เดือนล่าสุด</option>
          <option value="year">ปีนี้</option>
          <option value="all">ทั้งหมด</option>
          <option value="custom">กำหนดเอง...</option>
        </select>
        <div id="dash-kpi-daterange" style="display:none;align-items:center;gap:6px;">
          <input type="date" id="dash-kpi-from" style="height:34px;padding:0 8px;border:1px solid var(--line);border-radius:8px;font-size:12px;background:#fff;">
          <span style="color:#64748B;font-size:12px;">–</span>
          <input type="date" id="dash-kpi-to" style="height:34px;padding:0 8px;border:1px solid var(--line);border-radius:8px;font-size:12px;background:#fff;">
        </div>
        <button id="dash-kpi-print" type="button" class="secondary-button" style="height:34px;padding:0 12px;font-size:13px;">
          🖨️ Export PDF
        </button>
      </div>
    </div>
    <div id="dash-kpi-body"></div>
  `;
  view.appendChild(kpiWrapper);

  const scopeEl  = view.querySelector("#dash-kpi-scope");
  const personEl = view.querySelector("#dash-kpi-person");
  const periodEl = view.querySelector("#dash-kpi-period");

  const dateRangeEl = view.querySelector("#dash-kpi-daterange");
  const fromEl      = view.querySelector("#dash-kpi-from");
  const toEl        = view.querySelector("#dash-kpi-to");

  const refreshKpi = () => {
    personEl.style.display = scopeEl.value === "individual" ? "block" : "none";
    const isCustom = periodEl.value === "custom";
    dateRangeEl.style.display = isCustom ? "flex" : "none";
    const person = scopeEl.value === "individual" ? team.find((u) => u.email === personEl.value) : null;
    const customRange = isCustom && fromEl.value && toEl.value
      ? { from: new Date(fromEl.value), to: new Date(toEl.value + "T23:59:59") }
      : null;
    const body = view.querySelector("#dash-kpi-body");
    if (body) body.innerHTML = renderKpiDashboard(state.requests || [], team, periodEl.value, person, customRange);
  };

  scopeEl.addEventListener("change", refreshKpi);
  personEl.addEventListener("change", refreshKpi);
  periodEl.addEventListener("change", refreshKpi);
  fromEl?.addEventListener("change", refreshKpi);
  toEl?.addEventListener("change", refreshKpi);
  view.querySelector("#dash-kpi-print").addEventListener("click", () => {
    const body = view.querySelector("#dash-kpi-body");
    if (!body) return;
    const w = window.open("", "_blank");
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>KPI ฝ่ายเขียนแบบ</title>
      <style>body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:15mm;}@page{size:A4;margin:10mm;}</style>
      </head><body><h1 style="color:#005DAC;">📊 KPI ฝ่ายเขียนแบบ</h1>${body.innerHTML}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 800);
  });

  refreshKpi();

  // ── Divider ──
  const hr = document.createElement("hr");
  hr.style.cssText = "border:none;border-top:2px solid var(--line,#e2e8f0);margin:1.5rem 0;";
  view.appendChild(hr);

  // ── Existing dashboard content ──
  const dashContainer = document.createElement("div");
  dashContainer.innerHTML = `
    <div class="dashboard-modern">
      <article class="dash-card dash-stat">
        <span>คำร้องทั้งหมด</span>
        <strong>${total}</strong>
        <small>รายการในระบบ</small>
      </article>
      <article class="dash-card dash-stat">
        <span>รอฝ่ายเขียนแบบรับงาน</span>
        <strong>${queued}</strong>
        <small>รอผู้เขียนแบบรับเองหรือเลือกผู้รับผิดชอบ</small>
      </article>
      <article class="dash-card dash-stat dash-accent">
        <span>กำลังดำเนินการ</span>
        <strong>${active}</strong>
        <small>งานที่ยังไม่ปิด</small>
      </article>
      <article class="dash-card designer-spotlight">
        <div>
          <span>ภาระสูงสุด</span>
          <h2>${escapeHtml(topWorkload.name)}</h2>
          <p>${escapeHtml(topWorkload.role)} · ${topWorkload.count} งาน</p>
        </div>
        <b>${topWorkload.urgent} งานด่วน</b>
      </article>

      <section class="dash-card yearly-pipeline-card">
        <div class="pipeline-summary">
          ${pipelineBadge("📋 Proposal", pipeline.proposal, "proposal")}
          ${pipelineBadge("🏗️ เขียนแบบก่อสร้าง", pipeline.construction, "construction")}
        </div>
        <div class="clean-chart-container">
          <div class="chart-period-buttons" role="group" aria-label="เลือกช่วงเวลากราฟ">
            ${chartPeriods.map((period) => chartPeriodButton(period)).join("")}
          </div>
          <div class="chart-svg-slot">
            ${chartSvg}
          </div>
        </div>
      </section>

      <section class="dash-card team-list-card">
        <div class="section-header compact-header">
          <div>
            <h2>ฝ่ายเขียนแบบวันนี้</h2>
            <p>สถานะกำลังการผลิตของทีม</p>
          </div>
        </div>
        <div class="team-mini-list">
          ${workload.slice(0, 5).map(teamMini).join("") || `<p class="empty-state">ยังไม่มีงานที่มอบหมาย</p>`}
        </div>
      </section>

      <section class="dash-card flow-card">
        <div class="section-header compact-header">
          <div>
            <h2>ภาระงานแต่ละคน</h2>
            <p>กราฟแท่งจำนวนงานที่ถืออยู่ในฝ่ายเขียนแบบ</p>
          </div>
        </div>
        <div class="team-column-chart">
          ${workload.length ? workload.map((member) => columnBar(member, workload)).join("") : `<p class="empty-state">ยังไม่มีข้อมูล</p>`}
        </div>
      </section>

      <section class="dash-card recent-panel">
        <div class="section-header compact-header">
          <div>
            <h2>คำร้องล่าสุด</h2>
            <p>ติดตามสถานะการมอบหมายและผู้รับผิดชอบของคำร้องล่าสุด</p>
          </div>
          <a class="secondary-button" href="#/track">${trackLinkLabel(state.user)}</a>
        </div>
        ${renderTable({
          columns: [
            { label: "วันที่รับข้อมูล", render: (row) => formatDate(row.submittedAt) },
            { label: "เลขคำร้อง", key: "requestNo" },
            { label: "โครงการ", key: "projectName" },
            { label: "ผู้ขอ", key: "requesterName" },
            { label: "สถานะ", render: assignmentStatus },
          ],
          rows: recent,
          empty: "ยังไม่มีคำร้อง",
        })}
      </section>
    </div>
  `;
  view.appendChild(dashContainer);
  bindPipelineChart(dashContainer, requests);
}

// ══════════════════════════════════════════════════════════════
// REAL DATA AGGREGATION — แทนที่ hardcoded mock arrays ทั้งหมด
// ══════════════════════════════════════════════════════════════

function buildTeamWorkload(requests) {
  const members = getDrawingTeamMembers();
  const workload = members.map((member) => {
    const memberRequests = requests.filter((item) =>
      String(item.assignedToEmail || "").toLowerCase() === member.email.toLowerCase()
      && ![STATUS.DONE, STATUS.CANCELLED, STATUS.REJECTED].includes(item.status)
    );
    const urgent = memberRequests.filter((item) => ["เร่งด่วน", "เร่งด่วนมาก"].includes(item.priority)).length;
    return { name: member.name, role: member.role || "ฝ่ายเขียนแบบ", count: memberRequests.length, urgent };
  });
  return workload.sort((a, b) => b.count - a.count);
}

function buildPipelineTotals(requests) {
  return requests.reduce((sum, item) => {
    const type = (item.requestType || "").toLowerCase();
    if (type.includes("proposal")) sum.proposal += 1;
    if (type.includes("ก่อสร้าง") && !type.includes("as-built")) sum.construction += 1;
    return sum;
  }, { proposal: 0, construction: 0 });
}

function buildChartSeries(requests, period) {
  if (period === "weekly") return buildWeeklySeries(requests);
  if (period === "yearly") return buildYearlySeries(requests);
  return buildMonthlySeries(requests);
}

function buildWeeklySeries(requests) {
  const dayLabels = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."];
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay() + 1); // Monday
  start.setHours(0, 0, 0, 0);

  return dayLabels.map((label, index) => {
    const dayStart = new Date(start);
    dayStart.setDate(start.getDate() + index);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayStart.getDate() + 1);
    const dayItems = requests.filter((item) => {
      const date = new Date(item.submittedAt || 0);
      return date >= dayStart && date < dayEnd;
    });
    return countByType(dayItems, label);
  });
}

function buildMonthlySeries(requests) {
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(date);
  }
  return months.map((date) => {
    const monthItems = requests.filter((item) => {
      const submitted = new Date(item.submittedAt || 0);
      return submitted.getFullYear() === date.getFullYear() && submitted.getMonth() === date.getMonth();
    });
    return countByType(monthItems, date.toLocaleDateString("th-TH", { month: "short" }));
  });
}

function buildYearlySeries(requests) {
  const years = [...new Set(requests.map((item) => new Date(item.submittedAt || 0).getFullYear()))].sort();
  const currentYear = new Date().getFullYear();
  const range = years.length ? years : [currentYear];
  const start = Math.min(...range, currentYear - 2);
  const span = [];
  for (let year = start; year <= currentYear; year += 1) span.push(year);

  return span.map((year) => {
    const yearItems = requests.filter((item) => new Date(item.submittedAt || 0).getFullYear() === year);
    return countByType(yearItems, String(year));
  });
}

function countByType(items, label) {
  return {
    label,
    proposal: items.filter((item) => (item.requestType || "").toLowerCase().includes("proposal")).length,
    construction: items.filter((item) => {
      const type = (item.requestType || "").toLowerCase();
      return type.includes("ก่อสร้าง") && !type.includes("as-built");
    }).length,
  };
}

// ══════════════════════════════════════════════════════════════
// RENDER HELPERS
// ══════════════════════════════════════════════════════════════

function trackLinkLabel(user) {
  if (["manager", "viewer"].includes(user?.role)) return "ดูงานทั้งหมด";
  return "ดูงานของฉัน";
}

function assignmentStatus(row) {
  const name = assigneeName(row);
  const workflow = dashboardWorkflowStatus(row, name);
  return `
    <div class="dashboard-assignment">
      <span class="workflow-status ${workflow.className}">${workflow.label}</span>
      ${name ? `<small>${escapeHtml(name)}</small>` : ""}
    </div>
  `;
}

function dashboardWorkflowStatus(row, name) {
  if ([STATUS.CANCELLED, STATUS.REJECTED].includes(row.status)) {
    return { label: "ยกเลิก", className: "cancelled" };
  }
  if (row.status === STATUS.DONE) {
    return { label: STATUS_LABELS[STATUS.DONE], className: "done" };
  }
  if (!name) {
    return { label: "รอฝ่ายเขียนแบบรับงาน", className: "waiting" };
  }
  if (row.status === STATUS.PENDING || row.status === STATUS.INPROGRESS_LV1) {
    return { label: STATUS_LABELS[row.status], className: "approval" };
  }
  if (row.status === STATUS.MGR_REVIEW) {
    return { label: STATUS_LABELS[STATUS.MGR_REVIEW], className: "review" };
  }
  if (row.status === STATUS.MGR_REJECTED) {
    return { label: STATUS_LABELS[STATUS.MGR_REJECTED], className: "cancelled" };
  }
  if (row.status === STATUS.DELIVERED) {
    return { label: STATUS_LABELS[STATUS.DELIVERED], className: "review" };
  }
  if (row.status === STATUS.WORKING) {
    return { label: "กำลังดำเนินการ", className: "working" };
  }
  return { label: "รอดำเนินการ", className: "assigned" };
}

function pipelineBadge(label, value, tone) {
  return `<span class="pipeline-badge ${tone}"><b>${label}</b><strong>${value}</strong></span>`;
}

function chartPeriodButton(period) {
  const active = period.key === dashboardChartPeriod;
  return `
    <button class="chart-period-button ${active ? "active" : ""}" type="button" data-chart-period="${period.key}" aria-pressed="${active}">
      ${period.label}
    </button>
  `;
}

function bindPipelineChart(view, requests) {
  const container = view.querySelector(".clean-chart-container");
  if (!container) return;

  container.addEventListener("click", (event) => {
    const button = event.target.closest("[data-chart-period]");
    if (!button || !container.contains(button)) return;

    dashboardChartPeriod = button.dataset.chartPeriod;
    container.querySelector(".chart-svg-slot").innerHTML = cleanLineChartSvg(buildChartSeries(requests, dashboardChartPeriod));
    container.querySelectorAll("[data-chart-period]").forEach((item) => {
      const active = item.dataset.chartPeriod === dashboardChartPeriod;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
  });
}

function cleanLineChartSvg(data) {
  if (!data.length) data = [{ label: "—", proposal: 0, construction: 0 }];
  const maxVal = Math.max(1, ...data.flatMap((item) => [item.proposal, item.construction]));
  const min = 0;
  const stepBase = maxVal > 100 ? 10 : 5;
  const step = Math.max(5, Math.ceil(maxVal / 4 / stepBase) * stepBase);
  const max = step * 4;
  const paddingX = 58;
  const paddingRight = 24;
  const graphWidth = 800 - paddingX - paddingRight;
  const graphHeight = 170;
  const offsetY = 58;

  const getX = (index) => paddingX + index * (graphWidth / Math.max(1, data.length - 1));
  const getY = (val) => offsetY + graphHeight - ((val - min) / (max - min)) * graphHeight;

  const smoothCurve = (key) => {
    let d = `M ${getX(0).toFixed(1)} ${getY(data[0][key]).toFixed(1)}`;
    for (let i = 0; i < data.length - 1; i += 1) {
      const p0x = getX(i);
      const p0y = getY(data[i][key]);
      const p1x = getX(i + 1);
      const p1y = getY(data[i + 1][key]);
      const cp1x = p0x + (p1x - p0x) * 0.4;
      const cp2x = p1x - (p1x - p0x) * 0.4;
      d += ` C ${cp1x.toFixed(1)} ${p0y.toFixed(1)}, ${cp2x.toFixed(1)} ${p1y.toFixed(1)}, ${p1x.toFixed(1)} ${p1y.toFixed(1)}`;
    }
    return d;
  };

  const points = (key, className) => data.map((item, index) => {
    const x = getX(index).toFixed(1);
    const y = getY(item[key]).toFixed(1);
    return `
      <g class="point-marker ${className}-marker" transform="translate(${x} ${y})">
        <circle class="point-hit" cx="0" cy="0" r="12"></circle>
        <circle class="point ${className}-point" cx="0" cy="0" r="4.2"></circle>
        <g class="point-tooltip">
          <rect x="-20" y="-34" width="40" height="24" rx="8"></rect>
          <text x="0" y="-18">${item[key]}</text>
        </g>
      </g>
    `;
  }).join("");

  const labels = data.map((item, index) => `<text x="${getX(index).toFixed(1)}" y="${offsetY + graphHeight + 32}" class="axis-label x-axis">${escapeHtml(item.label)}</text>`).join("");

  const gridLines = [];
  const yLabels = [];
  for (let val = max; val >= min; val -= step) {
    const y = getY(val);
    gridLines.push(`<line x1="${paddingX}" y1="${y.toFixed(1)}" x2="${paddingX + graphWidth}" y2="${y.toFixed(1)}" class="grid-line" />`);
    yLabels.push(`<text x="${paddingX - 16}" y="${y + 4}" class="axis-label y-axis">${val}</text>`);
  }

  return `
    <svg viewBox="0 0 800 290" role="img" aria-label="Pipeline analytics line chart" class="clean-svg">
      <defs>
        <filter id="analytics-shadow" x="-8%" y="-12%" width="116%" height="130%">
          <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#6b7c93" flood-opacity="0.14" />
        </filter>
      </defs>
      <rect class="analytics-card-bg" x="8" y="8" width="784" height="270" rx="14" filter="url(#analytics-shadow)" />
      <text x="34" y="40" class="chart-title">Analytics</text>

      <g class="grid-group">
        ${gridLines.join("")}
      </g>

      <g class="axis-group">
        ${yLabels.join("")}
        ${labels}
      </g>

      <path class="line-path proposal-path" d="${smoothCurve("proposal")}" />
      <path class="line-path construction-path" d="${smoothCurve("construction")}" />

      <g class="chart-points">
        ${points("proposal", "proposal")}
        ${points("construction", "construction")}
      </g>
    </svg>
  `;
}

function columnBar(member, allMembers) {
  const max = Math.max(1, ...allMembers.map((item) => item.count));
  const percent = Math.max(8, Math.round((member.count / max) * 100));
  return `
    <div class="team-column">
      <i><b style="height:${percent}%"></b></i>
      <strong>${member.count}</strong>
      <span>${escapeHtml(member.name)}</span>
    </div>
  `;
}

function teamMini(member) {
  return `
    <article>
      <span>${escapeHtml(member.name.slice(0, 1))}</span>
      <div>
        <strong>${escapeHtml(member.name)}</strong>
        <small>${escapeHtml(member.role)}</small>
      </div>
      <time>${member.count} งาน</time>
    </article>
  `;
}
