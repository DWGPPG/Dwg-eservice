import { STATUS, STATUS_LABELS, CLOSED_STATUSES } from "../../../config/schema.js";
import { appConfig } from "../../../config/config.js";
import { openModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import {
  adminCancel,
  patchRequest,
  requesterReview,
  submitSendwork,
  updateWorkStatus,
} from "../services/request-service.js";
import { getAuditHistory } from "../services/audit-service.js";
import { assigneeName, getDrawingTeamMembers } from "../services/team-service.js";
import { escapeHtml, formatDate, formatDateOnly } from "../utils.js";

const WORK_STATUS_OPTIONS = [
  { value: STATUS.APPROVED, label: "🔵 รอดำเนินการ" },
  { value: STATUS.WORKING, label: "⚙️ กำลังดำเนินการ" },
  { value: "__complete__", label: "✅ เสร็จสิ้น" },
  { value: "__cancel__", label: "❌ ยกเลิก" },
];

// แท็บกลุ่มหลัก: งานของฉัน / งานในฝ่าย (เฉพาะ designer/manager ที่เห็นแท็บหลังได้)
let scopeTab = "mine";
// แท็บย่อยในแต่ละกลุ่ม: งานปัจจุบัน / เสร็จสิ้น / ยกเลิก / ทั้งหมด
let statusTab = "current";
let searchQuery = "";
let projectFilter = "";
let assigneeFilter = "";
let trackDateFrom = "";
let trackDateTo = "";

// ── โฟลเดอร์ SharePoint สำหรับคำร้อง ──
function getRequestFolderUrl(requestNo) {
  const sp    = appConfig.sharePoint;
  const match = String(requestNo || "").match(/^(.*)-(Rev\.\d+)$/);
  const baseNo = match ? match[1] : requestNo;
  const revSeg = match ? `/${match[2]}` : "";
  const path   = `${sp.uploadFolder}/${baseNo}${revSeg}`;
  return `https://${sp.hostname}${sp.sitePath}/Shared%20Documents/${path.split("/").map(encodeURIComponent).join("/")}`;
}

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
    [item.requestNo, item.projectName, item.drawingNo, item.drawingName, item.assignedToName, item.requesterName]
      .some((value) => String(value || "").toLowerCase().includes(query))
  );
}

function filterByAssignee(items) {
  if (!assigneeFilter) return items;
  return items.filter((item) => (item.assignedToEmail || "") === assigneeFilter);
}

function filterByDate(items) {
  if (!trackDateFrom && !trackDateTo) return items;
  return items.filter((item) => {
    if (!item.submittedAt) return false;
    const d = new Date(item.submittedAt).setHours(0, 0, 0, 0);
    if (trackDateFrom && d < new Date(trackDateFrom).setHours(0, 0, 0, 0)) return false;
    if (trackDateTo   && d > new Date(trackDateTo).setHours(23, 59, 59, 999)) return false;
    return true;
  });
}

function filterByProject(items) {
  if (!projectFilter) return items;
  return items.filter((item) => item.projectName === projectFilter);
}

function renderWorkbookTrack(view, state) {
  const myAll   = state.requests.filter((item) => isMine(item, state));
  const deptAll = state.requests;

  const baseList       = scopeTab === "mine" ? myAll : deptAll;
  const projectOptions = [...new Set(state.requests.map((i) => i.projectName).filter(Boolean))].sort();
  const members = getDrawingTeamMembers();

  let rows = filterByStatusTab(baseList);
  rows = filterByProject(rows);
  rows = filterByAssignee(rows);
  rows = filterByDate(rows);
  rows = filterBySearch(rows);
  rows = [...rows].sort((a, b) => new Date(a.dueDate || "9999-12-31") - new Date(b.dueDate || "9999-12-31"));

  const currentCount = baseList.filter((i) => !CLOSED_STATUSES.includes(i.status)).length;
  const hasActiveFilter = assigneeFilter || trackDateFrom || trackDateTo;

  view.innerHTML = `
    <section class="content-section track-workbook">
      <div class="section-header">
        <h2>ติดตามงาน <span class="requester-result-count">งานปัจจุบัน ${currentCount} รายการ</span></h2>
      </div>

      <div class="track-filter-bar" style="flex-wrap:wrap;gap:8px;">
        <label class="track-search-field">
          <span>ค้นหางาน</span>
          <input id="track-search-input" type="search"
            placeholder="ค้นหาเลขที่คำร้อง โครงการ Drawing ผู้ขอ..."
            value="${escapeHtml(searchQuery)}" />
        </label>

        <label class="track-select-filter">
          <span>โครงการ</span>
          <select id="track-project-filter">
            <option value="">ทุกโครงการ</option>
            ${projectOptions.map((name) => `<option value="${escapeHtml(name)}" ${projectFilter === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
          </select>
        </label>

        <label class="track-select-filter">
          <span>ผู้รับผิดชอบ</span>
          <select id="track-assignee-filter">
            <option value="">ทุกคน</option>
            ${members.map((m) => `<option value="${escapeHtml(m.email)}" ${assigneeFilter === m.email ? "selected" : ""}>${escapeHtml(m.name || m.email)}</option>`).join("")}
          </select>
        </label>

        <label style="display:flex;align-items:center;gap:4px;font-size:13px;color:#555;">
          ตั้งแต่ <input id="track-date-from" type="date" value="${trackDateFrom}"
            style="border:1px solid #d0d7de;border-radius:6px;padding:4px 8px;font-size:13px;" />
        </label>
        <label style="display:flex;align-items:center;gap:4px;font-size:13px;color:#555;">
          ถึง <input id="track-date-to" type="date" value="${trackDateTo}"
            style="border:1px solid #d0d7de;border-radius:6px;padding:4px 8px;font-size:13px;" />
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
              <th>โฟลเดอร์ / ลิงก์</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length
              ? rows.map((item) => renderWorkbookRow(item, state)).join("")
              : `<tr><td colspan="7" class="track-empty">ไม่พบงานในหมวดนี้</td></tr>`}
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
  const canEditStatus = mine && [STATUS.APPROVED, STATUS.WORKING, STATUS.MGR_REJECTED].includes(item.status);
  const folder   = getRequestFolderUrl(item.requestNo);
  const fileLink = item.dwgFileUrl || item.pdfFileUrl || "";
  const dataLink = item.dataLink || "";

  return `
    <tr>
      <td><span class="due-chip ${due.className}">${escapeHtml(due.label)}</span></td>
      <td><button class="track-request-link" data-request-detail="${escapeHtml(item.requestNo)}" type="button">${escapeHtml(item.requestNo)}</button></td>
      <td><strong>${escapeHtml(item.projectName || "—")}</strong></td>
      <td><strong>${escapeHtml(item.drawingNo || "—")}</strong><br><small>${escapeHtml(item.drawingName || "")}</small></td>
      <td>${formatDateOnly(item.dueDate)}</td>
      <td style="white-space:nowrap;">
        <a href="${escapeHtml(folder)}" target="_blank" rel="noopener noreferrer"
          class="mgr-file-btn folder-btn" style="display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:3px 8px;">
          📁 โฟลเดอร์
        </a>
        ${fileLink ? `<a href="${escapeHtml(fileLink)}" target="_blank" rel="noopener noreferrer"
          class="mgr-file-btn pdf-btn" style="display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:3px 8px;margin-top:4px;">
          📄 ไฟล์
        </a>` : ""}
        ${dataLink ? `<a href="${escapeHtml(dataLink)}" target="_blank" rel="noopener noreferrer"
          class="mgr-file-btn ref-btn" style="display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:3px 8px;margin-top:4px;">
          🔗 ลิงก์
        </a>` : ""}
      </td>
      <td style="vertical-align:middle;text-align:center;width:155px;">
        ${canEditStatus ? `
          <select class="track-status-select" data-designer-status="${escapeHtml(item.requestNo)}">
            ${item.status === STATUS.MGR_REJECTED ? `<option value="${STATUS.MGR_REJECTED}" selected disabled>↩️ ถูกส่งกลับแก้ไข</option>` : ""}
            ${WORK_STATUS_OPTIONS.map((opt) => `<option value="${opt.value}" ${item.status === opt.value ? "selected" : ""}>${opt.label}</option>`).join("")}
          </select>
        ` : `
          <div style="display:inline-flex;align-items:center;gap:6px;">
            <span class="badge badge-${item.status}" style="white-space:nowrap;">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span>
            ${item.status === STATUS.DONE ? `
              <button type="button" data-delivery-form="${escapeHtml(item.requestNo)}"
                title="${item.deliveryFormUrl ? "ดาวน์โหลดใบส่งมอบ" : "สร้างใบส่งมอบงาน"}"
                style="background:none;border:none;cursor:pointer;padding:2px 4px;border-radius:6px;display:inline-flex;align-items:center;color:${item.deliveryFormUrl ? "#0DB14B" : "#005DAC"};"
                onmouseenter="this.style.background='#f0f6ff'" onmouseleave="this.style.background='none'">
                ${item.deliveryFormUrl
                  ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="12" x2="12" y2="18"/><polyline points="9 15 12 18 15 15"/></svg>`
                  : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="12" x2="12" y2="16"/><circle cx="12" cy="10" r="1" fill="currentColor"/></svg>`
                }
              </button>
            ` : ""}
          </div>
        `}
      </td>
    </tr>
  `;
}

function bindWorkbookEvents(view, state) {
  view._workbookEvents?.abort();
  const controller = new AbortController();
  view._workbookEvents = controller;
  const opts = { signal: controller.signal };

  view.querySelector("#track-search-input")?.addEventListener("input", (e) => {
    searchQuery = e.target.value;
    renderWorkbookTrack(view, state);
  }, opts);

  view.querySelector("#track-project-filter")?.addEventListener("change", (e) => {
    projectFilter = e.target.value;
    renderWorkbookTrack(view, state);
  }, opts);

  view.querySelector("#track-assignee-filter")?.addEventListener("change", (e) => {
    assigneeFilter = e.target.value;
    renderWorkbookTrack(view, state);
  }, opts);

  view.querySelector("#track-date-from")?.addEventListener("change", (e) => {
    trackDateFrom = e.target.value;
    renderWorkbookTrack(view, state);
  }, opts);

  view.querySelector("#track-date-to")?.addEventListener("change", (e) => {
    trackDateTo = e.target.value;
    renderWorkbookTrack(view, state);
  }, opts);

  view.querySelector("#track-clear-filters")?.addEventListener("click", () => {
    searchQuery    = "";
    projectFilter  = "";
    assigneeFilter = "";
    trackDateFrom  = "";
    trackDateTo    = "";
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

    const deliveryBtn = event.target.closest("[data-delivery-form]");
    if (deliveryBtn) {
      const request = state.requests.find((i) => i.requestNo === deliveryBtn.dataset.deliveryForm);
      if (request) {
        if (request.deliveryFormUrl) {
          window.open(request.deliveryFormUrl, "_blank", "noopener,noreferrer");
        } else {
          openDeliveryFormModal(view, state, request);
        }
      }
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
    const value = select.value;

    if (value === "__complete__") {
      select.value = request.status;
      openSendworkModal(view, state, request);
      return;
    }

    if (value === "__cancel__") {
      select.value = request.status;
      openCancelOwnWorkModal(view, state, request);
      return;
    }

    // Optimistic update — เปลี่ยน state ทันทีก่อนรอ API
    select.disabled = true;
    const originalValue = request.status;
    request.status = value; // update state ทันที
    renderWorkbookTrack(view, state); // re-render ทันที ผู้ใช้เห็นสถานะใหม่เลย

    try {
      await updateWorkStatus(request, value);
      showToast(`อัปเดตสถานะ ${requestNo} แล้ว`, "success");
    } catch (error) {
      request.status = originalValue; // คืนค่าเดิมถ้า error
      showToast(`อัปเดตไม่สำเร็จ: ${error.message}`, "error");
      renderWorkbookTrack(view, state);
    }
  }, opts);
}

function openCancelOwnWorkModal(view, state, request) {
  const body = `
    <div class="delivery-summary">
      <span>${escapeHtml(request.requestNo)}</span>
      <strong>${escapeHtml(request.projectName || "-")}</strong>
      <small>${escapeHtml(request.drawingNo || "-")} · ${escapeHtml(request.drawingName || "-")}</small>
    </div>
    <label class="field">
      <span>เหตุผลที่ยกเลิกงาน <b class="req">*</b></span>
      <textarea id="cancel-own-reason" rows="3" placeholder="ระบุเหตุผลที่ยกเลิกงานนี้..."></textarea>
    </label>
  `;

  openModal({
    title: "❌ ยกเลิกงาน",
    body,
    actions: [
      { label: "ปิด", className: "secondary-button" },
      {
        label: "ยืนยันยกเลิก",
        className: "danger-button",
        onClick: async (close) => {
          const reason = document.querySelector("#cancel-own-reason")?.value.trim();
          if (!reason) {
            showToast("กรุณาระบุเหตุผลที่ยกเลิก", "warning");
            return;
          }
          try {
            await adminCancel(request, reason);
            showToast(`ยกเลิกงาน ${request.requestNo} แล้ว`, "warning");
            close();
            renderWorkbookTrack(view, state);
          } catch (error) {
            showToast(`ยกเลิกไม่สำเร็จ: ${error.message}`, "error");
          }
        },
      },
    ],
  });
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
            const totalFiles = pendingFiles.length;
            let uploadedFiles = 0;
            if (totalFiles > 0) showSendworkProgress(0, "", totalFiles, 0);

            await submitSendwork(request, {
              dwgUrl,
              pdfUrl,
              reviseTag: String(data.get("reviseTag") || "").trim(),
              note: String(data.get("note") || "").trim(),
              files: pendingFiles,
              onProgress: ({ fileName, percent }) => {
                const overall = Math.round(((uploadedFiles + percent / 100) / totalFiles) * 100);
                showSendworkProgress(overall, fileName, totalFiles, uploadedFiles + (percent === 100 ? 1 : 0));
                if (percent === 100) uploadedFiles++;
              },
            });

            hideSendworkProgress();
            showToast(`ส่งงานสำเร็จ! แจ้งเตือนผู้จัดการใน Microsoft Teams แล้ว — รอตรวจสอบก่อนส่งมอบ`, "success");
            close();
            renderWorkbookTrack(view, state);
          } catch (error) {
            hideSendworkProgress();
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

/**
 * แยก noteFromDrawing ออกเป็น { note, otherFiles }
 * รูปแบบ: "<หมายเหตุ>|||[{"name":"...","url":"..."}]"
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

function renderRequesterTrack(view, state) {
  const myItems = state.requests.filter((item) =>
    String(item.requesterEmail || "").toLowerCase() === String(state.user?.email || "").toLowerCase()
  );
  const active        = myItems.filter((item) => !CLOSED_STATUSES.includes(item.status));
  const awaitingReview = active.filter((item) => item.status === STATUS.DELIVERED);
  const inProgress    = active.filter((item) => item.status !== STATUS.DELIVERED);
  const done          = myItems.filter((item) => item.status === STATUS.DONE);
  const cancelled     = myItems.filter((item) => [STATUS.CANCELLED, STATUS.REJECTED].includes(item.status));

  view.innerHTML = `
    <section class="content-section requester-track">
      <div class="section-header">
        <h2>คำร้องของฉัน <span class="requester-result-count">งานปัจจุบัน ${active.length} รายการ</span></h2>
      </div>

      <!-- Tab สลับ -->
      <div class="requester-tab-row">
        <button class="requester-tab ${awaitingReview.length ? "requester-tab-alert" : ""}" data-requester-tab="awaiting" type="button">
          📦 รอตรวจรับ
          ${awaitingReview.length ? `<span class="requester-tab-badge">${awaitingReview.length}</span>` : ""}
        </button>
        <button class="requester-tab" data-requester-tab="inprogress" type="button">
          🔄 กำลังดำเนินการ
          ${inProgress.length ? `<span class="requester-tab-badge requester-tab-badge-gray">${inProgress.length}</span>` : ""}
        </button>
        <button class="requester-tab" data-requester-tab="done" type="button">
          ✅ เสร็จสิ้น
          ${done.length ? `<span class="requester-tab-badge requester-tab-badge-gray">${done.length}</span>` : ""}
        </button>
        <button class="requester-tab" data-requester-tab="cancelled" type="button">
          ❌ ยกเลิก/ส่งกลับ
          ${cancelled.length ? `<span class="requester-tab-badge requester-tab-badge-gray">${cancelled.length}</span>` : ""}
        </button>
        <button class="requester-tab" data-requester-tab="all" type="button">
          📋 ทั้งหมด (${myItems.length})
        </button>
      </div>

      <!-- Tab: รอตรวจรับ -->
      <div id="requester-panel-awaiting">
        ${awaitingReview.length ? `
          <div class="admin-list">
            ${awaitingReview.map((item) => renderReviewCard(item)).join("")}
          </div>
        ` : `<div class="track-empty" style="padding:40px;text-align:center;color:#94a3b8;">✅ ไม่มีรายการรอตรวจรับ</div>`}
      </div>

      <!-- Tab: กำลังดำเนินการ -->
      <div id="requester-panel-inprogress" hidden>
        <div class="track-table-wrap">
          <table class="track-sheet requester-track-table">
            <thead>
              <tr><th>เลขที่คำร้อง</th><th>โครงการ</th><th>Drawing</th><th>กำหนดส่ง</th><th>สถานะ</th><th>ไฟล์งาน</th></tr>
            </thead>
            <tbody>${inProgress.length ? inProgress.map((item) => renderRequesterRow(item)).join("") : `<tr><td colspan="6" class="track-empty">ไม่มีงานที่กำลังดำเนินการ</td></tr>`}</tbody>
          </table>
        </div>
      </div>

      <!-- Tab: เสร็จสิ้น — แสดงใบส่งมอบ FM-SEN-009 ด้วย -->
      <div id="requester-panel-done" hidden>
        <div class="track-table-wrap">
          <table class="track-sheet requester-track-table">
            <thead>
              <tr><th>เลขที่คำร้อง</th><th>โครงการ</th><th>Drawing</th><th>กำหนดส่ง</th><th>สถานะ</th><th>ไฟล์งาน</th></tr>
            </thead>
            <tbody>${done.length ? done.map((item) => renderRequesterRow(item)).join("") : `<tr><td colspan="6" class="track-empty">ยังไม่มีงานเสร็จสิ้น</td></tr>`}</tbody>
          </table>
        </div>
      </div>

      <!-- Tab: ยกเลิก/ส่งกลับ -->
      <div id="requester-panel-cancelled" hidden>
        <div class="track-table-wrap">
          <table class="track-sheet requester-track-table">
            <thead>
              <tr><th>เลขที่คำร้อง</th><th>โครงการ</th><th>Drawing</th><th>กำหนดส่ง</th><th>สถานะ</th><th>ไฟล์งาน</th></tr>
            </thead>
            <tbody>${cancelled.length ? cancelled.map((item) => renderRequesterRow(item)).join("") : `<tr><td colspan="6" class="track-empty">ไม่มีรายการยกเลิก</td></tr>`}</tbody>
          </table>
        </div>
      </div>

      <!-- Tab: ทั้งหมด -->
      <div id="requester-panel-all" hidden>
        <div class="track-table-wrap">
          <table class="track-sheet requester-track-table">
            <thead>
              <tr><th>เลขที่คำร้อง</th><th>โครงการ</th><th>Drawing</th><th>กำหนดส่ง</th><th>สถานะ</th><th>ไฟล์งาน</th></tr>
            </thead>
            <tbody>${myItems.length ? myItems.map((item) => renderRequesterRow(item)).join("") : `<tr><td colspan="6" class="track-empty">ยังไม่มีคำร้องของคุณ</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  // Tab switching
  view.querySelectorAll("[data-requester-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      view.querySelectorAll("[data-requester-tab]").forEach((b) => b.classList.remove("requester-tab-active"));
      btn.classList.add("requester-tab-active");
      ["awaiting", "inprogress", "done", "cancelled", "all"].forEach((name) => {
        const panel = view.querySelector(`#requester-panel-${name}`);
        if (panel) panel.hidden = btn.dataset.requesterTab !== name;
      });
    });
  });

  // เปิด tab รอตรวจรับก่อนถ้ามีรายการ
  const defaultTab = awaitingReview.length ? "awaiting" : "inprogress";
  view.querySelector(`[data-requester-tab="${defaultTab}"]`)?.click();

  bindRequesterReviewEvents(view, state);
}

function renderReviewCard(item) {
  const { note, otherFiles } = parseNoteAndFiles(item.noteFromDrawing || "");
  return `
    <article class="admin-card" id="review-card-${escapeHtml(item.requestNo)}">
      <div class="admin-card-header">
        <div>
          <div class="admin-card-title">${escapeHtml(item.requestNo)}</div>
          <div class="admin-card-ref">${escapeHtml(item.projectName || "—")} · ${escapeHtml(item.drawingNo || "—")} — ${escapeHtml(item.drawingName || "—")}</div>
        </div>
        <span class="badge badge-delivered">📦 รอตรวจรับ</span>
      </div>

      <div class="lv1-info-block">
        <div class="lv1-info-grid">
          <div><span>ผู้ร้องขอ:</span> <b>${escapeHtml(item.requesterName || item.requesterEmail || "—")}</b></div>
          <div><span>Drawing No.:</span> <b>${escapeHtml(item.drawingNo || "—")}</b></div>
          <div><span>Drawing Name:</span> ${escapeHtml(item.drawingName || "—")}</div>
          <div><span>โครงการ:</span> ${escapeHtml(item.projectName || "—")}</div>
          <div><span>Revise:</span> ${escapeHtml(item.currentRevise || item.reviseNumber || "—")}</div>
          <div><span>กำหนดส่ง:</span> ${item.dueDate ? new Date(item.dueDate).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" }) : "—"}</div>
          ${note ? `<div class="span-full"><span>📝 หมายเหตุจากผู้เขียนแบบ:</span> ${escapeHtml(note)}</div>` : ""}
        </div>
      </div>

      <!-- ไฟล์งาน -->
      <div class="mgr-file-review-block">
        <div class="mgr-file-review-label">📎 ไฟล์งานที่ส่งมา</div>
        <div class="mgr-file-review-links">
          ${item.dwgFileUrl ? `<a href="${escapeHtml(item.dwgFileUrl)}" target="_blank" rel="noopener noreferrer" class="mgr-file-btn dwg-btn"><span>📐</span><span>DWG</span></a>` : ""}
          ${item.pdfFileUrl ? `<a href="${escapeHtml(item.pdfFileUrl)}" target="_blank" rel="noopener noreferrer" class="mgr-file-btn pdf-btn"><span>📄</span><span>PDF</span></a>` : ""}
          ${otherFiles.map((f) => `<a href="${escapeHtml(f.url)}" target="_blank" rel="noopener noreferrer" class="mgr-file-btn other-btn"><span>📎</span><span>${escapeHtml(f.name)}</span></a>`).join("")}
          ${!item.dwgFileUrl && !item.pdfFileUrl && !otherFiles.length ? `<span class="mgr-file-missing">— ไม่มีไฟล์แนบ</span>` : ""}
        </div>
      </div>

      <div class="admin-card-footer">
        <div class="admin-card-actions" style="width:100%;justify-content:flex-end;">
          <button class="secondary-button small-flow-button" data-review-action="toggle-revise" data-request="${escapeHtml(item.requestNo)}">✏️ ขอแก้ไข</button>
          <button class="danger-button small-flow-button" data-review-action="toggle-reject" data-request="${escapeHtml(item.requestNo)}">❌ Reject</button>
          <button class="primary-button small-flow-button" data-review-action="approve" data-request="${escapeHtml(item.requestNo)}">✅ ตรวจรับงาน</button>
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

// เก็บ AbortController ของแต่ละ view เพื่อ cancel listener เก่าก่อน bind ใหม่
const _requesterAbortMap = new WeakMap();

function bindRequesterReviewEvents(view, state) {
  // ยกเลิก listener เก่าถ้ามี
  _requesterAbortMap.get(view)?.abort();
  const ac = new AbortController();
  _requesterAbortMap.set(view, ac);
  const signal = ac.signal;

  view.addEventListener("click", async (event) => {
    if (signal.aborted) return;
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

          <!-- ── โฟลเดอร์ + ไฟล์ + ลิงก์ ── -->
          <div class="request-detail-files">
            <strong>📎 ไฟล์ / โฟลเดอร์ / ลิงก์</strong>
            <div class="mgr-file-review-links" style="margin-top:8px;flex-wrap:wrap;gap:8px;display:flex;">
              <a href="${escapeHtml(getRequestFolderUrl(request.requestNo))}"
                target="_blank" rel="noopener noreferrer"
                class="mgr-file-btn folder-btn"
                style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;font-size:13px;">
                📁 เปิดโฟลเดอร์ SharePoint
              </a>
              ${request.dwgFileUrl ? `
                <a href="${escapeHtml(request.dwgFileUrl)}" target="_blank" rel="noopener noreferrer"
                  class="mgr-file-btn dwg-btn"
                  style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;font-size:13px;">
                  📐 ไฟล์ DWG
                </a>` : ""}
              ${request.pdfFileUrl ? `
                <a href="${escapeHtml(request.pdfFileUrl)}" target="_blank" rel="noopener noreferrer"
                  class="mgr-file-btn pdf-btn"
                  style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;font-size:13px;">
                  📄 ไฟล์ PDF
                </a>` : ""}
              ${request.dataLink ? `
                <a href="${escapeHtml(request.dataLink)}" target="_blank" rel="noopener noreferrer"
                  class="mgr-file-btn ref-btn"
                  style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;font-size:13px;">
                  🔗 ลิงก์แนบจากผู้ส่งคำร้อง
                </a>` : ""}
            </div>
          </div>

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

// ══════════════════════════════════════════════════════════════
// DELIVERY FORM — ใบส่งมอบงาน FM-SEN-009
// ══════════════════════════════════════════════════════════════

let deliverySig2 = null; // Reviewed by (ผู้ร้องขอ)
let deliverySig3 = null; // Approved by (ผู้จัดการผู้ร้องขอ)
let deliveryDrawing2 = false;
let deliveryDrawing3 = false;
let deliveryCurrentCanvas = null;

function openDeliveryFormModal(view, state, request) {
  const thaiDate = (iso) => iso
    ? new Date(iso).toLocaleDateString("th-TH", { year:"numeric", month:"short", day:"numeric" })
    : "—";

  deliverySig2 = null;
  deliverySig3 = null;

  // ข้อมูลอัตโนมัติ
  const issuedName  = request.assignedToName   || "—";
  const issuedDate  = thaiDate(request.approvedLv2At || request.submittedAt);
  const checkerName = request.mgrApprovedBy    || "—";
  const checkerDate = thaiDate(request.mgrApprovedAt);
  const reviewName  = request.requesterName    || "—";
  const reviewDate  = thaiDate(request.reviewedAt || request.doneAt);
  const today       = thaiDate(new Date().toISOString());

  const canvasStyle = "border:1.5px dashed #CBD5E1;border-radius:8px;background:#FAFAFA;cursor:crosshair;touch-action:none;width:100%;height:90px;display:block;";

  const body = `
    <div style="font-size:13px;color:#334155;">

      <!-- ข้อมูลคำร้อง -->
      <div style="background:#F0F6FF;border-radius:8px;padding:12px 14px;margin-bottom:14px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;">
          <div><span style="color:#64748B;font-size:11px;">เลขที่คำร้อง</span><br><b>${escapeHtml(request.requestNo)}</b></div>
          <div><span style="color:#64748B;font-size:11px;">โครงการ</span><br><b>${escapeHtml(request.projectName || "—")}</b></div>
          <div><span style="color:#64748B;font-size:11px;">Drawing No.</span><br><b>${escapeHtml(request.drawingNo || "—")}</b></div>
          <div><span style="color:#64748B;font-size:11px;">Drawing Name</span><br><b>${escapeHtml(request.drawingName || "—")}</b></div>
          <div><span style="color:#64748B;font-size:11px;">Revise</span><br><b>${escapeHtml(request.currentRevise || request.reviseNumber || "R01")}</b></div>
          <div><span style="color:#64748B;font-size:11px;">วันที่ส่งมอบ</span><br><b>${checkerDate}</b></div>
        </div>
      </div>

      <!-- ลายเซ็น 4 ช่อง -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">

        <!-- Issued by (อัตโนมัติ) -->
        <div style="border:1px solid #E2E8F0;border-radius:8px;padding:10px;">
          <div style="font-size:11px;font-weight:600;color:#005DAC;margin-bottom:6px;">Issued by — ผู้เขียนแบบ</div>
          <div style="background:#F8FAFC;border-radius:6px;padding:8px 10px;font-size:12px;">
            <b>${escapeHtml(issuedName)}</b><br>
            <span style="color:#64748B;font-size:11px;">วันที่: ${escapeHtml(issuedDate)}</span><br>
            <span style="color:#94A3B8;font-size:10px;">Drawing Department</span>
          </div>
          <div style="font-size:10px;color:#94A3B8;margin-top:4px;text-align:center;">ระบบบันทึกอัตโนมัติ</div>
        </div>

        <!-- Checker by (อัตโนมัติ) -->
        <div style="border:1px solid #E2E8F0;border-radius:8px;padding:10px;">
          <div style="font-size:11px;font-weight:600;color:#005DAC;margin-bottom:6px;">Checker by — ผู้จัดการฝ่ายแบบ</div>
          <div style="background:#F8FAFC;border-radius:6px;padding:8px 10px;font-size:12px;">
            <b>${escapeHtml(checkerName)}</b><br>
            <span style="color:#64748B;font-size:11px;">วันที่: ${escapeHtml(checkerDate)}</span><br>
            <span style="color:#94A3B8;font-size:10px;">Drawing Department</span>
          </div>
          <div style="font-size:10px;color:#94A3B8;margin-top:4px;text-align:center;">ระบบบันทึกอัตโนมัติ</div>
        </div>

        <!-- Reviewed by (วาดเอง) -->
        <div style="border:1px solid #E2E8F0;border-radius:8px;padding:10px;">
          <div style="font-size:11px;font-weight:600;color:#0DB14B;margin-bottom:6px;">Reviewed by — ผู้ร้องขอ</div>
          <div style="font-size:11px;color:#334155;margin-bottom:4px;"><b>${escapeHtml(reviewName)}</b> · ${escapeHtml(reviewDate)}</div>
          <canvas id="deliverySig2" style="${canvasStyle}"></canvas>
          <div style="display:flex;justify-content:space-between;margin-top:4px;">
            <span id="deliverySig2Status" style="font-size:10px;color:#94A3B8;">วาดลายเซ็น</span>
            <button type="button" onclick="clearDeliverySig(2)" style="font-size:10px;color:#EF4444;background:none;border:none;cursor:pointer;">ล้าง</button>
          </div>
        </div>

        <!-- Approved by (กรอก + วาด) -->
        <div style="border:1px solid #E2E8F0;border-radius:8px;padding:10px;">
          <div style="font-size:11px;font-weight:600;color:#0DB14B;margin-bottom:6px;">Approved by — ผู้จัดการผู้ร้องขอ</div>
          <input id="deliveryApprovedName" type="text" placeholder="กรอกชื่อผู้อนุมัติ..."
            style="width:100%;height:30px;padding:0 8px;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;margin-bottom:6px;box-sizing:border-box;" />
          <canvas id="deliverySig3" style="${canvasStyle}"></canvas>
          <div style="display:flex;justify-content:space-between;margin-top:4px;">
            <span id="deliverySig3Status" style="font-size:10px;color:#94A3B8;">วาดลายเซ็น</span>
            <button type="button" onclick="clearDeliverySig(3)" style="font-size:10px;color:#EF4444;background:none;border:none;cursor:pointer;">ล้าง</button>
          </div>
        </div>
      </div>

      <div id="deliveryPreviewSection" style="display:none;margin-top:14px;">
        <div style="font-size:12px;font-weight:600;color:#334155;margin-bottom:8px;">Preview ใบส่งมอบ</div>
        <div id="deliveryPdfPreview" style="background:#fff;border:1px solid #E2E8F0;border-radius:8px;padding:20px;font-family:Arial,sans-serif;font-size:10px;color:#111;"></div>
      </div>

    </div>
  `;

  openModal({
    title: "📄 ใบส่งมอบงาน FM-SEN-009",
    body,
    size: "large",
    actions: [
      { label: "ยกเลิก", className: "secondary-button" },
      {
        label: "👁️ Preview PDF",
        className: "secondary-button",
        onClick: (close) => {
          renderDeliveryPreview(request, issuedName, issuedDate, checkerName, checkerDate, reviewName, reviewDate, today);
          return false; // ไม่ปิด modal
        },
      },
      {
        label: "📄 Export & บันทึก",
        className: "primary-button",
        onClick: async (close) => {
          const approvedName = document.getElementById("deliveryApprovedName")?.value.trim();
          if (!approvedName) {
            showToast("กรุณากรอกชื่อ Approved by", "warning");
            return;
          }
          try {
            await exportDeliveryPDF(view, state, request, {
              issuedName, issuedDate, checkerName, checkerDate,
              reviewName, reviewDate, approvedName, today,
            });
            close();
          } catch (err) {
            showToast(`เกิดข้อผิดพลาด: ${err.message}`, "error");
          }
        },
      },
    ],
  });

  // ผูก signature pad หลัง modal render
  setTimeout(() => {
    bindDeliveryCanvas("deliverySig2", 2);
    bindDeliveryCanvas("deliverySig3", 3);
  }, 100);
}

function bindDeliveryCanvas(canvasId, sigNum) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let drawing = false, lx, ly;

  const getPos = (e) => {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width;
    const sy = canvas.height / r.height;
    if (e.touches) return { x: (e.touches[0].clientX - r.left) * sx, y: (e.touches[0].clientY - r.top) * sy };
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  };

  // set canvas pixel size
  canvas.width  = canvas.offsetWidth  || 280;
  canvas.height = 90;

  const start = (e) => { e.preventDefault(); drawing = true; const p = getPos(e); lx = p.x; ly = p.y; };
  const move  = (e) => {
    e.preventDefault();
    if (!drawing) return;
    const p = getPos(e);
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.stroke();
    lx = p.x; ly = p.y;
    const data = canvas.toDataURL("image/png");
    if (sigNum === 2) deliverySig2 = data;
    if (sigNum === 3) deliverySig3 = data;
    const statusEl = document.getElementById(`deliverySig${sigNum}Status`);
    if (statusEl) { statusEl.textContent = "✅ มีลายเซ็น"; statusEl.style.color = "#0DB14B"; }
  };
  const stop  = () => drawing = false;

  canvas.addEventListener("mousedown", start);
  canvas.addEventListener("mousemove", move);
  canvas.addEventListener("mouseup", stop);
  canvas.addEventListener("mouseleave", stop);
  canvas.addEventListener("touchstart", start, { passive: false });
  canvas.addEventListener("touchmove",  move,  { passive: false });
  canvas.addEventListener("touchend",   stop);
}

window.clearDeliverySig = function(sigNum) {
  const canvas = document.getElementById(`deliverySig${sigNum}`);
  if (!canvas) return;
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  if (sigNum === 2) deliverySig2 = null;
  if (sigNum === 3) deliverySig3 = null;
  const statusEl = document.getElementById(`deliverySig${sigNum}Status`);
  if (statusEl) { statusEl.textContent = "วาดลายเซ็น"; statusEl.style.color = "#94A3B8"; }
};

function renderDeliveryPreview(request, issuedName, issuedDate, checkerName, checkerDate, reviewName, reviewDate, today) {
  const approvedName = document.getElementById("deliveryApprovedName")?.value.trim() || "—";
  const preview = document.getElementById("deliveryPdfPreview");
  const section = document.getElementById("deliveryPreviewSection");
  if (!preview || !section) return;
  section.style.display = "block";
  preview.innerHTML = buildDeliveryHTML(request, { issuedName, issuedDate, checkerName, checkerDate, reviewName, reviewDate, approvedName, today });
  preview.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function buildDeliveryHTML(request, d) {
  const logoUrl = "./PPC NEW-2024 - R1.png";
  const sig2 = deliverySig2 ? `<img src="${deliverySig2}" style="max-height:28px;max-width:90%;">` : "";
  const sig3 = deliverySig3 ? `<img src="${deliverySig3}" style="max-height:28px;max-width:90%;">` : "";

  return `
    <div style="font-family:Arial,sans-serif;font-size:10px;color:#111;max-width:560px;margin:0 auto;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
        <tr>
          <td style="width:35%;"><img src="${logoUrl}" style="max-height:40px;" onerror="this.style.display='none'"></td>
          <td style="text-align:center;font-size:13px;font-weight:700;">ทวนสอบและอนุมัติแบบ</td>
          <td style="text-align:right;font-size:9px;color:#555;">FM-SEN-009 Rev.02<br>หน้า 1 / 1</td>
        </tr>
      </table>
      <div style="height:2px;background:#1a6cc8;margin-bottom:10px;"></div>

      <table style="width:100%;margin-bottom:8px;">
        <tr>
          <td style="font-size:10px;"><b>PROJECT :</b> ${escapeHtml(request.projectName || "—")}</td>
          <td style="font-size:10px;text-align:right;"><b>TRANS NO :</b> ${escapeHtml(request.requestNo)}</td>
        </tr>
        <tr><td colspan="2" style="font-size:10px;"><b>DATE :</b> ${escapeHtml(d.today)}</td></tr>
      </table>

      <div style="font-size:10px;margin-bottom:6px;"><b>PLEASE FIND ATTACHED THE FOLLOWING :</b> &nbsp; <b>FOR : A — APPROVAL</b></div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:10px;font-size:9px;">
        <thead>
          <tr style="background:#1a6cc8;color:#fff;">
            <th style="padding:4px 6px;text-align:left;width:24px;">Item</th>
            <th style="padding:4px 6px;text-align:left;">Document / Drawing No.</th>
            <th style="padding:4px 6px;width:36px;">Rev.</th>
            <th style="padding:4px 6px;text-align:left;">Title</th>
            <th style="padding:4px 6px;width:28px;">For</th>
            <th style="padding:4px 6px;width:54px;">Approval Status</th>
          </tr>
        </thead>
        <tbody>
          <tr style="background:#F5F8FE;">
            <td style="padding:4px 6px;border:0.5px solid #ddd;">1</td>
            <td style="padding:4px 6px;border:0.5px solid #ddd;">${escapeHtml(request.drawingNo || "—")}</td>
            <td style="padding:4px 6px;border:0.5px solid #ddd;text-align:center;">${escapeHtml(request.currentRevise || request.reviseNumber || "R01")}</td>
            <td style="padding:4px 6px;border:0.5px solid #ddd;">${escapeHtml(request.drawingName || "—")}</td>
            <td style="padding:4px 6px;border:0.5px solid #ddd;text-align:center;">A</td>
            <td style="padding:4px 6px;border:0.5px solid #ddd;text-align:center;font-weight:700;color:#1a6cc8;">AP</td>
          </tr>
          ${[2,3,4,5,6,7].map(() => `<tr><td style="border:0.5px solid #ddd;padding:4px 6px;">&nbsp;</td><td style="border:0.5px solid #ddd;">&nbsp;</td><td style="border:0.5px solid #ddd;">&nbsp;</td><td style="border:0.5px solid #ddd;">&nbsp;</td><td style="border:0.5px solid #ddd;">&nbsp;</td><td style="border:0.5px solid #ddd;">&nbsp;</td></tr>`).join("")}
        </tbody>
      </table>

      <div style="font-size:8.5px;font-weight:700;margin-bottom:4px;">***Approval Status*** — AP: Approved &nbsp; AC: Approved with Comment &nbsp; RC: Return for Correction &nbsp; X: Rejected</div>
      <div style="border:0.5px solid #ddd;border-radius:3px;padding:5px;font-size:9px;color:#555;min-height:24px;margin-bottom:10px;">Note: ................................................................</div>

      <table style="width:100%;border-collapse:collapse;font-size:9px;">
        <tr>
          <td style="width:50%;border:0.5px solid #ccc;padding:8px;vertical-align:top;">
            <div style="font-weight:700;margin-bottom:6px;">Issued by :</div>
            <div style="min-height:28px;border-bottom:0.5px solid #ccc;margin-bottom:4px;display:flex;align-items:center;">
              <span style="color:#555;font-size:8px;font-style:italic;">(ชื่อ-นามสกุล)</span>
            </div>
            <div style="font-weight:700;">${escapeHtml(d.issuedName)}</div>
            <div style="color:#555;">วันที่: ${escapeHtml(d.issuedDate)}</div>
            <div style="color:#888;">Division / Department: Drawing</div>
          </td>
          <td style="width:50%;border:0.5px solid #ccc;padding:8px;vertical-align:top;">
            <div style="font-weight:700;margin-bottom:6px;">Checker by :</div>
            <div style="min-height:28px;border-bottom:0.5px solid #ccc;margin-bottom:4px;display:flex;align-items:center;">
              <span style="color:#555;font-size:8px;font-style:italic;">(ชื่อ-นามสกุล)</span>
            </div>
            <div style="font-weight:700;">${escapeHtml(d.checkerName)}</div>
            <div style="color:#555;">วันที่: ${escapeHtml(d.checkerDate)}</div>
            <div style="color:#888;">Division / Department: Drawing</div>
          </td>
        </tr>
        <tr>
          <td style="width:50%;border:0.5px solid #ccc;padding:8px;vertical-align:top;">
            <div style="font-weight:700;margin-bottom:6px;">Reviewed by :</div>
            <div style="min-height:32px;border-bottom:0.5px solid #ccc;margin-bottom:4px;display:flex;align-items:center;">
              ${sig2 || `<span style="color:#555;font-size:8px;font-style:italic;">(ลายเซ็น)</span>`}
            </div>
            <div style="font-weight:700;">${escapeHtml(d.reviewName)}</div>
            <div style="color:#555;">วันที่: ${escapeHtml(d.reviewDate)}</div>
          </td>
          <td style="width:50%;border:0.5px solid #ccc;padding:8px;vertical-align:top;">
            <div style="font-weight:700;margin-bottom:6px;">Approved by :</div>
            <div style="min-height:32px;border-bottom:0.5px solid #ccc;margin-bottom:4px;display:flex;align-items:center;">
              ${sig3 || `<span style="color:#555;font-size:8px;font-style:italic;">(ลายเซ็น)</span>`}
            </div>
            <div style="font-weight:700;">${escapeHtml(d.approvedName)}</div>
            <div style="color:#555;">วันที่: ${escapeHtml(d.today)}</div>
          </td>
        </tr>
      </table>

      <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:8px;color:#888;">
        <span>Form Page 1 / 1</span>
        <span>FM-SEN-009 Rev.02 (01/08/2568)</span>
      </div>
    </div>
  `;
}

async function exportDeliveryPDF(view, state, request, d) {
  showToast("กำลัง generate PDF...", "info");

  // สร้าง iframe ชั่วคราวสำหรับ print
  const printFrame = document.createElement("iframe");
  printFrame.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:210mm;height:297mm;border:none;";
  document.body.appendChild(printFrame);

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>
      body { margin:15mm; font-family:Arial,sans-serif; font-size:10px; }
      @media print { body { margin:10mm; } }
      @page { size:A4; margin:10mm; }
    </style>
  </head><body>${buildDeliveryHTML(request, d)}</body></html>`;

  printFrame.contentDocument.open();
  printFrame.contentDocument.write(html);
  printFrame.contentDocument.close();

  await new Promise(r => setTimeout(r, 500));

  printFrame.contentWindow.focus();
  printFrame.contentWindow.print();

  setTimeout(() => document.body.removeChild(printFrame), 2000);

  // บันทึก metadata ลง SharePoint
  const now = new Date().toISOString();
  try {
    await patchRequest(request, {
      deliveryFormGeneratedAt: now,
    }, `สร้างใบส่งมอบงาน FM-SEN-009`);
    showToast("สร้างใบส่งมอบสำเร็จ — กด Print หรือ Save as PDF ในหน้าต่างที่เปิดขึ้น", "success");
  } catch (err) {
    console.warn("บันทึก deliveryFormGeneratedAt ไม่สำเร็จ:", err.message);
    showToast("สร้างใบส่งมอบสำเร็จ", "success");
  }
}

// ── Sendwork Upload Progress Overlay ─────────────────────────
function showSendworkProgress(percent, fileName, totalFiles, uploadedFiles) {
  let overlay = document.querySelector("#sendwork-progress-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "sendwork-progress-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;";
    document.body.appendChild(overlay);
  }
  const isDone = percent >= 100;
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:32px 40px;min-width:360px;max-width:480px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center;">
      <div style="font-size:36px;margin-bottom:12px;">${isDone ? "✅" : "⬆️"}</div>
      <div style="font-size:17px;font-weight:700;color:#1E293B;margin-bottom:4px;">${isDone ? "อัปโหลดเสร็จสิ้น!" : "กำลังอัปโหลดไฟล์..."}</div>
      ${fileName ? `<div style="font-size:12px;color:#64748B;margin-bottom:16px;word-break:break-all;">📄 ${fileName}</div>` : "<div style='margin-bottom:16px;'></div>"}
      <div style="background:#E2E8F0;border-radius:999px;height:10px;overflow:hidden;margin-bottom:10px;">
        <div style="height:100%;border-radius:999px;background:linear-gradient(90deg,#005DAC,#0DB14B);width:${percent}%;transition:width 0.3s ease;"></div>
      </div>
      <div style="font-size:13px;color:#005DAC;font-weight:600;">${percent}%</div>
      ${totalFiles > 1 ? `<div style="font-size:11px;color:#94A3B8;margin-top:6px;">ไฟล์ที่ ${uploadedFiles} จาก ${totalFiles} ไฟล์</div>` : ""}
      ${isDone ? "" : `<div style="font-size:11px;color:#94A3B8;margin-top:8px;">กรุณารอสักครู่ อย่าปิดหน้าต่าง</div>`}
    </div>
  `;
}

function hideSendworkProgress() {
  document.querySelector("#sendwork-progress-overlay")?.remove();
}
