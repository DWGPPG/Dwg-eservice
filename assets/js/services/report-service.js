import { STATUS_LABELS } from "../../../config/schema.js";
import { groupBy } from "../utils.js";

export function buildStatusSummary(requests) {
  const grouped = groupBy(requests, "status");
  return Object.entries(grouped).map(([status, items]) => ({
    status,
    label: STATUS_LABELS[status] || status,
    count: items.length,
  }));
}

export function buildAgingSummary(requests) {
  const now = Date.now();
  return requests.map((request) => ({
    requestNo: request.requestNo,
    title: request.title,
    status: request.status,
    ageDays: Math.max(0, Math.floor((now - new Date(request.submittedAt || now).getTime()) / 86400000)),
  }));
}
