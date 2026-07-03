import { STATUS, STATUS_LABELS } from "../../../config/schema.js";
import { appConfig } from "../../../config/config.js";
import { openModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import {
  adminCancel,
  adminReject,
  approveLv1AndAssign,
  approveLv2,
  approveLv2AndAssign,
  mgrApproveDeliver,
  mgrRejectWork,
  patchRequest,
  rejectBeforePickup,
  transferRequester,
} from "../services/request-service.js";
import { getDrawingTeamMembers, getAllManagerEmails } from "../services/team-service.js";
import { sendTeams1on1 } from "../graph.js";
import { isNotificationSupported, notificationPermission } from "../services/notification-service.js";
import { escapeHtml, formatDate } from "../utils.js";

let adminFilter = "all";
let adminSearchQuery = "";
let adminProjectFilter = "";
let adminAssigneeFilter = "";
let adminDateFrom = "";
let adminDateTo = "";
let selectedPickupIds = new Set();
let activeAdminSection = "all";

export function renderAdmin(view, state) {
  const isManager = state.user?.role === "manager";
  selectedPickupIds.clear();
  if (isManager) {
    renderManagerAdmin(view, state);
  } else {
    renderDesignerPickup(view, state);
  }
}

// ══════════════════════════════════════════════════════════════
// FILTERS
// ══════════════════════════════════════════════════════════════

function applyTypeFilter(items) {
  if (adminFilter === "all") return items;
  return items.filter((item) => {
    const type = (item.requestType || "").toLowerCase();
    if (adminFilter === "proposal")    return type.includes("proposal");
    if (adminFilter === "construction") return type.includes("ก่อสร้าง") && !type.includes("as-built");
    if (adminFilter === "permit")      return type.includes("ขออนุญาต");
    if (adminFilter === "asbuilt")     return type.includes("as-built");
    if (adminFilter === "revision")    return type.includes("revision") || item.isRevision;
    return true;
  });
}

function applySearchFilter(items) {
  const query = adminSearchQuery.toLowerCase().trim();
  if (!query) return items;
  return items.filter((item) =>
    [item.requestNo, item.projectName, item.requesterName, item.requesterEmail, item.assignedToName, item.department]
      .some((v) => String(v || "").toLowerCase().includes(query))
  );
}

function applyProjectFilter(items) {
  if (!adminProjectFilter) return items;
  return items.filter((item) => item.projectName === adminProjectFilter);
}

function applyAssigneeFilter(items) {
  if (!adminAssigneeFilter) return items;
  return items.filter((item) => (item.assignedToEmail || "") === adminAssigneeFilter);
}

function applyDateFilter(items) {
  if (!adminDateFrom && !adminDateTo) return items;
  return items.filter((item) => {
    if (!item.submittedAt) return false;
    const d = new Date(item.submittedAt).setHours(0, 0, 0, 0);
    if (adminDateFrom && d < new Date(adminDateFrom).setHours(0, 0, 0, 0)) return false;
    if (adminDateTo   && d > new Date(adminDateTo).setHours(23, 59, 59, 999)) return false;
    return true;
  });
}

function applyAllFilters(items) {
  return applySearchFilter(applyProjectFilter(applyAssigneeFilter(applyDateFilter(applyTypeFilter(items)))));
}

function typeFilterButton(key, label) {
  return `<button class="filter-button ${adminFilter === key ? "is-active" : ""}" data-admin-filter="${key}" type="button">${label}</button>`;
}

function renderFilterBar(state, allItems) {
  const projects = [...new Set(allItems.map((i) => i.projectName).filter(Boolean))].sort();
  const members  = getDrawingTeamMembers();
  const hasActive = adminProjectFilter || adminAssigneeFilter || adminDateFrom || adminDateTo || adminSearchQuery;

  const inp = "height:34px;padding:0 10px;border:1px solid var(--line,#e2e5ea);border-radius:8px;font-size:13px;background:var(--bg,#f8fafc);color:var(--text,#1e293b);box-sizing:border-box;outline:none;";

  return `
    <div class="admin-toolbar">

      <!-- แถว 1: ประเภทงาน -->
      <div class="filter-row" style="align-items:center;">
        <span style="font-size:11px;font-weight:700;color:var(--muted,#6b7280);white-space:nowrap;letter-spacing:0.04em;text-transform:uppercase;">ประเภท:</span>
        ${typeFilterButton("all", "ทั้งหมด")}
        ${typeFilterButton("proposal", "📋 Proposal")}
        ${typeFilterButton("construction", "🏗️ ก่อสร้าง")}
        ${typeFilterButton("permit", "🏛️ ขออนุญาต")}
        ${typeFilterButton("asbuilt", "🏁 As-Built")}
        ${typeFilterButton("revision", "✏️ Revision")}
      </div>

      <!-- แถว 2: ทุก filter ในแถวเดียว ไม่ตกบรรทัด -->
      <div class="filter-row" style="align-items:center;flex-wrap:nowrap;gap:8px;">

        <div style="position:relative;flex:1.5;min-width:0;">
          <span style="position:absolute;left:9px;top:50%;transform:translateY(-50%);font-size:13px;pointer-events:none;color:#94A3B8;">🔍</span>
          <input id="admin-search" type="search"
            placeholder="ค้นหาเลขคำร้อง โครงการ ชื่อ..."
            value="${escapeHtml(adminSearchQuery)}"
            style="${inp}width:100%;padding-left:30px;" />
        </div>

        <div style="flex:1;min-width:0;">
          <select id="admin-project-filter" style="${inp}width:100%;">
            <option value="">📂 ทุกโครงการ</option>
            ${projects.map((p) => `<option value="${escapeHtml(p)}" ${adminProjectFilter === p ? "selected" : ""}>${escapeHtml(p)}</option>`).join("")}
          </select>
        </div>

        <div style="flex:1;min-width:0;">
          <select id="admin-assignee-filter" style="${inp}width:100%;">
            <option value="">👤 ผู้รับผิดชอบ</option>
            ${members.map((m) => `<option value="${escapeHtml(m.email)}" ${adminAssigneeFilter === m.email ? "selected" : ""}>${escapeHtml(m.name || m.email)}</option>`).join("")}
          </select>
        </div>

        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <span style="font-size:12px;color:var(--muted,#6b7280);">📅</span>
          <input id="admin-date-from" type="date" value="${adminDateFrom}"
            style="${inp}width:136px;" />
          <span style="font-size:11px;color:var(--muted,#6b7280);">–</span>
          <input id="admin-date-to" type="date" value="${adminDateTo}"
            style="${inp}width:136px;" />
        </div>

        ${hasActive ? `
          <button id="admin-clear-filters" type="button" style="
            flex-shrink:0;height:34px;padding:0 14px;
            border:1px solid #FCA5A5;border-radius:8px;
            background:#fff;color:#DC2626;
            font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">
            ✕ ล้าง
          </button>` : ""}
      </div>

    </div>
  `;
}
// ══════════════════════════════════════════════════════════════
// DESIGNER VIEW
// ══════════════════════════════════════════════════════════════

function renderDesignerPickup(view, state) {
  const allPending = state.requests.filter((i) => i.status === STATUS.PENDING);
  const pendingItems = applyAllFilters(allPending);

  // งานที่รับไปแล้ว (assigned) สำหรับแสดงในส่วน "ดึงงาน"
  const assignedItems = state.requests.filter((i) =>
    [STATUS.APPROVED, STATUS.WORKING, STATUS.MGR_REJECTED].includes(i.status) &&
    i.assignedToEmail && i.assignedToEmail.toLowerCase() !== (state.user?.email || "").toLowerCase()
  );

  const activeSection = view._adminSection || "pickup-section";
  const sectionHidden = (id) => activeSection !== id ? "hidden" : "";
  const jumpButton = (id, label, count) => `
    <button type="button" class="admin-tab-btn ${activeSection === id ? "active" : ""}" data-section="${id}">
      ${label} <span class="admin-tab-count">${count}</span>
    </button>`;

  view.innerHTML = `
    <section class="content-section admin-page">
      <div class="section-header">
        <div>
          <h2>รับงานและอนุมัติ</h2>
          <p>เลือกงานที่ต้องการรับผิดชอบ งานจะถูกส่งต่อให้ผู้จัดการอนุมัติ</p>
        </div>
      </div>

      <div class="admin-tabs">
        ${jumpButton("pickup-section", "🙋 รับงาน", allPending.length)}
        ${jumpButton("takeover-section", "🔄 งานในฝ่าย (ดึงงาน)", assignedItems.length)}
      </div>

      <div id="pickup-section" ${sectionHidden("pickup-section")}>
        <button id="pickup-bulk-button" class="primary-button pickup-bulk-button" type="button" disabled>
          รับงาน <span class="pickup-bulk-count">0</span>
        </button>
        ${renderFilterBar(state, allPending)}
        ${renderPickupTableSection(pendingItems, "รอฝ่ายแบบรับงาน", false)}
      </div>

      <div id="takeover-section" ${sectionHidden("takeover-section")}>
        <!-- ── ตัวกรอง ── -->
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center;">
          <input id="takeover-search" type="text" placeholder="🔍 ค้นหาเลขที่คำร้อง / Drawing..."
            style="height:34px;padding:0 12px;border:1px solid var(--line);border-radius:8px;font-size:13px;min-width:220px;flex:1;" />
          <select id="takeover-project" style="height:34px;padding:0 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:#fff;">
            <option value="">🏗️ ทุกโครงการ</option>
            ${[...new Set(assignedItems.map((i) => i.projectName).filter(Boolean))].sort().map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("")}
          </select>
          <select id="takeover-assignee" style="height:34px;padding:0 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:#fff;">
            <option value="">👤 ผู้รับผิดชอบทุกคน</option>
            ${[...new Set(assignedItems.map((i) => i.assignedToName).filter(Boolean))].sort().map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("")}
          </select>
          <select id="takeover-type" style="height:34px;padding:0 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:#fff;">
            <option value="">📋 ทุกประเภท</option>
            ${[...new Set(assignedItems.map((i) => i.requestType).filter(Boolean))].sort().map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
          </select>
        </div>
        ${renderTakeoverSection(assignedItems, state)}
      </div>

    </section>
  `;

  // ── tab switching ──
  view.querySelectorAll(".admin-tab-btn[data-section]").forEach((btn) => {
    btn.addEventListener("click", () => {
      view._adminSection = btn.dataset.section;
      renderDesignerPickup(view, state);
    });
  });

  bindPickupEvents(view, state);
  bindFilterEvents(view, state, () => renderDesignerPickup(view, state));
  bindTakeoverEvents(view, state);

  // ── ตัวกรองของ tab "งานในฝ่าย" ──
  const applyTakeoverFilter = () => {
    const search   = (view.querySelector("#takeover-search")?.value || "").toLowerCase();
    const project  = (view.querySelector("#takeover-project")?.value || "").toLowerCase();
    const assignee = (view.querySelector("#takeover-assignee")?.value || "").toLowerCase();
    const type     = (view.querySelector("#takeover-type")?.value || "").toLowerCase();
    view.querySelectorAll("#takeover-section tbody tr[data-takeover-row]").forEach((row) => {
      const text = row.textContent.toLowerCase();
      const proj = (row.dataset.project || "").toLowerCase();
      const asgn = (row.dataset.assignee || "").toLowerCase();
      const tp   = (row.dataset.type || "").toLowerCase();
      const show = (!search || text.includes(search))
        && (!project || proj.includes(project))
        && (!assignee || asgn === assignee)
        && (!type || tp === type);
      row.hidden = !show;
    });
  };
  ["#takeover-search","#takeover-project","#takeover-assignee","#takeover-type"].forEach((sel) => {
    view.querySelector(sel)?.addEventListener("input", applyTakeoverFilter);
    view.querySelector(sel)?.addEventListener("change", applyTakeoverFilter);
  });
}

// ══════════════════════════════════════════════════════════════
// MANAGER VIEW
// ══════════════════════════════════════════════════════════════

function renderManagerAdmin(view, state) {
  const isManager      = true;
  const allPending     = state.requests.filter((i) => i.status === STATUS.PENDING);
  const allApprove     = state.requests.filter((i) => i.status === STATUS.INPROGRESS_LV1);
  const mgrReviewItems = state.requests.filter((i) => i.status === STATUS.MGR_REVIEW);
  const allAssigned    = state.requests.filter((i) =>
    [STATUS.APPROVED, STATUS.WORKING, STATUS.MGR_REJECTED].includes(i.status) && i.assignedToEmail
  );

  const pendingItems  = applyAllFilters(allPending);
  const approveItems  = applyAllFilters(allApprove);

  view.innerHTML = `
    <section class="content-section admin-page">
      <div class="section-header">
        <div>
          <h2>รับงานและอนุมัติ</h2>
          <p>สิทธิ์: ผู้จัดการ Lv.2 — รับงาน, อนุมัติเริ่มงาน, ตรวจสอบและส่งมอบงาน</p>
        </div>
      </div>

      <div class="admin-jump-row" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:4px 0 20px;padding-bottom:18px;border-bottom:1px solid #e2e8f0;">
        ${jumpButton("pickup-section",     "📥 รับงาน",                   pendingItems.length,  true, "pickup-bulk-button", "pickup-bulk-count")}
        ${jumpButton("approve-section",    "✅ อนุมัติเริ่มงาน",           approveItems.length)}
        ${jumpButton("mgr-review-section", "🔍 ตรวจสอบและส่งมอบงาน",       mgrReviewItems.length)}
        ${jumpButton("takeover-section",   "🔄 งานในฝ่าย (ดึงงาน)",        allAssigned.length)}
      </div>

      ${renderFilterBar(state, [...allPending, ...allApprove])}

      <div class="admin-section-block" id="pickup-section" ${sectionHidden("pickup-section")}>
        <div class="admin-section-heading">📥 รับงาน — ติ๊กเลือกแล้วกดปุ่ม "รับงาน" ด้านบนเพื่อรับพร้อมกัน</div>
        ${renderPickupTableSection(pendingItems, "รอฝ่ายแบบรับงาน", true)}
      </div>

      <div class="admin-section-block" id="approve-section" ${sectionHidden("approve-section")}>
        <div class="admin-section-heading">✅ อนุมัติเริ่มงาน <span class="admin-section-count">${approveItems.length}</span></div>
        <div id="admin-list" class="admin-list">
          ${approveItems.length
            ? approveItems.map((item) => renderApprovalCard(item, isManager)).join("")
            : `<div class="empty-state">📭 ไม่มีรายการรออนุมัติ</div>`}
        </div>
      </div>

      <div class="admin-section-block" id="mgr-review-section" ${sectionHidden("mgr-review-section")}>
        <div class="admin-section-heading">🔍 ตรวจสอบและส่งมอบงาน <span class="admin-section-count">${mgrReviewItems.length}</span></div>
        <div id="mgr-review-list" class="admin-list">
          ${mgrReviewItems.length
            ? mgrReviewItems.map((item) => renderMgrReviewCard(item)).join("")
            : `<div class="empty-state">✅ ไม่มีงานรอตรวจสอบ</div>`}
        </div>
      </div>

      <div class="admin-section-block" id="takeover-section" ${sectionHidden("takeover-section")}>
        ${renderTakeoverSection(allAssigned, state)}
      </div>
    </section>
  `;

  bindPickupEvents(view, state);
  bindApprovalEvents(view, state);
  bindMgrReviewEvents(view, state);
  bindJumpBarEvents(view, state);
  bindFilterEvents(view, state, () => renderManagerAdmin(view, state));
  bindTakeoverEvents(view, state);
}

// ══════════════════════════════════════════════════════════════
// TAKEOVER SECTION — ดึงงานจากคนอื่นมาทำ
// ══════════════════════════════════════════════════════════════

function renderTakeoverSection(items, state) {
  const myEmail = (state.user?.email || "").toLowerCase();
  const notMine = items
    .filter((i) => (i.assignedToEmail || "").toLowerCase() !== myEmail)
    .sort((a, b) => {
      // เรียงตาม dueDate: เกินกำหนด (ผ่านไปแล้ว) → วันนี้ → เหลือน้อยสุด → ไม่มีกำหนด
      const toMs = (r) => {
        if (!r.dueDate) return Infinity;
        const d = new Date(r.dueDate); d.setHours(0, 0, 0, 0);
        return d.getTime();
      };
      return toMs(a) - toMs(b);
    });
  return `
    <div class="pickup-section" id="takeover-inner">
      <div class="pickup-section-heading">🔄 ดึงงานจากเพื่อนร่วมทีม
        <span class="pickup-section-count">${notMine.length} รายการ</span>
      </div>
      <p class="pickup-section-sub" style="color:#b45309;">
        ⚠️ ใช้เมื่อเพื่อนไม่อยู่ / ลา / สาย / งานเร่งด่วน — ระบบจะแจ้งเตือนผู้จัดการและเจ้าของงานเดิมทาง Teams
      </p>
      <div class="track-table-wrap">
        <table class="track-sheet pickup-table">
          <thead>
            <tr>
              <th>เลขที่คำร้อง</th>
              <th>DRAWING</th>
              <th>ผู้ร้องขอ</th>
              <th>ผู้รับผิดชอบปัจจุบัน</th>
              <th>โครงการ</th>
              <th>กำหนดส่ง</th>
              <th>สถานะ</th>
              <th>โฟลเดอร์ / ลิงก์</th>
              <th>ดำเนินการ</th>
            </tr>
          </thead>
          <tbody>
            ${notMine.length
              ? notMine.map((item) => renderTakeoverRow(item)).join("")
              : `<tr><td colspan="9" class="track-empty">ไม่มีงานในฝ่ายที่สามารถดึงมาได้</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderTakeoverRow(item) {
  const due  = pickupDueLabel(item.dueDate);
  const folder = getRequestFolderUrl(item.requestNo);
  const fileLink = item.dwgFileUrl || item.pdfFileUrl || item.dataLink || "";
  return `
    <tr data-takeover-row data-project="${escapeHtml(item.projectName||"")}" data-assignee="${escapeHtml(item.assignedToName||"")}" data-type="${escapeHtml(item.requestType||"")}">
      <td style="white-space:nowrap;"><strong>${escapeHtml(item.requestNo)}</strong></td>
      <td><strong>${escapeHtml(item.drawingNo || "—")}</strong><br><small>${escapeHtml(item.drawingName || "")}</small></td>
      <td>
        <span style="font-weight:600;">${escapeHtml(item.requesterName || "—")}</span><br>
        <small style="color:#888;">${escapeHtml(item.requesterEmail || "")}</small>
      </td>
      <td>
        <span style="font-weight:600;">${escapeHtml(item.assignedToName || "—")}</span><br>
        <small style="color:#888;">${escapeHtml(item.assignedToEmail || "")}</small>
      </td>
      <td>${escapeHtml(item.projectName || "—")}</td>
      <td><span class="due-chip ${due.className}">${escapeHtml(due.label)}</span></td>
      <td><span class="badge badge-${item.status}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span></td>
      <td style="white-space:nowrap;">
        <a href="${escapeHtml(folder)}" target="_blank" rel="noopener noreferrer"
          class="mgr-file-btn folder-btn" style="display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:3px 8px;">
          📁 โฟลเดอร์
        </a>
        ${fileLink ? `<a href="${escapeHtml(fileLink)}" target="_blank" rel="noopener noreferrer"
          class="mgr-file-btn ref-btn" style="display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:3px 8px;margin-top:4px;">
          🔗 ลิงก์
        </a>` : ""}
      </td>
      <td style="white-space:nowrap;">
        <button class="small-button" data-takeover="${escapeHtml(item.requestNo)}" type="button"
          style="background:#f59e0b;color:#fff;border-color:#f59e0b;">
          🔄 ดึงงานนี้
        </button>
        <button class="small-button secondary-button" data-transfer-requester="${escapeHtml(item.requestNo)}" type="button" style="margin-top:4px;">
          👤 โอนผู้ร้องขอ
        </button>
      </td>
    </tr>
  `;
}

function bindTakeoverEvents(view, state) {
  view.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-takeover]");
    if (btn) {
      const requestNo = btn.dataset.takeover;
      const request   = state.requests.find((i) => i.requestNo === requestNo);
      if (!request) return;
      openTakeoverModal(view, state, request);
      return;
    }

    const transferBtn = event.target.closest("[data-transfer-requester]");
    if (transferBtn) {
      const requestNo = transferBtn.dataset.transferRequester;
      const request   = state.requests.find((i) => i.requestNo === requestNo);
      if (!request) return;
      openTransferRequesterModal(view, state, request);
    }
  });
}

function openTransferRequesterModal(view, state, request) {
  const team = getDrawingTeamMembers();
  const body = `
    <div class="assign-work-panel">
      <div class="assign-work-summary">
        <strong>${escapeHtml(request.requestNo)}</strong>
        <span>${escapeHtml(request.drawingNo || "")} ${escapeHtml(request.drawingName || "")}</span>
      </div>
      <p style="font-size:13px;color:#64748B;margin:8px 0 14px;">
        ใช้เมื่อผู้ร้องขอเดิม (<b>${escapeHtml(request.requesterName || "—")}</b>) ลาออก/ย้ายงาน — คำร้องเดิมจะไม่ขาดตอน ผู้ร้องขอใหม่จะเห็นงานนี้ใน "งานของฉัน" ทันที
      </p>
      <label class="field">
        <span>ผู้ร้องขอคนใหม่ <b class="req">*</b></span>
        <select id="transfer-requester-select">
          <option value="">-- เลือกผู้รับช่วงต่อ --</option>
          ${team.map((m) => `<option value="${escapeHtml(m.email)}" data-name="${escapeHtml(m.name)}">${escapeHtml(m.name)} (${escapeHtml(m.email)})</option>`).join("")}
          <option value="__custom__">อื่นๆ — ระบุอีเมลเอง</option>
        </select>
      </label>
      <div id="transfer-custom-fields" hidden style="margin-top:8px;display:flex;flex-direction:column;gap:8px;">
        <label class="field">
          <span>ชื่อผู้ร้องขอใหม่</span>
          <input id="transfer-custom-name" type="text" placeholder="ชื่อ-นามสกุล" />
        </label>
        <label class="field">
          <span>อีเมลผู้ร้องขอใหม่</span>
          <input id="transfer-custom-email" type="email" placeholder="name@primepower.co.th" />
        </label>
      </div>
      <label class="field" style="margin-top:8px;">
        <span>เหตุผล (ถ้ามี)</span>
        <input id="transfer-reason" type="text" placeholder="เช่น ผู้ร้องขอเดิมลาออก..." />
      </label>
    </div>
  `;

  openModal({
    title: "👤 โอนผู้ร้องขอ",
    body,
    actions: [
      { label: "ยกเลิก", className: "secondary-button" },
      {
        label: "✅ ยืนยันโอนผู้ร้องขอ",
        className: "primary-button",
        onClick: async (close) => {
          const select = document.querySelector("#transfer-requester-select");
          const reason = document.querySelector("#transfer-reason")?.value.trim() || "";
          let newRequester;

          if (select.value === "__custom__") {
            const name  = document.querySelector("#transfer-custom-name")?.value.trim();
            const email = document.querySelector("#transfer-custom-email")?.value.trim();
            if (!name || !email) { showToast("กรุณากรอกชื่อและอีเมลให้ครบ", "warning"); return; }
            newRequester = { name, email };
          } else if (select.value) {
            const opt = select.options[select.selectedIndex];
            newRequester = { name: opt.dataset.name, email: select.value };
          } else {
            showToast("กรุณาเลือกผู้ร้องขอคนใหม่", "warning");
            return;
          }

          try {
            await transferRequester(request, newRequester, reason);
            showToast(`โอนคำร้อง ${request.requestNo} ให้ ${newRequester.name} แล้ว`, "success");
            close();
            renderAdmin(view, state);
          } catch (err) {
            showToast(`เกิดข้อผิดพลาด: ${err.message}`, "error");
          }
        },
      },
    ],
  });

  // toggle custom fields
  setTimeout(() => {
    const select = document.querySelector("#transfer-requester-select");
    const customFields = document.querySelector("#transfer-custom-fields");
    select?.addEventListener("change", () => {
      if (customFields) customFields.hidden = select.value !== "__custom__";
    });
  }, 0);
}

function openTakeoverModal(view, state, request) {
  const me = state.user || {};
  const body = `
    <div class="assign-work-panel">
      <div class="assign-work-summary">
        <span>${escapeHtml(request.requestNo)}</span>
        <strong>${escapeHtml(request.projectName || "—")}</strong>
        <small>${escapeHtml(request.drawingNo || "—")} · ${escapeHtml(request.drawingName || "—")}</small>
      </div>
      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:12px 16px;margin:12px 0;font-size:14px;color:#92400e;">
        ⚠️ งานนี้รับผิดชอบโดย <strong>${escapeHtml(request.assignedToName || request.assignedToEmail || "—")}</strong><br>
        ระบบจะแจ้งเตือน <b>เจ้าของงานเดิม + ผู้จัดการ</b> ทาง Teams 1:1 และ Browser Notification โดยอัตโนมัติ
      </div>
      <label class="field">
        <span>เหตุผลที่ดึงงาน <b class="req">*</b></span>
        <select id="takeover-reason-select" style="width:100%;padding:8px;border:1px solid #d0d7de;border-radius:6px;font-size:14px;">
          <option value="">— เลือกเหตุผล —</option>
          <option value="ขาดงาน / ไม่มาทำงาน">ขาดงาน / ไม่มาทำงาน</option>
          <option value="ลาป่วย / ลากิจ">ลาป่วย / ลากิจ</option>
          <option value="สาย / ติดธุระ">สาย / ติดธุระ</option>
          <option value="งานเร่งด่วน">งานเร่งด่วน</option>
          <option value="อื่นๆ">อื่นๆ — ระบุเพิ่มเติม</option>
        </select>
        <textarea id="takeover-reason-note" rows="2" style="margin-top:8px;"
          placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)..."></textarea>
      </label>
    </div>
  `;

  openModal({
    title: "🔄 ดึงงานมาทำแทน",
    body,
    actions: [
      { label: "ยกเลิก", className: "secondary-button" },
      {
        label: "✅ ยืนยันดึงงาน",
        className: "primary-button",
        onClick: async (close) => {
          const reasonSelect = document.querySelector("#takeover-reason-select")?.value;
          const reasonNote   = document.querySelector("#takeover-reason-note")?.value.trim();
          if (!reasonSelect) {
            showToast("กรุณาเลือกเหตุผล", "warning");
            return;
          }
          const fullReason = reasonNote ? `${reasonSelect} — ${reasonNote}` : reasonSelect;

          // เก็บข้อมูลเจ้าของงานเดิมก่อน patch (หลัง patch ค่าใน request จะเปลี่ยนแล้ว)
          const prevOwnerName  = request.assignedToName  || "—";
          const prevOwnerEmail = request.assignedToEmail || "";

          try {
            // ── 1. อัปเดต SharePoint + audit log ──
            await patchRequest(request, {
              assignedToName:  me.name  || "",
              assignedToEmail: me.email || "",
              assignNote: `[ดึงงานจาก ${prevOwnerName}] ${fullReason}`,
            }, `ดึงงานจาก ${prevOwnerName} — ${fullReason}`);

            // ── 2. แจ้งเตือนทั้งหมดแบบ parallel ──
            await notifyTakeover({ request, me, prevOwnerName, prevOwnerEmail, fullReason, state });

            showToast(`ดึงงาน ${request.requestNo} มาแล้ว — แจ้งเตือนเจ้าของงานเดิม + ผู้จัดการเรียบร้อย`, "success");
            close();
            renderAdmin(view, state);
          } catch (err) {
            showToast(`เกิดข้อผิดพลาด: ${err.message}`, "error");
          }
        },
      },
    ],
  });
}

// ══════════════════════════════════════════════════════════════
// TAKEOVER NOTIFICATIONS — แจ้งเตือน 3 ช่องทาง
// ══════════════════════════════════════════════════════════════

async function notifyTakeover({ request, me, prevOwnerName, prevOwnerEmail, fullReason, state }) {
  const thaiNow = new Date().toLocaleDateString("th-TH", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  const appUrl = appConfig.azure.redirectUri;

  // ── ข้อความถึงเจ้าของงานเดิม ──
  const msgToOwner = [
    `🔄 <b>งานของคุณถูกโอนให้เพื่อนร่วมทีมแล้ว</b>`,
    ``,
    `🔖 <b>เลขที่คำร้อง:</b> ${request.requestNo}`,
    `🏗️ <b>โครงการ:</b> ${request.projectName || "—"}`,
    `📐 <b>Drawing:</b> ${request.drawingNo || "—"} — ${request.drawingName || "—"}`,
    ``,
    `👤 <b>ผู้รับงานคนใหม่:</b> ${me.name || me.email || "—"}`,
    `📝 <b>เหตุผล:</b> ${fullReason}`,
    `🕐 <b>เวลา:</b> ${thaiNow}`,
    ``,
    `<a href="${appUrl}">🖥️ ดูรายละเอียดในระบบ</a>`,
  ].join("<br>");

  // ── ข้อความถึงผู้จัดการ ──
  const msgToMgr = [
    `🔄 <b>มีการโอนงานเกิดขึ้นในฝ่าย</b>`,
    ``,
    `🔖 <b>เลขที่คำร้อง:</b> ${request.requestNo}`,
    `🏗️ <b>โครงการ:</b> ${request.projectName || "—"}`,
    `📐 <b>Drawing:</b> ${request.drawingNo || "—"} — ${request.drawingName || "—"}`,
    ``,
    `👤 <b>เจ้าของงานเดิม:</b> ${prevOwnerName}`,
    `👤 <b>ผู้รับงานคนใหม่:</b> ${me.name || me.email || "—"}`,
    `📝 <b>เหตุผล:</b> ${fullReason}`,
    `🕐 <b>เวลา:</b> ${thaiNow}`,
    ``,
    `<a href="${appUrl}">🖥️ ดูรายละเอียดในระบบ</a>`,
  ].join("<br>");

  // ── ข้อความถึงผู้ร้องขอ (Requester) ──
  const msgToRequester = [
    `🔄 <b>มีการโอนงานเกิดขึ้นในฝ่าย</b>`,
    ``,
    `🔖 <b>เลขที่คำร้อง:</b> ${request.requestNo}`,
    `🏗️ <b>โครงการ:</b> ${request.projectName || "—"}`,
    `📐 <b>Drawing:</b> ${request.drawingNo || "—"} — ${request.drawingName || "—"}`,
    ``,
    `👤 <b>เจ้าของงานเดิม:</b> ${prevOwnerName}`,
    `👤 <b>ผู้รับงานคนใหม่:</b> ${me.name || me.email || "—"}`,
    `📝 <b>เหตุผล:</b> ${fullReason}`,
    `🕐 <b>เวลา:</b> ${thaiNow}`,
    ``,
    `<a href="${appUrl}">🖥️ ดูรายละเอียดในระบบ</a>`,
  ].join("<br>");

  const tasks = [];

  // ── ช่องทาง 0: Teams 1:1 → ผู้ร้องขอ ──
  if (request.requesterEmail) {
    tasks.push(
      sendTeams1on1(request.requesterEmail, msgToRequester).catch((err) =>
        console.warn("notifyTakeover → requester Teams failed:", err.message)
      )
    );
  }
  if (prevOwnerEmail) {
    tasks.push(
      sendTeams1on1(prevOwnerEmail, msgToOwner).catch((err) =>
        console.warn("notifyTakeover → owner Teams failed:", err.message)
      )
    );
  }

  // ── ช่องทาง 2: Teams 1:1 → ผู้จัดการทุกคน ──
  const mgrEmails = getAllManagerEmails(appConfig.approverLv2Emails || []);
  mgrEmails.forEach((email) => {
    // ไม่ส่งหาตัวเองถ้าผู้จัดการเป็นคนดึงงาน
    if (email.toLowerCase() === (me.email || "").toLowerCase()) return;
    tasks.push(
      sendTeams1on1(email, msgToMgr).catch((err) =>
        console.warn("notifyTakeover → mgr Teams failed:", err.message)
      )
    );
  });

  // ── ช่องทาง 3: Browser Notification → ทุกคนที่เปิดแอปค้างไว้ ──
  // (แสดงบน device ของเจ้าของงานเดิม ถ้าเขาเปิดแท็บนี้อยู่)
  tasks.push(
    sendBrowserNotificationIfGranted(
      `🔄 งาน ${request.requestNo} ถูกโอนแล้ว`,
      `${me.name || "เพื่อนร่วมทีม"} รับงานไปจาก ${prevOwnerName}\nเหตุผล: ${fullReason}`,
      `takeover-${request.requestNo}`
    )
  );

  await Promise.allSettled(tasks);
}

function sendBrowserNotificationIfGranted(title, body, tag) {
  if (!isNotificationSupported() || notificationPermission() !== "granted") return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const n = new Notification(title, {
        body,
        tag,
        icon: "./assets/icons/icon-192.png",
        badge: "./assets/icons/icon-192.png",
      });
      n.onclick = () => { window.focus(); n.close(); };
      resolve();
    } catch {
      resolve(); // ไม่ critical
    }
  });
}

// ══════════════════════════════════════════════════════════════
// PICKUP TABLE
// ══════════════════════════════════════════════════════════════

function renderPickupTableSection(items, heading, isManager = false) {
  return `
    <div class="pickup-section">
      <div class="pickup-section-heading">${escapeHtml(heading)}
        <span class="pickup-section-count">${items.length} รายการ</span>
      </div>
      <p class="pickup-section-sub">เลือกงานที่ต้องการรับผิดชอบ งานจะถูกส่งต่อให้ผู้จัดการอนุมัติ</p>
      <div class="track-table-wrap">
        <table class="track-sheet pickup-table">
          <thead>
            <tr>
              <th><input type="checkbox" id="pickup-select-all" ${items.length ? "" : "disabled"} /></th>
              <th>กำหนด</th>
              <th>เลขที่คำร้อง</th>
              <th>DRAWING</th>
              <th>ประเภทงาน</th>
              <th>ผู้ขอ</th>
              <th>วันที่/เวลาส่งคำขอ</th>
              <th>โฟลเดอร์ / ลิงก์</th>
              <th>สาเหตุการแก้ไข</th>
              <th>รับงาน</th>
              <th>อื่นๆ</th>
            </tr>
          </thead>
          <tbody>
            ${items.length
              ? items.map((item) => pickupRow(item, isManager)).join("")
              : `<tr><td colspan="11" class="track-empty">ไม่มีงานรอรับ</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function pickupRow(item, isManager = false) {
  const due = pickupDueLabel(item.dueDate);
  const submittedLabel = item.submittedAt
    ? new Date(item.submittedAt).toLocaleDateString("th-TH", {
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "—";
  const folder   = getRequestFolderUrl(item.requestNo);
  const fileLink = item.dataLink || "";
  return `
    <tr>
      <td><input type="checkbox" class="pickup-checkbox" data-pickup-id="${escapeHtml(item.requestNo)}" /></td>
      <td><span class="due-chip ${due.className}">${escapeHtml(due.label)}</span></td>
      <td>
        <strong style="white-space:nowrap;">${escapeHtml(item.requestNo)}</strong><br>
        <small style="color:#005DAC;font-weight:600;">${escapeHtml(item.projectName || "—")}</small>
      </td>
      <td><strong>${escapeHtml(item.drawingNo || "—")}</strong><br><small>${escapeHtml(item.drawingName || "")}</small></td>
      <td><span class="badge badge-pending">${escapeHtml(item.requestType || "—")}</span></td>
      <td>${escapeHtml(item.requesterName || "—")}</td>
      <td style="white-space:nowrap;font-size:13px;color:#555;">${escapeHtml(submittedLabel)}</td>
      <td style="white-space:nowrap;">
        <a href="${escapeHtml(folder)}" target="_blank" rel="noopener noreferrer"
          class="mgr-file-btn folder-btn" style="display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:3px 8px;">
          📁 โฟลเดอร์
        </a>
        ${fileLink ? `<a href="${escapeHtml(fileLink)}" target="_blank" rel="noopener noreferrer"
          class="mgr-file-btn ref-btn" style="display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:3px 8px;margin-top:4px;">
          🔗 ลิงก์
        </a>` : ""}
      </td>
      <td style="max-width:200px;">
        ${item.revisionSource || item.revisionReason ? (() => {
          const srcMap = { "1.1":"🔴 1.1 ฝ่ายเขียนแบบ","1.2":"🟡 1.2 ผู้ส่งคำร้อง","1.3":"🟠 1.3 งานติดตั้ง","1.4":"🔵 1.4 ลูกค้า" };
          return `
            <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:6px;padding:5px 8px;font-size:11px;">
              ${item.revisionSource ? `<div style="font-weight:600;color:#C2410C;">${escapeHtml(srcMap[item.revisionSource]||item.revisionSource)}</div>` : ""}
              ${item.revisionReason ? `<div style="color:#78350F;margin-top:2px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;" title="${escapeHtml(item.revisionReason)}">${escapeHtml(item.revisionReason)}</div>` : ""}
            </div>`;
        })() : `<span style="color:#CBD5E1;font-size:11px;">—</span>`}
      </td>
      <td style="white-space:nowrap;text-align:center;">
        <button class="small-button" data-pickup-self="${escapeHtml(item.requestNo)}" type="button">🙋 รับเอง</button>
        ${isManager ? `<button class="small-button secondary-button" style="margin-top:4px;" data-pickup-assign="${escapeHtml(item.requestNo)}" type="button">👤 มอบหมาย</button>` : ""}
      </td>
      <td style="white-space:nowrap;text-align:center;">
        <button class="small-button secondary-button" data-pickup-reject-toggle="${escapeHtml(item.requestNo)}" type="button">↩️ ตีกลับ</button>
      </td>
    </tr>
    <tr id="pickup-reject-row-${escapeHtml(item.requestNo)}" hidden>
      <td colspan="11" style="background:#FFFBEB;padding:12px 16px;">
        <div style="display:flex;flex-direction:column;gap:8px;max-width:600px;">
          <label style="font-size:12px;font-weight:600;color:#92400E;">⚠️ เหตุผลที่ตีกลับ (ข้อมูลไม่เพียงพอ) <b style="color:#EF4444;">*</b></label>
          <textarea id="pickup-reject-note-${escapeHtml(item.requestNo)}" rows="2" placeholder="เช่น ไม่มีไฟล์อ้างอิง, ระบุ Spec ไม่ครบ, ต้องการข้อมูลเพิ่มเติม..." style="width:100%;border:1px solid #FCD34D;border-radius:8px;padding:8px;font-size:13px;background:#FFFFFF;resize:vertical;"></textarea>
          <div style="display:flex;gap:8px;">
            <button class="secondary-button small-flow-button" type="button" data-pickup-reject-cancel="${escapeHtml(item.requestNo)}">ยกเลิก</button>
            <button class="danger-button small-flow-button" type="button" data-pickup-reject-confirm="${escapeHtml(item.requestNo)}">ยืนยันตีกลับ</button>
          </div>
        </div>
      </td>
    </tr>
  `;
}

function pickupDueLabel(dueDate) {
  if (!dueDate) return { label: "-", className: "neutral" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due   = new Date(dueDate); due.setHours(0, 0, 0, 0);
  const diff  = Math.round((due - today) / 86400000);
  if (diff < 0) return { label: `เกิน ${Math.abs(diff)} วัน`, className: "overdue" };
  if (diff === 0) return { label: "วันนี้", className: "today" };
  return { label: `เหลือ ${diff} วัน`, className: "soon" };
}

// ══════════════════════════════════════════════════════════════
// BIND FILTER EVENTS (shared)
// ══════════════════════════════════════════════════════════════

function bindFilterEvents(view, state, rerender) {
  view.querySelector("#admin-search")?.addEventListener("input", (e) => {
    adminSearchQuery = e.target.value;
    rerender();
  });
  view.querySelector("#admin-project-filter")?.addEventListener("change", (e) => {
    adminProjectFilter = e.target.value;
    rerender();
  });
  view.querySelector("#admin-assignee-filter")?.addEventListener("change", (e) => {
    adminAssigneeFilter = e.target.value;
    rerender();
  });
  view.querySelector("#admin-date-from")?.addEventListener("change", (e) => {
    adminDateFrom = e.target.value;
    rerender();
  });
  view.querySelector("#admin-date-to")?.addEventListener("change", (e) => {
    adminDateTo = e.target.value;
    rerender();
  });
  view.querySelector("#admin-clear-filters")?.addEventListener("click", () => {
    adminProjectFilter  = "";
    adminAssigneeFilter = "";
    adminDateFrom = "";
    adminDateTo   = "";
    adminSearchQuery = "";
    rerender();
  });
  view.addEventListener("click", (e) => {
    const fb = e.target.closest("[data-admin-filter]");
    if (fb) { adminFilter = fb.dataset.adminFilter; rerender(); }
  });
}

// ══════════════════════════════════════════════════════════════
// PICKUP EVENTS
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// PICKUP ASSIGN MODAL — manager มอบหมายงานตอนรับคำขอใหม่
// ══════════════════════════════════════════════════════════════

function openPickupAssignModal(view, state, request) {
  const members = getDrawingTeamMembers();
  const body = `
    <div class="assign-work-panel">
      <div class="assign-work-summary">
        <span>${escapeHtml(request.requestNo)}</span>
        <strong>${escapeHtml(request.projectName || "—")}</strong>
        <small>${escapeHtml(request.drawingNo || "—")} · ${escapeHtml(request.drawingName || "—")}</small>
      </div>
      <p class="assign-work-label">เลือกพนักงานฝ่ายเขียนแบบที่จะรับงานนี้</p>
      <div class="assignee-choice-grid">
        ${members.map((m, idx) => `
          <label class="assignee-choice">
            <input type="radio" name="pickupAssignMember" value="${idx}" />
            <span class="assignee-avatar">${escapeHtml(initials(m.name || m.email))}</span>
            <span>
              <strong>${escapeHtml(m.name || m.email)}</strong>
              <small>${escapeHtml(m.role || m.email || "ฝ่ายเขียนแบบ")}</small>
            </span>
          </label>`).join("")}
      </div>
      <label class="field">
        <span>หมายเหตุถึงผู้รับงาน (optional)</span>
        <textarea id="pickup-assign-note" rows="2" placeholder="เช่น งานด่วน ลูกค้าติดตาม..."></textarea>
      </label>
    </div>
  `;
  openModal({
    title: "👤 มอบหมายงานให้ฝ่ายเขียนแบบ",
    body,
    actions: [
      { label: "ยกเลิก", className: "secondary-button" },
      {
        label: "✓ ยืนยันมอบหมาย",
        className: "primary-button",
        onClick: async (close) => {
          const sel = document.querySelector('input[name="pickupAssignMember"]:checked');
          if (!sel) { showToast("กรุณาเลือกผู้รับผิดชอบ", "warning"); return; }
          const member = members[Number(sel.value)];
          const note   = document.querySelector("#pickup-assign-note")?.value.trim() || "";
          try {
            await approveLv1AndAssign(request, member, note);
            showToast(`มอบหมายงานให้ ${member.name || member.email} แล้ว — รอ Lv.2 อนุมัติ`, "success");
            close();
            renderAdmin(view, state);
          } catch (err) {
            showToast(`เกิดข้อผิดพลาด: ${err.message}`, "error");
          }
        },
      },
    ],
  });
}

function bindPickupEvents(view, state) {
  view._pickupEvents?.abort();
  const controller = new AbortController();
  view._pickupEvents = controller;
  const opts = { signal: controller.signal };

  const bulkButton    = view.querySelector("#pickup-bulk-button");
  const isManagerView = bulkButton?.hasAttribute("data-jump-to");

  const updateBulkButton = () => {
    const btn  = view.querySelector("#pickup-bulk-button");
    if (!btn) return;
    const countSpan = btn.querySelector(".pickup-bulk-count, #pickup-bulk-count");
    const labelSpan = btn.querySelector("span:first-child");
    const count = selectedPickupIds.size;
    if (countSpan) countSpan.textContent = count;
    if (isManagerView) {
      if (labelSpan) labelSpan.textContent = count > 0 ? "✅ รับงานที่เลือก" : "📥 รับงาน";
    } else {
      btn.disabled = count === 0;
    }
  };

  view.querySelector("#pickup-select-all")?.addEventListener("change", (e) => {
    view.querySelectorAll(".pickup-checkbox").forEach((cb) => {
      cb.checked = e.target.checked;
      if (e.target.checked) selectedPickupIds.add(cb.dataset.pickupId);
      else selectedPickupIds.delete(cb.dataset.pickupId);
    });
    updateBulkButton();
  }, opts);

  view.querySelectorAll(".pickup-checkbox").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) selectedPickupIds.add(cb.dataset.pickupId);
      else selectedPickupIds.delete(cb.dataset.pickupId);
      updateBulkButton();
    }, opts);
  });

  bulkButton?.addEventListener("click", async (e) => {
    const ids = [...selectedPickupIds];
    if (!ids.length) return;
    e.stopImmediatePropagation();
    await pickupRequests(view, state, ids);
  }, opts);

  view.querySelectorAll("[data-pickup-self]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await pickupRequests(view, state, [btn.dataset.pickupSelf]);
    }, opts);
  });

  // ── ปุ่ม "มอบหมาย" — Lv.2 manager เลือกผู้รับแทน รับเอง ──
  view.querySelectorAll("[data-pickup-assign]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const requestNo = btn.dataset.pickupAssign;
      const request = state.requests.find((i) => i.requestNo === requestNo);
      if (!request) return;
      openPickupAssignModal(view, state, request);
    }, opts);
  });

  // ── ตีกลับก่อนรับงาน (ข้อมูลไม่เพียงพอ) ──
  view.querySelectorAll("[data-pickup-reject-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const requestNo = btn.dataset.pickupRejectToggle;
      const row = view.querySelector(`#pickup-reject-row-${cssEscape(requestNo)}`);
      if (row) {
        row.hidden = !row.hidden;
        if (!row.hidden) view.querySelector(`#pickup-reject-note-${cssEscape(requestNo)}`)?.focus();
      }
    }, opts);
  });

  view.querySelectorAll("[data-pickup-reject-cancel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const requestNo = btn.dataset.pickupRejectCancel;
      const row = view.querySelector(`#pickup-reject-row-${cssEscape(requestNo)}`);
      if (row) row.hidden = true;
    }, opts);
  });

  view.querySelectorAll("[data-pickup-reject-confirm]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const requestNo = btn.dataset.pickupRejectConfirm;
      const note = view.querySelector(`#pickup-reject-note-${cssEscape(requestNo)}`);
      const reason = note?.value.trim();
      if (!reason) { showToast("กรุณาระบุเหตุผลที่ตีกลับ", "warning"); return; }
      const request = state.requests.find((i) => i.requestNo === requestNo);
      if (!request) return;
      btn.disabled = true; btn.classList.add("is-loading");
      try {
        await rejectBeforePickup(request, reason);
        showToast(`ตีกลับคำร้อง ${requestNo} ไปยังผู้ร้องขอแล้ว`, "warning");
        renderAdmin(view, state);
      } catch (err) {
        showToast(`เกิดข้อผิดพลาด: ${err.message}`, "error");
        btn.disabled = false; btn.classList.remove("is-loading");
      }
    }, opts);
  });
}

async function pickupRequests(view, state, requestNos) {
  const me  = { name: state.user?.name || "", email: state.user?.email || "" };
  const btn = view.querySelector("#pickup-bulk-button");
  if (btn) { btn.disabled = true; btn.classList.add("is-loading"); }

  let successCount = 0;
  for (const requestNo of requestNos) {
    const request = state.requests.find((i) => i.requestNo === requestNo);
    if (!request) continue;
    try {
      await approveLv1AndAssign(request, me, "");
      successCount += 1;
    } catch (err) {
      showToast(`รับงาน ${requestNo} ไม่สำเร็จ: ${err.message}`, "error");
    }
  }
  if (successCount > 0) showToast(`รับงานสำเร็จ ${successCount} รายการ — ส่งต่อให้ผู้จัดการอนุมัติแล้ว`, "success");
  selectedPickupIds.clear();
  renderAdmin(view, state);
}

// ══════════════════════════════════════════════════════════════
// APPROVAL CARD — Lv.2
// ══════════════════════════════════════════════════════════════

function renderApprovalCard(item, isManager = false) {
  const urgentClass = { "เร่งด่วน": "badge-urgent", "เร่งด่วนมาก": "badge-critical" };
  const statusBadge = `<span class="badge badge-${item.status}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span>`;
  const lv1Block = item.assignedToName ? `
    <div class="lv1-info-block">
      <div class="lv1-info-title">✅ รับงานแล้ว</div>
      <div class="lv1-info-grid">
        <div><span>ผู้รับผิดชอบ:</span> <b>${escapeHtml(item.assignedToName)}</b></div>
        <div><span>รับงานโดย:</span> ${escapeHtml(item.reviewerLv1 || "—")}</div>
        ${item.assignNote ? `<div class="span-full"><span>หมายเหตุ:</span> ${escapeHtml(item.assignNote)}</div>` : ""}
      </div>
    </div>` : "";

  const folder   = getRequestFolderUrl(item.requestNo);
  const fileLink = item.dataLink || "";

  // ปุ่มมอบหมายงานใหม่ — แสดงเฉพาะ Lv.2 manager และเฉพาะงานที่มีผู้รับผิดชอบแล้ว
  const reassignBtn = isManager && item.assignedToName
    ? `<button class="secondary-button small-flow-button" data-admin-action="open-reassign" data-request="${escapeHtml(item.requestNo)}">🔄 มอบหมายใหม่</button>`
    : "";

  return `
    <article class="admin-card" id="admin-card-${escapeHtml(item.requestNo)}">
      <div class="admin-card-header">
        <div>
          <div class="admin-card-title">
            ${escapeHtml(item.requestType || "คำร้อง")}
            ${item.drawingNo ? `<span class="admin-card-drawing-no">${escapeHtml(item.drawingNo)}</span>` : ""}
          </div>
          <div class="admin-card-ref">${escapeHtml(item.requestNo)} ${item.drawingName ? "— " + escapeHtml(item.drawingName) : ""}</div>
        </div>
        ${statusBadge}
        ${item.priority && item.priority !== "ปกติ" ? `<span class="badge ${urgentClass[item.priority] || ""}">${escapeHtml(item.priority)}</span>` : ""}
      </div>

      ${lv1Block}
      ${item.description ? `<div class="admin-card-body">${escapeHtml(item.description)}</div>` : ""}

      <div class="admin-card-footer">
        <span class="admin-card-meta">👤 ${escapeHtml(item.requesterName || item.department || "—")}</span>
        <span class="admin-card-meta">📅 ${formatDate(item.submittedAt)}</span>

        <!-- โฟลเดอร์ + ลิงก์แนบ -->
        <a href="${escapeHtml(folder)}" target="_blank" rel="noopener noreferrer"
          class="secondary-button small-flow-button" style="display:inline-flex;align-items:center;gap:4px;">
          📁 โฟลเดอร์
        </a>
        ${fileLink ? `<a href="${escapeHtml(fileLink)}" target="_blank" rel="noopener noreferrer"
          class="secondary-button small-flow-button" style="display:inline-flex;align-items:center;gap:4px;">
          🔗 ลิงก์แนบ
        </a>` : ""}

        <div class="admin-card-actions">
          <button class="secondary-button small-flow-button" data-admin-action="toggle-reject" data-request="${escapeHtml(item.requestNo)}">↩️ ส่งกลับ</button>
          <button class="secondary-button small-flow-button danger-button" data-admin-action="toggle-cancel" data-request="${escapeHtml(item.requestNo)}">❌ ยกเลิก</button>
          ${reassignBtn}
          ${item.assignedToName
            ? `<button class="primary-button small-flow-button" data-admin-action="approve-lv2" data-request="${escapeHtml(item.requestNo)}">✅ อนุมัติเริ่มงาน</button>`
            : `<button class="primary-button small-flow-button" data-admin-action="open-assign" data-request="${escapeHtml(item.requestNo)}" data-level="lv2">✅ อนุมัติ + มอบหมาย</button>`}
        </div>
      </div>

      <div id="admin-action-box-${escapeHtml(item.requestNo)}" class="admin-action-box" hidden>
        <div id="admin-action-label-${escapeHtml(item.requestNo)}" class="admin-action-label"></div>
        <textarea id="admin-action-note-${escapeHtml(item.requestNo)}" rows="3" placeholder="ระบุเหตุผล / หมายเหตุ..."></textarea>
        <div class="admin-action-buttons">
          <button class="secondary-button small-flow-button" data-admin-action="close-box" data-request="${escapeHtml(item.requestNo)}">ยกเลิก</button>
          <button class="danger-button small-flow-button" id="admin-action-confirm-${escapeHtml(item.requestNo)}" data-admin-action="confirm-box" data-request="${escapeHtml(item.requestNo)}">ยืนยัน</button>
        </div>
      </div>
    </article>
  `;
}

function bindApprovalEvents(view, state) {
  view._approvalEvents?.abort();
  const controller = new AbortController();
  view._approvalEvents = controller;
  const opts = { signal: controller.signal };

  view.addEventListener("click", async (e) => {
    const actionButton = e.target.closest("[data-admin-action]");
    if (!actionButton) return;
    const requestNo = actionButton.dataset.request;
    const request   = state.requests.find((i) => i.requestNo === requestNo);
    if (!request) return;
    const action = actionButton.dataset.adminAction;

    if (action === "open-assign") {
      openAssignModal(view, state, request, actionButton.dataset.level);
      return;
    }
    if (action === "open-reassign") {
      openReassignModal(view, state, request);
      return;
    }
    if (action === "approve-lv2") {
      actionButton.disabled = true; actionButton.classList.add("is-loading");
      try {
        await approveLv2(request, "");
        showToast(`${request.requestNo} อนุมัติเริ่มงานแล้ว`, "success");
        renderAdmin(view, state);
      } catch (err) {
        showToast(`เกิดข้อผิดพลาด: ${err.message}`, "error");
        actionButton.disabled = false; actionButton.classList.remove("is-loading");
      }
      return;
    }
    if (action === "toggle-reject" || action === "toggle-cancel") {
      toggleActionBox(view, requestNo, action === "toggle-reject" ? "reject" : "cancel", true, Boolean(request.assignedToName));
      return;
    }
    if (action === "close-box") {
      const box = view.querySelector(`#admin-action-box-${cssEscape(requestNo)}`);
      if (box) box.hidden = true;
      return;
    }
    if (action === "confirm-box") {
      await submitActionBox(view, state, request, true);
    }
  }, opts);
}

function toggleActionBox(view, requestNo, mode, isManager, hasLv1) {
  const box       = view.querySelector(`#admin-action-box-${cssEscape(requestNo)}`);
  const label     = view.querySelector(`#admin-action-label-${cssEscape(requestNo)}`);
  const note      = view.querySelector(`#admin-action-note-${cssEscape(requestNo)}`);
  const confirmBtn = view.querySelector(`#admin-action-confirm-${cssEscape(requestNo)}`);
  if (!box) return;
  if (!box.hidden && box.dataset.mode === mode) { box.hidden = true; return; }
  box.dataset.mode = mode; box.hidden = false; note.value = "";
  if (mode === "reject") {
    const isBackToLv1 = isManager && hasLv1;
    label.innerHTML   = isBackToLv1 ? "↩️ <b>ส่งกลับ Lv.1</b>" : "↩️ <b>ส่งกลับผู้ร้องขอ</b>";
    box.classList.add("tone-warning"); box.classList.remove("tone-danger");
    confirmBtn.textContent = isBackToLv1 ? "ยืนยันส่งกลับ Lv.1" : "ยืนยันส่งกลับ";
    note.placeholder = "ระบุเหตุผล...";
  } else {
    label.innerHTML = "❌ <b>ยกเลิกคำร้อง</b>";
    box.classList.add("tone-danger"); box.classList.remove("tone-warning");
    confirmBtn.textContent = "ยืนยันยกเลิก";
    note.placeholder = "ระบุเหตุผลที่ยกเลิก...";
  }
  note.focus();
}

async function submitActionBox(view, state, request, isManager) {
  const requestNo  = request.requestNo;
  const box        = view.querySelector(`#admin-action-box-${cssEscape(requestNo)}`);
  const mode       = box?.dataset.mode;
  const note       = view.querySelector(`#admin-action-note-${cssEscape(requestNo)}`);
  const reason     = note?.value.trim();
  if (!reason) { showToast("กรุณาระบุเหตุผล", "warning"); return; }
  const confirmBtn = view.querySelector(`#admin-action-confirm-${cssEscape(requestNo)}`);
  confirmBtn.disabled = true; confirmBtn.classList.add("is-loading");
  try {
    if (mode === "cancel") {
      await adminCancel(request, reason);
      showToast(`ยกเลิกคำร้อง ${requestNo} แล้ว`, "warning");
    } else {
      const hasLv1 = Boolean(request.assignedToName);
      await adminReject(request, reason, { isManager, hasLv1 });
      showToast(isManager && hasLv1 ? `ส่งกลับ Lv.1 แล้ว — ${requestNo}` : `ส่งกลับผู้ร้องขอแล้ว — ${requestNo}`, "warning");
    }
    renderAdmin(view, state);
  } catch (err) {
    showToast(`เกิดข้อผิดพลาด: ${err.message}`, "error");
    confirmBtn.disabled = false; confirmBtn.classList.remove("is-loading");
  }
}

// ══════════════════════════════════════════════════════════════
// ASSIGN MODAL
// ══════════════════════════════════════════════════════════════

function openAssignModal(view, state, request, level) {
  const members = getDrawingTeamMembers();
  const isLv2   = level === "lv2";
  const body = `
    <div class="assign-work-panel">
      <div class="assign-work-summary">
        <span>${escapeHtml(request.requestNo)}</span>
        <strong>${escapeHtml(request.projectName || "—")}</strong>
        <small>${escapeHtml(request.drawingNo || "—")} · ${escapeHtml(request.drawingName || "—")}</small>
      </div>
      <p class="assign-work-label">เลือกพนักงานฝ่ายเขียนแบบ</p>
      <div class="assignee-choice-grid">
        ${members.map((m, idx) => `
          <label class="assignee-choice">
            <input type="radio" name="assignMember" value="${idx}" />
            <span class="assignee-avatar">${escapeHtml(initials(m.name || m.email))}</span>
            <span>
              <strong>${escapeHtml(m.name || m.email)}</strong>
              <small>${escapeHtml(m.role || m.email || "ฝ่ายเขียนแบบ")}</small>
            </span>
          </label>`).join("")}
      </div>
      <label class="field">
        <span>หมายเหตุถึงผู้รับงาน</span>
        <textarea id="assign-note-input" rows="2" placeholder="เช่น ลูกค้าต้องการงานภายใน 5 วันทำการ..."></textarea>
      </label>
    </div>
  `;
  openModal({
    title: isLv2 ? "อนุมัติ Lv.2 — ระบุผู้รับผิดชอบ" : "อนุมัติ Lv.1 — มอบหมายงาน",
    body,
    actions: [
      { label: "ยกเลิก", className: "secondary-button" },
      {
        label: "✓ ยืนยันอนุมัติ + มอบหมาย",
        className: "primary-button",
        onClick: async (close) => {
          const sel = document.querySelector('input[name="assignMember"]:checked');
          if (!sel) { showToast("กรุณาเลือกผู้รับผิดชอบ", "warning"); return; }
          const member = members[Number(sel.value)];
          const note   = document.querySelector("#assign-note-input")?.value.trim() || "";
          try {
            if (isLv2) {
              await approveLv2AndAssign(request, member, note);
              showToast(`อนุมัติ Lv.2 แล้ว — มอบหมายให้ ${member.name}`, "success");
            } else {
              await approveLv1AndAssign(request, member, note);
              showToast(`อนุมัติ Lv.1 แล้ว — รอ Lv.2 ผู้จัดการ`, "success");
            }
            close();
            renderAdmin(view, state);
          } catch (err) {
            showToast(`เกิดข้อผิดพลาด: ${err.message}`, "error");
          }
        },
      },
    ],
  });
}

// ══════════════════════════════════════════════════════════════
// REASSIGN — มอบหมายงานใหม่ (Lv.2 manager เท่านั้น ไม่เปลี่ยน status)
// ══════════════════════════════════════════════════════════════

function openReassignModal(view, state, request) {
  const members = getDrawingTeamMembers();
  const currentAssignee = request.assignedToName || "—";
  const body = `
    <div class="assign-work-panel">
      <div class="assign-work-summary">
        <span>${escapeHtml(request.requestNo)}</span>
        <strong>${escapeHtml(request.projectName || "—")}</strong>
        <small>${escapeHtml(request.drawingNo || "—")} · ${escapeHtml(request.drawingName || "—")}</small>
      </div>
      <p class="assign-work-label" style="margin-bottom:6px;">
        ผู้รับผิดชอบปัจจุบัน: <strong>${escapeHtml(currentAssignee)}</strong>
      </p>
      <p class="assign-work-label">เลือกผู้รับผิดชอบคนใหม่</p>
      <div class="assignee-choice-grid">
        ${members.map((m, idx) => `
          <label class="assignee-choice ${(m.name || m.email) === currentAssignee ? "is-current" : ""}">
            <input type="radio" name="reassignMember" value="${idx}" ${(m.name || m.email) === currentAssignee ? "checked" : ""} />
            <span class="assignee-avatar">${escapeHtml(initials(m.name || m.email))}</span>
            <span>
              <strong>${escapeHtml(m.name || m.email)}</strong>
              <small>${escapeHtml(m.role || m.email || "ฝ่ายเขียนแบบ")}</small>
            </span>
          </label>`).join("")}
      </div>
      <label class="field">
        <span>หมายเหตุ (optional)</span>
        <textarea id="reassign-note-input" rows="2" placeholder="เช่น เปลี่ยนเนื่องจากภาระงาน..."></textarea>
      </label>
    </div>
  `;
  openModal({
    title: "🔄 มอบหมายงานใหม่",
    body,
    actions: [
      { label: "ยกเลิก", className: "secondary-button" },
      {
        label: "✓ ยืนยันมอบหมาย",
        className: "primary-button",
        onClick: async (close) => {
          const sel = document.querySelector('input[name="reassignMember"]:checked');
          if (!sel) { showToast("กรุณาเลือกผู้รับผิดชอบ", "warning"); return; }
          const member = members[Number(sel.value)];
          const note   = document.querySelector("#reassign-note-input")?.value.trim() || "";
          const prevName = request.assignedToName || "—";
          try {
            await patchRequest(request, {
              assignedToName:  member.name  || member.email || "",
              assignedToEmail: member.email || "",
              assignNote: note
                ? `[มอบหมายใหม่จาก ${prevName}] ${note}`
                : `[มอบหมายใหม่จาก ${prevName}]`,
            }, "มอบหมายงานใหม่");
            showToast(`มอบหมายงานใหม่ให้ ${member.name || member.email} แล้ว`, "success");
            close();
            renderAdmin(view, state);
          } catch (err) {
            showToast(`เกิดข้อผิดพลาด: ${err.message}`, "error");
          }
        },
      },
    ],
  });
}

// ══════════════════════════════════════════════════════════════
// MGR REVIEW — ตรวจสอบ + ส่งมอบงาน
// ══════════════════════════════════════════════════════════════

function getRequestFolderUrl(requestNo) {
  const sp    = appConfig.sharePoint;
  const match = String(requestNo || "").match(/^(.*)-(Rev\.\d+)$/);
  const baseNo = match ? match[1] : requestNo;
  const revSeg = match ? `/${match[2]}` : "";
  const path   = `${sp.uploadFolder}/${baseNo}${revSeg}`;
  return `https://${sp.hostname}${sp.sitePath}/Shared%20Documents/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function parseNoteAndFiles(raw = "") {
  const sep = raw.indexOf("|||");
  if (sep === -1) return { note: raw, otherFiles: [] };
  const notePart = raw.slice(0, sep).trim();
  const jsonPart = raw.slice(sep + 3).trim();
  try {
    const otherFiles = JSON.parse(jsonPart);
    return { note: notePart, otherFiles: Array.isArray(otherFiles) ? otherFiles : [] };
  } catch { return { note: raw, otherFiles: [] }; }
}

function renderMgrReviewCard(item) {
  const { note, otherFiles } = parseNoteAndFiles(item.noteFromDrawing || "");
  const folder = getRequestFolderUrl(item.requestNo);
  const hasFile = item.dwgFileUrl || item.pdfFileUrl || otherFiles.length;
  return `
    <article class="admin-card" id="mgr-card-${escapeHtml(item.requestNo)}">
      <div class="admin-card-header">
        <div>
          <div class="admin-card-title">${escapeHtml(item.requestNo)}</div>
          <div class="admin-card-ref">${escapeHtml(item.projectName || "—")} · ${escapeHtml(item.drawingNo || "—")} — ${escapeHtml(item.drawingName || "—")}</div>
        </div>
        <span class="badge badge-mgr_review">🔍 รอผู้จัดการตรวจ+ส่งมอบ</span>
      </div>

      <div class="lv1-info-block">
        <div class="lv1-info-grid">
          <div><span>ผู้เขียนแบบ:</span> <b>${escapeHtml(item.assignedToName || "—")}</b></div>
          <div><span>Revise:</span> <b>${escapeHtml(item.currentRevise || item.reviseNumber || "—")}</b></div>
          <div><span>กำหนดส่ง:</span> ${item.dueDate ? escapeHtml(new Date(item.dueDate).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" })) : "—"}</div>
          <div><span>ความเร่งด่วน:</span> ${escapeHtml(item.priority || "ปกติ")}</div>
          ${item.description ? `<div class="span-full"><span>รายละเอียด:</span> ${escapeHtml(item.description)}</div>` : ""}
          ${note ? `<div class="span-full mgr-note-from-drawing"><span>📝 หมายเหตุจากผู้เขียนแบบ:</span> <b>${escapeHtml(note)}</b></div>` : ""}
        </div>
      </div>

      <div class="mgr-file-review-block">
        <div class="mgr-file-review-label">📎 ไฟล์งาน + ลิงก์</div>
        <div class="mgr-file-review-links">
          ${item.dwgFileUrl ? `<a href="${escapeHtml(item.dwgFileUrl)}" target="_blank" rel="noopener noreferrer" class="mgr-file-btn dwg-btn"><span>📐</span><span>DWG</span></a>` : `<span class="mgr-file-missing">— ไม่มีไฟล์ DWG</span>`}
          ${item.pdfFileUrl ? `<a href="${escapeHtml(item.pdfFileUrl)}" target="_blank" rel="noopener noreferrer" class="mgr-file-btn pdf-btn"><span>📄</span><span>PDF</span></a>` : `<span class="mgr-file-missing">— ไม่มีไฟล์ PDF</span>`}
          ${otherFiles.map((f) => {
            const shortName = f.name.length > 22 ? f.name.slice(0, 19) + "…" : f.name;
            return `<a href="${escapeHtml(f.url)}" target="_blank" rel="noopener noreferrer" class="mgr-file-btn other-btn" title="${escapeHtml(f.name)}"><span>📎</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px;">${escapeHtml(shortName)}</span></a>`;
          }).join("")}
          ${item.dataLink ? `<a href="${escapeHtml(item.dataLink)}" target="_blank" rel="noopener noreferrer" class="mgr-file-btn ref-btn"><span>🔗</span><span>ลิงก์แนบ</span></a>` : ""}
          <a href="${escapeHtml(folder)}" target="_blank" rel="noopener noreferrer" class="mgr-file-btn folder-btn"><span>📁</span><span>โฟลเดอร์ทั้งหมด</span></a>
        </div>
        ${!hasFile && !item.dataLink ? `<div class="mgr-file-warning">⚠️ ไม่พบไฟล์ — ตรวจสอบในโฟลเดอร์หรือติดต่อผู้เขียนแบบโดยตรง</div>` : ""}
      </div>

      <div class="admin-card-footer">
        <div class="admin-card-actions" style="width:100%;justify-content:flex-end;">
          <button class="secondary-button small-flow-button" data-mgr-action="toggle-reject" data-request="${escapeHtml(item.requestNo)}">↩️ ส่งกลับแก้ไข</button>
          <button class="primary-button small-flow-button" data-mgr-action="approve" data-request="${escapeHtml(item.requestNo)}">✅ อนุมัติ + ส่งมอบ</button>
        </div>
      </div>
      <div id="mgr-reject-box-${escapeHtml(item.requestNo)}" class="admin-action-box tone-warning" hidden>
        <div class="admin-action-label">⚠️ ระบุเหตุผลที่ส่งกลับ</div>
        <textarea id="mgr-reject-note-${escapeHtml(item.requestNo)}" rows="3" placeholder="เช่น แบบยังไม่ถูกต้อง..."></textarea>
        <div class="admin-action-buttons">
          <button class="secondary-button small-flow-button" data-mgr-action="close-reject" data-request="${escapeHtml(item.requestNo)}">ยกเลิก</button>
          <button class="danger-button small-flow-button" data-mgr-action="confirm-reject" data-request="${escapeHtml(item.requestNo)}">ยืนยันส่งกลับ</button>
        </div>
      </div>
    </article>
  `;
}

function bindMgrReviewEvents(view, state) {
  view._mgrReviewEvents?.abort();
  const controller = new AbortController();
  view._mgrReviewEvents = controller;
  const opts = { signal: controller.signal };

  view.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-mgr-action]");
    if (!btn) return;
    const requestNo = btn.dataset.request;
    const request   = state.requests.find((i) => i.requestNo === requestNo);
    if (!request) return;
    const action = btn.dataset.mgrAction;
    const safeId = cssEscape(requestNo);

    if (action === "toggle-reject") {
      const box = view.querySelector(`#mgr-reject-box-${safeId}`);
      if (box) box.hidden = !box.hidden;
      return;
    }
    if (action === "close-reject") {
      const box = view.querySelector(`#mgr-reject-box-${safeId}`);
      if (box) box.hidden = true;
      return;
    }
    if (action === "approve") {
      btn.disabled = true; btn.classList.add("is-loading");
      try {
        await mgrApproveDeliver(request);
        showToast(`ส่งมอบงาน ${requestNo} แล้ว`, "success");
        renderAdmin(view, state);
      } catch (err) {
        showToast(`เกิดข้อผิดพลาด: ${err.message}`, "error");
        btn.disabled = false; btn.classList.remove("is-loading");
      }
      return;
    }
    if (action === "confirm-reject") {
      const note   = view.querySelector(`#mgr-reject-note-${safeId}`);
      const reason = note?.value.trim();
      if (!reason) { showToast("กรุณาระบุเหตุผล", "warning"); return; }
      btn.disabled = true; btn.classList.add("is-loading");
      try {
        await mgrRejectWork(request, reason);
        showToast(`ส่งกลับแก้ไข ${requestNo} แล้ว`, "warning");
        renderAdmin(view, state);
      } catch (err) {
        showToast(`เกิดข้อผิดพลาด: ${err.message}`, "error");
        btn.disabled = false; btn.classList.remove("is-loading");
      }
    }
  }, opts);
}

// ══════════════════════════════════════════════════════════════
// JUMP BAR
// ══════════════════════════════════════════════════════════════

function jumpButton(targetId, label, count, primary = false, buttonId = "", countId = "") {
  const hasItems = count > 0;
  const base  = "display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 16px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .15s ease;";
  const style = hasItems
    ? base + "border:1.5px solid #005DAC;background:rgba(0,93,172,0.08);color:#005DAC;"
    : base + "border:1.5px solid #d0d7de;background:#fff;color:#888;";
  const countBg  = hasItems ? "background:#005DAC;color:#fff;" : "background:#f1f3f5;color:#666;";
  const countSt  = `display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 7px;border-radius:999px;font-size:13px;font-weight:800;${countBg}`;
  const idAttr   = buttonId ? ` id="${buttonId}"` : "";
  return `
    <button class="admin-jump-button" data-jump-to="${targetId}" type="button" style="${style}"${idAttr}>
      <span>${label}</span>
      <span style="${countSt}"${countId ? ` id="${countId}"` : ""}>${count}</span>
    </button>
  `;
}

function bindJumpBarEvents(view, state) {
  view.querySelectorAll("[data-jump-to]").forEach((btn) => {
    const targetId = btn.dataset.jumpTo;
    if (activeAdminSection === targetId) btn.style.boxShadow = "0 0 0 2px rgba(0,93,172,0.5) inset";
    btn.addEventListener("click", () => {
      activeAdminSection = activeAdminSection === targetId ? "all" : targetId;
      renderManagerAdmin(view, state);
      view.querySelector(".admin-section-block:not([hidden])")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    btn.addEventListener("mouseenter", () => { btn.style.transform = "translateY(-1px)"; });
    btn.addEventListener("mouseleave", () => { btn.style.transform = "translateY(0)"; });
  });
}

function sectionHidden(sectionId) {
  return activeAdminSection !== "all" && activeAdminSection !== sectionId ? "hidden" : "";
}

// ══════════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════════

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "DW";
}

function cssEscape(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}
