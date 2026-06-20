import { STATUS, STATUS_LABELS, CLOSED_STATUSES } from "../../../config/schema.js";
import { openModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import {
  requesterReview,
  submitSendwork,
  updateWorkStatus,
} from "../services/request-service.js";
import { getAuditHistory } from "../services/audit-service.js";
import { assigneeName } from "../services/team-service.js";
import { escapeHtml, formatDate, formatDateOnly } from "../utils.js";

const WORK_STATUS_OPTIONS = [
  { value: STATUS.APPROVED, label: "🔵 กำลังดำเนินการ" },
  { value: STATUS.WORKING, label: "⚙️ กำลังดำเนินการ (อัปเดต)" },
];

// แท็บกลุ่มหลัก: งานของฉัน / งานในฝ่าย (เฉพาะ designer/manager ที่เห็นแท็บหลังได้)
let scopeTab = "mine";
// แท็บย่อยในแต่ละกลุ่ม: งานปัจจุบัน / เสร็จสิ้น / ยกเลิก / ทั้งหมด
let statusTab = "current";
let searchQuery = "";
let projectFilter = "";

export function renderTrack(view, state) {
  const role = state.user?.role;
  if (role === "manager" || role === "designer") {
    renderWorkbookTrack(view, state);
  } else if (role === "requester") {
    renderRequesterTrack(view, state);
  } else {
    renderPublicTrack(view, state);
  }
}

// ══════════════════════════════════════════════════════════════
// WORKBOOK VIEW (designer + manager) — งานของฉัน / งานในฝ่าย
// mgr_review (ตรวจสอบ+ส่งมอบ) ย้ายไปอยู่หน้า "รับงาน/อนุมัติ" แล้ว ไม่อยู่หน้านี้
// ══════════════════════════════════════════════════════════════

function getMyEmail(state) {
  return String(state.user?.email || "").toLowerCase();
}

function isMine(item, state) {
  return String(item.assignedToEmail || "").toLowerCase() === getMyEmail(state);
}

function filterByStatusTab(items) {
  if (statusTab === "current") return items.filter((item) => !CLOSED_STATUSES.includes(item.status));
  if (statusTab === "done") return items.filter((item) => item.status === STATUS.DONE);
  if (statusTab === "cancelled") return items.filter((item) => [STATUS.CANCELLED, STATUS.REJECTED].includes(item.status));
  return items; // ทั้งหมด
}

function filterBySearch(items) {
  const query = searchQuery.toLowerCase().trim();
  if (!query) return items;
  return items.filter((item) =>
    [item.requestNo, item.projectName, item.drawingNo, item.drawingName]
      .some((value) => String(value || "").toLowerCase().includes(query))
  );
}

function filterByProject(items) {
  if (!projectFilter) return items;
  return items.filter((item) => item.projectName === projectFilter);
}

function renderWorkbookTrack(view, state) {
  const myAll = state.requests.filter((item) => isMine(item, state));
  const deptAll = state.requests; // งานในฝ่าย = มองเห็นคำร้องทั้งหมดในระบบ

  const baseList = scopeTab === "mine" ? myAll : deptAll;
  const projectOptions = [...new Set(state.requests.map((item) => item.projectName).filter(Boolean))].sort();

  let rows = filterByStatusTab(baseList);
  rows = filterByProject(rows);
  rows = filterBySearch(rows);
  rows = [...rows].sort((a, b) => new Date(a.dueDate || "9999-12-31") - new Date(b.dueDate || "9999-12-31"));

  const currentCount = baseList.filter((item) => !CLOSED_STATUSES.includes(item.status)).length;

  view.innerHTML = `
    <section class="content-section track-workbook">
      <div class="section-header">
        <h2>ติดตามงาน <span class="requester-result-count">งานปัจจุบัน ${currentCount} รายการ</span></h2>
      </div>

      <div class="track-filter-bar">
        <label class="track-search-field">
          <span>ค้นหางาน</span>
          <input id="track-search-input" type="search" placeholder="ค้นหาเลขที่คำร้อง โครงการ หรือ Drawing..." value="${escapeHtml(searchQuery)}" />
        </label>
        <label class="track-select-filter">
          <span>โครงการ</span>
          <select id="track-project-filter">
            <option value="">ทุกโครงการ</option>
            ${projectOptions.map((name) => `<option value="${escapeHtml(name)}" ${projectFilter === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
          </select>
        </label>
        <button id="track-clear-filters" class="secondary-button" type="button">ล้าง</button>
      </div>

      <div class="track-tab-groups">
        <div class="track-tab-group">
          <div class="track-tab-group-label">งานของฉัน</div>
          <div class="track-tab-row">
            ${scopeStatusTabButton("mine", "current", "งานปัจจุบัน")}
            ${scopeStatusTabButton("mine", "done", "เสร็จสิ้น")}
            ${scopeStatusTabButton("mine", "cancelled", "ยกเลิก")}
            ${scopeStatusTabButton("mine", "all", "ทั้งหมด")}
          </div>
        </div>
        <div class="track-tab-group track-tab-group-dept">
          <div class="track-tab-group-label">งานในฝ่าย</div>
          <div class="track-tab-row">
            ${scopeStatusTabButton("department", "current", "งานปัจจุบัน")}
            ${scopeStatusTabButton("department", "done", "เสร็จสิ้น")}
            ${scopeStatusTabButton("department", "cancelled", "ยกเลิก")}
            ${scopeStatusTabButton("department", "all", "ทั้งหมด")}
          </div>
        </div>
      </div>

      <div class="track-table-wrap">
        <table class="track-sheet">
          <thead>
            <tr>
              <th>เหลือ/เกินกำหนด</th>
              <th>เลขที่คำร้อง</th>
              <th>โครงการ</th>
              <th>DRAWING</th>
              <th>กำหนดส่ง</th>
              <th>ลิงก์เก็บไฟล์</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((item) => renderWorkbookRow(item, state)).join("") : `<tr><td colspan="7" class="track-empty">ไม่พบงานในหมวดนี้</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;

  bindWorkbookEvents(view, state);
}

function scopeStatusTabButton(scope, status, label) {
  const isActive = scopeTab === scope && statusTab === status;
  return `<button class="filter-button ${isActive ? "is-active" : ""}" data-scope="${scope}" data-status-tab="${status}" type="button">${label}</button>`;
}

function renderWorkbookRow(item, state) {
  const due = dueSummary(item.dueDate, item.status);
  const mine = isMine(item, state);
  // ผู้รับงานแก้สถานะได้เองทุกเมื่อ จนกว่าจะกด "นำส่งงาน" (เปลี่ยนเป็น mgr_review แล้วแก้ไม่ได้อีก)
  const canEditStatus = mine && [STATUS.APPROVED, STATUS.WORKING].includes(item.status);
  const canSend = mine && [STATUS.APPROVED, STATUS.WORKING, STATUS.MGR_REJECTED].includes(item.status);
  const fileLink = item.dwgFileUrl || item.pdfFileUrl || item.dataLink;

  return `
    <tr>
      <td><span class="due-chip ${due.className}">${escapeHtml(due.label)}</span></td>
      <td><button class="track-request-link" data-request-detail="${escapeHtml(item.requestNo)}" type="button">${escapeHtml(item.requestNo)}</button></td>
      <td><strong>${escapeHtml(item.projectName || "—")}</strong></td>
      <td><strong>${escapeHtml(item.drawingNo || "—")}</strong><br><small>${escapeHtml(item.drawingName || "")}</small></td>
      <td>${formatDateOnly(item.dueDate)}</td>
      <td>${fileLink ? `<a class="track-file-link" href="${escapeHtml(fileLink)}" target="_blank" rel="noopener noreferrer">เปิดไฟล์</a>` : `<span class="track-no-file">—</span>`}</td>
      <td class="track-status-cell">
        ${canEditStatus ? `
          <select class="track-status-select" data-designer-status="${escapeHtml(item.requestNo)}">
            ${WORK_STATUS_OPTIONS.map((opt) => `<option value="${opt.value}" ${item.status === opt.value ? "selected" : ""}>${opt.label}</option>`).join("")}
          </select>
        ` : `<span class="badge badge-${item.status}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span>`}
        ${canSend ? `<button class="small-button" data-sendwork-open="${escapeHtml(item.requestNo)}" type="button">📤 ส่งงาน</button>` : ""}
      </td>
    </tr>
  `;
}

function bindWorkbookEvents(view, state) {
  view._workbookEvents?.abort();
  const controller = new AbortController();
  view._workbookEvents = controller;
  const opts = { signal: controller.signal };

  view.querySelector("#track-search-input")?.addEventListener("input", (event) => {
    searchQuery = event.target.value;
    renderWorkbookTrack(view, state);
  }, opts);

  view.querySelector("#track-project-filter")?.addEventListener("change", (event) => {
    projectFilter = event.target.value;
    renderWorkbookTrack(view, state);
  }, opts);

  view.querySelector("#track-clear-filters")?.addEventListener("click", () => {
    searchQuery = "";
    projectFilter = "";
    renderWorkbookTrack(view, state);
  }, opts);

  view.addEventListener("click", (event) => {
    const tabButton = event.target.closest("[data-status-tab]");
    if (tabButton) {
      scopeTab = tabButton.dataset.scope;
      statusTab = tabButton.dataset.statusTab;
      renderWorkbookTrack(view, state);
      return;
    }

    const detailButton = event.target.closest("[data-request-detail]");
    if (detailButton) {
      const request = state.requests.find((item) => item.requestNo === detailButton.dataset.requestDetail);
      if (request) openRequestDetail(request);
      return;
    }

    const sendworkButton = event.target.closest("[data-sendwork-open]");
    if (sendworkButton) {
      const request = state.requests.find((item) => item.requestNo === sendworkButton.dataset.sendworkOpen);
      if (request) openSendworkModal(view, state, request);
    }
  }, opts);

  view.addEventListener("change", async (event) => {
    const select = event.target.closest("[data-designer-status]");
    if (!select) return;
    const requestNo = select.dataset.designerStatus;
    const request = state.requests.find((item) => item.requestNo === requestNo);
    if (!request) return;
    try {
      await updateWorkStatus(request, select.value);
      showToast(`อัปเดตสถานะ ${requestNo} แล้ว`, "success");
    } catch (error) {
      showToast(`อัปเดตไม่สำเร็จ: ${error.message}`, "error");
    }
  }, opts);
}

// ══════════════════════════════════════════════════════════════
// SENDWORK MODAL — ส่งงานคืน → mgr_review (รอผู้จัดการตรวจที่หน้า "รับงาน/อนุมัติ")
// ══════════════════════════════════════════════════════════════

function openSendworkModal(view, state, request) {
  let pendingFiles = [];

  const body = `
    <form id="sendwork-form" class="delivery-form">
      <div class="delivery-summary">
        <span>${escapeHtml(request.requestNo)}</span>
        <strong>${escapeHtml(request.projectName || "-")}</strong>
        <small>${escapeHtml(request.drawingNo || "-")} · ${escapeHtml(request.drawingName || "-")}</small>
      </div>
      <label class="field">
        <span>Revise ที่ส่ง</span>
        <input name="reviseTag" type="text" placeholder="เช่น R1, R2" value="${escapeHtml(request.reviseNumber || "")}" />
      </label>
      <label class="field">
        <span>ลิงก์ไฟล์ DWG</span>
        <input name="dwgUrl" type="text" placeholder="https://..." />
      </label>
      <label class="field">
        <span>ลิงก์ไฟล์ PDF</span>
        <input name="pdfUrl" type="text" placeholder="https://..." />
      </label>
      <label class="delivery-file-drop" id="sendwork-file-drop">
        <input id="sendwork-files" type="file" multiple accept=".dwg,.dxf,.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip" />
        <span class="delivery-drop-icon">⇪</span>
        <strong>ลากไฟล์มาวาง หรือคลิกเลือกไฟล์</strong>
        <small id="sendwork-file-list">DWG, PDF, รูปภาพ และเอกสารประกอบ</small>
      </label>
      <label class="field">
        <span>หมายเหตุถึงผู้จัดการ / ผู้ร้องขอ</span>
        <textarea name="note" rows="2" placeholder="เช่น แบบ Revision 2 แก้ตามความต้องการของลูกค้า..."></textarea>
      </label>
    </form>
  `;

  openModal({
    title: "📤 ส่งงาน",
    body,
    actions: [
      { label: "ยกเลิก", className: "secondary-button" },
      {
        label: "ยืนยันนำส่ง",
        className: "primary-button",
        onClick: async (close) => {
          const form = document.querySelector("#sendwork-form");
          const data = new FormData(form);
          const dwgUrl = String(data.get("dwgUrl") || "").trim();
          const pdfUrl = String(data.get("pdfUrl") || "").trim();
          if (!dwgUrl && !pdfUrl && !pendingFiles.length) {
            showToast("กรุณาใส่ลิงก์ไฟล์ หรือแนบเอกสารอย่างน้อย 1 รายการ", "warning");
            return;
          }
          try {
            await submitSendwork(request, {
              dwgUrl,
              pdfUrl,
              reviseTag: String(data.get("reviseTag") || "").trim(),
              note: String(data.get("note") || "").trim(),
              files: pendingFiles,
            });
            showToast(`ส่งงานสำเร็จ! แจ้งเตือนผู้จัดการใน Microsoft Teams แล้ว — รอตรวจสอบก่อนส่งมอบ`, "success");
            close();
          } catch (error) {
            showToast(`ส่งงานไม่สำเร็จ: ${error.message}`, "error");
          }
        },
      },
    ],
  });

  const drop = document.querySelector("#sendwork-file-drop");
  const input = document.querySelector("#sendwork-files");
  const list = document.querySelector("#sendwork-file-list");
  const updateList = () => {
    pendingFiles = Array.from(input.files || []);
    list.textContent = pendingFiles.length
      ? pendingFiles.map((file) => file.name).join(", ")
      : "DWG, PDF, รูปภาพ และเอกสารประกอบ";
    drop.classList.toggle("has-files", pendingFiles.length > 0);
  };
  input.addEventListener("change", updateList);
  drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("is-dragging"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-dragging"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("is-dragging");
    if (event.dataTransfer?.files?.length) {
      input.files = event.dataTransfer.files;
      updateList();
    }
  });
}

// ══════════════════════════════════════════════════════════════
// REQUESTER VIEW — คำร้องของฉัน + ตรวจรับงาน (approve/revise/reject)
// ══════════════════════════════════════════════════════════════

function renderRequesterTrack(view, state) {
  const myItems = state.requests.filter((item) =>
    String(item.requesterEmail || "").toLowerCase() === String(state.user?.email || "").toLowerCase()
  );
  const active = myItems.filter((item) => !CLOSED_STATUSES.includes(item.status));
  const awaitingReview = active.filter((item) => item.status === STATUS.DELIVERED);

  view.innerHTML = `
    <section class="content-section requester-track">
      <div class="section-header">
        <h2>คำร้องของฉัน <span class="requester-result-count">งานปัจจุบัน ${active.length} รายการ</span></h2>
      </div>

      ${awaitingReview.length ? `
        <div class="section-header" style="margin-top:8px">
          <h2 style="color:#0b5394">📦 รอท่านตรวจรับงาน</h2>
        </div>
        <div class="admin-list">
          ${awaitingReview.map((item) => renderReviewCard(item)).join("")}
        </div>
      ` : ""}

      <div class="section-header" style="margin-top:18px">
        <h2>คำร้องทั้งหมด</h2>
      </div>
      <div class="track-table-wrap">
        <table class="track-sheet requester-track-table">
          <thead>
            <tr><th>เลขที่คำร้อง</th><th>โครงการ</th><th>Drawing</th><th>กำหนดส่ง</th><th>สถานะ</th><th>ไฟล์งาน</th></tr>
          </thead>
          <tbody>${active.length ? active.map((item) => renderRequesterRow(item)).join("") : `<tr><td colspan="6" class="track-empty">ยังไม่มีคำร้องของคุณ</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;

  bindRequesterReviewEvents(view, state);
}

function renderReviewCard(item) {
  return `
    <article class="admin-card" id="review-card-${escapeHtml(item.requestNo)}">
      <div class="admin-card-header">
        <div>
          <div class="admin-card-title">${escapeHtml(item.requestNo)}</div>
          <div class="admin-card-ref">${escapeHtml(item.projectName || "—")} · ${escapeHtml(item.drawingNo || "—")} — ${escapeHtml(item.drawingName || "—")}</div>
        </div>
        <span class="badge badge-delivered">📦 ส่งมอบแล้ว รอตรวจรับ</span>
      </div>
      <div class="admin-card-footer">
        ${item.dwgFileUrl ? `<a href="${escapeHtml(item.dwgFileUrl)}" target="_blank" rel="noopener noreferrer" class="secondary-button small-flow-button">📐 ดู DWG</a>` : ""}
        ${item.pdfFileUrl ? `<a href="${escapeHtml(item.pdfFileUrl)}" target="_blank" rel="noopener noreferrer" class="secondary-button small-flow-button">📄 ดู PDF</a>` : ""}
        <div class="admin-card-actions">
          <button class="secondary-button small-flow-button" data-review-action="toggle-revise" data-request="${escapeHtml(item.requestNo)}">✏️ ขอแก้ไข</button>
          <button class="secondary-button small-flow-button danger-button" data-review-action="toggle-reject" data-request="${escapeHtml(item.requestNo)}">❌ Reject</button>
          <button class="primary-button small-flow-button" data-review-action="approve" data-request="${escapeHtml(item.requestNo)}">✅ อนุมัติรับงาน</button>
        </div>
      </div>
      <div id="review-box-${escapeHtml(item.requestNo)}" class="admin-action-box" hidden>
        <div id="review-label-${escapeHtml(item.requestNo)}" class="admin-action-label"></div>
        <textarea id="review-note-${escapeHtml(item.requestNo)}" rows="3"></textarea>
        <div class="admin-action-buttons">
          <button class="secondary-button small-flow-button" data-review-action="close-box" data-request="${escapeHtml(item.requestNo)}">ยกเลิก</button>
          <button class="danger-button small-flow-button" data-review-action="confirm-box" data-request="${escapeHtml(item.requestNo)}">ยืนยัน</button>
        </div>
      </div>
    </article>
  `;
}

function renderRequesterRow(item) {
  return `
    <tr>
      <td><button class="track-request-link" data-request-detail="${escapeHtml(item.requestNo)}" type="button">${escapeHtml(item.requestNo)}</button></td>
      <td><strong>${escapeHtml(item.projectName || "-")}</strong></td>
      <td><strong>${escapeHtml(item.drawingNo || "-")}</strong><small>${escapeHtml(item.drawingName || "")}</small></td>
      <td>${formatDateOnly(item.dueDate)}</td>
      <td><span class="badge badge-${item.status}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span></td>
      <td>${item.pdfFileUrl ? `<a class="track-file-link" href="${escapeHtml(item.pdfFileUrl)}" target="_blank" rel="noopener noreferrer">FILE</a>` : `<span class="track-no-file">-</span>`}</td>
    </tr>
  `;
}

function bindRequesterReviewEvents(view, state) {
  view.addEventListener("click", async (event) => {
    const detailButton = event.target.closest("[data-request-detail]");
    if (detailButton) {
      const request = state.requests.find((item) => item.requestNo === detailButton.dataset.requestDetail);
      if (request) openRequestDetail(request);
      return;
    }

    const button = event.target.closest("[data-review-action]");
    if (!button) return;
    const requestNo = button.dataset.request;
    const request = state.requests.find((item) => item.requestNo === requestNo);
    if (!request) return;
    const action = button.dataset.reviewAction;
    const safeId = cssEscape(requestNo);

    if (action === "toggle-revise" || action === "toggle-reject") {
      const mode = action === "toggle-revise" ? "revise" : "reject";
      toggleReviewBox(view, requestNo, mode);
      return;
    }
    if (action === "close-box") {
      view.querySelector(`#review-box-${safeId}`).hidden = true;
      return;
    }
    if (action === "approve") {
      button.disabled = true;
      button.classList.add("is-loading");
      try {
        await requesterReview(request, "approve");
        showToast(`${requestNo} ตรวจรับงานเรียบร้อย — เสร็จสิ้น`, "success");
        renderRequesterTrack(view, state);
      } catch (error) {
        showToast(`เกิดข้อผิดพลาด: ${error.message}`, "error");
        button.disabled = false;
        button.classList.remove("is-loading");
      }
      return;
    }
    if (action === "confirm-box") {
      const box = view.querySelector(`#review-box-${safeId}`);
      const mode = box?.dataset.mode;
      const note = view.querySelector(`#review-note-${safeId}`)?.value.trim();
      if (!note) {
        showToast("กรุณาระบุรายละเอียด", "warning");
        return;
      }
      button.disabled = true;
      button.classList.add("is-loading");
      try {
        await requesterReview(request, mode, note);
        showToast(`${requestNo} ${mode === "revise" ? "ส่งขอแก้ไขแล้ว" : "Reject แล้ว"}`, "warning");
        renderRequesterTrack(view, state);
      } catch (error) {
        showToast(`เกิดข้อผิดพลาด: ${error.message}`, "error");
        button.disabled = false;
        button.classList.remove("is-loading");
      }
    }
  });
}

function toggleReviewBox(view, requestNo, mode) {
  const safeId = cssEscape(requestNo);
  const box = view.querySelector(`#review-box-${safeId}`);
  const label = view.querySelector(`#review-label-${safeId}`);
  const note = view.querySelector(`#review-note-${safeId}`);
  if (!box.hidden && box.dataset.mode === mode) {
    box.hidden = true;
    return;
  }
  box.dataset.mode = mode;
  box.hidden = false;
  note.value = "";
  if (mode === "revise") {
    label.innerHTML = "✏️ <b>ขอแก้ไข</b> — ระบุรายละเอียดที่ต้องการแก้ไข";
    note.placeholder = "ระบุจุดที่ต้องการให้แก้ไข...";
    box.className = "admin-action-box tone-warning";
  } else {
    label.innerHTML = "❌ <b>Reject</b> — ระบุเหตุผล";
    note.placeholder = "ระบุเหตุผลที่ Reject...";
    box.className = "admin-action-box tone-danger";
  }
  note.focus();
}

// ══════════════════════════════════════════════════════════════
// PUBLIC VIEW (viewer role) — ดูภาพรวมอย่างเดียว ไม่มี action
// ══════════════════════════════════════════════════════════════

function renderPublicTrack(view, state) {
  const rows = [...state.requests].sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
  view.innerHTML = `
    <section class="content-section track-workbook public-track">
      <div class="section-header">
        <h2>ติดตามงานทั้งหมด <span class="requester-result-count">งานทั้งหมด ${rows.length} รายการ</span></h2>
      </div>
      <div class="track-table-wrap">
        <table class="track-sheet">
          <thead>
            <tr><th>เลขที่คำร้อง</th><th>โครงการ</th><th>Drawing</th><th>กำหนดส่ง</th><th>สถานะ</th></tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((item) => `
              <tr>
                <td><button class="track-request-link" data-request-detail="${escapeHtml(item.requestNo)}" type="button">${escapeHtml(item.requestNo)}</button></td>
                <td><strong>${escapeHtml(item.projectName || "-")}</strong></td>
                <td><strong>${escapeHtml(item.drawingNo || "-")}</strong></td>
                <td>${formatDateOnly(item.dueDate)}</td>
                <td><span class="badge badge-${item.status}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span></td>
              </tr>
            `).join("") : `<tr><td colspan="5" class="track-empty">ยังไม่มีคำร้องในระบบ</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
  view.addEventListener("click", (event) => {
    const detailButton = event.target.closest("[data-request-detail]");
    if (!detailButton) return;
    const request = state.requests.find((item) => item.requestNo === detailButton.dataset.requestDetail);
    if (request) openRequestDetail(request);
  });
}

// ══════════════════════════════════════════════════════════════
// SHARED: REQUEST DETAIL MODAL (พร้อม timeline ประวัติคำร้อง)
// ══════════════════════════════════════════════════════════════

function openRequestDetail(request) {
  openModal({
    title: request.requestNo,
    body: `
      <div class="request-detail-layout">
        <article class="request-detail-panel">
          <div class="request-detail-heading">
            <strong>${escapeHtml(request.requestNo)}</strong>
            <span class="detail-status badge badge-${request.status}">${escapeHtml(STATUS_LABELS[request.status] || request.status)}</span>
          </div>
          <div class="request-detail-grid">
            ${detailItem("โครงการ", request.projectName)}
            ${detailItem("ประเภทแบบ", request.requestType)}
            ${detailItem("Drawing Number", request.drawingNo)}
            ${detailItem("Drawing Name", request.drawingName)}
            ${detailItem("ผู้ส่งคำร้อง (ชื่อ)", request.requesterName)}
            ${detailItem("ผู้ส่งคำร้อง (อีเมล)", request.requesterEmail)}
            ${detailItem("ผู้รับผิดชอบ (เขียนแบบ)", assigneeName(request))}
            ${detailItem("กำหนดส่ง", formatDateOnly(request.dueDate))}
            ${detailItem("ความเร่งด่วน", request.priority)}
            ${detailItem("วันที่ส่งคำร้อง", formatDate(request.submittedAt))}
          </div>
          <div class="request-detail-note"><span>รายละเอียด</span><strong>${escapeHtml(request.description || "-")}</strong></div>
          <div class="request-detail-files"><strong>เอกสาร/ลิงก์ผู้ส่งคำร้อง</strong>${
            request.dataLink
              ? `<a href="${escapeHtml(request.dataLink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(request.dataLink)}</a>`
              : `<span>-</span>`
          }</div>
          ${request.mgrRejectReason ? `<div class="request-detail-note cancellation-detail"><span>เหตุผลที่ผู้จัดการส่งกลับ</span><strong>${escapeHtml(request.mgrRejectReason)}</strong></div>` : ""}
          ${request.rejectReason ? `<div class="request-detail-note cancellation-detail"><span>เหตุผลส่งกลับ/ยกเลิก</span><strong>${escapeHtml(request.rejectReason)}</strong></div>` : ""}
        </article>

        <aside class="request-detail-history">
          <div class="request-detail-history-heading">ประวัติคำร้อง</div>
          <div class="request-detail-timeline" id="audit-timeline-slot">
            <div class="timeline-loading">⏳ กำลังโหลดประวัติ...</div>
          </div>
        </aside>
      </div>
    `,
    actions: [],
  });

  loadAuditTimeline(request.requestNo);
}

async function loadAuditTimeline(requestNo) {
  const slot = document.querySelector("#audit-timeline-slot");
  if (!slot) return; // ผู้ใช้ปิด modal ไปแล้วก่อนโหลดเสร็จ

  try {
    const history = await getAuditHistory(requestNo);
    const freshSlot = document.querySelector("#audit-timeline-slot");
    if (!freshSlot) return; // เช็คซ้ำเผื่อปิด modal ระหว่างรอ fetch

    if (!history.length) {
      freshSlot.innerHTML = `<div class="timeline-empty">ยังไม่มีประวัติบันทึกไว้</div>`;
      return;
    }
    freshSlot.innerHTML = history.map(timelineEntry).join("");
  } catch (error) {
    const freshSlot = document.querySelector("#audit-timeline-slot");
    if (freshSlot) freshSlot.innerHTML = `<div class="timeline-empty">โหลดประวัติไม่สำเร็จ</div>`;
  }
}

function timelineEntry(entry) {
  return `
    <div class="timeline-item">
      <span class="timeline-dot" aria-hidden="true"></span>
      <div class="timeline-item-body">
        <div class="timeline-item-top">
          <strong>${escapeHtml(entry.action || "—")}</strong>
          <time>${formatDate(entry.actionAt)}</time>
        </div>
        <div class="timeline-item-user">${escapeHtml(entry.userName || entry.userEmail || "—")}</div>
        ${entry.detail ? `<div class="timeline-item-note">${escapeHtml(entry.detail)}</div>` : ""}
      </div>
    </div>
  `;
}

function detailItem(label, value) {
  return `<div class="request-detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "-")}</strong></div>`;
}

// ══════════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════════

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dueSummary(dueDate, status) {
  if (CLOSED_STATUSES.includes(status)) return { label: "ปิดแล้ว", className: "done" };
  if (!dueDate) return { label: "-", className: "neutral" };
  const today = startOfDay(new Date()).getTime();
  const due = startOfDay(new Date(dueDate)).getTime();
  const diff = Math.round((due - today) / 86400000);
  if (diff < 0) return { label: `เกินกำหนด ${Math.abs(diff)} วัน`, className: "overdue" };
  if (diff === 0) return { label: "ส่งวันนี้", className: "today" };
  return { label: `เหลืออีก ${diff} วัน`, className: "soon" };
}

function cssEscape(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}
