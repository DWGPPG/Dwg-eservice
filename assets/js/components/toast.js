import { escapeHtml } from "../utils.js";

export function showToast(message, type = "info") {
  const root = document.querySelector("#toast-root");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span><button type="button" aria-label="Close">×</button>`;
  toast.querySelector("button").addEventListener("click", () => toast.remove());
  root.appendChild(toast);
  setTimeout(() => toast.remove(), 4800);
}
