import { appConfig } from "../../../config/config.js";
import { fields, lists } from "../../../config/schema.js";
import { refreshUserRole } from "../auth.js";
import { openModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import { refreshNavBadges } from "../router.js";
import { writeAudit } from "../services/audit-service.js";
import { addItem, deleteItem, getListItems, loadMasterData, patchItem } from "../sharepoint.js";
import { state } from "../state.js";
import { downloadCsv, escapeHtml, formatDate, formatDateOnly } from "../utils.js";

// ══════════════════════════════════════════════════════════════
// หน้า "จัดการข้อมูล" (ผู้จัดการ Lv.2 เท่านั้น)
// แก้ master data ใน SharePoint Lists ได้จากหน้าเว็บโดยไม่ต้องเข้า SharePoint:
//   โครงการ / เลข Drawing / ชื่อ Drawing / ขนาด kWp / ทีมเขียนแบบ+สิทธิ์ / วันหยุด / Audit log
// หลักการลบ: ข้อมูลที่คำร้องอ้างอิงอยู่ (ชื่อโครงการ, เลข Drawing) ใช้ "ซ่อน" (IsHidden) แทนการลบ
// ลบถาวรได้เฉพาะรายการที่ไม่มีคำร้องใดอ้างอิงเลย เพื่อไม่ให้ประวัติคำร้องเก่าเสีย
// ══════════════════════════════════════════════════════════════

const DRAWING_CATEGORIES = [
  "General Drawing",
  "Architectural Drawing",
  "Structural Drawing",
  "Electrical Drawing",
  "Mechanical Drawing",
];

const TEAM_ROLES = ["Electrical", "Civil", "Architectural", "Mechanical", "Structural"];

const isTrue = (value) => value === true || value === "Yes" || value === 1 || value === "true";
const norm = (value) => String(value ?? "").trim().toLowerCase();
const projectNames = () => (state.masterData.projects || []).map((p) => p.Title).filter(Boolean);

// ── นิยามแต่ละแท็บ: list ใน SharePoint, คอลัมน์ในตาราง, ช่องในฟอร์ม ──
const TABS = {
  projects: {
    label: "โครงการ",
    icon: "🏗️",
    list: lists.projects,
    data: () => state.masterData.projects,
    hideField: "IsHidden",
    columns: [
      { label: "ชื่อโครงการ", value: (r) => r.Title, strong: true },
      { label: "ขนาด", value: (r) => r.DefaultKwp || r.SolarKwp },
      { label: "สถานที่", value: (r) => r.DefaultLocation },
      { label: "Drawing", value: (r) => drawingCountForProject(r.Title), numeric: true },
      { label: "คำร้อง", value: (r) => usage("projects", r), numeric: true },
    ],
    form: [
      { key: "Title", label: "ชื่อโครงการ", required: true, placeholder: "เช่น Solar Rooftop CP Factory" },
      { key: "kwp", label: "ขนาดระบบ (kWp)", placeholder: "เช่น 998.4 kWp", read: (r) => r.DefaultKwp || r.SolarKwp || "" },
      { key: "DefaultLocation", label: "สถานที่", placeholder: "จังหวัด / ที่ตั้งโครงการ" },
    ],
    toPayload: (v) => ({ Title: v.Title, DefaultKwp: v.kwp, SolarKwp: v.kwp, DefaultLocation: v.DefaultLocation }),
    duplicateKey: (v) => norm(v.Title),
    searchText: (r) => `${r.Title} ${r.DefaultLocation || ""}`,
  },
  drawingNumbers: {
    label: "เลข Drawing",
    icon: "📐",
    list: lists.drawingNumbers,
    data: () => state.masterData.drawingNumbers,
    hideField: "IsHidden",
    projectFilter: true,
    columns: [
      { label: "เลข Drawing", value: (r) => r.Title, strong: true, mono: true },
      { label: "ชื่อ Drawing", value: (r) => r.DrawingName },
      { label: "หมวด", value: (r) => r.DrawingCategory },
      { label: "โครงการ", value: (r) => r.ProjectName },
      { label: "คำร้อง", value: (r) => usage("drawingNumbers", r), numeric: true },
    ],
    form: [
      { key: "ProjectName", label: "โครงการ", required: true, type: "select", options: projectNames },
      { key: "DrawingCategory", label: "หมวด Drawing", type: "select", options: () => DRAWING_CATEGORIES, allowCustom: true },
      { key: "Title", label: "เลข Drawing", required: true, placeholder: "เช่น E-001" },
      { key: "DrawingName", label: "ชื่อ Drawing", placeholder: "เช่น Single Line Diagram" },
    ],
    toPayload: (v) => ({ Title: v.Title, ProjectName: v.ProjectName, DrawingCategory: v.DrawingCategory, DrawingName: v.DrawingName }),
    duplicateKey: (v) => `${norm(v.ProjectName)}|${norm(v.Title)}`,
    searchText: (r) => `${r.Title} ${r.DrawingName || ""} ${r.ProjectName || ""}`,
  },
  drawingNames: {
    label: "ชื่อ Drawing",
    icon: "🏷️",
    list: lists.drawingNames,
    data: () => state.masterData.drawingNames,
    hideField: "IsHidden",
    projectFilter: true,
    columns: [
      { label: "ชื่อ Drawing", value: (r) => r.Title, strong: true },
      { label: "หมวด", value: (r) => r.DrawingCategory },
      { label: "โครงการ", value: (r) => r.ProjectName || "ทุกโครงการ" },
    ],
    form: [
      { key: "Title", label: "ชื่อ Drawing", required: true, placeholder: "เช่น PV Layout" },
      { key: "DrawingCategory", label: "หมวด Drawing", type: "select", options: () => DRAWING_CATEGORIES, allowCustom: true },
      { key: "ProjectName", label: "โครงการ (เว้นว่าง = ใช้ได้ทุกโครงการ)", type: "select", options: projectNames, optional: true },
    ],
    toPayload: (v) => ({ Title: v.Title, DrawingCategory: v.DrawingCategory, ProjectName: v.ProjectName }),
    duplicateKey: (v) => `${norm(v.ProjectName)}|${norm(v.Title)}`,
    searchText: (r) => `${r.Title} ${r.ProjectName || ""}`,
  },
  kwp: {
    label: "ขนาด kWp",
    icon: "⚡",
    list: lists.kwp,
    data: () => state.masterData.kwp,
    hideField: "IsHidden",
    columns: [{ label: "ขนาด", value: (r) => r.Title, strong: true }],
    form: [{ key: "Title", label: "ขนาด", required: true, placeholder: "เช่น 500 kWp" }],
    toPayload: (v) => ({ Title: v.Title }),
    duplicateKey: (v) => norm(v.Title),
    searchText: (r) => r.Title,
  },
  team: {
    label: "ทีม & สิทธิ์",
    addLabel: "สมาชิก",
    icon: "👥",
    list: lists.team,
    data: () => state.masterData.team,
    hideField: "IsActive",
    hideFieldInverted: true,
    columns: [
      { label: "ชื่อ", value: (r) => r.Title0 || r.Title, strong: true },
      { label: "อีเมล", value: (r) => r.Email, mono: true },
      { label: "สายงาน", value: (r) => r.Role },
      { label: "สิทธิ์", html: (r) => teamRoleBadge(r) },
      { label: "ป้ายแสดงผล", value: (r) => r.DisplayLabel },
    ],
    form: [
      { key: "Title0", label: "ชื่อ-นามสกุล (ชื่อเล่น)", required: true, placeholder: "เช่น นาย สมชาย ใจดี (ชาย)" },
      { key: "Email", label: "อีเมล", required: true, type: "email", placeholder: `name@${appConfig.azure.allowedDomain}` },
      { key: "Role", label: "สายงาน", type: "select", options: () => TEAM_ROLES, allowCustom: true },
      { key: "DisplayLabel", label: "ป้ายแสดงผล (ไม่บังคับ)", placeholder: "เช่น วิศวกรไฟฟ้าอาวุโส" },
      { key: "IsAdmin", label: "สิทธิ์ผู้จัดการ Lv.2 (อนุมัติ / ส่งมอบ / ดูรายงาน / จัดการข้อมูล)", type: "checkbox" },
    ],
    toPayload: (v) => ({ Title0: v.Title0, Email: v.Email.toLowerCase(), Role: v.Role, DisplayLabel: v.DisplayLabel, IsAdmin: v.IsAdmin }),
    validate: (v, item) => validateTeamMember(v, item),
    duplicateKey: (v) => norm(v.Email),
    searchText: (r) => `${r.Title0 || ""} ${r.Email || ""} ${r.Role || ""}`,
  },
  holidays: {
    label: "วันหยุด",
    icon: "📅",
    list: lists.holidays,
    data: () => state.masterData.holidays,
    deletable: true,
    bulkHolidays: true,
    sort: (a, b) => new Date(b.HolidayDate || 0) - new Date(a.HolidayDate || 0),
    columns: [
      { label: "วันที่", value: (r) => formatDateOnly(r.HolidayDate), strong: true },
      { label: "ชื่อวันหยุด", value: (r) => r.Title },
    ],
    form: [
      { key: "HolidayDate", label: "วันที่", required: true, type: "date", read: (r) => toDateInput(r.HolidayDate) },
      { key: "Title", label: "ชื่อวันหยุด", required: true, placeholder: "เช่น วันสงกรานต์" },
    ],
    toPayload: (v) => ({ Title: v.Title, HolidayDate: new Date(`${v.HolidayDate}T00:00:00`).toISOString() }),
    duplicateKey: (v) => toDateInput(v.HolidayDate),
    searchText: (r) => `${r.Title} ${formatDateOnly(r.HolidayDate)}`,
  },
};

// ── ui state (คงไว้ข้าม re-render) ──
const ui = {
  tab: "overview",
  search: "",
  project: "",
  showHidden: false,
  audit: null,       // cache audit log — โหลดเมื่อเปิดแท็บเท่านั้น (List ใหญ่)
  auditLoading: false,
};

export function renderManage(view) {
  if (state.user?.role !== "manager") {
    view.innerHTML = `<section class="content-section"><p>เฉพาะผู้จัดการ Lv.2 เท่านั้น</p></section>`;
    return;
  }

  const tabs = [
    { key: "overview", label: "ภาพรวม", icon: "🩺" },
    ...Object.entries(TABS).map(([key, tab]) => ({ key, label: tab.label, icon: tab.icon, count: activeRows(tab).length })),
    { key: "audit", label: "Audit log", icon: "🧾" },
  ];

  view.innerHTML = `
    <section class="content-section manage-page">
      <div class="section-header">
        <div>
          <h2>จัดการข้อมูลระบบ</h2>
          <p>แก้ไขข้อมูลหลักใน SharePoint ได้จากที่นี่ — ทุกการเปลี่ยนแปลงถูกบันทึกลง Audit log</p>
        </div>
        <button class="secondary-button" type="button" data-action="reload">⟳ โหลดข้อมูลล่าสุด</button>
      </div>
      <nav class="manage-tabs" role="tablist">
        ${tabs.map((t) => `
          <button type="button" role="tab" class="manage-tab ${ui.tab === t.key ? "is-active" : ""}" data-tab="${t.key}" aria-selected="${ui.tab === t.key}">
            <span aria-hidden="true">${t.icon}</span> ${escapeHtml(t.label)}
            ${t.count !== undefined ? `<b>${t.count}</b>` : ""}
          </button>`).join("")}
      </nav>
      <div class="manage-body">${renderBody()}</div>
    </section>
  `;

  bind(view);
  if (ui.tab === "audit" && !ui.audit && !ui.auditLoading) loadAudit(view);
}

function renderBody() {
  if (ui.tab === "overview") return renderOverview();
  if (ui.tab === "audit") return renderAudit();
  return renderTable(ui.tab);
}

// ══════════════════════════════════════════════════════════════
// แท็บข้อมูล (ตาราง + เครื่องมือ)
// ══════════════════════════════════════════════════════════════

function renderTable(key) {
  const tab = TABS[key];
  const rows = filteredRows(tab);
  const hiddenCount = (tab.data() || []).length - activeRows(tab).length;

  return `
    <div class="manage-toolbar">
      <input class="manage-search" type="search" placeholder="ค้นหา${escapeHtml(tab.label)}..." value="${escapeHtml(ui.search)}" data-input="search" />
      ${tab.projectFilter ? `
        <select data-input="project">
          <option value="">ทุกโครงการ</option>
          ${projectNames().sort((a, b) => a.localeCompare(b, "th")).map((name) => `<option ${ui.project === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
        </select>` : ""}
      ${tab.hideField ? `
        <label class="manage-check">
          <input type="checkbox" data-input="showHidden" ${ui.showHidden ? "checked" : ""} />
          <span>${tab.hideFieldInverted ? "แสดงคนที่ปิดใช้งาน" : "แสดงที่ซ่อนไว้"} (${hiddenCount})</span>
        </label>` : ""}
      <span class="manage-spacer"></span>
      <button class="secondary-button" type="button" data-action="csv">⬇ CSV</button>
      ${tab.bulkHolidays ? `<button class="secondary-button" type="button" data-action="bulk">📋 เพิ่มหลายวัน</button>` : ""}
      <button class="primary-button" type="button" data-action="add">+ เพิ่ม${escapeHtml(tab.addLabel || tab.label)}</button>
    </div>
    <p class="manage-count">${rows.length} รายการ</p>
    ${rows.length ? `
      <div class="track-table-wrap manage-table-wrap">
        <table class="manage-table">
          <thead><tr>${tab.columns.map((c) => `<th class="${c.numeric ? "is-num" : ""}">${escapeHtml(c.label)}</th>`).join("")}<th class="is-actions">จัดการ</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr class="${isHidden(tab, row) ? "is-hidden-row" : ""}">
                ${tab.columns.map((c) => `<td class="${[c.numeric && "is-num", c.mono && "is-mono"].filter(Boolean).join(" ")}">${c.html ? c.html(row) : c.strong ? `<strong>${escapeHtml(c.value(row) ?? "")}</strong>` : escapeHtml(c.value(row) ?? "") || "—"}</td>`).join("")}
                <td class="is-actions">${rowActions(key, tab, row)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>` : `<div class="empty-state manage-empty">ไม่พบข้อมูล${ui.search ? ` ที่ตรงกับ “${escapeHtml(ui.search)}”` : ""}</div>`}
  `;
}

function rowActions(key, tab, row) {
  const id = escapeHtml(row.id);
  const buttons = [`<button class="small-button" type="button" data-action="edit" data-id="${id}">แก้ไข</button>`];
  const isSelf = key === "team" && norm(row.Email) === norm(state.user?.email);
  if (tab.hideField && !isSelf) {
    const hidden = isHidden(tab, row);
    const label = tab.hideFieldInverted ? (hidden ? "เปิดใช้งาน" : "ปิดใช้งาน") : (hidden ? "แสดง" : "ซ่อน");
    buttons.push(`<button class="small-button ${hidden ? "" : "warning"}" type="button" data-action="toggle" data-id="${id}">${label}</button>`);
  }
  // ลบถาวรได้เฉพาะรายการที่ไม่มีคำร้องอ้างอิง (วันหยุดลบได้เสมอ)
  if (tab.deletable || (tab.hideField && usage(key, row) === 0 && isHidden(tab, row))) {
    buttons.push(`<button class="small-button danger" type="button" data-action="delete" data-id="${id}">ลบ</button>`);
  }
  return `<div class="manage-actions">${buttons.join("")}</div>`;
}

function teamRoleBadge(row) {
  if (!isTrue(row.IsActive) && row.IsActive !== undefined && row.IsActive !== null) return `<span class="badge badge-cancelled">ปิดใช้งาน</span>`;
  return isTrue(row.IsAdmin)
    ? `<span class="badge badge-done">ผู้จัดการ Lv.2</span>`
    : `<span class="badge badge-working">ฝ่ายเขียนแบบ</span>`;
}

// ══════════════════════════════════════════════════════════════
// ภาพรวม + ตรวจสุขภาพข้อมูล
// ══════════════════════════════════════════════════════════════

function renderOverview() {
  const issues = healthChecks();
  const cards = Object.entries(TABS).map(([key, tab]) => `
    <button type="button" class="manage-stat" data-tab="${key}">
      <span class="manage-stat-icon" aria-hidden="true">${tab.icon}</span>
      <strong>${activeRows(tab).length}</strong>
      <span>${escapeHtml(tab.label)}</span>
    </button>`).join("");

  return `
    <div class="manage-stats">${cards}</div>
    <h3 class="manage-subhead">ตรวจสุขภาพข้อมูล</h3>
    ${issues.length ? `
      <ul class="manage-issues">
        ${issues.map((issue) => `
          <li class="manage-issue is-${issue.level}">
            <span class="manage-issue-dot" aria-hidden="true"></span>
            <div>
              <strong>${escapeHtml(issue.title)}</strong>
              <p>${escapeHtml(issue.detail)}</p>
            </div>
            ${issue.tab ? `<button class="small-button" type="button" data-tab="${issue.tab}" data-search="${escapeHtml(issue.search || "")}">ไปแก้ไข →</button>` : ""}
          </li>`).join("")}
      </ul>` : `<div class="manage-ok">✅ ไม่พบปัญหา ข้อมูลพร้อมใช้งาน</div>`}
  `;
}

function healthChecks() {
  const issues = [];
  const projects = activeRows(TABS.projects);
  const projectSet = new Set(projects.map((p) => norm(p.Title)));
  const drawings = activeRows(TABS.drawingNumbers);
  const team = activeRows(TABS.team);

  const orphans = drawings.filter((d) => d.ProjectName && !projectSet.has(norm(d.ProjectName)));
  if (orphans.length) {
    issues.push({
      level: "warn", tab: "drawingNumbers", search: orphans[0].ProjectName,
      title: `เลข Drawing ${orphans.length} รายการ อ้างอิงโครงการที่ไม่มี/ถูกซ่อน`,
      detail: `เช่น ${orphans.slice(0, 3).map((d) => `${d.Title} (${d.ProjectName})`).join(", ")} — ผู้ร้องขอจะเลือก Drawing เหล่านี้ไม่ได้`,
    });
  }

  const dupDrawings = duplicates(drawings, (d) => `${norm(d.ProjectName)}|${norm(d.Title)}`);
  if (dupDrawings.length) {
    issues.push({
      level: "warn", tab: "drawingNumbers", search: dupDrawings[0].Title,
      title: `เลข Drawing ซ้ำในโครงการเดียวกัน ${dupDrawings.length} รายการ`,
      detail: `เช่น ${dupDrawings.slice(0, 3).map((d) => `${d.Title} (${d.ProjectName})`).join(", ")} — ควรซ่อนรายการที่ซ้ำ`,
    });
  }

  const dupProjects = duplicates(projects, (p) => norm(p.Title));
  if (dupProjects.length) {
    issues.push({
      level: "warn", tab: "projects", search: dupProjects[0].Title,
      title: `ชื่อโครงการซ้ำ ${dupProjects.length} รายการ`,
      detail: dupProjects.slice(0, 3).map((p) => p.Title).join(", "),
    });
  }

  const emptyProjects = projects.filter((p) => drawingCountForProject(p.Title) === 0);
  if (emptyProjects.length) {
    issues.push({
      level: "info", tab: "projects", search: emptyProjects[0].Title,
      title: `โครงการที่ยังไม่มีเลข Drawing ${emptyProjects.length} โครงการ`,
      detail: `${emptyProjects.slice(0, 4).map((p) => p.Title).join(", ")}${emptyProjects.length > 4 ? " ..." : ""} — ผู้ร้องขอต้องสร้าง Drawing เองตอนส่งคำร้อง`,
    });
  }

  if (!(state.masterData.team || []).length) {
    issues.push({
      level: "error", tab: "team",
      title: "โหลดรายชื่อทีมเขียนแบบจาก SharePoint ไม่ได้",
      detail: "ระบบกำลังใช้รายชื่อสำรองที่เขียนไว้ในโค้ด (team-service.js) — สิทธิ์อาจไม่ตรงกับความเป็นจริง",
    });
  } else if (!team.some((m) => isTrue(m.IsAdmin))) {
    issues.push({
      level: "warn", tab: "team",
      title: "ยังไม่มีผู้จัดการ Lv.2 ใน SharePoint (IsAdmin)",
      detail: "ตอนนี้สิทธิ์ผู้จัดการมาจากรายชื่อสำรองใน config.js เท่านั้น — แนะนำให้ตั้ง IsAdmin ในแท็บทีม & สิทธิ์",
    });
  }

  const badEmails = team.filter((m) => !String(m.Email || "").toLowerCase().endsWith(`@${appConfig.azure.allowedDomain}`));
  if (badEmails.length) {
    issues.push({
      level: "error", tab: "team", search: badEmails[0].Title0 || badEmails[0].Email || "",
      title: `สมาชิกทีม ${badEmails.length} คน อีเมลว่างหรือไม่ใช่ @${appConfig.azure.allowedDomain}`,
      detail: "คนเหล่านี้จะไม่ได้สิทธิ์ฝ่ายเขียนแบบ และรับแจ้งเตือน Teams ไม่ได้",
    });
  }

  const year = new Date().getFullYear();
  const holidaysThisYear = (state.masterData.holidays || []).filter((h) => new Date(h.HolidayDate).getFullYear() === year);
  const holidaysNextYear = (state.masterData.holidays || []).filter((h) => new Date(h.HolidayDate).getFullYear() === year + 1);
  if (!holidaysThisYear.length) {
    issues.push({
      level: "warn", tab: "holidays",
      title: `ยังไม่มีวันหยุดของปี ${year + 543}`,
      detail: "ระบบใช้วันหยุดคำนวณ “3 วันทำการ” ตรวจรับอัตโนมัติ — ถ้าไม่มีข้อมูล งานอาจถูกอนุมัติอัตโนมัติเร็วกว่าที่ควร",
    });
  } else if (!holidaysNextYear.length && new Date().getMonth() >= 10) {
    issues.push({
      level: "info", tab: "holidays",
      title: `ใกล้สิ้นปีแล้ว — ยังไม่มีวันหยุดของปี ${year + 544}`,
      detail: "เพิ่มล่วงหน้าได้ด้วยปุ่ม “เพิ่มหลายวัน”",
    });
  }

  return issues;
}

function duplicates(rows, keyFn) {
  const seen = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    seen.set(key, [...(seen.get(key) || []), row]);
  });
  return [...seen.values()].filter((group) => group.length > 1).map((group) => group[0]);
}

// ══════════════════════════════════════════════════════════════
// Audit log
// ══════════════════════════════════════════════════════════════

function renderAudit() {
  if (!ui.audit) return `<div class="empty-state manage-empty">⏳ กำลังโหลด Audit log...</div>`;
  const q = norm(ui.search);
  const rows = ui.audit.filter((r) => !q || norm(`${r.action} ${r.requestNo} ${r.userName} ${r.userEmail} ${r.detail}`).includes(q));
  const shown = rows.slice(0, 300);
  return `
    <div class="manage-toolbar">
      <input class="manage-search" type="search" placeholder="ค้นหา การกระทำ / เลขคำร้อง / ผู้ใช้..." value="${escapeHtml(ui.search)}" data-input="search" />
      <span class="manage-spacer"></span>
      <button class="secondary-button" type="button" data-action="audit-reload">⟳ โหลดใหม่</button>
      <button class="secondary-button" type="button" data-action="audit-csv">⬇ CSV</button>
    </div>
    <p class="manage-count">${rows.length} รายการ${rows.length > shown.length ? ` (แสดง ${shown.length} รายการล่าสุด — ค้นหาเพื่อกรอง)` : ""}</p>
    <div class="track-table-wrap manage-table-wrap">
      <table class="manage-table">
        <thead><tr><th>เวลา</th><th>การกระทำ</th><th>เลขคำร้อง</th><th>ผู้ใช้</th><th>รายละเอียด</th></tr></thead>
        <tbody>
          ${shown.map((r) => `
            <tr>
              <td class="is-nowrap">${escapeHtml(formatDate(r.actionAt))}</td>
              <td><strong>${escapeHtml(r.action)}</strong></td>
              <td class="is-mono">${escapeHtml(r.requestNo || "—")}</td>
              <td>${escapeHtml(r.userName || r.userEmail || "—")}</td>
              <td class="manage-detail">${escapeHtml(r.detail || "")}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function loadAudit(view) {
  ui.auditLoading = true;
  try {
    const items = await getListItems(lists.auditLog);
    ui.audit = items
      .map((item) => ({
        action: item[fields.audit.title] || "",
        requestNo: item[fields.audit.requestId] || "",
        userEmail: item[fields.audit.userEmail] || "",
        userName: item[fields.audit.userName] || "",
        detail: item[fields.audit.detail] || "",
        actionAt: item[fields.audit.actionAt] || item.Created || "",
      }))
      .sort((a, b) => new Date(b.actionAt || 0) - new Date(a.actionAt || 0));
  } catch (error) {
    ui.audit = [];
    showToast(`โหลด Audit log ไม่สำเร็จ: ${error.message}`, "error");
  } finally {
    ui.auditLoading = false;
  }
  if (state.currentRoute === "/manage" && ui.tab === "audit") renderManage(view);
}

// ══════════════════════════════════════════════════════════════
// events
// ══════════════════════════════════════════════════════════════

function bind(view) {
  const rerender = () => renderManage(view);

  view.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.tab = button.dataset.tab;
      ui.search = button.dataset.search || "";
      ui.project = "";
      ui.showHidden = false;
      rerender();
    });
  });

  bindBody(view);

  view.querySelector('[data-action="reload"]')?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    ui.audit = null;
    await reloadMasterData();
    showToast("โหลดข้อมูลล่าสุดจาก SharePoint แล้ว", "success");
    rerender();
  });
}

// ปุ่ม/ตัวกรองใน .manage-body (ถูกวาดใหม่ตอนพิมพ์ค้นหา จึงต้อง bind แยก)
function bindBody(view) {
  const rerender = () => renderManage(view);
  const body = view.querySelector(".manage-body");

  // ค้นหา: วาดเฉพาะ .manage-body ใหม่ (ไม่วาดแท็บ) แล้วคืน focus/เคอร์เซอร์ให้ช่องค้นหา
  const search = body.querySelector('[data-input="search"]');
  search?.addEventListener("input", () => {
    ui.search = search.value;
    const pos = search.selectionStart;
    body.innerHTML = renderBody();
    bindBody(view);
    const next = body.querySelector('[data-input="search"]');
    next.focus();
    next.setSelectionRange(pos, pos);
  });

  body.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.tab = button.dataset.tab;
      ui.search = button.dataset.search || "";
      ui.project = "";
      rerender();
    });
  });

  body.querySelector('[data-input="project"]')?.addEventListener("change", (event) => {
    ui.project = event.target.value;
    rerender();
  });
  body.querySelector('[data-input="showHidden"]')?.addEventListener("change", (event) => {
    ui.showHidden = event.target.checked;
    rerender();
  });

  const tab = TABS[ui.tab];
  const find = (id) => (tab?.data() || []).find((row) => String(row.id) === String(id));

  body.querySelector('[data-action="add"]')?.addEventListener("click", () => openForm(ui.tab, null, rerender));
  body.querySelector('[data-action="bulk"]')?.addEventListener("click", () => openBulkHolidays(rerender));
  body.querySelector('[data-action="csv"]')?.addEventListener("click", () => exportCsv(ui.tab));
  body.querySelectorAll('[data-action="edit"]').forEach((b) => b.addEventListener("click", () => openForm(ui.tab, find(b.dataset.id), rerender)));
  body.querySelectorAll('[data-action="toggle"]').forEach((b) => b.addEventListener("click", () => toggleHidden(ui.tab, find(b.dataset.id), rerender)));
  body.querySelectorAll('[data-action="delete"]').forEach((b) => b.addEventListener("click", () => confirmDelete(ui.tab, find(b.dataset.id), rerender)));

  body.querySelector('[data-action="audit-reload"]')?.addEventListener("click", () => {
    ui.audit = null;
    rerender();
  });
  body.querySelector('[data-action="audit-csv"]')?.addEventListener("click", () => {
    downloadCsv(`audit-log-${today()}.csv`, [
      ["เวลา", "การกระทำ", "เลขคำร้อง", "ผู้ใช้", "อีเมล", "รายละเอียด"],
      ...(ui.audit || []).map((r) => [formatDate(r.actionAt), r.action, r.requestNo, r.userName, r.userEmail, r.detail]),
    ]);
  });
}

// ══════════════════════════════════════════════════════════════
// ฟอร์มเพิ่ม/แก้ไข
// ══════════════════════════════════════════════════════════════

function openForm(key, item, rerender) {
  const tab = TABS[key];
  const isEdit = Boolean(item);
  const fieldHtml = tab.form.map((f) => formField(f, item)).join("");

  openModal({
    title: `${isEdit ? "แก้ไข" : "เพิ่ม"}${tab.addLabel || tab.label}`,
    body: `<form class="manage-form" novalidate>${fieldHtml}<p class="manage-form-error" hidden></p></form>`,
    actions: [
      { label: "ยกเลิก" },
      {
        label: isEdit ? "บันทึก" : "เพิ่ม",
        className: "primary-button",
        onClick: async (close) => {
          const form = document.querySelector(".manage-form");
          const values = readForm(form, tab);
          const error = validate(tab, values, item);
          const errorBox = form.querySelector(".manage-form-error");
          if (error) {
            errorBox.textContent = error;
            errorBox.hidden = false;
            return;
          }
          try {
            const payload = clean(tab.toPayload(values));
            if (isEdit) {
              await patchItem(tab.list, item.id, payload);
            } else {
              if (tab.hideField) payload[tab.hideField] = Boolean(tab.hideFieldInverted); // IsHidden=false / IsActive=true
              await addItem(tab.list, payload);
            }
            await writeAudit({ action: `จัดการข้อมูล: ${isEdit ? "แก้ไข" : "เพิ่ม"}${tab.label}`, detail: summarize(payload) });
            await reloadMasterData();
            close();
            showToast(`${isEdit ? "บันทึก" : "เพิ่ม"}${tab.label}แล้ว`, "success");
            rerender();
          } catch (err) {
            errorBox.textContent = `บันทึกไม่สำเร็จ: ${err.message}`;
            errorBox.hidden = false;
          }
        },
      },
    ],
  });

  // dropdown ที่พิมพ์เองได้ (allowCustom) — เลือก "อื่นๆ" แล้วโชว์ช่องพิมพ์
  document.querySelectorAll(".manage-form select[data-custom]").forEach((select) => {
    const input = select.parentElement.querySelector("input[data-custom-input]");
    const sync = () => { input.hidden = select.value !== "__custom"; };
    select.addEventListener("change", () => { sync(); if (!input.hidden) input.focus(); });
    sync();
  });
  document.querySelector(".manage-form input, .manage-form select")?.focus();
}

function formField(f, item) {
  const value = item ? (f.read ? f.read(item) : item[f.key]) : "";
  const label = `<span>${escapeHtml(f.label)}${f.required ? ' <b class="req">*</b>' : ""}</span>`;

  if (f.type === "checkbox") {
    return `<label class="manage-check manage-field-check"><input type="checkbox" name="${f.key}" ${isTrue(value) ? "checked" : ""} /><span>${escapeHtml(f.label)}</span></label>`;
  }
  if (f.type === "select") {
    const options = f.options();
    const custom = value && !options.includes(value);
    return `
      <label class="field">${label}
        <select name="${f.key}" ${f.allowCustom ? "data-custom" : ""}>
          <option value="">${f.optional ? "— ไม่ระบุ —" : "— เลือก —"}</option>
          ${options.map((o) => `<option ${o === value ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
          ${f.allowCustom ? `<option value="__custom" ${custom ? "selected" : ""}>อื่นๆ (พิมพ์เอง)</option>` : ""}
        </select>
        ${f.allowCustom ? `<input type="text" data-custom-input="${f.key}" value="${custom ? escapeHtml(value) : ""}" placeholder="พิมพ์${escapeHtml(f.label)}" hidden />` : ""}
      </label>`;
  }
  return `
    <label class="field">${label}
      <input type="${f.type || "text"}" name="${f.key}" value="${escapeHtml(value ?? "")}" placeholder="${escapeHtml(f.placeholder || "")}" ${f.required ? "required" : ""} />
    </label>`;
}

function readForm(form, tab) {
  const values = {};
  tab.form.forEach((f) => {
    const el = form.querySelector(`[name="${f.key}"]`);
    if (f.type === "checkbox") values[f.key] = el.checked;
    else if (el.value === "__custom") values[f.key] = form.querySelector(`[data-custom-input="${f.key}"]`).value.trim();
    else values[f.key] = el.value.trim();
  });
  return values;
}

function validate(tab, values, item) {
  const missing = tab.form.find((f) => f.required && !values[f.key]);
  if (missing) return `กรุณากรอก “${missing.label}”`;
  const custom = tab.validate?.(values, item);
  if (custom) return custom;
  if (tab.duplicateKey) {
    const key = tab.duplicateKey(values);
    const clash = (tab.data() || []).find((row) => String(row.id) !== String(item?.id) && tab.duplicateKey(rowToValues(tab, row)) === key);
    if (clash) return `มี${tab.label}นี้อยู่แล้ว${isHidden(tab, clash) ? " (ถูกซ่อน/ปิดใช้งานไว้ — กด “แสดง” แทนการเพิ่มใหม่)" : ""}`;
  }
  return "";
}

function rowToValues(tab, row) {
  return Object.fromEntries(tab.form.map((f) => [f.key, f.read ? f.read(row) : row[f.key]]));
}

function validateTeamMember(values, item) {
  const email = values.Email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return "รูปแบบอีเมลไม่ถูกต้อง";
  if (!email.endsWith(`@${appConfig.azure.allowedDomain}`)) return `ต้องเป็นอีเมล @${appConfig.azure.allowedDomain} เท่านั้น`;
  // กันผู้จัดการถอดสิทธิ์ตัวเองจนเข้าหน้านี้ไม่ได้
  const self = norm(state.user?.email);
  if (item && norm(item.Email) === self && isTrue(item.IsAdmin) && !values.IsAdmin) {
    return "ถอดสิทธิ์ผู้จัดการของตัวเองไม่ได้ — ให้ผู้จัดการคนอื่นเป็นคนแก้";
  }
  return "";
}

// ══════════════════════════════════════════════════════════════
// ซ่อน / ลบ
// ══════════════════════════════════════════════════════════════

async function toggleHidden(key, item, rerender) {
  if (!item) return;
  const tab = TABS[key];
  const hidden = isHidden(tab, item);
  if (key === "team" && !hidden && norm(item.Email) === norm(state.user?.email)) {
    showToast("ปิดใช้งานบัญชีตัวเองไม่ได้", "error");
    return;
  }
  const nextValue = tab.hideFieldInverted ? hidden : !hidden; // IsActive กลับด้านกับ IsHidden
  try {
    await patchItem(tab.list, item.id, { [tab.hideField]: nextValue });
    const name = item.Title0 || item.Title;
    await writeAudit({ action: `จัดการข้อมูล: ${hidden ? "แสดง" : "ซ่อน"}${tab.label}`, detail: name });
    await reloadMasterData();
    showToast(`${hidden ? "แสดง" : "ซ่อน"} “${name}” แล้ว`, "success");
    rerender();
  } catch (error) {
    showToast(`ไม่สำเร็จ: ${error.message}`, "error");
  }
}

function confirmDelete(key, item, rerender) {
  if (!item) return;
  const tab = TABS[key];
  const name = item.Title0 || item.Title;
  openModal({
    title: `ลบ${tab.label}ถาวร`,
    body: `<p>ต้องการลบ <strong>${escapeHtml(name)}</strong> ออกจาก SharePoint ถาวรใช่หรือไม่? ย้อนกลับไม่ได้</p>`,
    actions: [
      { label: "ยกเลิก" },
      {
        label: "ลบถาวร",
        className: "danger-button",
        onClick: async (close) => {
          try {
            await deleteItem(tab.list, item.id);
            await writeAudit({ action: `จัดการข้อมูล: ลบ${tab.label}`, detail: name });
            await reloadMasterData();
            close();
            showToast(`ลบ “${name}” แล้ว`, "success");
            rerender();
          } catch (error) {
            showToast(`ลบไม่สำเร็จ: ${error.message}`, "error");
          }
        },
      },
    ],
  });
}

// ── เพิ่มวันหยุดหลายวันจากการวางข้อความ (1 บรรทัด = 1 วัน) ──
function openBulkHolidays(rerender) {
  openModal({
    title: "เพิ่มวันหยุดหลายวัน",
    body: `
      <form class="manage-form">
        <p class="manage-hint">วาง 1 บรรทัดต่อ 1 วัน รูปแบบ <code>YYYY-MM-DD ชื่อวันหยุด</code> (ปี ค.ศ.) — วันที่มีอยู่แล้วจะถูกข้าม</p>
        <textarea name="lines" rows="10" placeholder="2027-01-01 วันขึ้นปีใหม่&#10;2027-04-13 วันสงกรานต์&#10;2027-04-14 วันสงกรานต์"></textarea>
        <p class="manage-form-error" hidden></p>
      </form>`,
    actions: [
      { label: "ยกเลิก" },
      {
        label: "เพิ่มทั้งหมด",
        className: "primary-button",
        onClick: async (close) => {
          const form = document.querySelector(".manage-form");
          const errorBox = form.querySelector(".manage-form-error");
          const existing = new Set((state.masterData.holidays || []).map((h) => toDateInput(h.HolidayDate)));
          const parsed = [];
          const bad = [];
          form.lines.value.split("\n").map((l) => l.trim()).filter(Boolean).forEach((line) => {
            const m = line.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
            if (!m || Number.isNaN(new Date(m[1]).getTime())) bad.push(line);
            else if (!existing.has(m[1])) parsed.push({ HolidayDate: m[1], Title: m[2] });
          });
          if (bad.length) {
            errorBox.textContent = `รูปแบบไม่ถูกต้อง: ${bad.slice(0, 3).join(" | ")}`;
            errorBox.hidden = false;
            return;
          }
          if (!parsed.length) {
            errorBox.textContent = "ไม่มีวันใหม่ให้เพิ่ม";
            errorBox.hidden = false;
            return;
          }
          try {
            for (const holiday of parsed) await addItem(lists.holidays, TABS.holidays.toPayload(holiday));
            await writeAudit({ action: "จัดการข้อมูล: เพิ่มวันหยุดหลายวัน", detail: `${parsed.length} วัน` });
            await reloadMasterData();
            close();
            showToast(`เพิ่มวันหยุด ${parsed.length} วันแล้ว`, "success");
            rerender();
          } catch (error) {
            errorBox.textContent = `เพิ่มไม่สำเร็จ: ${error.message}`;
            errorBox.hidden = false;
          }
        },
      },
    ],
  });
}

// ══════════════════════════════════════════════════════════════
// helpers
// ══════════════════════════════════════════════════════════════

function isHidden(tab, row) {
  if (!tab.hideField) return false;
  const value = row[tab.hideField];
  if (tab.hideFieldInverted) return value !== undefined && value !== null && !isTrue(value); // IsActive ว่าง = ใช้งาน
  return isTrue(value);
}

function activeRows(tab) {
  return (tab.data() || []).filter((row) => !isHidden(tab, row));
}

function filteredRows(tab) {
  const q = norm(ui.search);
  return (tab.data() || [])
    .filter((row) => ui.showHidden || !isHidden(tab, row))
    .filter((row) => !ui.project || row.ProjectName === ui.project)
    .filter((row) => !q || norm(tab.searchText(row)).includes(q))
    .sort(tab.sort || ((a, b) => String(a.Title0 || a.Title || "").localeCompare(String(b.Title0 || b.Title || ""), "th", { numeric: true })));
}

function drawingCountForProject(name) {
  return activeRows(TABS.drawingNumbers).filter((d) => norm(d.ProjectName) === norm(name)).length;
}

// จำนวนคำร้องที่อ้างอิงรายการนี้ — ใช้ตัดสินว่าลบถาวรได้หรือไม่
function usage(key, row) {
  const requests = state.requests || [];
  if (key === "projects") return requests.filter((r) => norm(r.projectName) === norm(row.Title)).length;
  if (key === "drawingNumbers") {
    return requests.filter((r) => norm(r.projectName) === norm(row.ProjectName) && String(r.drawingNo || "").split(/[,\n]/).map(norm).includes(norm(row.Title))).length;
  }
  return 0;
}

function clean(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
}

function summarize(payload) {
  return Object.entries(payload).filter(([, v]) => v !== "" && v !== undefined).map(([k, v]) => `${k}=${v}`).join(", ").slice(0, 250);
}

function toDateInput(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  // HolidayDate เก็บเป็นเที่ยงคืนเวลาไทย — ใช้วันที่ตามเวลาเครื่อง ไม่ใช่ UTC
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function today() {
  return toDateInput(new Date());
}

function exportCsv(key) {
  const tab = TABS[key];
  const rows = filteredRows(tab);
  downloadCsv(`${key}-${today()}.csv`, [
    [...tab.columns.map((c) => c.label), "สถานะ"],
    ...rows.map((row) => [
      ...tab.columns.map((c) => (c.value ? c.value(row) : isTrue(row.IsAdmin) ? "ผู้จัดการ Lv.2" : "ฝ่ายเขียนแบบ")),
      isHidden(tab, row) ? "ซ่อน/ปิดใช้งาน" : "ใช้งาน",
    ]),
  ]);
}

async function reloadMasterData() {
  await loadMasterData();
  refreshUserRole(); // แก้ทีม/สิทธิ์แล้ว role ของผู้ใช้ปัจจุบันอาจเปลี่ยน
  refreshNavBadges();
}
