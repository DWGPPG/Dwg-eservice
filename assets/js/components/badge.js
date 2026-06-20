import { STATUS_LABELS } from "../../../config/schema.js";
import { escapeHtml } from "../utils.js";

export function statusBadge(status) {
  return `<span class="badge badge-${status}">${escapeHtml(STATUS_LABELS[status] || status || "-")}</span>`;
}

export function priorityBadge(priority) {
  const tone = String(priority || "normal").toLowerCase();
  return `<span class="badge priority-${tone}">${escapeHtml(priority || "Normal")}</span>`;
}
