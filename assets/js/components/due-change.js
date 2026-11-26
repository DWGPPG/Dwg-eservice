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
  return `<div class="due-banner">📅 <span>มีคำขอ<b>เลื่อนกำหนดส่ง ${list.length} รายการ</b> รอคุณยืนยัน — กดเลขคำร้องเพื่อดูเหตุผลแล้วกด <b>ยอมรับ</b> หรือ <b>ไม่ยอมรับ</b>
    <span class="due-banner-list">${list.map((r) => `<button type="button" class="due-banner-req" data-request-detail="${escapeHtml(r.requestNo)}">📋 ${escapeHtml(r.requestNo)} · ${escapeHtml(thShort(getDueChange(r.requestNo)?.oldDue))} → ${escapeHtml(thShort(getDueChange(r.requestNo)?.newDue))}</button>`).join("")}</span></span></div>`;
}

/** กล่องในหน้ารายละเอียดคำร้อง */
export function dueChangeDetailHtml(request) {
  const c = getDueChange(request.requestNo);
  if (!c || c.status === "cancelled") return "";
  const label = { pending: "⏳ รอผู้ส่งคำร้องยืนยัน", accepted: "✅ ผู้ส่งคำร้องยอมรับแล้ว", rejected: "⛔ ผู้ส่งคำร้องยืนยันวันเดิม" }[c.status];
  return `<div class="request-detail-note due-detail is-${c.status}">
    <span>📅 คำขอเลื่อนกำหนดส่ง — ${label}</span>
    <strong>${escapeHtml(formatDateOnly(c.oldDue))} → ${escapeHtml(formatDateOnly(c.newDue))}</strong>
    <div><b>สาเหตุ:</b> ${escapeHtml(c.cause)} · <b>เหตุผล:</b> ${escapeHtml(c.reason)} <small>(${escapeHtml(c.by)})</small></div>
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
  if (getDueChange(request.requestNo)?.status === "pending") { showToast("คำร้องนี้มีคำขอเลื่อนรอผู้ส่งคำร้องยืนยันอยู่แล้ว", "warning"); return; }
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
            await requestDueChange(request, { newDue, cause, reason });
            close();
            showToast(`ส่งคำขอเลื่อน ${request.requestNo} ให้ผู้ส่งคำร้องยืนยันแล้ว`, "success");
            afterChange();
          } catch (error) { showToast(`ส่งคำขอไม่สำเร็จ: ${error.message}`, "error"); }
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
