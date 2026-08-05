import { escapeHtml } from "../utils.js";

// ── ป้องกัน popup ซ้อนกัน: ถ้ามี modal เปิดอยู่แล้ว ไม่เปิดซ้ำ ──
let _modalOpen = false;

export function isModalOpen() {
  return _modalOpen;
}

export function openModal({ title, body, actions = [], onClose }) {
  // ถ้ามี modal เปิดอยู่แล้ว ไม่เปิดใหม่ซ้อน (ป้องกันคลิกซ้ำตอนเน็ตช้า)
  if (_modalOpen) return () => {};

  _modalOpen = true;
  const root = document.querySelector("#modal-root");
  root.replaceChildren();
  const dialog = document.createElement("div");
  dialog.className = "modal-backdrop";
  dialog.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header>
        <h2 id="modal-title">${escapeHtml(title)}</h2>
        <button class="icon-button" type="button" aria-label="Close">×</button>
      </header>
      <div class="modal-body">${body}</div>
      <footer>${actions.map((action, index) => `<button class="${action.className || "secondary-button"}" data-index="${index}" type="button">${escapeHtml(action.label)}</button>`).join("")}</footer>
    </section>
  `;
  root.appendChild(dialog);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    _modalOpen = false;
    dialog.remove();
    onClose?.();
  };
  dialog.querySelector(".icon-button").addEventListener("click", close);
  dialog.querySelectorAll("footer button").forEach((button) => {
    button.addEventListener("click", () => {
      const action = actions[Number(button.dataset.index)];
      if (action?.onClick) {
        // ป้องกันกดปุ่มซ้ำตอนกำลัง async (disable ทุกปุ่มทันทีที่มี onClick)
        const allFooterBtns = dialog.querySelectorAll("footer button");
        allFooterBtns.forEach((btn) => { btn.disabled = true; });
        const result = action.onClick(close);
        // ถ้าไม่ใช่ async (ไม่คืน Promise) ให้ enable ปุ่มกลับ
        if (result && typeof result.finally === "function") {
          result.finally(() => {
            if (!closed) allFooterBtns.forEach((btn) => { btn.disabled = false; });
          });
        } else {
          if (!closed) allFooterBtns.forEach((btn) => { btn.disabled = false; });
        }
      } else {
        close();
      }
    });
  });
  return close;
}

/**
 * Popup เตือนสีแดง เมื่อกำหนดส่งใหม่ตรงกับวันที่ส่งกลับแก้ไข (วันเดียวกัน)
 * เตือนเฉยๆ — ผู้ใช้ยังยืนยันใช้วันเดียวกันได้
 * @returns {Promise<boolean>} true = ยืนยันดำเนินการต่อ
 */
export function confirmSameDayDueDate(newDueDate) {
  return new Promise((resolve) => {
    // close() จะ trigger onClose ด้วย — ต้องกัน resolve ซ้อนไม่ให้ค่าถูกทับเป็น false
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const thaiDate = new Date(`${newDueDate}T00:00:00`).toLocaleDateString("th-TH", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    openModal({
      title: "🚨 กำหนดส่งใหม่เป็นวันนี้",
      body: `
        <div style="border:2px solid #DC2626;background:#FEF2F2;border-radius:12px;padding:18px 20px;">
          <div style="font-size:34px;text-align:center;line-height:1;margin-bottom:10px;">⏰</div>
          <div style="font-size:16px;font-weight:800;color:#B91C1C;text-align:center;margin-bottom:12px;">
            กรุณาเผื่อเวลาให้ฝ่ายเขียนแบบได้แก้ไขงาน
          </div>
          <div style="background:#fff;border:1px solid #FCA5A5;border-radius:8px;padding:12px 14px;font-size:13px;color:#991B1B;line-height:1.8;">
            คุณกำลังส่งกลับแก้ไขและกำหนดส่งใหม่เป็น<br>
            <b style="font-size:15px;color:#DC2626;">${escapeHtml(thaiDate)}</b><br>
            ซึ่งเป็น<b>วันเดียวกันกับวันที่ส่งกลับ</b>
            <br><br>
            การกำหนดส่งภายในวันเดียวกันทำให้ฝ่ายเขียนแบบมีเวลาแก้ไขน้อยมาก
            และมีความเสี่ยงสูงที่งานจะเกินกำหนด ซึ่งจะกระทบ KPI ของฝ่าย
          </div>
          <div style="margin-top:12px;font-size:12px;color:#7F1D1D;text-align:center;">
            💡 หากงานเร่งด่วนจริง สามารถยืนยันใช้วันเดียวกันได้ — นี่เป็นเพียงการแจ้งเตือน
          </div>
        </div>
      `,
      actions: [
        { label: "↩️ กลับไปแก้วันที่", className: "secondary-button", onClick: (close) => { done(false); close(); } },
        { label: "ยืนยันใช้วันนี้", className: "danger-button", onClick: (close) => { done(true); close(); } },
      ],
      onClose: () => done(false),
    });
  });
}
