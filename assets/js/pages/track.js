import { STATUS, STATUS_LABELS, CLOSED_STATUSES } from "../../../config/schema.js";
import { openModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import {
  mgrApproveDeliver,
  mgrRejectWork,
  requesterReview,
  submitSendwork,
  updateWorkStatus,
} from "../services/request-service.js";
import { assigneeName } from "../services/team-service.js";
import { escapeHtml, formatDate, formatDateOnly } from "../utils.js";

const WORK_STATUS_OPTIONS = [
  { value: STATUS.APPROVED, label: "🔵 กำลังดำเนินการ" },
  { value: STATUS.WORKING, label: "⚙️ กำลังดำเนินการ (อัปเดต)" },
];

export function renderTrack(view, state) {
  const role = state.user?.role;
  if (role === "manager") {
    renderManagerTrack(view, state);
  } else if (role === "designer") {
    renderDesignerTrack(view, state);
  } else if (role === "requester") {
    renderRequesterTrack(view, state);
  } else {
    renderPublicTrack(view, state);
  }
}

// ══════════════════════════════════════════════════════════════
// MANAGER VIEW — mgr_review queue (ส่งมอบ/ส่งกลับ) + งานที่ตัวเองรับผิดชอบ
// ══════════════════════════════════════════════════════════════

function renderManagerTrack(view, state) {
  const mgrReviewItems = state.requests.filter((item) => item.status === STATUS.MGR_REVIEW);
  const myItems = state.requests.filter((item) =>
    String(item.assignedToEmail || "").toLowerCase() === String(state.user?.email || "").toLowerCase()
    && !CLOSED_STATUSES.includes(item.status)
  );

  view.innerHTML = `
    <section class="content-section track-workbook">
      <div class="section-header">
        <h2>
          🔍 รออนุมัติส่งมอบ
          <span class="mgr-review-badge">${mgrReviewItems.length}</span>
        </h2>
      </div>
      <div id="mgr-review-list" class="admin-list">
        ${mgrReviewItems.length
          ? mgrReviewItems.map((item) => renderMgrReviewCard(item)).join("")
          : `<div class="empty-state">✅ ไม่มีงานรอตรวจสอบ</div>`}
      </div>

      ${myItems.length ? `
        <div class="section-header" style="margin-top:24px">
          <h2>งานที่ฉันรับผิดชอบ</h2>
        </div>
        <div class="track-table-wrap">
          <table class="track-sheet">
            <thead>
              <tr><th>เลขที่คำร้อง</th><th>โครงการ</th><th>Drawing</th><th>กำหนดส่ง</th><th>สถานะ</th><th>ดำเนินการ</th></tr>
            </thead>
            <tbody>${myItems.map((item) => renderDesignerRow(item)).join("")}</tbody>
          </table>
        </div>
      ` : ""}
    </section>
  `;

  bindMgrReviewEvents(view, state);
  bindDesignerStatusEvents(view, state);
}

function renderMgrReviewCard(item) {
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
          <div><span>Revise:</span> ${escapeHtml(item.currentRevise || item.reviseNumber || "—")}</div>
          ${item.noteFromDrawing ? `<div class="span-full"><span>หมายเหตุ:</span> ${escapeHtml(item.noteFromDrawing)}</div>` : ""}
        </div>
      </div>
      <div class="admin-card-footer">
        ${item.dwgFileUrl ? `<a href="${escapeHtml(item.dwgFileUrl)}" target="_blank" rel="noopener noreferrer" class="secondary-button small-flow-button">📐 ดู DWG</a>` : ""}
        ${item.pdfFileUrl ? `<a href="${escapeHtml(item.pdfFileUrl)}" target="_blank" rel="noopener noreferrer" class="secondary-button small-flow-button">📄 ดู PDF</a>` : ""}
        <div class="admin-card-actions">
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
  view._mgrEvents?.abort();
  const controller = new AbortController();
  view._mgrEvents = controller;

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
        renderManagerTrack(view, state);
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
        renderManagerTrack(view, state);
      } catch (error) {
        showToast(`เกิดข้อผิดพลาด: ${error.message}`, "error");
        button.disabled = false;
        button.classList.remove("is-loading");
      }
    }
  }, { signal: controller.signal });
}

// ══════════════════════════════════════════════════════════════
// DESIGNER VIEW — งานของฉัน + sendwork
// ══════════════════════════════════════════════════════════════

function renderDesignerTrack(view, state) {
  const myItems = state.requests.filter((item) =>
    String(item.assignedToEmail || "").toLowerCase() === String(state.user?.email || "").toLowerCase()
  );
  const active = myItems.filter((item) => !CLOSED_STATUSES.includes(item.status));
  const mgrRejected = active.filter((item) => item.status === STATUS.MGR_REJECTED);
  const today = startOfDay(new Date());
  const overdue = active.filter((item) => item.dueDate && startOfDay(new Date(item.dueDate)) < today);
  const dueToday = active.filter((item) => item.dueDate && startOfDay(new Date(item.dueDate)).getTime() === today.getTime());

  view.innerHTML = `
    <section class="content-section track-workbook">
      <div class="section-header">
        <h2>งานของฉัน — ฝ่ายเขียนแบบ <span class="requester-result-count">${active.length} รายการ</span></h2>
      </div>

      <div class="dash-stats-row">
        ${statTile("เกินกำหนด", overdue.length, "overdue")}
        ${statTile("ส่งวันนี้", dueToday.length, "today")}
        ${statTile("ถูกส่งกลับแก้ไข", mgrRejected.length, "rejected")}
        ${statTile("ทั้งหมด", active.length, "total")}
      </div>

      ${mgrRejected.length ? `
        <div class="section-header" style="margin-top:18px">
          <h2 style="color:#c2410c">↩️ งานที่ถูกส่งกลับแก้ไข</h2>
        </div>
        <div class="admin-list">
          ${mgrRejected.map((item) => renderMgrRejectedCard(item)).join("")}
        </div>
      ` : ""}

      <div class="section-header" style="margin-top:18px">
        <h2>งานทั้งหมดของฉัน</h2>
      </div>
      <div class="track-table-wrap">
        <table class="track-sheet">
          <thead>
            <tr><th>กำหนดส่ง</th><th>เลขที่คำร้อง</th><th>โครงการ</th><th>Drawing</th><th>สถานะ</th><th>ดำเนินการ</th></tr>
          </thead>
          <tbody>${active.length ? active.map((item) => renderDesignerRow(item)).join("") : `<tr><td colspan="6" class="track-empty">ยังไม่มีงาน</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;

  bindDesignerStatusEvents(view, state);
  bindSendworkEvents(view, state);
}

function renderMgrRejectedCard(item) {
  return `
    <article class="admin-card" style="border-left:4px solid #c2410c">
      <div class="admin-card-header">
        <div>
          <div class="admin-card-title">${escapeHtml(item.requestNo)}</div>
          <div class="admin-card-ref">${escapeHtml(item.projectName || "—")} · ${escapeHtml(item.drawingNo || "—")}</div>
        </div>
        <span class="badge badge-mgr_rejected">↩️ ผู้จัดการส่งกลับแก้ไข</span>
      </div>
      <div class="admin-card-body">📌 ${escapeHtml(item.mgrRejectReason || "—")}</div>
      <div class="admin-card-footer">
        <button class="primary-button small-flow-button" data-sendwork-open="${escapeHtml(item.requestNo)}">📤 แก้ไขแล้ว ส่งงานใหม่</button>
      </div>
    </article>
  `;
}

function renderDesignerRow(item) {
  const due = dueSummary(item.dueDate, item.status);
  const canUpdate = [STATUS.APPROVED, STATUS.WORKING].includes(item.status);
  const canSend = [STATUS.APPROVED, STATUS.WORKING, STATUS.MGR_REJECTED].includes(item.status);
  return `
    <tr>
      <td><span class="due-chip ${due.className}">${escapeHtml(due.label)}</span></td>
      <td><button class="track-request-link" data-request-detail="${escapeHtml(item.requestNo)}" type="button">${escapeHtml(item.requestNo)}</button></td>
      <td><strong>${escapeHtml(item.projectName || "—")}</strong></td>
      <td><strong>${escapeHtml(item.drawingNo || "—")}</strong><br><small>${escapeHtml(item.drawingName || "")}</small></td>
      <td><span class="badge badge-${item.status}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span></td>
      <td>
        ${canUpdate ? `
          <select class="track-status-select" data-designer-status="${escapeHtml(item.requestNo)}">
            ${WORK_STATUS_OPTIONS.map((opt) => `<option value="${opt.value}" ${item.status === opt.value ? "selected" : ""}>${opt.label}</option>`).join("")}
          </select>
        ` : ""}
        ${canSend ? `<button class="small-button" data-sendwork-open="${escapeHtml(item.requestNo)}" type="button">📤 ส่งงาน</button>` : ""}
      </td>
    </tr>
  `;
}

function bindDesignerStatusEvents(view, state) {
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
  });

  view.addEventListener("click", (event) => {
    const detailButton = event.target.closest("[data-request-detail]");
    if (detailButton) {
      const request = state.requests.find((item) => item.requestNo === detailButton.dataset.requestDetail);
      if (request) openRequestDetail(request);
    }
  });
}

// ══════════════════════════════════════════════════════════════
// SENDWORK MODAL — ส่งงานคืน → mgr_review
// ══════════════════════════════════════════════════════════════

function bindSendworkEvents(view, state) {
  view.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sendwork-open]");
    if (!button) return;
    const request = state.requests.find((item) => item.requestNo === button.dataset.sendworkOpen);
    if (request) openSendworkModal(view, state, request);
  });
}

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
// SHARED: REQUEST DETAIL MODAL
// ══════════════════════════════════════════════════════════════

function openRequestDetail(request) {
  openModal({
    title: request.requestNo,
    body: `
      <article class="request-detail-panel">
        <div class="request-detail-heading">
          <strong>${escapeHtml(request.requestNo)}</strong>
          <span class="detail-status">${escapeHtml(STATUS_LABELS[request.status] || request.status)}</span>
        </div>
        <div class="request-detail-grid">
          ${detailItem("ประเภท", request.requestType)}
          ${detailItem("โครงการ", request.projectName)}
          ${detailItem("Drawing Number", request.drawingNo)}
          ${detailItem("Drawing Name", request.drawingName)}
          ${detailItem("Revise", request.currentRevise || request.reviseNumber)}
          ${detailItem("ผู้ส่ง", request.requesterName)}
          ${detailItem("ผู้รับผิดชอบ", assigneeName(request))}
          ${detailItem("กำหนดส่ง", formatDateOnly(request.dueDate))}
          ${detailItem("ความเร่งด่วน", request.priority)}
          ${detailItem("วันที่ส่งคำร้อง", formatDate(request.submittedAt))}
        </div>
        ${request.description ? `<div class="request-detail-note"><span>รายละเอียด</span><strong>${escapeHtml(request.description)}</strong></div>` : ""}
        ${request.dataLink ? `<div class="request-detail-files"><strong>ลิงก์ข้อมูล</strong><a href="${escapeHtml(request.dataLink)}" target="_blank" rel="noopener noreferrer">เปิดลิงก์</a></div>` : ""}
        ${request.mgrRejectReason ? `<div class="request-detail-note cancellation-detail"><span>เหตุผลที่ผู้จัดการส่งกลับ</span><strong>${escapeHtml(request.mgrRejectReason)}</strong></div>` : ""}
        ${request.rejectReason ? `<div class="request-detail-note cancellation-detail"><span>เหตุผลส่งกลับ/ยกเลิก</span><strong>${escapeHtml(request.rejectReason)}</strong></div>` : ""}
      </article>
    `,
    actions: [],
  });
}

function detailItem(label, value) {
  return `<div class="request-detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "-")}</strong></div>`;
}

// ══════════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════════

function statTile(label, value, tone) {
  return `<div class="dash-stat-tile tone-${tone}"><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`;
}

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
