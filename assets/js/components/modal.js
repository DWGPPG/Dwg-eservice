import { escapeHtml } from "../utils.js";

export function openModal({ title, body, actions = [], onClose }) {
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
    dialog.remove();
    onClose?.();
  };
  dialog.querySelector(".icon-button").addEventListener("click", close);
  dialog.querySelectorAll("footer button").forEach((button) => {
    button.addEventListener("click", () => {
      const action = actions[Number(button.dataset.index)];
      if (action?.onClick) {
        action.onClick(close);
      } else {
        close();
      }
    });
  });
  return close;
}
