import { STATUS_LABELS } from "../../../config/schema.js";
import { escapeHtml, formatDate } from "../utils.js";

export function renderTimeline(events = []) {
  return `
    <ol class="timeline">
      ${events.map((event) => `
        <li>
          <span></span>
          <div>
            <strong>${escapeHtml(event.label || STATUS_LABELS[event.status] || event.action)}</strong>
            <small>${formatDate(event.date)} · ${escapeHtml(event.actor || "System")}</small>
            ${event.comment ? `<p>${escapeHtml(event.comment)}</p>` : ""}
          </div>
        </li>
      `).join("")}
    </ol>
  `;
}
