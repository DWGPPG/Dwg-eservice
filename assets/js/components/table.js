import { escapeHtml } from "../utils.js";

export function renderTable({ columns, rows, empty = "No data" }) {
  if (!rows.length) {
    return `<div class="empty-state">${escapeHtml(empty)}</div>`;
  }
  return `
    <div class="table-wrap">
      <table class="m-card-table">
        <thead>
          <tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              ${columns.map((column) => `<td data-label="${escapeHtml(column.label)}">${column.render ? column.render(row) : escapeHtml(row[column.key] ?? "-")}</td>`).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}
