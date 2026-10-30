export function qs(selector, scope = document) {
  return scope.querySelector(selector);
}

export function qsa(selector, scope = document) {
  return Array.from(scope.querySelectorAll(selector));
}

// วันที่ผิดรูปแบบจาก SharePoint (เช่นพิมพ์มือใน List) ทำให้ Intl.format() throw RangeError
// แล้วทั้งหน้าพัง — คืน "-" แทน
export function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatDateOnly(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(date);
}

export function uid(prefix = "REQ") {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const random = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix}-${date}-${random}`;
}

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function serializeForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

export function groupBy(items, key) {
  return items.reduce((result, item) => {
    const group = item[key] || "Unknown";
    result[group] = result[group] || [];
    result[group].push(item);
    return result;
  }, {});
}

export function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }); // BOM ให้ Excel อ่านภาษาไทยถูก
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}


export function formatFileSize(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * นับวันทำงาน (จ.–ศ. ไม่รวมวันหยุดใน holidaySet) ระหว่าง from → to แบบรวมทั้งสองวัน
 * คืนค่าบวกถ้า to อยู่หลัง from, ติดลบถ้าอยู่ก่อน, คืน null ถ้าวันที่ผิดรูปแบบ
 * holidaySet = Set ของ Date#toDateString()
 *
 * เดิมแต่ละหน้าเขียนลูปเดินทีละวันจนกว่า "วัน" จะตรงกัน — วันที่ผิดรูปแบบ (Invalid Date) ทำให้ลูปไม่มีวันจบ
 * และปีที่กรอกเป็น พ.ศ. (เช่น 2569) ทำให้วนหลายแสนรอบต่อแถว → หน้าค้างจนต้องรีเฟรช
 * ฟังก์ชันนี้คำนวณเป็นสัปดาห์ (ไม่ขึ้นกับระยะห่าง) แล้วหักวันหยุดที่อยู่ในช่วง
 */
export function signedWorkingDays(from, to, holidaySet = new Set()) {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  const sign = b >= a ? 1 : -1;
  const start = sign > 0 ? a : b;
  const end = sign > 0 ? b : a;

  // จำนวนวันตามปฏิทิน (ใช้ Date.UTC กันเวลาออมแสงทำให้หารไม่ลงตัว)
  const dayIndex = (d) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  const totalDays = dayIndex(end) - dayIndex(start) + 1;
  let count = Math.floor(totalDays / 7) * 5;
  const startDow = start.getDay();
  for (let i = 0; i < totalDays % 7; i++) {
    const dow = (startDow + i) % 7;
    if (dow !== 0 && dow !== 6) count += 1;
  }

  for (const key of holidaySet) {
    const h = new Date(key);
    if (Number.isNaN(h.getTime())) continue;
    h.setHours(0, 0, 0, 0);
    const dow = h.getDay();
    if (h >= start && h <= end && dow !== 0 && dow !== 6) count -= 1;
  }
  return sign * count;
}

// ── กติกากำหนดส่งของคำร้อง ──
// ส่งภายในวัน (กำหนดส่ง = วันนี้) ได้เฉพาะความเร่งด่วน "เร่งด่วนมาก" — ระดับอื่นต้องเป็นวันถัดไปเป็นต้นไป
export const SAME_DAY_PRIORITY = "เร่งด่วนมาก";

/** วันแรกที่เลือกเป็นกำหนดส่งได้ ("YYYY-MM-DD" ตามเวลาเครื่อง) ตามระดับความเร่งด่วน */
export function minDueDateKey(priority) {
  const d = new Date();
  if (priority !== SAME_DAY_PRIORITY) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * วันทำงานคงเหลือ/ที่เลยมาแล้ว แบบ "ไม่นับวันเริ่มต้น" — นับวันทำงานที่อยู่หลังวันที่เก่ากว่า จนถึงวันที่ใหม่กว่า (รวมวันนั้น)
 *   วันนี้ จ. กำหนดส่ง พ.  → +2 (อ., พ.)        กำหนดส่งเมื่อวาน (จ.) วันนี้ อ. → -1
 *   กำหนดส่ง = วันนี้       → 0
 * คืน null ถ้าวันที่ผิดรูปแบบ
 */
export function workingDaysUntil(from, to, holidaySet = new Set()) {
  const inclusive = signedWorkingDays(from, to, holidaySet);
  if (inclusive === null) return null;
  const a = new Date(from); a.setHours(0, 0, 0, 0);
  const b = new Date(to); b.setHours(0, 0, 0, 0);
  const earlier = a <= b ? a : b;
  const dow = earlier.getDay();
  const earlierIsWorkday = dow !== 0 && dow !== 6 && !holidaySet.has(earlier.toDateString());
  if (!earlierIsWorkday) return inclusive;
  return inclusive - (b >= a ? 1 : -1);
}
