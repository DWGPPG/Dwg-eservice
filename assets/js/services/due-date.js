// ══════════════════════════════════════════════════════════════
// กติกากำหนดส่ง (ใช้ร่วมกันทุกหน้า)
//  - ห้ามตรงเสาร์-อาทิตย์ / วันหยุดในหน้าจัดการข้อมูล → "ทุกกรณี" ไม่มีข้อยกเว้น แม้เร่งด่วนมาก
//  - แนะนำวันทำการถัดไป + ปุ่ม "ใช้วันนี้แทน" ให้กดเลือกได้ทันที
// ใช้ที่: หน้าส่งคำร้อง, ผู้ร้องขอ "ขอแก้ไข", ผู้จัดการ "ส่งกลับแก้ไข", แอดมิน "แก้ไขคำร้อง"
// ══════════════════════════════════════════════════════════════

import { state } from "../state.js";
import { escapeHtml } from "../utils.js";

export function toDateKey(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── ชื่อวันหยุด ──
// List HolidayList ของบริษัทมีคอลัมน์ "Title" 2 คอลัมน์: Title ของระบบ (ว่าง) กับคอลัมน์ที่สร้างเองชื่อแสดงว่า "Title"
// (ชื่อภายในเป็นอย่างอื่น เช่น Title0) ซึ่งเป็นที่เก็บชื่อวันหยุดจริง — อ่านจากคอลัมน์ไหนก็ได้ที่มีค่า
const SYSTEM_FIELDS = new Set(["id", "Title", "HolidayDate", "ContentType", "Modified", "Created", "Attachments", "Edit",
  "LinkTitle", "LinkTitleNoMenu", "ItemChildCount", "FolderChildCount", "DocIcon", "AuthorLookupId", "EditorLookupId",
  "AppAuthorLookupId", "AppEditorLookupId"]);
const isCustomTextField = (key, value) => !SYSTEM_FIELDS.has(key) && !key.startsWith("_") && !key.startsWith("@")
  && !/LookupId$|^OData|^Link/i.test(key) && typeof value === "string" && value.trim() && !/^\d{4}-\d{2}-\d{2}T/.test(value);

/** ชื่อคอลัมน์ที่เก็บชื่อวันหยุดจริง (ถ้าไม่ใช่ Title) — ใช้ตอนบันทึกวันหยุดใหม่ให้ลงคอลัมน์เดียวกัน */
export function holidayNameField(rows = state.masterData?.holidays || []) {
  const counts = new Map();
  rows.forEach((row) => Object.entries(row).forEach(([k, v]) => { if (isCustomTextField(k, v)) counts.set(k, (counts.get(k) || 0) + 1); }));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

export function holidayName(row, nameField = holidayNameField()) {
  const fromTitle = String(row?.Title || "").trim();
  if (fromTitle) return fromTitle;
  if (nameField && String(row?.[nameField] || "").trim()) return String(row[nameField]).trim();
  const any = Object.entries(row || {}).find(([k, v]) => isCustomTextField(k, v));
  return any ? String(any[1]).trim() : "";
}

/** Map "YYYY-MM-DD" → ชื่อวันหยุด (จาก List HolidayList) */
export function holidayMap() {
  const map = new Map();
  const nameField = holidayNameField();
  (state.masterData?.holidays || []).forEach((h) => {
    const key = toDateKey(h.HolidayDate || h.holidayDate || "");
    if (key) map.set(key, holidayName(h, nameField) || "วันหยุดนักขัตฤกษ์");
  });
  return map;
}

const parseKey = (key) => {
  const [y, m, d] = String(key || "").split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};

/** วันหยุดหรือไม่ — คืนชื่อวันหยุด ("วันเสาร์", "วันหยุดนักขัตฤกษ์ — สงกรานต์") หรือ "" */
export function offDayLabel(dateKey, map = holidayMap()) {
  const date = parseKey(dateKey);
  if (!date) return "";
  if (date.getDay() === 0) return "วันอาทิตย์";
  if (date.getDay() === 6) return "วันเสาร์";
  const name = map.get(dateKey);
  return name ? `วันหยุดนักขัตฤกษ์ — ${name}` : "";
}

/** วันทำการแรกที่ "หลัง" dateKey */
export function nextWorkingDay(dateKey, map = holidayMap()) {
  const date = parseKey(dateKey);
  if (!date) return "";
  for (let i = 0; i < 120; i++) {
    date.setDate(date.getDate() + 1);
    const key = toDateKey(date);
    if (!offDayLabel(key, map)) return key;
  }
  return "";
}

export function formatThaiDate(dateKey) {
  const date = parseKey(dateKey);
  return date ? date.toLocaleDateString("th-TH", { weekday: "short", year: "numeric", month: "long", day: "numeric" }) : (dateKey || "");
}

/** ตรวจวันหยุด — คืน null ถ้าใช้ได้ หรือ { label, next } */
export function checkOffDay(dateKey) {
  const map = holidayMap();
  const label = offDayLabel(dateKey, map);
  return label ? { label, next: nextWorkingDay(dateKey, map) } : null;
}

/** ข้อความเตือน (HTML) + ปุ่มใช้วันทำการถัดไป — ปุ่มมี data-use-due="YYYY-MM-DD" */
export function offDayHtml(off) {
  return `⛔ <b>กำหนดส่งตรง${escapeHtml(off.label)}</b> — ฝ่ายเขียนแบบไม่ทำงาน ส่งคำขอไม่ได้
    ${off.next ? `<br>💡 วันทำการถัดไป: <b>${escapeHtml(formatThaiDate(off.next))}</b>
      <button type="button" class="due-use-next" data-use-due="${off.next}">ใช้วันนี้แทน</button>` : ""}`;
}

export function offDayText(off) {
  return `กำหนดส่งตรง${off.label} — ฝ่ายเขียนแบบไม่ทำงาน${off.next ? ` (วันทำการถัดไป ${formatThaiDate(off.next)})` : ""}`;
}

/**
 * ผูกช่องวันที่ให้เตือนทันทีเมื่อเลือกวันหยุด และกดปุ่มเพื่อเปลี่ยนเป็นวันทำการถัดไปได้
 * @param {HTMLInputElement} input
 * @param {HTMLElement} warnEl  กล่องข้อความเตือน (ระบบซ่อน/แสดงให้)
 */
export function bindOffDayGuard(input, warnEl) {
  if (!input || !warnEl || input.dataset.offDayGuard) return;
  input.dataset.offDayGuard = "1";
  const render = () => {
    const off = input.value ? checkOffDay(input.value) : null;
    input.classList.toggle("is-off-day", Boolean(off));
    warnEl.hidden = !off;
    warnEl.style.display = off ? "" : "none";
    warnEl.innerHTML = off ? `<div class="due-offday-warn">${offDayHtml(off)}</div>` : "";
  };
  input.addEventListener("change", render);
  input.addEventListener("input", render);
  warnEl.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-use-due]");
    if (!btn) return;
    event.preventDefault();
    input.value = btn.dataset.useDue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  render();
}

/** ช่องวันที่ที่มี data-due-guard ได้กล่องเตือนวันหยุดอัตโนมัติ (ไม่ต้องผูกทีละหน้า) */
let enhancerStarted = false;
export function startDueGuardEnhancer() {
  if (enhancerStarted) return;
  enhancerStarted = true;
  const run = () => {
    document.querySelectorAll('input[type="date"][data-due-guard]:not([data-off-day-guard])').forEach((input) => {
      const slot = document.createElement("div");
      slot.className = "due-offday-slot";
      slot.hidden = true;
      input.insertAdjacentElement("afterend", slot);
      bindOffDayGuard(input, slot);
    });
  };
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; run(); });
  }).observe(document.body, { childList: true, subtree: true });
  run();
}
