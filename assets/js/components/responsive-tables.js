// ══════════════════════════════════════════════════════════════
// ตารางบนมือถือ → แสดงเป็นการ์ดทีละแถว (ตารางหลายคอลัมน์บนจอแคบ ตัวอักษรถูกบีบเหลือคอลัมน์ละ 1 ตัว)
// ใส่ class="m-card-table" ให้ <table> แล้วระบบเติม data-label (ชื่อคอลัมน์) ให้ทุกช่องอัตโนมัติ
// CSS (theme.css) จะเปลี่ยนเป็นการ์ดเฉพาะจอ ≤ 720px — จอคอมยังเป็นตารางเหมือนเดิม
// ตารางที่คอลัมน์แรกเป็นลำดับ (#) → การ์ดใช้คอลัมน์ที่ 2 เป็นหัวการ์ด และลำดับเป็นป้ายเล็ก
// ══════════════════════════════════════════════════════════════

function labelTable(table) {
  const heads = [...table.querySelectorAll("thead th")].map((th) => th.textContent.replace(/ⓘ/g, "").replace(/\s+/g, " ").trim());
  if (!heads.length) return;
  if (heads[0] === "#") table.classList.add("m-card-ranked");
  table.querySelectorAll("tbody tr").forEach((tr) => {
    [...tr.children].forEach((td, i) => {
      if (td.tagName === "TD" && !td.hasAttribute("data-label")) td.setAttribute("data-label", heads[i] || "");
    });
  });
  table.dataset.cardLabeled = String(table.querySelectorAll("tbody tr").length);
}

export function labelCardTables(root = document) {
  root.querySelectorAll("table.m-card-table").forEach((table) => {
    // ติดป้ายใหม่เมื่อจำนวนแถวเปลี่ยน (เช่นตารางถูกวาดใหม่บางส่วน)
    if (table.dataset.cardLabeled === String(table.querySelectorAll("tbody tr").length)) return;
    labelTable(table);
  });
}

let started = false;
export function startResponsiveTables() {
  if (started) return;
  started = true;
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; labelCardTables(document); });
  }).observe(document.body, { childList: true, subtree: true });
  labelCardTables(document);
}
