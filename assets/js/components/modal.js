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
