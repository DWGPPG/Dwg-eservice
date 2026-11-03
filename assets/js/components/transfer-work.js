// ══════════════════════════════════════════════════════════════
// โอนงาน (เปลี่ยนผู้รับผิดชอบ) ไปยังบุคคลในฝ่ายเขียนแบบ — หน้าติดตามงาน
//  - เหมือน "ดึงงาน" แต่เลือกคนรับได้: เจ้าของงานเอง หรือผู้จัดการ โอนให้เพื่อนร่วมทีม
//  - ผู้รับผิดชอบโครงการ (ProjectOwners) ไม่เปลี่ยน — เปลี่ยนเฉพาะผู้รับงานของคำร้องนี้
//  - แจ้งเตือน Teams: ผู้รับงานคนใหม่ + เจ้าของงานเดิม + ผู้ร้องขอ + ผู้จัดการ
// ══════════════════════════════════════════════════════════════

import { appConfig } from "../../../config/config.js";
import { STATUS } from "../../../config/schema.js";
import { sendTeams1on1 } from "../graph.js";
import { leaveOf } from "../services/owner-service.js";
import { patchRequest } from "../services/request-service.js";
import { effectiveBootstrapEmails } from "../services/role-service.js";
import { getAllManagerEmails, getDrawingTeamMembers } from "../services/team-service.js";
import { escapeHtml } from "../utils.js";
import { openModal } from "./modal.js";
import { showToast } from "./toast.js";

export const TRANSFERABLE_STATUSES = [STATUS.INPROGRESS_LV1, STATUS.APPROVED, STATUS.WORKING, STATUS.MGR_REJECTED];

const lower = (v) => String(v || "").trim().toLowerCase();

/** เจ้าของงาน หรือผู้จัดการ · งานที่มีผู้รับแล้วและยังไม่ส่งมอบ */
export function canTransferWork(item, user) {
  const role = user?.role;
  if (role !== "designer" && role !== "manager") return false;
  if (!item.assignedToEmail || !TRANSFERABLE_STATUSES.includes(item.status)) return false;
  return role === "manager" || lower(item.assignedToEmail) === lower(user?.email);
}

export function openTransferWorkModal(request, user, onDone) {
  const current = lower(request.assignedToEmail);
  const members = getDrawingTeamMembers().filter((m) => lower(m.email) !== current);
  if (!members.length) { showToast("ไม่มีบุคคลอื่นในฝ่ายเขียนแบบ", "warning"); return; }

  const body = `
    <div class="assign-work-panel">
      <div class="assign-work-summary">
        <span>${escapeHtml(request.requestNo)}</span>
        <strong>${escapeHtml(request.projectName || "—")}</strong>
        <small>${escapeHtml(request.drawingNo || "—")} · ${escapeHtml(request.drawingName || "—")}</small>
      </div>
      <div class="transfer-work-note">
        👤 ผู้รับผิดชอบปัจจุบัน: <b>${escapeHtml(request.assignedToName || request.assignedToEmail || "—")}</b><br>
        ระบบจะแจ้งเตือน <b>ผู้รับงานคนใหม่ · เจ้าของงานเดิม · ผู้ร้องขอ · ผู้จัดการ</b> ทาง Teams
      </div>
      <label class="field">
        <span>โอนให้ <b class="req">*</b></span>
        <select id="tw-member">
          <option value="">— เลือกบุคคลในฝ่ายเขียนแบบ —</option>
          ${members.map((m) => {
            const away = leaveOf(m.email);
            return `<option value="${escapeHtml(m.email)}" data-name="${escapeHtml(m.name || m.email)}">${escapeHtml(m.name || m.email)}${away ? " (ลาวันนี้)" : ""}</option>`;
          }).join("")}
        </select>
      </label>
      <label class="field">
        <span>เหตุผลที่โอน <b class="req">*</b></span>
        <select id="tw-reason">
          <option value="">— เลือกเหตุผล —</option>
          <option value="ลาป่วย / ลากิจ / ลาพักร้อน">ลาป่วย / ลากิจ / ลาพักร้อน</option>
          <option value="งานล้นมือ / เกลี่ยภาระงาน">งานล้นมือ / เกลี่ยภาระงาน</option>
          <option value="งานเร่งด่วน">งานเร่งด่วน</option>
          <option value="ผู้รับผิดชอบโครงการ / ถนัดงานนี้มากกว่า">ผู้รับผิดชอบโครงการ / ถนัดงานนี้มากกว่า</option>
          <option value="อื่นๆ">อื่นๆ — ระบุเพิ่มเติม</option>
        </select>
        <textarea id="tw-note" rows="2" style="margin-top:8px;" placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)..."></textarea>
      </label>
    </div>`;

  openModal({
    title: "➡️ โอนงานให้เพื่อนร่วมทีม",
    body,
    actions: [
      { label: "ยกเลิก", className: "secondary-button" },
      {
        label: "✅ ยืนยันโอนงาน",
        className: "primary-button",
        onClick: async (close) => {
          const select = document.querySelector("#tw-member");
          const reason = document.querySelector("#tw-reason")?.value || "";
          const note = document.querySelector("#tw-note")?.value.trim() || "";
          if (!select?.value) { showToast("กรุณาเลือกผู้รับงานคนใหม่", "warning"); return; }
          if (!reason) { showToast("กรุณาเลือกเหตุผล", "warning"); return; }
          const fullReason = reason === "อื่นๆ" ? (note || "อื่นๆ") : (note ? `${reason} — ${note}` : reason);
          const target = { email: select.value, name: select.options[select.selectedIndex].dataset.name || select.value };
          const prev = { email: request.assignedToEmail || "", name: request.assignedToName || request.assignedToEmail || "—" };
          const by = user?.name || user?.email || "—";
          try {
            await patchRequest(request, {
              assignedToName: target.name,
              assignedToEmail: target.email,
              assignNote: `[โอนงานจาก ${prev.name} ให้ ${target.name} โดย ${by}] ${fullReason}`,
            }, `โอนงานจาก ${prev.name} ให้ ${target.name} — ${fullReason}`);
            request.assignedToName = target.name;
            request.assignedToEmail = target.email;
            notifyTransfer({ request, prev, target, by, user, fullReason });
            showToast(`โอนงาน ${request.requestNo} ให้ ${target.name} แล้ว`, "success");
            close();
            onDone?.();
          } catch (error) {
            showToast(`โอนงานไม่สำเร็จ: ${error.message}`, "error");
          }
        },
      },
    ],
  });
}

function notifyTransfer({ request, prev, target, by, user, fullReason }) {
  const head = [
    `🔖 <b>เลขที่คำร้อง:</b> ${request.requestNo}`,
    `🏗️ <b>โครงการ:</b> ${request.projectName || "—"}`,
    `📐 <b>Drawing:</b> ${request.drawingNo || "—"} — ${request.drawingName || "—"}`,
    ``,
    `👤 <b>เจ้าของงานเดิม:</b> ${prev.name}`,
    `👤 <b>ผู้รับงานคนใหม่:</b> ${target.name}`,
    `🔁 <b>โอนโดย:</b> ${by}`,
    `📝 <b>เหตุผล:</b> ${fullReason}`,
    ``,
    `<a href="${appConfig.azure.redirectUri}#/track">🖥️ ดูรายละเอียดในระบบ</a>`,
  ];
  const msg = (title) => [title, ``, ...head].join("<br>");
  const me = lower(user?.email);
  const sent = new Set([me]);
  const send = (email, html) => {
    const key = lower(email);
    if (!key || sent.has(key)) return;
    sent.add(key);
    sendTeams1on1(email, html).catch((err) => console.warn("notifyTransfer:", err.message));
  };
  send(target.email, msg("📥 <b>คุณได้รับโอนงานใหม่</b>"));
  send(prev.email, msg("🔄 <b>งานของคุณถูกโอนให้เพื่อนร่วมทีมแล้ว</b>"));
  send(request.requesterEmail, msg("🔄 <b>คำร้องของคุณเปลี่ยนผู้รับผิดชอบ</b>"));
  getAllManagerEmails(effectiveBootstrapEmails()).forEach((email) => send(email, msg("🔄 <b>มีการโอนงานในฝ่ายเขียนแบบ</b>")));
}
