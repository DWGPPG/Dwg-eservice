// ══════════════════════════════════════════════════════════════
// ตอนยืนยันส่งคำร้อง: แสดงภาระงานที่ "ต้องส่งวันเดียวกัน" ของผู้รับผิดชอบโครงการ
//  - ผู้รับผิดชอบ = ตามหน้าจัดการข้อมูล / ประวัติงาน (ownersFor)
//  - งาน Proposal = แสดงผู้รับผิดชอบ Proposal ทุกคน (เช่น Narakorn / Janjira) แยกคนละฝั่ง
//  - นับงานทุกประเภทที่คนนั้นรับผิดชอบอยู่ (ทุกโครงการ) ที่ยังไม่ส่งงาน และกำหนดส่งตรงวันเดียวกัน
// ══════════════════════════════════════════════════════════════

import { STATUS } from "../../../config/schema.js";
import { state } from "../state.js";
import { escapeHtml } from "../utils.js";
import { toDateKey } from "../services/due-date.js";
import { isProposalType, leaveOf, ownersFor, personName } from "../services/owner-service.js";

// งานที่ยัง "ต้องส่ง" (ฝ่ายเขียนแบบยังไม่ส่งงาน)
const OPEN = new Set([STATUS.PENDING, STATUS.INPROGRESS_LV1, STATUS.APPROVED, STATUS.WORKING, STATUS.MGR_REJECTED].filter(Boolean));
const norm = (v) => String(v || "").trim().toLowerCase();
const thDate = (key) => new Date(`${key}T00:00:00`).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

function level(n) {
  if (n >= 4) return { cls: "is-high", text: "ภาระงานสูง — เสี่ยงส่งไม่ทัน" };
  if (n >= 2) return { cls: "is-mid", text: "ภาระงานปานกลาง" };
  return { cls: "is-low", text: "ว่างพอรับงาน" };
}

/** งานเดิมของคนนี้ที่ต้องส่งวันนั้น (ทุกประเภท ทุกโครงการ) */
function existingFor(email, dateKey) {
  return (state.requests || []).filter((r) => OPEN.has(r.status) && norm(r.assignedToEmail) === norm(email) && r.dueDate && toDateKey(r.dueDate) === dateKey);
}

/**
 * HTML สรุปภาระงานในวันเดียวกัน — ใช้ในหน้าต่างยืนยันส่งคำร้อง
 * @param {string} projectName
 * @param {string} requestType
 * @param {string[]} dueKeys วันกำหนดส่งของ Drawing ที่กำลังจะส่ง ("YYYY-MM-DD")
 */
export function dueWorkloadHtml(projectName, requestType, dueKeys) {
  const owners = ownersFor(projectName, requestType);
  const dates = [...new Set(dueKeys.filter(Boolean))].sort();
  if (!dates.length) return "";
  const newCount = (key) => dueKeys.filter((k) => k === key).length;
  const proposal = isProposalType(requestType);

  // Proposal ที่ยังไม่มีผู้รับ (รอรับงาน) ในวันเดียวกัน — ผู้รับผิดชอบ Proposal ต้องแบ่งกันทำ
  const unassignedProposal = (key) => (state.requests || []).filter((r) => OPEN.has(r.status) && !r.assignedToEmail && isProposalType(r.requestType) && r.dueDate && toDateKey(r.dueDate) === key);

  if (!owners.length) {
    return `<section class="dw-box"><div class="dw-title">📊 ภาระงานในวันกำหนดส่ง</div>
      <p class="dw-empty">ยังไม่ได้กำหนดผู้รับผิดชอบโครงการนี้ — ผู้จัดการจะมอบหมายงานให้หลังส่งคำร้อง</p></section>`;
  }

  const card = (o) => {
    const leaveBadge = (key) => {
      const lv = leaveOf(o.email, key);
      return lv ? `<span class="dw-leave">🏖️ ลา${escapeHtml(lv.Period || "")}</span>` : "";
    };
    return `<div class="dw-person">
      <div class="dw-name">👤 ${escapeHtml(o.name || personName(o.email))}${o.source === "history" ? ` <small>(จากประวัติงาน)</small>` : ""}</div>
      ${dates.map((key) => {
        const list = existingFor(o.email, key);
        const total = list.length + newCount(key);
        const lv = level(total);
        return `<div class="dw-day ${lv.cls}">
          <div class="dw-day-head"><b>${escapeHtml(thDate(key))}</b>${leaveBadge(key)}</div>
          <div class="dw-count"><span class="dw-num">${list.length}</span> งานเดิมที่ต้องส่งวันนี้ <span class="dw-plus">+ ${newCount(key)} งานนี้${proposal && owners.length > 1 ? " (ถ้ารับงาน)" : ""} = ${total}</span></div>
          <div class="dw-level">${lv.text}</div>
          ${list.length ? `<ul class="dw-list">${list.slice(0, 6).map((r) => `<li><b>${escapeHtml(r.requestNo)}</b> · ${escapeHtml(r.projectName || "")} · ${escapeHtml(r.drawingNo || "")}${isProposalType(r.requestType) ? " <small>(Proposal)</small>" : ""}</li>`).join("")}${list.length > 6 ? `<li><small>และอีก ${list.length - 6} งาน</small></li>` : ""}</ul>` : ""}
        </div>`;
      }).join("")}
    </div>`;
  };

  const anyHigh = owners.some((o) => dates.some((key) => existingFor(o.email, key).length + newCount(key) >= 4 || leaveOf(o.email, key)));
  return `<section class="dw-box">
    <div class="dw-title">📊 ภาระงานของผู้รับผิดชอบในวันกำหนดส่ง${proposal ? " <small>(งาน Proposal — แสดงผู้รับผิดชอบทุกคน)</small>" : ""}</div>
    <div class="dw-grid ${owners.length > 1 ? "is-multi" : ""}">${owners.map(card).join("")}</div>
    ${proposal ? dates.map((key) => { const n = unassignedProposal(key).length; return n ? `<p class="dw-note">📋 Proposal ที่ยังรอรับงานและต้องส่ง ${escapeHtml(thDate(key))}: <b>${n}</b> งาน</p>` : ""; }).join("") : ""}
    ${anyHigh ? `<p class="dw-warn">⚠️ วันกำหนดส่งที่เลือกมีงานค้างมาก หรือผู้รับผิดชอบลา — พิจารณาเลื่อนวันเพื่อให้ได้งานตามกำหนด (กด "แก้ไข" เพื่อเปลี่ยนวัน)</p>` : ""}
    <p class="dw-hint">นับงานทุกประเภทที่ผู้รับผิดชอบถืออยู่และยังไม่ส่งงาน ที่มีกำหนดส่งตรงวันเดียวกัน</p>
  </section>`;
}
