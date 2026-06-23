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
} from "../services/request-service.js";
import { getDrawingTeamMembers } from "../services/team-service.js";
import { escapeHtml, formatDate } from "../utils.js";

let adminFilter = "all";
let adminSearchQuery = "";
let selectedPickupIds = new Set();
let activeAdminSection = "all"; // "all" | "pickup-section" | "approve-section" | "mgr-review-section"

export function renderAdmin(view, state) {
  const isManager = state.user?.role === "manager";
  selectedPickupIds.clear();

  if (isManager) {
    renderManagerAdmin(view, state);
  } else {
    renderDesignerPickup(view, state);
  }
}

function applyTypeFilter(items) {
  if (adminFilter === "all") return items;
  return items.filter((item) => {
    const type = (item.requestType || "").toLowerCase();
    if (adminFilter === "proposal") return type.includes("proposal");
    if (adminFilter === "construction") return type.includes("ก่อสร้าง") && !type.includes("as-built");
    if (adminFilter === "permit") return type.includes("ขออนุญาต");
    if (adminFilter === "asbuilt") return type.includes("as-built");
    if (adminFilter === "revision") return type.includes("revision") || item.isRevision;
    return true;
  });
}

function applySearchFilter(items) {
  const query = adminSearchQuery.toLowerCase().trim();
  if (!query) return items;
  return items.filter((item) =>
    [item.requestNo, item.projectName, item.requesterName, item.requesterEmail, item.assignedToName, item.department]
      .some((value) => String(value || "").toLowerCase().includes(query))
  );
}

function typeFilterButton(key, label) {
  return `<button class="filter-button ${adminFilter === key ? "is-active" : ""}" data-admin-filter="${key}" type="button">${label}</button>`;
}

// ══════════════════════════════════════════════════════════════
// DESIGNER VIEW — "รับงาน" เลือกหลายรายการพร้อมกัน
// ══════════════════════════════════════════════════════════════

function renderDesignerPickup(view, state) {
  const pendingItems = applySearchFilter(applyTypeFilter(state.requests.filter((item) => item.status === STATUS.PENDING)));

  view.innerHTML = `
    <section class="content-section admin-page">
      <div class="section-header">
        <div>
          <h2>รับงานและอนุมัติ</h2>
          <p>เลือกงานที่ต้องการรับผิดชอบ งานจะถูกส่งต่อให้ผู้จัดการอนุมัติ</p>
        </div>
      </div>

      <button id="pickup-bulk-button" class="primary-button pickup-bulk-button" type="button" disabled>
        รับงาน <span class="pickup-bulk-count">0</span>
      </button>

      ${renderPickupTableSection(pendingItems, "รอฝ่ายแบบรับงาน")}
    </section>
  `;

  bindPickupEvents(view, state);
}

// ══════════════════════════════════════════════════════════════
// MANAGER VIEW — รวม 3 ส่วน: รับงาน / อนุมัติเริ่มงาน / ตรวจสอบ+ส่งมอบงาน
// ══════════════════════════════════════════════════════════════

function renderManagerAdmin(view, state) {
  const pendingItems = applySearchFilter(applyTypeFilter(state.requests.filter((item) => item.status === STATUS.PENDING)));
  const approveItems = applySearchFilter(applyTypeFilter(state.requests.filter((item) => item.status === STATUS.INPROGRESS_LV1)));
  const mgrReviewItems = state.requests.filter((item) => item.status === STATUS.MGR_REVIEW);

  view.innerHTML = `
    <section class="content-section admin-page">
      <div class="section-header">
        <div>
          <h2>รับงานและอนุมัติ</h2>
          <p>สิทธิ์: ผู้จัดการ Lv.2 — รับงาน, อนุมัติเริ่มงาน, ตรวจสอบและส่งมอบงาน</p>
        </div>
      </div>

      <div class="admin-jump-row" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:4px 0 20px;padding-bottom:18px;border-bottom:1px solid #e2e8f0;">
        ${jumpButton("pickup-section", "📥 รับงาน", pendingItems.length, true, "pickup-bulk-button", "pickup-bulk-count")}
        ${jumpButton("approve-section", "✅ อนุมัติเริ่มงาน", approveItems.length)}
        ${jumpButton("mgr-review-section", "🔍 ตรวจสอบและส่งมอบงาน", mgrReviewItems.length)}
      </div>

      <div class="admin-toolbar">
        <div class="filter-row">
          ${typeFilterButton("all", "ทั้งหมด")}
          ${typeFilterButton("proposal", "📋 Proposal")}
          ${typeFilterButton("construction", "🏗️ ก่อสร้าง")}
          ${typeFilterButton("permit", "🏛️ ขออนุญาต")}
          ${typeFilterButton("asbuilt", "🏁 As-Built")}
          ${typeFilterButton("revision", "✏️ Revision")}
        </div>
        <input id="admin-search" class="search-input" type="search" placeholder="🔍 ค้นหาเลขคำร้อง โครงการ ชื่อ..." value="${escapeHtml(adminSearchQuery)}" />
      </div>

      <div class="admin-section-block" id="pickup-section" ${sectionHidden("pickup-section")}>
        <div class="admin-section-heading">📥 รับงาน — ติ๊กเลือกแล้วกดปุ่ม "รับงาน" ด้านบนเพื่อรับพร้อมกัน</div>
        ${renderPickupTableSection(pendingItems, "รอฝ่ายแบบรับงาน")}
      </div>

      <div class="admin-section-block" id="approve-section" ${sectionHidden("approve-section")}>
        <div class="admin-section-heading">✅ อนุมัติเริ่มงาน <span class="admin-section-count">${approveItems.length}</span></div>
        <div id="admin-list" class="admin-list">
          ${approveItems.length
            ? approveItems.map((item) => renderApprovalCard(item)).join("")
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
    </section>
  `;

  bindPickupEvents(view, state);
  bindApprovalEvents(view, state);
  bindMgrReviewEvents(view, state);
  bindJumpBarEvents(view, state);
}

function jumpButton(targetId, label, count, primary = false, buttonId = "", countId = "") {
  const hasItems = count > 0;
  const baseStyle = "display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 16px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .15s ease;";
  // ทุกปุ่มสไตล์เดียวกัน — outline สีน้ำเงิน ถ้ามีรายการจะเข้มขึ้น
  const style = hasItems
    ? baseStyle + "border:1.5px solid #005DAC;background:rgba(0,93,172,0.08);color:#005DAC;"
    : baseStyle + "border:1.5px solid #d0d7de;background:#fff;color:#888;";
  const countBg = hasItems
    ? "background:#005DAC;color:#fff;"
    : "background:#f1f3f5;color:#666;";
  const countStyle = `display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 7px;border-radius:999px;font-size:13px;font-weight:800;${countBg}`;
  const idAttr = buttonId ? ` id="${buttonId}"` : "";
  return `
    <button class="admin-jump-button" data-jump-to="${targetId}" type="button" style="${style}"${idAttr}>
      <span>${label}</span>
      <span style="${countStyle}"${countId ? ` id="${countId}"` : ""}>${count}</span>
    </button>
  `;
}

function bindJumpBarEvents(view, state) {
  view.querySelectorAll("[data-jump-to]").forEach((button) => {
    const targetId = button.dataset.jumpTo;
    // ไฮไลต์ปุ่มที่กำลังเลือกอยู่ ด้วยเส้นขอบหนาขึ้นเพื่อบอกสถานะ active
    if (activeAdminSection === targetId) {
      button.style.boxShadow = "0 0 0 2px rgba(0,93,172,0.5) inset";
    }
    button.addEventListener("click", () => {
      // กดปุ่มเดิมซ้ำ → กลับไปแสดงทุก section เหมือนเดิม (toggle)
      activeAdminSection = activeAdminSection === targetId ? "all" : targetId;
      renderManagerAdmin(view, state);
      const firstVisible = view.querySelector(".admin-section-block:not([hidden])");
      firstVisible?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    button.addEventListener("mouseenter", () => { button.style.transform = "translateY(-1px)"; });
    button.addEventListener("mouseleave", () => { button.style.transform = "translateY(0)"; });
  });
}

function sectionHidden(sectionId) {
  return activeAdminSection !== "all" && activeAdminSection !== sectionId ? "hidden" : "";
}

// ══════════════════════════════════════════════════════════════
// PICKUP TABLE — ใช้ร่วมกันทั้ง designer และ manager
// ══════════════════════════════════════════════════════════════

function renderPickupTableSection(items, heading) {
  return `
    <div class="pickup-section">
      <div class="pickup-section-heading">${escapeHtml(heading)} <span class="pickup-section-count">${items.length} รายการ</span></div>
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
              <th>ดำเนินการ</th>
            </tr>
          </thead>
          <tbody>
            ${items.length ? items.map(pickupRow).join("") : `<tr><td colspan="7" class="track-empty">ไม่มีงานรอรับ</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function pickupRow(item) {
  const due = pickupDueLabel(item.dueDate);
  return `
    <tr>
      <td><input type="checkbox" class="pickup-checkbox" data-pickup-id="${escapeHtml(item.requestNo)}" /></td>
      <td><span class="due-chip ${due.className}">${escapeHtml(due.label)}</span></td>
      <td><strong>${escapeHtml(item.requestNo)}</strong><br><small>${escapeHtml(item.projectName || "—")}</small></td>
      <td><strong>${escapeHtml(item.drawingNo || "—")}</strong><br><small>${escapeHtml(item.drawingName || "")}</small></td>
      <td><span class="badge badge-pending">${escapeHtml(item.requestType || "—")}</span></td>
      <td>${escapeHtml(item.requesterName || "—")}</td>
      <td><button class="small-button" data-pickup-self="${escapeHtml(item.requestNo)}" type="button">รับเอง</button></td>
    </tr>
  `;
}

function pickupDueLabel(dueDate) {
  if (!dueDate) return { label: "-", className: "neutral" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate); due.setHours(0, 0, 0, 0);
  const diff = Math.round((due - today) / 86400000);
  if (diff < 0) return { label: `เกิน ${Math.abs(diff)} วัน`, className: "overdue" };
  if (diff === 0) return { label: "วันนี้", className: "today" };
  return { label: `เหลือ ${diff} วัน`, className: "soon" };
}

function bindPickupEvents(view, state) {
  view._pickupEvents?.abort();
  const controller = new AbortController();
  view._pickupEvents = controller;
  const opts = { signal: controller.signal };

  const bulkButton = view.querySelector("#pickup-bulk-button");
  const isManagerView = bulkButton?.hasAttribute("data-jump-to");

  const updateBulkButton = () => {
    const button = view.querySelector("#pickup-bulk-button");
    if (!button) return;
    const countSpan = button.querySelector(".pickup-bulk-count, #pickup-bulk-count");
    const labelSpan = button.querySelector("span:first-child");
    const count = selectedPickupIds.size;
    if (countSpan) countSpan.textContent = count;

    if (isManagerView) {
      // ปุ่มในแถบบน (jump bar) — สลับข้อความบอกสถานะว่าตอนนี้กดแล้วจะ "รับงานที่เลือก" หรือแค่ดูรายการ
      if (labelSpan) labelSpan.textContent = count > 0 ? "✅ รับงานที่เลือก" : "📥 รับงาน";
    } else {
      button.disabled = count === 0;
    }
  };

  view.querySelector("#pickup-select-all")?.addEventListener("change", (event) => {
    const checked = event.target.checked;
    view.querySelectorAll(".pickup-checkbox").forEach((checkbox) => {
      checkbox.checked = checked;
      if (checked) selectedPickupIds.add(checkbox.dataset.pickupId);
      else selectedPickupIds.delete(checkbox.dataset.pickupId);
    });
    updateBulkButton();
  }, opts);

  view.querySelectorAll(".pickup-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedPickupIds.add(checkbox.dataset.pickupId);
      else selectedPickupIds.delete(checkbox.dataset.pickupId);
      updateBulkButton();
    }, opts);
  });

  bulkButton?.addEventListener("click", async (event) => {
    const ids = [...selectedPickupIds];
    if (!ids.length) return; // ไม่มีอะไรเลือกไว้ — ปล่อยให้ bindJumpBarEvents จัดการ filter/scroll ตามปกติ
    event.stopImmediatePropagation(); // กันไม่ให้ jump-bar click handler ทำงานซ้อน (filter) ตอนกำลังจะรับงานจริง
    await pickupRequests(view, state, ids);
  }, opts);

  view.querySelectorAll("[data-pickup-self]").forEach((button) => {
    button.addEventListener("click", async () => {
      await pickupRequests(view, state, [button.dataset.pickupSelf]);
    }, opts);
  });
}

/**
 * รับงาน — designer/manager เลือกตัวเองเป็นผู้รับผิดชอบ
 * ใช้ approveLv1AndAssign (status -> inprogress_lv1) เหมือนกันทั้งสอง role
 * เพราะ "รับงาน" คือขั้นตอน Lv.1 มอบหมาย ไม่ใช่ Lv.2 อนุมัติเริ่มงาน (คนละขั้นตอนกัน)
 */
async function pickupRequests(view, state, requestNos) {
  const me = { name: state.user?.name || "", email: state.user?.email || "" };
  const button = view.querySelector("#pickup-bulk-button");
  if (button) { button.disabled = true; button.classList.add("is-loading"); }

  let successCount = 0;
  for (const requestNo of requestNos) {
    const request = state.requests.find((item) => item.requestNo === requestNo);
    if (!request) continue;
    try {
      await approveLv1AndAssign(request, me, "");
      successCount += 1;
    } catch (error) {
      showToast(`รับงาน ${requestNo} ไม่สำเร็จ: ${error.message}`, "error");
    }
  }

  if (successCount > 0) {
    showToast(`รับงานสำเร็จ ${successCount} รายการ — ส่งต่อให้ผู้จัดการอนุมัติแล้ว`, "success");
  }
  selectedPickupIds.clear();
  renderAdmin(view, state);
}

// ══════════════════════════════════════════════════════════════
// APPROVAL CARD — Lv.2 อนุมัติเริ่มงาน
// ══════════════════════════════════════════════════════════════

function renderApprovalCard(item) {
  const urgentClass = { "เร่งด่วน": "badge-urgent", "เร่งด่วนมาก": "badge-critical" };
  const statusBadge = `<span class="badge badge-${item.status}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span>`;

  const lv1InfoBlock = item.assignedToName ? `
    <div class="lv1-info-block">
      <div class="lv1-info-title">✅ รับงานแล้ว</div>
      <div class="lv1-info-grid">
        <div><span>ผู้รับผิดชอบ:</span> <b>${escapeHtml(item.assignedToName)}</b></div>
        <div><span>รับงานโดย:</span> ${escapeHtml(item.reviewerLv1 || "—")}</div>
        ${item.assignNote ? `<div class="span-full"><span>หมายเหตุ:</span> ${escapeHtml(item.assignNote)}</div>` : ""}
      </div>
    </div>` : "";

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

      ${lv1InfoBlock}

      ${item.description ? `<div class="admin-card-body">${escapeHtml(item.description)}</div>` : ""}

      <div class="admin-card-footer">
        <span class="admin-card-meta">👤 ${escapeHtml(item.requesterName || item.department || "—")}</span>
        <span class="admin-card-meta">📅 ${formatDate(item.submittedAt)}</span>
        ${item.dataLink ? `<a href="${escapeHtml(item.dataLink)}" target="_blank" rel="noopener noreferrer" class="secondary-button small-flow-button">🔗 ลิงก์แนบ</a>` : ""}

        <div class="admin-card-actions">
          <button class="secondary-button small-flow-button" data-admin-action="toggle-reject" data-request="${escapeHtml(item.requestNo)}">↩️ ส่งกลับ</button>
          <button class="secondary-button small-flow-button danger-button" data-admin-action="toggle-cancel" data-request="${escapeHtml(item.requestNo)}">❌ ยกเลิก</button>
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

  view.querySelector("#admin-search")?.addEventListener("input", (event) => {
    adminSearchQuery = event.target.value;
    renderAdmin(view, state);
  }, opts);

  view.addEventListener("click", async (event) => {
    const filterButton = event.target.closest("[data-admin-filter]");
    if (filterButton) {
      adminFilter = filterButton.dataset.adminFilter;
      renderAdmin(view, state);
      return;
    }

    const actionButton = event.target.closest("[data-admin-action]");
    if (!actionButton) return;
    const requestNo = actionButton.dataset.request;
    const request = state.requests.find((item) => item.requestNo === requestNo);
    if (!request) return;
    const action = actionButton.dataset.adminAction;

    if (action === "open-assign") {
      openAssignModal(view, state, request, actionButton.dataset.level);
      return;
    }

    if (action === "approve-lv2") {
      actionButton.disabled = true;
      actionButton.classList.add("is-loading");
      try {
        await approveLv2(request, "");
        showToast(`${request.requestNo} อนุมัติเริ่มงานแล้ว`, "success");
        renderAdmin(view, state);
      } catch (error) {
        showToast(`เกิดข้อผิดพลาด: ${error.message}`, "error");
        actionButton.disabled = false;
        actionButton.classList.remove("is-loading");
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
      return;
    }
  }, opts);
}

function toggleActionBox(view, requestNo, mode, isManager, hasLv1) {
  const box = view.querySelector(`#admin-action-box-${cssEscape(requestNo)}`);
  const label = view.querySelector(`#admin-action-label-${cssEscape(requestNo)}`);
  const note = view.querySelector(`#admin-action-note-${cssEscape(requestNo)}`);
  const confirmBtn = view.querySelector(`#admin-action-confirm-${cssEscape(requestNo)}`);
  if (!box) return;

  if (!box.hidden && box.dataset.mode === mode) {
    box.hidden = true;
    return;
  }

  box.dataset.mode = mode;
  box.hidden = false;
  note.value = "";

  if (mode === "reject") {
    const isBackToLv1 = isManager && hasLv1;
    label.innerHTML = isBackToLv1
      ? "↩️ <b>ส่งกลับ Lv.1</b> — ระบุเหตุผลให้ผู้รับผิดชอบแก้ไข"
      : "↩️ <b>ส่งกลับผู้ร้องขอ</b> — ระบุเหตุผล / สิ่งที่ต้องแก้ไข";
    box.classList.add("tone-warning");
    box.classList.remove("tone-danger");
    confirmBtn.textContent = isBackToLv1 ? "ยืนยันส่งกลับ Lv.1" : "ยืนยันส่งกลับผู้ร้องขอ";
    note.placeholder = isBackToLv1
      ? "ระบุสิ่งที่ต้องแก้ไข เช่น แบบไม่ตรงมาตรฐาน ขอให้ทบทวนใหม่..."
      : "ระบุเหตุผล เช่น ข้อมูลไม่ครบ โปรดแนบแบบเพิ่มเติม...";
  } else {
    label.innerHTML = "❌ <b>ยกเลิกคำร้อง</b> — ระบุเหตุผล";
    box.classList.add("tone-danger");
    box.classList.remove("tone-warning");
    confirmBtn.textContent = "ยืนยันยกเลิกคำร้อง";
    note.placeholder = "ระบุเหตุผลที่ยกเลิก...";
  }
  note.focus();
}

async function submitActionBox(view, state, request, isManager) {
  const requestNo = request.requestNo;
  const box = view.querySelector(`#admin-action-box-${cssEscape(requestNo)}`);
  const mode = box?.dataset.mode;
  const note = view.querySelector(`#admin-action-note-${cssEscape(requestNo)}`);
  const reason = note?.value.trim();
  if (!reason) {
    showToast("กรุณาระบุเหตุผล", "warning");
    return;
  }

  const confirmBtn = view.querySelector(`#admin-action-confirm-${cssEscape(requestNo)}`);
  confirmBtn.disabled = true;
  confirmBtn.classList.add("is-loading");

  try {
    if (mode === "cancel") {
      await adminCancel(request, reason);
      showToast(`ยกเลิกคำร้อง ${requestNo} แล้ว`, "warning");
    } else {
      const hasLv1 = Boolean(request.assignedToName);
      await adminReject(request, reason, { isManager, hasLv1 });
      const isBackToLv1 = isManager && hasLv1;
      showToast(
        isBackToLv1 ? `ส่งกลับ Lv.1 แล้ว — ${requestNo} กลับเป็นรอตรวจสอบ Lv.1` : `ส่งกลับผู้ร้องขอแล้ว — ${requestNo}`,
        "warning"
      );
    }
    renderAdmin(view, state);
  } catch (error) {
    showToast(`เกิดข้อผิดพลาด: ${error.message}`, "error");
    confirmBtn.disabled = false;
    confirmBtn.classList.remove("is-loading");
  }
}

// ══════════════════════════════════════════════════════════════
// ASSIGN MODAL — เลือกผู้รับผิดชอบ (กรณี Lv.2 อนุมัติเองโดยไม่มี Lv.1 มาก่อน)
// ══════════════════════════════════════════════════════════════

function openAssignModal(view, state, request, level) {
  const members = getDrawingTeamMembers();
  const isLv2 = level === "lv2";

  const body = `
    <div class="assign-work-panel">
      <div class="assign-work-summary">
        <span>${escapeHtml(request.requestNo)}</span>
        <strong>${escapeHtml(request.projectName || "-")}</strong>
        <small>${escapeHtml(request.drawingNo || "-")} · ${escapeHtml(request.drawingName || "-")}</small>
      </div>
      <p class="assign-work-label">เลือกพนักงานฝ่ายเขียนแบบ</p>
      <div class="assignee-choice-grid">
        ${members.map((member, index) => `
          <label class="assignee-choice">
            <input type="radio" name="assignMember" value="${index}" />
            <span class="assignee-avatar">${escapeHtml(initials(member.name || member.email))}</span>
            <span>
              <strong>${escapeHtml(member.name || member.email)}</strong>
              <small>${escapeHtml(member.role || member.email || "ฝ่ายเขียนแบบ")}</small>
            </span>
          </label>
        `).join("")}
      </div>
      <label class="field">
        <span>หมายเหตุถึงผู้รับงาน</span>
        <textarea id="assign-note-input" rows="2" placeholder="เช่น ลูกค้าต้องการงานภายใน 5 วันทำการ..."></textarea>
      </label>
    </div>
  `;

  openModal({
    title: isLv2 ? "อนุมัติ Lv.2 — ระบุผู้รับผิดชอบในแผนก" : "อนุมัติ Lv.1 — มอบหมายงานเบื้องต้น",
    body,
    actions: [
      { label: "ยกเลิก", className: "secondary-button" },
      {
        label: "✓ ยืนยันอนุมัติ + มอบหมายงาน",
        className: "primary-button",
        onClick: async (close) => {
          const selected = document.querySelector('input[name="assignMember"]:checked');
          if (!selected) {
            showToast("กรุณาเลือกผู้รับผิดชอบก่อน", "warning");
            return;
          }
          const member = members[Number(selected.value)];
          const note = document.querySelector("#assign-note-input")?.value.trim() || "";

          try {
            if (isLv2) {
              await approveLv2AndAssign(request, member, note);
              showToast(`อนุมัติ Lv.2 แล้ว — มอบหมายให้ ${member.name}`, "success");
            } else {
              await approveLv1AndAssign(request, member, note);
              showToast(`อนุมัติ Lv.1 แล้ว — มอบหมายให้ ${member.name} (รอ LV.2 ผู้จัดการอนุมัติ)`, "success");
            }
            close();
            renderAdmin(view, state);
          } catch (error) {
            showToast(`เกิดข้อผิดพลาด: ${error.message}`, "error");
          }
        },
      },
    ],
  });
}

// ══════════════════════════════════════════════════════════════
// MGR REVIEW — ตรวจสอบและส่งมอบงาน (ย้ายมาจากหน้าติดตามงาน)
// ══════════════════════════════════════════════════════════════

/**
 * สร้าง URL ตรงไปยังโฟลเดอร์ของคำร้องบน SharePoint
 * เช่น DWG-BEM-2569-0018 → https://primepowertl.sharepoint.com/sites/DrawingDepartment/Shared%20Documents/DrawingRequests/DWG-BEM-2569-0018
 */
function getRequestFolderUrl(requestNo) {
  const sp = appConfig.sharePoint;
  const match = String(requestNo || "").match(/^(.*)-(Rev\.\d+)$/);
  const baseNo = match ? match[1] : requestNo;
  const revSeg = match ? `/${match[2]}` : "";
  const folderPath = `${sp.uploadFolder}/${baseNo}${revSeg}`;
  // SharePoint "Shared Documents" = driveName ภาษาอังกฤษ
  return `https://${sp.hostname}${sp.sitePath}/Shared%20Documents/${folderPath.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * แยก noteFromDrawing ออกเป็น { note, otherFiles }
 * รูปแบบที่เก็บ: "<หมายเหตุ>|||[{"name":"...","url":"..."}]"
 */
function parseNoteAndFiles(raw = "") {
  const sep = raw.indexOf("|||");
  if (sep === -1) return { note: raw, otherFiles: [] };
  const notePart = raw.slice(0, sep).trim();
  const jsonPart = raw.slice(sep + 3).trim();
  try {
    const otherFiles = JSON.parse(jsonPart);
    return { note: notePart, otherFiles: Array.isArray(otherFiles) ? otherFiles : [] };
  } catch {
    return { note: raw, otherFiles: [] };
  }
}

function renderMgrReviewCard(item) {
  const { note, otherFiles } = parseNoteAndFiles(item.noteFromDrawing || "");
  const hasDrawingFile = item.dwgFileUrl || item.pdfFileUrl || otherFiles.length;
  const hasRefLink = item.dataLink;

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
          ${item.description ? `<div class="span-full"><span>รายละเอียดคำขอ:</span> ${escapeHtml(item.description)}</div>` : ""}
          ${note ? `<div class="span-full mgr-note-from-drawing"><span>📝 หมายเหตุจากผู้เขียนแบบ:</span> <b>${escapeHtml(note)}</b></div>` : ""}
        </div>
      </div>

      <!-- ไฟล์งานที่ส่งมาให้ตรวจสอบ -->
      <div class="mgr-file-review-block">
        <div class="mgr-file-review-label">📎 ไฟล์งานที่ส่งมาตรวจสอบ</div>
        <div class="mgr-file-review-links">
          ${item.dwgFileUrl
            ? `<a href="${escapeHtml(item.dwgFileUrl)}" target="_blank" rel="noopener noreferrer" class="mgr-file-btn dwg-btn">
                <span class="mgr-file-icon">📐</span><span>เปิดไฟล์ DWG</span>
              </a>`
            : `<span class="mgr-file-missing">— ไม่มีไฟล์ DWG</span>`}
          ${item.pdfFileUrl
            ? `<a href="${escapeHtml(item.pdfFileUrl)}" target="_blank" rel="noopener noreferrer" class="mgr-file-btn pdf-btn">
                <span class="mgr-file-icon">📄</span><span>เปิดไฟล์ PDF</span>
              </a>`
            : `<span class="mgr-file-missing">— ไม่มีไฟล์ PDF</span>`}
          ${otherFiles.map((f) => `
            <a href="${escapeHtml(f.url)}" target="_blank" rel="noopener noreferrer" class="mgr-file-btn other-btn">
              <span class="mgr-file-icon">📎</span><span>${escapeHtml(f.name)}</span>
            </a>`).join("")}
          ${item.dataLink
            ? `<a href="${escapeHtml(item.dataLink)}" target="_blank" rel="noopener noreferrer" class="mgr-file-btn ref-btn">
                <span class="mgr-file-icon">🔗</span><span>ลิงก์ข้อมูลอ้างอิง</span>
              </a>`
            : ""}
          <a href="${escapeHtml(getRequestFolderUrl(item.requestNo))}" target="_blank" rel="noopener noreferrer" class="mgr-file-btn folder-btn">
            <span class="mgr-file-icon">📁</span><span>เปิดโฟลเดอร์ทั้งหมด</span>
          </a>
        </div>
        ${!hasDrawingFile && !hasRefLink
          ? `<div class="mgr-file-warning">⚠️ ไม่พบไฟล์ DWG/PDF ที่ระบุ — กรุณาตรวจสอบในโฟลเดอร์ด้านบน หรือติดต่อผู้เขียนแบบโดยตรง</div>`
          : ""}
      </div>

      <div class="admin-card-footer">
        <div class="admin-card-actions" style="width:100%;justify-content:flex-end;">
          <button class="secondary-button small-flow-button" data-mgr-action="toggle-reject" data-request="${escapeHtml(item.requestNo)}">↩️ ส่งกลับแก้ไข</button>
          <button class="primary-button small-flow-button" data-mgr-action="approve" data-request="${escapeHtml(item.requestNo)}">✅ อนุมัติ + ส่งมอบ</button>
        </div>
      </div>
      <div id="mgr-reject-box-${escapeHtml(item.requestNo)}" class="admin-action-box tone-warning" hidden>
        <div class="admin-action-label">⚠️ ระบุเหตุผลที่ส่งกลับ</div>
        <textarea id="mgr-reject-note-${escapeHtml(item.requestNo)}" rows="3" placeholder="เช่น แบบยังไม่ถูกต้องตามมาตรฐาน..."></textarea>
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

  view.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-mgr-action]");
    if (!button) return;
    const requestNo = button.dataset.request;
    const request = state.requests.find((item) => item.requestNo === requestNo);
    if (!request) return;
    const action = button.dataset.mgrAction;
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
      button.disabled = true;
      button.classList.add("is-loading");
      try {
        await mgrApproveDeliver(request);
        showToast(`ส่งมอบงาน ${requestNo} แล้ว — แจ้ง Teams + Email ผู้ร้องขอเรียบร้อย`, "success");
        renderAdmin(view, state);
      } catch (error) {
        showToast(`เกิดข้อผิดพลาด: ${error.message}`, "error");
        button.disabled = false;
        button.classList.remove("is-loading");
      }
      return;
    }
    if (action === "confirm-reject") {
      const note = view.querySelector(`#mgr-reject-note-${safeId}`);
      const reason = note?.value.trim();
      if (!reason) {
        showToast("กรุณาระบุเหตุผลที่ส่งกลับ", "warning");
        return;
      }
      button.disabled = true;
      button.classList.add("is-loading");
      try {
        await mgrRejectWork(request, reason);
        showToast(`ส่งกลับแก้ไข ${requestNo} แล้ว — แจ้ง Teams ผู้เขียนแบบเรียบร้อย`, "warning");
        renderAdmin(view, state);
      } catch (error) {
        showToast(`เกิดข้อผิดพลาด: ${error.message}`, "error");
        button.disabled = false;
        button.classList.remove("is-loading");
      }
    }
  }, opts);
}

// ══════════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════════

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.slice(0, 1)).join("").toUpperCase() || "DW";
}

function cssEscape(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}
