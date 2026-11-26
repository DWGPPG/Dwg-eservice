// ══════════════════════════════════════════════════════════════
// UI ขอเลื่อนกำหนดส่ง: ช่องกำหนดส่งในตาราง · ฟอร์มขอเลื่อน · ปุ่มยอมรับ/ไม่ยอมรับ · แถบแจ้งเตือนผู้ส่งคำร้อง
// ══════════════════════════════════════════════════════════════

import { STATUS } from "../../../config/schema.js";
import { state } from "../state.js";
import { escapeHtml, formatDateOnly } from "../utils.js";
import { checkOffDay, offDayText } from "../services/due-date.js";
import {
  DUE_CHANGE_CAUSES, DUE_REJECT_IMPACTS, MIN_REASON, MIN_REJECT_REASON,
  cancelDueChange, getDueChange, pendingForRequester, requestDueChange, respondDueChange, visibleDueChange,
  extensionWorkingDays, managerDecideDueChange, mgrApprovalReasons, pendingForManager,
} from "../services/due-change-service.js";
import { openModal } from "./modal.js";
import { showToast } from "./toast.js";

const norm = (v) => String(v || "").trim().toLowerCase();
const thShort = (iso) => (iso ? new Date(iso).toLocaleDateString("th-TH", { month: "short", day: "numeric" }) : "—");
const keyOfDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** สถานะที่ขอเลื่อนได้ */
export const canRequestDueChange = (r) => [STATUS.APPROVED, STATUS.WORKING, STATUS.MGR_REJECTED].includes(r.status);
const isRequesterOf = (r) => norm(state.user?.email) === norm(r.requesterEmail);
const isStaff = () => ["designer", "manager"].includes(state.user?.role);

/** ช่อง "กำหนดส่ง" ในตาราง — วันที่ + ป้ายสถานะคำขอเลื่อน (+ ปุ่มสำหรับผู้ที่ต้องทำ) */
export function dueCellHtml(item) {
  const c = visibleDueChange(item.requestNo);
  if (!c) return escapeHtml(formatDateOnly(item.dueDate));
  // ขั้นผู้จัดการอนุมัติ — ผู้ส่งคำร้องยังไม่เห็น (เห็นเมื่อผู้จัดการอนุมัติแล้วเท่านั้น)
  if (c.status === "mgr_pending" || c.status === "mgr_rejected") {
    if (isRequesterOf(item) && !isStaff()) return escapeHtml(formatDateOnly(item.dueDate));
    if (c.status === "mgr_pending") {
      return `<div class="due-cell is-pending"><b>${escapeHtml(formatDateOnly(item.dueDate))}</b>
        <span class="due-chip amber">📅 ขอเลื่อน → ${escapeHtml(thShort(c.newDue))}</span>
        <span class="due-chip violet">🛡️ รอผู้จัดการอนุมัติ</span>
        ${state.user?.role === "manager" ? `
          <div class="due-callout"><b>เหตุที่ต้องอนุมัติ:</b> ${escapeHtml((c.mgrReasons || []).join(" · "))}<br><b>สาเหตุ:</b> ${escapeHtml(c.cause)}<br><b>เหตุผล:</b> ${escapeHtml(c.reason)}<br><small>โดย ${escapeHtml(c.by)}</small></div>
          <div class="due-actions"><button type="button" class="due-btn green" data-due-mgr-approve="${escapeHtml(item.requestNo)}">🛡️ อนุมัติ</button><button type="button" class="due-btn red" data-due-mgr-reject="${escapeHtml(item.requestNo)}">⛔ ไม่อนุมัติ</button></div>`
        : `<button type="button" class="due-btn amber" data-due-cancel="${escapeHtml(item.requestNo)}">↩️ ยกเลิกคำขอเลื่อน</button>`}
      </div>`;
    }
    return `<div class="due-cell"><b>${escapeHtml(formatDateOnly(item.dueDate))}</b><span class="due-chip red">⛔ ผู้จัดการไม่อนุมัติเลื่อน</span>
      ${c.mgrNote ? `<div class="due-callout red"><b>เหตุผล:</b> ${escapeHtml(c.mgrNote)}<br><small>${escapeHtml(c.mgrBy || "")}</small></div>` : ""}</div>`;
  }
  if (c.status === "pending") {
    const mine = isRequesterOf(item);
    return `<div class="due-cell is-pending">
      ${mine ? `<span><s>${escapeHtml(thShort(c.oldDue))}</s> → <b class="due-new">${escapeHtml(formatDateOnly(c.newDue))}</b></span>` : `<b>${escapeHtml(formatDateOnly(item.dueDate))}</b>`}
      <span class="due-chip amber">📅 ขอเลื่อน → ${escapeHtml(thShort(c.newDue))}</span>
      ${mine ? `
        <div class="due-callout"><b>สาเหตุ:</b> ${escapeHtml(c.cause)}<br><b>เหตุผล:</b> ${escapeHtml(c.reason)}<br><small>โดย ${escapeHtml(c.by)}</small></div>
        <div class="due-actions">
          <button type="button" class="due-btn green" data-due-accept="${escapeHtml(item.requestNo)}">✅ ยอมรับเลื่อน</button>
          <button type="button" class="due-btn red" data-due-reject="${escapeHtml(item.requestNo)}">⛔ ไม่ยอมรับ</button>
        </div>`
      : `<small class="due-wait">⏳ รอผู้ส่งคำร้องยืนยัน</small>
         ${isStaff() ? `<button type="button" class="due-btn amber" data-due-cancel="${escapeHtml(item.requestNo)}">↩️ ยกเลิกคำขอเลื่อน</button>` : ""}`}
    </div>`;
  }
  if (c.status === "accepted") {
    return `<div class="due-cell"><span><s>${escapeHtml(thShort(c.oldDue))}</s> <b class="due-ok">${escapeHtml(formatDateOnly(item.dueDate))}</b></span>
      <span class="due-chip green">✅ ${isRequesterOf(item) ? "คุณยอมรับการเลื่อนแล้ว" : "เลื่อนแล้ว (ผู้ส่งยอมรับ)"}</span></div>`;
  }
  return `<div class="due-cell"><b>${escapeHtml(formatDateOnly(item.dueDate))}</b>
    <span class="due-chip red">⛔ ${isRequesterOf(item) ? "คุณยืนยันวันเดิม" : "ผู้ส่งไม่ยอมเลื่อน"}</span>
    ${isRequesterOf(item) ? "" : `<div class="due-callout red"><b>เหตุผล:</b> ${escapeHtml(c.responseReason)}<br><b>ผลกระทบ:</b> ${escapeHtml(c.impact)}</div>`}</div>`;
}

/** แถบแจ้งเตือนผู้ส่งคำร้องที่มีคำขอรอยืนยัน */
export function pendingBannerHtml() {
  const list = pendingForRequester();
  if (!list.length) return "";
  return `<div class="due-banner">📅 <div><div>มีคำขอ<b>เลื่อนกำหนดส่ง ${list.length} รายการ</b> รอคุณยืนยัน — กด <b>ยอมรับ</b> หรือ <b>ไม่ยอมรับ</b> ได้ที่นี่เลย (กดเลขคำร้องเพื่อดูรายละเอียด)</div>
    <div class="due-banner-list">${list.map((r) => {
      const c = getDueChange(r.requestNo) || {};
      return `<div class="due-banner-item">
        <button type="button" class="due-banner-req" data-request-detail="${escapeHtml(r.requestNo)}">📋 ${escapeHtml(r.requestNo)}</button>
        <span class="due-banner-info"><s>${escapeHtml(thShort(c.oldDue))}</s> → <b class="due-new">${escapeHtml(thShort(c.newDue))}</b> · ${escapeHtml(r.drawingNo || r.projectName || "")}<br><small>${escapeHtml(c.cause || "")} — ${escapeHtml(c.reason || "")}</small></span>
        <span class="due-actions"><button type="button" class="due-btn green" data-due-accept="${escapeHtml(r.requestNo)}">✅ ยอมรับ</button><button type="button" class="due-btn red" data-due-reject="${escapeHtml(r.requestNo)}">⛔ ไม่ยอมรับ</button></span>
      </div>`;
    }).join("")}</div></div></div>`;
}

/** แถบผู้จัดการ: คำขอเลื่อนที่รออนุมัติ */
export function mgrBannerHtml() {
  const list = pendingForManager();
  if (!list.length) return "";
  return `<div class="due-banner is-mgr">🛡️ <div><div>มีคำขอ<b>เลื่อนกำหนดส่ง ${list.length} รายการ</b> รอผู้จัดการอนุมัติก่อนส่งให้ผู้ส่งคำร้องยืนยัน</div>
    <div class="due-banner-list">${list.map((r) => {
      const c = getDueChange(r.requestNo) || {};
      return `<div class="due-banner-item">
        <button type="button" class="due-banner-req" data-request-detail="${escapeHtml(r.requestNo)}">📋 ${escapeHtml(r.requestNo)}</button>
        <span class="due-banner-info"><s>${escapeHtml(thShort(c.oldDue))}</s> → <b class="due-new">${escapeHtml(thShort(c.newDue))}</b> (+${extensionWorkingDays(c.oldDue, c.newDue)} วันทำการ) · ${escapeHtml(c.by || "")} · ${escapeHtml(r.drawingNo || r.projectName || "")}<br>
          <small>🛡️ ${escapeHtml((c.mgrReasons || []).join(" · "))}<br>${escapeHtml(c.cause || "")} — ${escapeHtml(c.reason || "")}</small></span>
        <span class="due-actions"><button type="button" class="due-btn green" data-due-mgr-approve="${escapeHtml(r.requestNo)}">🛡️ อนุมัติ</button><button type="button" class="due-btn red" data-due-mgr-reject="${escapeHtml(r.requestNo)}">⛔ ไม่อนุมัติ</button></span>
      </div>`;
    }).join("")}</div></div></div>`;
}

/** กล่องในหน้ารายละเอียดคำร้อง */
export function dueChangeDetailHtml(request) {
  const c = getDueChange(request.requestNo);
  if (!c || c.status === "cancelled") return "";
  if (["mgr_pending", "mgr_rejected"].includes(c.status) && isRequesterOf(request) && !isStaff()) return "";
  const label = { mgr_pending: "🛡️ รอผู้จัดการอนุมัติ", mgr_rejected: "⛔ ผู้จัดการไม่อนุมัติ", pending: "⏳ รอผู้ส่งคำร้องยืนยัน", accepted: "✅ ผู้ส่งคำร้องยอมรับแล้ว", rejected: "⛔ ผู้ส่งคำร้องยืนยันวันเดิม" }[c.status];
  return `<div class="request-detail-note due-detail is-${c.status}">
    <span>📅 คำขอเลื่อนกำหนดส่ง — ${label}</span>
    <strong>${escapeHtml(formatDateOnly(c.oldDue))} → ${escapeHtml(formatDateOnly(c.newDue))}</strong>
    <div><b>สาเหตุ:</b> ${escapeHtml(c.cause)} · <b>เหตุผล:</b> ${escapeHtml(c.reason)} <small>(${escapeHtml(c.by)})</small></div>
    ${c.mgrReasons?.length ? `<div><b>เหตุที่ต้องให้ผู้จัดการอนุมัติ:</b> ${escapeHtml(c.mgrReasons.join(" · "))}</div>` : ""}
    ${c.mgrBy ? `<div><b>ผู้จัดการ:</b> ${escapeHtml(c.mgrBy)} — ${c.status === "mgr_rejected" ? "ไม่อนุมัติ" : "อนุมัติ"}${c.requestedDue && c.requestedDue !== c.newDue ? ` (ปรับจากที่ขอ ${escapeHtml(formatDateOnly(c.requestedDue))})` : ""}${c.mgrNote ? ` · ${escapeHtml(c.mgrNote)}` : ""}</div>` : ""}
    ${c.status === "mgr_pending" && state.user?.role === "manager" ? `<div class="due-actions"><button type="button" class="due-btn green" data-due-mgr-approve="${escapeHtml(request.requestNo)}">🛡️ อนุมัติ</button><button type="button" class="due-btn red" data-due-mgr-reject="${escapeHtml(request.requestNo)}">⛔ ไม่อนุมัติ</button></div>` : ""}
    ${c.status === "rejected" ? `<div><b>เหตุผลที่ไม่ยอมรับ:</b> ${escapeHtml(c.responseReason)} · <b>ผลกระทบ:</b> ${escapeHtml(c.impact)}</div>` : ""}
    ${c.status === "accepted" && c.responseReason ? `<div><b>หมายเหตุผู้ส่งคำร้อง:</b> ${escapeHtml(c.responseReason)}</div>` : ""}
    ${c.status === "pending" && isRequesterOf(request) ? `<div class="due-actions"><button type="button" class="due-btn green" data-due-accept="${escapeHtml(request.requestNo)}">✅ ยอมรับเลื่อน</button><button type="button" class="due-btn red" data-due-reject="${escapeHtml(request.requestNo)}">⛔ ไม่ยอมรับ</button></div>` : ""}
  </div>`;
}

let afterChange = () => {};
/** ให้หน้าที่ใช้งานวาดใหม่หลังมีการเปลี่ยนแปลง */
export function onDueChange(fn) { afterChange = fn || (() => {}); }

function closeOpenModal() { document.querySelector("#modal-root .modal header .icon-button")?.click(); }

/** ฟอร์มขอเลื่อน (ผู้เขียนแบบ / ผู้จัดการ) */
export function openDueChangeRequestModal(request) {
  if (["pending", "mgr_pending"].includes(getDueChange(request.requestNo)?.status)) { showToast("คำร้องนี้มีคำขอเลื่อนรอผู้ส่งคำร้องยืนยันอยู่แล้ว", "warning"); return; }
  const cur = request.dueDate ? new Date(request.dueDate) : new Date();
  const min = new Date(cur.getTime() + 86400000);
  closeOpenModal();
  openModal({
    title: `📅 ขอเลื่อนกำหนดส่ง — ${request.requestNo}`,
    body: `
      <div class="due-form">
        <p class="manage-hint">${escapeHtml(request.projectName || "")} · ${escapeHtml(request.drawingNo || "")} ${escapeHtml(request.drawingName || "")}<br>กำหนดส่งจะเปลี่ยนเมื่อ<b>ผู้ส่งคำร้องยอมรับ</b>เท่านั้น — ระหว่างรอ วันเดิมยังมีผล</p>
        <div class="due-form-row">
          <label class="field"><span>กำหนดส่งเดิม</span><input type="text" value="${escapeHtml(formatDateOnly(request.dueDate))}" disabled /></label>
          <label class="field"><span>กำหนดส่งใหม่ที่ขอ <b class="req">*</b></span><input type="date" id="due-new" min="${keyOfDate(min)}" /></label>
        </div>
        <label class="field"><span>สาเหตุ <b class="req">*</b></span>
          <select id="due-cause"><option value="">— เลือกสาเหตุ —</option>${DUE_CHANGE_CAUSES.map((c) => `<option>${escapeHtml(c)}</option>`).join("")}</select></label>
        <label class="field"><span>เหตุผลโดยละเอียด <b class="req">*</b> <small>(อย่างน้อย ${MIN_REASON} ตัวอักษร)</small></span>
          <textarea id="due-reason" rows="4" placeholder="เช่น รอข้อมูลตำแหน่งเสาเข็มจากหน้างาน ได้รับ 25 พ.ย. ต้องใช้เวลาเพิ่ม 2 วันทำการ"></textarea></label>
        <div class="due-gate" id="due-gate" hidden></div>
      </div>`,
    actions: [
      { label: "ยกเลิก", className: "secondary-button" },
      {
        label: "📨 ส่งคำขอให้ผู้ส่งคำร้องยืนยัน",
        className: "primary-button",
        onClick: async (close) => {
          const newDue = document.querySelector("#due-new")?.value || "";
          const cause = document.querySelector("#due-cause")?.value || "";
          const reason = (document.querySelector("#due-reason")?.value || "").trim();
          if (!newDue) { showToast("กรุณาเลือกกำหนดส่งใหม่", "warning"); return; }
          if (newDue <= keyOfDate(cur)) { showToast("กำหนดส่งใหม่ต้องหลังวันเดิม", "warning"); return; }
          const off = checkOffDay(newDue);
          if (off) { showToast(`⛔ ${offDayText(off)} — กรุณาเลือกวันใหม่`, "warning"); return; }
          if (!cause) { showToast("กรุณาเลือกสาเหตุ", "warning"); return; }
          if (reason.length < MIN_REASON) { showToast(`กรุณาระบุเหตุผลโดยละเอียด (อย่างน้อย ${MIN_REASON} ตัวอักษร)`, "warning"); return; }
          try {
            const rec = await requestDueChange(request, { newDue, cause, reason });
            close();
            showToast(rec.status === "mgr_pending"
              ? `ส่งคำขอเลื่อน ${request.requestNo} ให้ผู้จัดการอนุมัติก่อนแล้ว`
              : `ส่งคำขอเลื่อน ${request.requestNo} ให้ผู้ส่งคำร้องยืนยันแล้ว`, "success");
            afterChange();
          } catch (error) { showToast(`ส่งคำขอไม่สำเร็จ: ${error.message}`, "error"); }
        },
      },
    ],
  });
  bindGateHint(request);
}

// แสดงล่วงหน้าว่าจะต้องให้ผู้จัดการอนุมัติไหม (คำนวณตามวันที่เลือก)
function bindGateHint(request) {
  const input = document.querySelector("#due-new");
  const box = document.querySelector("#due-gate");
  const update = () => {
    if (!input?.value || !box) { if (box) box.hidden = true; return; }
    const days = extensionWorkingDays(request.dueDate, new Date(`${input.value}T00:00:00`));
    const gate = mgrApprovalReasons(request, input.value);
    box.hidden = false;
    box.className = `due-gate ${gate.length ? "is-mgr" : ""}`;
    box.innerHTML = gate.length
      ? `🛡️ เลื่อน <b>${days} วันทำการ</b> — <b>ต้องให้ผู้จัดการอนุมัติก่อน</b> แล้วจึงส่งให้ผู้ส่งคำร้องยืนยัน<br><small>${escapeHtml(gate.join(" · "))}</small>`
      : `📨 เลื่อน <b>${days} วันทำการ</b> — ส่งให้ผู้ส่งคำร้องยืนยันได้เลย (แจ้งผู้จัดการให้ทราบ)`;
  };
  input?.addEventListener("change", update);
  input?.addEventListener("input", update);
}

function openMgrApproveModal(request) {
  const c = getDueChange(request.requestNo);
  if (!c) return;
  const toKey = (iso) => { const d = new Date(iso); return keyOfDate(d); };
  closeOpenModal();
  openModal({
    title: `🛡️ อนุมัติขอเลื่อน — ${request.requestNo}`,
    body: `
      <div class="due-form">
        <p class="manage-hint">${escapeHtml(request.projectName || "")} · ${escapeHtml(request.drawingNo || "")} · ขอโดย ${escapeHtml(c.by)}</p>
        <div class="due-callout" style="max-width:none"><b>เหตุที่ต้องอนุมัติ:</b> ${escapeHtml((c.mgrReasons || []).join(" · "))}<br><b>สาเหตุ:</b> ${escapeHtml(c.cause)}<br><b>เหตุผล:</b> ${escapeHtml(c.reason)}</div>
        <div class="due-form-row" style="margin-top:10px">
          <label class="field"><span>กำหนดส่งเดิม</span><input type="text" value="${escapeHtml(formatDateOnly(c.oldDue))}" disabled /></label>
          <label class="field"><span>กำหนดส่งใหม่ (ปรับได้)</span><input type="date" id="due-mgr-new" value="${toKey(c.newDue)}" /></label>
        </div>
        <label class="field"><span>หมายเหตุถึงผู้เขียนแบบ / ผู้ส่งคำร้อง (ไม่บังคับ)</span><textarea id="due-mgr-note" rows="2"></textarea></label>
        <p class="manage-hint">อนุมัติแล้วระบบส่งต่อให้ผู้ส่งคำร้องยืนยัน — กำหนดส่งเปลี่ยนเมื่อผู้ส่งคำร้องยอมรับ</p>
      </div>`,
    actions: [
      { label: "ยกเลิก", className: "secondary-button" },
      {
        label: "🛡️ อนุมัติ — ส่งให้ผู้ส่งคำร้องยืนยัน",
        className: "primary-button",
        onClick: async (close) => {
          const newDue = document.querySelector("#due-mgr-new")?.value || "";
          const note = document.querySelector("#due-mgr-note")?.value || "";
          if (!newDue) { showToast("กรุณาเลือกกำหนดส่งใหม่", "warning"); return; }
          if (new Date(`${newDue}T00:00:00`) <= new Date(c.oldDue)) { showToast("กำหนดส่งใหม่ต้องหลังวันเดิม", "warning"); return; }
          const off = checkOffDay(newDue);
          if (off) { showToast(`⛔ ${offDayText(off)} — กรุณาเลือกวันใหม่`, "warning"); return; }
          try {
            await managerDecideDueChange(request, true, { newDue, note });
            close();
            showToast(`อนุมัติแล้ว — ส่ง ${request.requestNo} ให้ผู้ส่งคำร้องยืนยัน`, "success");
            afterChange();
          } catch (error) { showToast(`บันทึกไม่สำเร็จ: ${error.message}`, "error"); }
        },
      },
    ],
  });
}

function openMgrRejectModal(request) {
  closeOpenModal();
  openModal({
    title: `⛔ ไม่อนุมัติขอเลื่อน — ${request.requestNo}`,
    body: `<div class="due-form"><p class="manage-hint">กำหนดส่งคงเดิม · ผู้เขียนแบบจะเห็นเหตุผล</p>
      <label class="field"><span>เหตุผล <b class="req">*</b> <small>(อย่างน้อย ${MIN_REASON} ตัวอักษร)</small></span><textarea id="due-mgr-reason" rows="4"></textarea></label></div>`,
    actions: [
      { label: "ยกเลิก", className: "secondary-button" },
      {
        label: "⛔ ไม่อนุมัติ",
        className: "primary-button danger",
        onClick: async (close) => {
          const note = (document.querySelector("#due-mgr-reason")?.value || "").trim();
          if (note.length < MIN_REASON) { showToast(`กรุณาระบุเหตุผล (อย่างน้อย ${MIN_REASON} ตัวอักษร)`, "warning"); return; }
          try {
            await managerDecideDueChange(request, false, { note });
            close();
            showToast(`ไม่อนุมัติการขอเลื่อน ${request.requestNo} — แจ้งผู้เขียนแบบแล้ว`, "success");
            afterChange();
          } catch (error) { showToast(`บันทึกไม่สำเร็จ: ${error.message}`, "error"); }
        },
      },
    ],
  });
}

function openRejectModal(request) {
  const c = getDueChange(request.requestNo);
  closeOpenModal();
  openModal({
    title: `⛔ ไม่ยอมรับการเลื่อน — ${request.requestNo}`,
    body: `
      <div class="due-form">
        <p class="manage-hint">กำหนดส่งจะ<b>คงเดิม ${escapeHtml(formatDateOnly(c?.oldDue))}</b> · ผู้เขียนแบบจะเห็นเหตุผลของคุณ</p>
        <label class="field"><span>ผลกระทบหากเลื่อน <b class="req">*</b></span>
          <select id="due-impact"><option value="">— เลือก —</option>${DUE_REJECT_IMPACTS.map((c2) => `<option>${escapeHtml(c2)}</option>`).join("")}</select></label>
        <label class="field"><span>เหตุผลโดยละเอียด <b class="req">*</b> <small>(อย่างน้อย ${MIN_REJECT_REASON} ตัวอักษร)</small></span>
          <textarea id="due-reject-reason" rows="5" placeholder="เช่น ต้องใช้แบบยื่น กทม. วันที่ 27 พ.ย. 09:00 หากเลื่อนจะพลาดรอบยื่นของเดือนนี้"></textarea></label>
      </div>`,
    actions: [
      { label: "ยกเลิก", className: "secondary-button" },
      {
        label: `⛔ ยืนยันใช้วันเดิม`,
        className: "primary-button danger",
        onClick: async (close) => {
          const impact = document.querySelector("#due-impact")?.value || "";
          const reason = (document.querySelector("#due-reject-reason")?.value || "").trim();
          if (!impact) { showToast("กรุณาเลือกผลกระทบ", "warning"); return; }
          if (reason.length < MIN_REJECT_REASON) { showToast(`กรุณาระบุเหตุผลโดยละเอียด (อย่างน้อย ${MIN_REJECT_REASON} ตัวอักษร)`, "warning"); return; }
          try {
            await respondDueChange(request, false, { reason, impact });
            close();
            showToast(`แจ้งผู้เขียนแบบแล้ว — ${request.requestNo} คงกำหนดส่งเดิม`, "success");
            afterChange();
          } catch (error) { showToast(`บันทึกไม่สำเร็จ: ${error.message}`, "error"); }
        },
      },
    ],
  });
}

async function accept(request, btn) {
  const c = getDueChange(request.requestNo);
  if (!c) return;
  if (!confirm(`ยอมรับเลื่อนกำหนดส่ง ${request.requestNo}\n${formatDateOnly(c.oldDue)} → ${formatDateOnly(c.newDue)} ?`)) return;
  btn.disabled = true;
  try {
    await respondDueChange(request, true);
    showToast(`เลื่อนกำหนดส่ง ${request.requestNo} เป็น ${formatDateOnly(c.newDue)} แล้ว`, "success");
    closeOpenModal();
    afterChange();
  } catch (error) {
    btn.disabled = false;
    showToast(`บันทึกไม่สำเร็จ: ${error.message}`, "error");
  }
}

// ปุ่มในตาราง/รายละเอียด — ผูกครั้งเดียวที่ document
var bound = false;
export function bindDueChangeButtons() {
  if (bound) return;
  bound = true;
  document.addEventListener("click", async (e) => {
    const find = (no) => (state.requests || []).find((r) => r.requestNo === no);
    const a = e.target.closest("[data-due-accept]");
    if (a) { const r = find(a.dataset.dueAccept); if (r) accept(r, a); return; }
    const rj = e.target.closest("[data-due-reject]");
    if (rj) { const r = find(rj.dataset.dueReject); if (r) openRejectModal(r); return; }
    const ma = e.target.closest("[data-due-mgr-approve]");
    if (ma) { const r = find(ma.dataset.dueMgrApprove); if (r) openMgrApproveModal(r); return; }
    const mr = e.target.closest("[data-due-mgr-reject]");
    if (mr) { const r = find(mr.dataset.dueMgrReject); if (r) openMgrRejectModal(r); return; }
    const cn = e.target.closest("[data-due-cancel]");
    if (cn) {
      const r = find(cn.dataset.dueCancel);
      if (!r || !confirm(`ยกเลิกคำขอเลื่อนกำหนดส่ง ${r.requestNo}?`)) return;
      cn.disabled = true;
      try { await cancelDueChange(r); showToast("ยกเลิกคำขอเลื่อนแล้ว", "success"); afterChange(); }
      catch (error) { cn.disabled = false; showToast(`ยกเลิกไม่สำเร็จ: ${error.message}`, "error"); }
    }
  });
}
