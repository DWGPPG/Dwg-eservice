// ══════════════════════════════════════════════════════════════
// หน้าจัดการข้อมูล → แท็บ "แก้ไขคำร้อง" (ผู้จัดการ Lv.2)
// แก้ข้อมูลที่ผู้ส่งกรอกผิด: ประเภท / โครงการ / Drawing / วันที่ส่ง / กำหนดส่ง / ความเร่งด่วน / รายละเอียด / ลิงก์
//  - ไม่เปลี่ยนสถานะงาน ไม่เปลี่ยนเลขคำร้อง (โฟลเดอร์ไฟล์ใน SharePoint ผูกกับเลขคำร้อง)
//  - บังคับใส่เหตุผล → บันทึกลง Audit log พร้อมค่าเดิม → ค่าใหม่ ทุกช่อง
//  - เลือกแจ้งผู้ส่งคำร้อง/ผู้รับผิดชอบทาง Teams ได้
// ══════════════════════════════════════════════════════════════

import { STATUS_LABELS } from "../../../config/schema.js";
import { openModal } from "../components/modal.js";
import { paginate } from "../components/pager.js";
import { showToast } from "../components/toast.js";
import { PRIORITIES, REQUEST_TYPES } from "../constants.js";
import { sendTeams1on1 } from "../graph.js";
import { writeAudit } from "../services/audit-service.js";
import { patchRequest } from "../services/request-service.js";
import { state } from "../state.js";
import { escapeHtml, formatDate, formatDateOnly } from "../utils.js";

const DRAWING_CATEGORIES = ["General Drawing", "Architectural Drawing", "Structural Drawing", "Electrical Drawing", "Mechanical Drawing"];

const view = { search: "", status: "", openOnly: false };

const norm = (v) => String(v ?? "").trim().toLowerCase();
const pad = (n) => String(n).padStart(2, "0");
const dateKey = (value) => {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const dateTimeLocal = (value) => {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ช่องที่แก้ได้ — key = ชื่อ field ฝั่งแอป (ตรงกับ fields.requests)
const EDIT_FIELDS = [
  { key: "requestType", label: "ประเภทคำร้อง", type: "select", options: () => REQUEST_TYPES, required: true },
  { key: "projectName", label: "โครงการ", type: "text", list: "mr-projects", required: true },
  { key: "drawingNo", label: "เลข Drawing", type: "text", list: "mr-drawing-nos" },
  { key: "drawingName", label: "ชื่อ Drawing", type: "text", list: "mr-drawing-names" },
  { key: "drawingCategory", label: "หมวด Drawing", type: "select", options: () => DRAWING_CATEGORIES, optional: true },
  { key: "kwp", label: "ขนาดระบบ (kWp)", type: "text", list: "mr-kwp" },
  { key: "location", label: "สถานที่", type: "text" },
  { key: "priority", label: "ความเร่งด่วน", type: "select", options: () => PRIORITIES, required: true },
  { key: "submittedAt", label: "วันที่ส่งคำร้อง", type: "datetime-local", read: dateTimeLocal, required: true },
  { key: "dueDate", label: "กำหนดส่ง", type: "date", read: dateKey },
  { key: "description", label: "รายละเอียด", type: "textarea", wide: true },
  { key: "dataLink", label: "ลิงก์แนบ", type: "text", wide: true, cloudLink: true },
];

const displayValue = (f, value) => {
  if (!value) return "—";
  if (f.key === "submittedAt") return formatDate(value);
  if (f.key === "dueDate") return formatDateOnly(value);
  return String(value);
};

function filteredRequests() {
  const q = norm(view.search);
  return [...state.requests]
    .filter((r) => !view.status || r.status === view.status)
    .filter((r) => !view.openOnly || !["done", "cancelled", "rejected"].includes(r.status))
    .filter((r) => !q || [r.requestNo, r.projectName, r.drawingNo, r.drawingName, r.requesterName, r.requesterEmail, r.requestType]
      .some((v) => norm(v).includes(q)))
    .sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
}

export function renderRequestEditor(rerender) {
  const rows = filteredRequests();
  const page = paginate(rows, "manage-requests", {
    sig: [view.search, view.status, view.openOnly].join("|"),
    onChange: rerender,
  });
  return `
    <div class="manage-note">✏️ แก้ข้อมูลที่ผู้ส่งกรอกผิด (ประเภท, โครงการ, Drawing, วันที่ส่ง, กำหนดส่ง ฯลฯ) — <b>ไม่เปลี่ยนสถานะงานและเลขคำร้อง</b> · ทุกการแก้ไขต้องใส่เหตุผลและถูกบันทึกลง Audit log</div>
    <div class="manage-toolbar">
      <input class="manage-search" type="search" placeholder="ค้นหาเลขคำร้อง โครงการ Drawing ผู้ส่ง..." value="${escapeHtml(view.search)}" data-mr-input="search" />
      <select data-mr-input="status">
        <option value="">ทุกสถานะ</option>
        ${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${escapeHtml(v)}" ${view.status === v ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}
      </select>
      <label class="manage-check"><input type="checkbox" data-mr-input="openOnly" ${view.openOnly ? "checked" : ""} /><span>เฉพาะงานที่ยังไม่ปิด</span></label>
    </div>
    <p class="manage-count">${rows.length.toLocaleString("th-TH")} คำร้อง</p>
    ${rows.length ? `
      ${page.anchor}
      <div class="track-table-wrap manage-table-wrap">
        <table class="manage-table m-card-table">
          <thead><tr><th>เลขคำร้อง</th><th>ประเภท</th><th>โครงการ</th><th>Drawing</th><th>ผู้ส่ง</th><th>วันที่ส่ง</th><th>กำหนดส่ง</th><th>สถานะ</th><th class="is-actions">จัดการ</th></tr></thead>
          <tbody>
            ${page.rows.map((r) => `
              <tr>
                <td class="is-mono"><strong>${escapeHtml(r.requestNo || "—")}</strong></td>
                <td>${escapeHtml(r.requestType || "—")}</td>
                <td>${escapeHtml(r.projectName || "—")}</td>
                <td>${escapeHtml(r.drawingNo || "—")}${r.drawingName ? `<br><small>${escapeHtml(r.drawingName)}</small>` : ""}</td>
                <td>${escapeHtml(r.requesterName || r.requesterEmail || "—")}</td>
                <td>${formatDate(r.submittedAt)}</td>
                <td>${formatDateOnly(r.dueDate)}</td>
                <td><span class="badge badge-${escapeHtml(r.status)}">${escapeHtml(STATUS_LABELS[r.status] || r.status || "—")}</span></td>
                <td class="is-actions"><button class="small-button" type="button" data-mr-edit="${escapeHtml(r.requestNo)}">แก้ไข</button></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      ${page.html}` : `<div class="empty-state manage-empty">ไม่พบคำร้อง${view.search ? ` ที่ตรงกับ “${escapeHtml(view.search)}”` : ""}</div>`}
  `;
}

export function bindRequestEditor(body, rerenderBody) {
  const search = body.querySelector('[data-mr-input="search"]');
  if (!search) return;
  let timer = null;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      view.search = search.value;
      const pos = search.selectionStart;
      rerenderBody();
      const next = body.querySelector('[data-mr-input="search"]');
      next?.focus();
      next?.setSelectionRange(pos, pos);
    }, 250);
  });
  body.querySelector('[data-mr-input="status"]')?.addEventListener("change", (e) => { view.status = e.target.value; rerenderBody(); });
  body.querySelector('[data-mr-input="openOnly"]')?.addEventListener("change", (e) => { view.openOnly = e.target.checked; rerenderBody(); });
  body.querySelectorAll("[data-mr-edit]").forEach((btn) => btn.addEventListener("click", () => {
    const request = state.requests.find((r) => r.requestNo === btn.dataset.mrEdit);
    if (request) openRequestEditForm(request, rerenderBody);
  }));
}

// ══════════════════════════════════════════════════════════════
// ฟอร์มแก้ไข
// ══════════════════════════════════════════════════════════════

function datalists() {
  const md = state.masterData || {};
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "th", { numeric: true }));
  const opt = (arr) => uniq(arr).map((v) => `<option value="${escapeHtml(v)}"></option>`).join("");
  return `
    <datalist id="mr-projects">${opt((md.projects || []).map((p) => p.Title))}</datalist>
    <datalist id="mr-drawing-nos">${opt((md.drawingNumbers || []).map((d) => d.Title))}</datalist>
    <datalist id="mr-drawing-names">${opt([...(md.drawingNames || []).map((d) => d.Title), ...(md.drawingNumbers || []).map((d) => d.DrawingName)])}</datalist>
    <datalist id="mr-kwp">${opt((md.kwp || []).map((k) => k.Title))}</datalist>`;
}

function fieldHtml(f, request) {
  const value = f.read ? f.read(request[f.key]) : (request[f.key] ?? "");
  const label = `<span>${escapeHtml(f.label)}${f.required ? ' <b class="req">*</b>' : ""}</span>`;
  const cls = `field${f.wide ? " is-wide" : ""}`;
  if (f.type === "select") {
    const options = f.options();
    const extra = value && !options.includes(value) ? [value] : []; // ค่าเดิมที่ไม่อยู่ในรายการ — คงไว้ให้เลือกได้
    return `<label class="${cls}">${label}
      <select name="${f.key}">
        ${f.optional ? `<option value="">— ไม่ระบุ —</option>` : ""}
        ${[...extra, ...options].map((o) => `<option ${o === value ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
      </select></label>`;
  }
  if (f.type === "textarea") {
    return `<label class="${cls}">${label}<textarea name="${f.key}" rows="3">${escapeHtml(value)}</textarea></label>`;
  }
  return `<label class="${cls}">${label}
    <input type="${f.type}" name="${f.key}" value="${escapeHtml(value)}" ${f.list ? `list="${f.list}"` : ""} ${f.cloudLink ? 'data-cloud-link="multi"' : ""} autocomplete="off" /></label>`;
}

function openRequestEditForm(request, rerenderBody) {
  const people = [
    request.requesterEmail && { email: request.requesterEmail, name: request.requesterName || request.requesterEmail, role: "ผู้ส่งคำร้อง" },
    request.assignedToEmail && norm(request.assignedToEmail) !== norm(request.requesterEmail) && { email: request.assignedToEmail, name: request.assignedToName || request.assignedToEmail, role: "ผู้รับผิดชอบ" },
  ].filter(Boolean);

  openModal({
    title: `แก้ไขคำร้อง ${request.requestNo}`,
    body: `
      <form class="manage-form manage-request-form" novalidate>
        <div class="manage-request-meta">
          <span class="badge badge-${escapeHtml(request.status)}">${escapeHtml(STATUS_LABELS[request.status] || request.status || "")}</span>
          <span>ผู้ส่ง: <b>${escapeHtml(request.requesterName || request.requesterEmail || "—")}</b></span>
          ${request.assignedToName ? `<span>ผู้รับผิดชอบ: <b>${escapeHtml(request.assignedToName)}</b></span>` : ""}
        </div>
        ${datalists()}
        <div class="manage-request-grid">${EDIT_FIELDS.map((f) => fieldHtml(f, request)).join("")}</div>
        <p class="manage-request-hint" data-mr-hint hidden></p>
        <label class="field is-wide"><span>เหตุผลการแก้ไข <b class="req">*</b></span>
          <textarea name="__reason" rows="2" placeholder="เช่น ผู้ส่งเลือกประเภทผิด / ลงกำหนดส่งผิดวัน (แจ้งทาง Line เมื่อ 1 พ.ย.)"></textarea></label>
        ${people.length ? `
          <label class="manage-check manage-field-check"><input type="checkbox" name="__notify" />
            <span>แจ้งการแก้ไขทาง Teams ถึง ${people.map((p) => `${escapeHtml(p.name)} (${p.role})`).join(", ")}</span></label>` : ""}
        <p class="manage-form-error" hidden></p>
      </form>`,
    actions: [
      { label: "ยกเลิก" },
      {
        label: "บันทึกการแก้ไข",
        className: "primary-button",
        onClick: async (close) => {
          const form = document.querySelector(".manage-request-form");
          const errorBox = form.querySelector(".manage-form-error");
          const showError = (msg) => { errorBox.textContent = msg; errorBox.hidden = false; };
          const { patch, changes, error } = collectChanges(form, request);
          if (error) return showError(error);
          if (!changes.length) return showError("ยังไม่มีช่องไหนถูกแก้ไข");
          const reason = form.querySelector('[name="__reason"]').value.trim();
          if (!reason) return showError("กรุณาใส่เหตุผลการแก้ไข");
          try {
            await patchRequest(request, patch);
            const detail = `เหตุผล: ${reason} | ${changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join(" ; ")}`;
            await writeAudit({ requestNo: request.requestNo, action: "แอดมินแก้ไขคำร้อง", detail: detail.slice(0, 1500) });
            if (form.querySelector('[name="__notify"]')?.checked) await notifyPeople(people, request, changes, reason);
            close();
            showToast(`แก้ไขคำร้อง ${request.requestNo} แล้ว (${changes.length} ช่อง)`, "success");
            rerenderBody();
          } catch (err) {
            showError(`บันทึกไม่สำเร็จ: ${err.message}`);
          }
        },
      },
    ],
  });

  const form = document.querySelector(".manage-request-form");
  const hint = form.querySelector("[data-mr-hint]");
  const val = (name) => form.querySelector(`[name="${name}"]`);

  // เลือกเลข Drawing ที่มีในข้อมูลหลัก → เติมชื่อ/หมวด Drawing ให้อัตโนมัติ
  val("drawingNo").addEventListener("change", () => {
    const project = norm(val("projectName").value);
    const all = state.masterData?.drawingNumbers || [];
    const match = all.find((d) => norm(d.Title) === norm(val("drawingNo").value) && (!project || norm(d.ProjectName) === project))
      || all.find((d) => norm(d.Title) === norm(val("drawingNo").value));
    if (!match) return;
    if (match.DrawingName) val("drawingName").value = match.DrawingName;
    if (match.DrawingCategory && [...val("drawingCategory").options].some((o) => o.value === match.DrawingCategory)) val("drawingCategory").value = match.DrawingCategory;
  });

  // คำเตือนเล็กๆ ระหว่างแก้
  const refreshHint = () => {
    const notes = [];
    if (val("requestType").value !== (request.requestType || "")) notes.push("เปลี่ยนประเภทแล้ว แต่เลขคำร้องยังคงเดิม (โฟลเดอร์ไฟล์ใน SharePoint ผูกกับเลขคำร้อง)");
    const sub = val("submittedAt").value.slice(0, 10);
    const due = val("dueDate").value;
    if (sub && due && due < sub) notes.push("กำหนดส่งอยู่ก่อนวันที่ส่งคำร้อง");
    if (due && due !== dateKey(request.dueDate) && ["done", "delivered", "mgr_review"].includes(request.status)) notes.push("งานนี้ส่งงานแล้ว — การเปลี่ยนกำหนดส่งมีผลกับ KPI ส่งตรงเวลา");
    hint.hidden = !notes.length;
    hint.innerHTML = notes.map((n) => `⚠️ ${escapeHtml(n)}`).join("<br>");
  };
  form.addEventListener("input", () => { form.querySelector(".manage-form-error").hidden = true; });
  form.addEventListener("input", refreshHint);
  form.addEventListener("change", refreshHint);
  val("requestType").focus();
}

function collectChanges(form, request) {
  const patch = {};
  const changes = [];
  for (const f of EDIT_FIELDS) {
    const el = form.querySelector(`[name="${f.key}"]`);
    const raw = el.value.trim();
    if (f.required && !raw) return { error: `กรุณากรอก “${f.label}”` };
    const before = f.read ? f.read(request[f.key]) : String(request[f.key] ?? "");
    if (raw === String(before ?? "")) continue;
    let value = raw;
    if (f.key === "submittedAt") value = new Date(raw).toISOString();
    if (f.key === "dueDate") value = raw ? new Date(`${raw}T00:00:00`).toISOString() : "";
    patch[f.key] = value;
    changes.push({ key: f.key, label: f.label, from: displayValue(f, request[f.key]), to: displayValue(f, value) });
  }
  const sub = form.querySelector('[name="submittedAt"]').value.slice(0, 10);
  const due = form.querySelector('[name="dueDate"]').value;
  if (sub && due && due < sub) return { error: "กำหนดส่งต้องไม่อยู่ก่อนวันที่ส่งคำร้อง" };
  return { patch, changes };
}

async function notifyPeople(people, request, changes, reason) {
  const html = [
    "✏️ <b>PPG Drawing e-Service — คำร้องถูกแก้ไขโดยผู้ดูแล</b>",
    "",
    `📋 <b>เลขคำขอ:</b> ${escapeHtml(request.requestNo)}`,
    `👤 <b>แก้ไขโดย:</b> ${escapeHtml(state.user?.name || "")}`,
    `📝 <b>เหตุผล:</b> ${escapeHtml(reason)}`,
    "",
    ...changes.map((c) => `• <b>${escapeHtml(c.label)}:</b> ${escapeHtml(c.from)} → <b>${escapeHtml(c.to)}</b>`),
  ].join("<br>");
  const results = await Promise.allSettled(people.map((p) => sendTeams1on1(p.email, html)));
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed) showToast(`แจ้ง Teams ไม่สำเร็จ ${failed} คน (บันทึกการแก้ไขเรียบร้อยแล้ว)`, "warning");
}
