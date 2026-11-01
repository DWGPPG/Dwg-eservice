// ══════════════════════════════════════════════════════════════
// แบ่งหน้าตาราง — ตารางที่มีหลายพันแถวทำให้เบราว์เซอร์หน่วง จึงวาดทีละหน้า (ค่าเริ่มต้น 50 แถว)
// ใช้:  const { rows: pageRows, html: pagerHtml } = paginate(rows, "track-workbook", { sig, onChange });
//  - sig      : ค่าตัวกรองปัจจุบัน — เปลี่ยนเมื่อไร กลับไปหน้า 1 (ข้อมูลอัปเดตเฉยๆ ไม่รีเซ็ตหน้า)
//  - onChange : ฟังก์ชันวาดตารางใหม่ (เรียกเมื่อกดเปลี่ยนหน้า/จำนวนแถว)
// ══════════════════════════════════════════════════════════════

const SIZE_OPTIONS = [25, 50, 100, 200];
const DEFAULT_SIZE = 50;
const SIZE_KEY = "ppg-page-size";

const stateByKey = new Map(); // key → { page, sig, onChange }
let bound = false;

function readSize() {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return SIZE_OPTIONS.includes(n) ? n : DEFAULT_SIZE;
  } catch {
    return DEFAULT_SIZE;
  }
}
let pageSize = readSize();

function bindOnce() {
  if (bound) return;
  bound = true;
  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-pager-go]");
    if (!btn || btn.disabled) return;
    const key = btn.closest("[data-pager]")?.dataset.pager;
    const st = stateByKey.get(key);
    if (!st) return;
    const go = btn.dataset.pagerGo;
    if (go === "prev") st.page -= 1;
    else if (go === "next") st.page += 1;
    else if (go === "first") st.page = 1;
    else if (go === "last") st.page = Infinity;
    else st.page = Number(go) || 1;
    rerender(key, st);
  });
  document.addEventListener("change", (event) => {
    const select = event.target.closest("[data-pager-size]");
    if (!select) return;
    const key = select.closest("[data-pager]")?.dataset.pager;
    const st = stateByKey.get(key);
    if (!st) return;
    pageSize = Number(select.value) || DEFAULT_SIZE;
    try { localStorage.setItem(SIZE_KEY, String(pageSize)); } catch { /* ignore */ }
    st.page = 1;
    rerender(key, st);
  });
}

function rerender(key, st) {
  st.onChange?.();
  // เลื่อนกลับไปหัวตาราง เพื่อเริ่มอ่านหน้าใหม่จากแถวแรก
  const anchor = document.querySelector(`[data-pager-anchor="${CSS.escape(key)}"]`);
  anchor?.scrollIntoView({ block: "start", behavior: "smooth" });
}

export function paginate(rows, key, { sig = "", onChange = null } = {}) {
  bindOnce();
  let st = stateByKey.get(key);
  if (!st) {
    st = { page: 1, sig, onChange };
    stateByKey.set(key, st);
  }
  if (st.sig !== sig) {
    st.sig = sig;
    st.page = 1;
  }
  st.onChange = onChange;

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  st.page = Math.min(Math.max(1, st.page), pages);
  const start = (st.page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  if (total <= SIZE_OPTIONS[0]) return { rows: pageRows, html: "", anchor: "" };

  const n = (v) => v.toLocaleString("th-TH");
  const html = `
    <div class="pager" data-pager="${key}">
      <span class="pager-info">แสดง ${n(start + 1)}–${n(start + pageRows.length)} จาก ${n(total)} รายการ</span>
      <div class="pager-controls">
        <button type="button" class="pager-btn" data-pager-go="first" ${st.page === 1 ? "disabled" : ""} aria-label="หน้าแรก">«</button>
        <button type="button" class="pager-btn" data-pager-go="prev" ${st.page === 1 ? "disabled" : ""} aria-label="ก่อนหน้า">‹</button>
        <span class="pager-page">หน้า ${n(st.page)} / ${n(pages)}</span>
        <button type="button" class="pager-btn" data-pager-go="next" ${st.page === pages ? "disabled" : ""} aria-label="ถัดไป">›</button>
        <button type="button" class="pager-btn" data-pager-go="last" ${st.page === pages ? "disabled" : ""} aria-label="หน้าสุดท้าย">»</button>
        <select class="pager-size" data-pager-size aria-label="จำนวนแถวต่อหน้า">
          ${SIZE_OPTIONS.map((s) => `<option value="${s}" ${s === pageSize ? "selected" : ""}>${s} แถว/หน้า</option>`).join("")}
        </select>
      </div>
    </div>`;
  return { rows: pageRows, html, anchor: `<span data-pager-anchor="${key}"></span>` };
}
