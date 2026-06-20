import { STATUS, STATUS_LABELS } from "../../../config/schema.js";
import { openModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import {
  adminCancel,
  adminReject,
  approveLv1AndAssign,
  approveLv2,
  approveLv2AndAssign,
} from "../services/request-service.js";
import { getDrawingTeamMembers } from "../services/team-service.js";
import { escapeHtml, formatDate } from "../utils.js";

let adminFilter = "all";
let adminSearchQuery = "";

export function renderAdmin(view, state) {
  const isManager = state.user?.role === "manager";

  // ── รายการรออนุมัติตาม role ──
  // Lv.2 (manager) เห็นทุก status ที่ยังรออนุมัติ รวม pending ที่ยังไม่มีใครรับ (เพื่อรับเองได้)
  // Lv.1 (designer) เห็นเฉพาะ pending
  const approvalItems = isManager
    ? state.requests.filter((item) => [STATUS.PENDING, STATUS.INPROGRESS_LV1].includes(item.status))
    : state.requests.filter((item) => item.status === STATUS.PENDING);

  const filtered = applySearchFilter(applyTypeFilter(approvalItems));

  view.innerHTML = `
    <section class="content-section admin-page">
      <div class="section-header">
        <div>
          <h2>หน้าอนุมัติคำร้อง</h2>
          <p>${isManager ? "สิทธิ์: ผู้อนุมัติ Lv.2 — รายการรอ LV.2 ตรวจสอบ" : "สิทธิ์: ผู้ตรวจสอบ Lv.1 — รายการรอตรวจสอบ"}</p>
        </div>
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

      <div id="admin-list" class="admin-list">
        ${filtered.length
          ? filtered.map((item) => renderApprovalCard(item, isManager)).join("")
          : `<div class="empty-state">📭 ไม่มีรายการรออนุมัติ</div>`}
      </div>
    </section>
  `;

  bindAdminEvents(view, state, isManager);
}

function typeFilterButton(key, label) {
  return `<button class="filter-button ${adminFilter === key ? "is-active" : ""}" data-admin-filter="${key}" type="button">${label}</button>`;
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

// ══════════════════════════════════════════════════════════════
// CARD RENDERING
// ══════════════════════════════════════════════════════════════

function renderApprovalCard(item, isManager) {
  const urgentClass = { "เร่งด่วน": "badge-urgent", "เร่งด่วนมาก": "badge-critical" };
  const statusBadge = `<span class="badge badge-${item.status}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span>`;

  const lv1InfoBlock = (isManager && item.assignedToName) ? `
    <div class="lv1-info-block">
      <div class="lv1-info-title">✅ Lv.1 มอบหมายแล้ว</div>
      <div class="lv1-info-grid">
        <div><span>ผู้รับผิดชอบ:</span> <b>${escapeHtml(item.assignedToName)}</b></div>
        <div><span>อนุมัติ Lv.1 โดย:</span> ${escapeHtml(item.reviewerLv1 || "—")}</div>
        ${item.assignNote ? `<div class="span-full"><span>หมายเหตุ Lv.1:</span> ${escapeHtml(item.assignNote)}</div>` : ""}
      </div>
    </div>` : "";

  const safeProject = escapeHtml(item.projectName || item.requestNo || "");
  const approveBtn = isManager
    ? item.assignedToName
      ? `<button class="primary-button small-flow-button" data-admin-action="approve-lv2" data-request="${escapeHtml(item.requestNo)}">✅ อนุมัติ Lv.2</button>`
      : `<button class="primary-button small-flow-button" data-admin-action="open-assign" data-request="${escapeHtml(item.requestNo)}" data-level="lv2">✅ อนุมัติ Lv.2 + มอบหมาย</button>`
    : `<button class="primary-button small-flow-button" data-admin-action="open-assign" data-request="${escapeHtml(item.requestNo)}" data-level="lv1">✅ อนุมัติ Lv.1 + มอบหมาย</button>`;

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
          ${approveBtn}
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

// ══════════════════════════════════════════════════════════════
// EVENT BINDING
// ══════════════════════════════════════════════════════════════

function bindAdminEvents(view, state, isManager) {
  view._adminEvents?.abort();
  const controller = new AbortController();
  view._adminEvents = controller;
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
        showToast(`${request.requestNo} อนุมัติ Lv.2 แล้ว (ตรวจสอบแล้ว กำลังดำเนินการ)`, "success");
        renderAdmin(view, state);
      } catch (error) {
        showToast(`เกิดข้อผิดพลาด: ${error.message}`, "error");
        actionButton.disabled = false;
        actionButton.classList.remove("is-loading");
      }
      return;
    }

    if (action === "toggle-reject" || action === "toggle-cancel") {
      toggleActionBox(view, requestNo, action === "toggle-reject" ? "reject" : "cancel", isManager, Boolean(request.assignedToName));
      return;
    }

    if (action === "close-box") {
      const box = view.querySelector(`#admin-action-box-${cssEscape(requestNo)}`);
      if (box) box.hidden = true;
      return;
    }

    if (action === "confirm-box") {
      await submitActionBox(view, state, request, isManager);
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

  // toggle ปิดถ้าเปิดอยู่ mode เดิม
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
// ASSIGN MODAL — Lv.1 เสมอต้องเลือก / Lv.2 เลือกเฉพาะกรณีไม่มี Lv.1 มาก่อน
// ══════════════════════════════════════════════════════════════

function openAssignModal(view, state, request, level) {
  const members = getDrawingTeamMembers();
  const isLv2 = level === "lv2";

  let selectedMember = null;

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

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.slice(0, 1)).join("").toUpperCase() || "DW";
}

function cssEscape(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}
