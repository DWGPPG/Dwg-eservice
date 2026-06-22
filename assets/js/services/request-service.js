import { appConfig } from "../../../config/config.js";
import { fields, lists, STATUS } from "../../../config/schema.js";
import { sendMail, sendTeams1on1, sendTeamsGroup } from "../graph.js";
import { addItem, ensureSite, getListItems, patchItem } from "../sharepoint.js";
import { setRequests, state, updateRequest } from "../state.js";
import { writeAudit } from "./audit-service.js";
import { ensureRequestFolder, uploadRequestFiles, uploadSendworkFiles } from "./drawing-service.js";
import { getAllManagerEmails } from "./team-service.js";

// ══════════════════════════════════════════════════════════════
// REQUEST NUMBER GENERATION — ตรงกับ getTypePrefix()/genRefNumber() ใน index__5_.html
// รูปแบบ: DWG-DES-2569-0001 (Proposal), DWG-PES-2569-0001 (ขออนุญาต),
//         DWG-{ProjectCode}-2569-0001 (ก่อสร้าง), DWG-ASB-{Code}-2569-0001 (As-Built),
//         DWG-OTH-2569-0001 (อื่นๆ)
// ══════════════════════════════════════════════════════════════

function typePrefix(requestType, projectCode = "") {
  const type = requestType || "";
  const code = (projectCode || "").replace(/\s+/g, "").toUpperCase().slice(0, 4) || "XXXX";
  const yearBE = new Date().getFullYear() + 543;
  if (type.includes("Proposal")) return `DWG-DES-${yearBE}-`;
  if (type.includes("ขออนุญาต")) return `DWG-PES-${yearBE}-`;
  if (type.includes("ก่อสร้าง")) return `DWG-${code}-${yearBE}-`;
  if (type.includes("As-Built")) return `DWG-ASB-${code}-${yearBE}-`;
  if (type.includes("อื่น")) return `DWG-OTH-${yearBE}-`;
  return `DWG-${yearBE}-`;
}

let genRefLock = Promise.resolve();
let genRefLastMax = null;

/** สร้างเลขคำร้องถัดไป ป้องกันเลขซ้ำเมื่อส่งหลายรายการพร้อมกัน (sequential lock) */
export async function generateRequestNo(requestType, projectCode = "") {
  const result = await (genRefLock = genRefLock.then(async () => {
    const prefix = typePrefix(requestType, projectCode);
    if (genRefLastMax === null || genRefLastMax.prefix !== prefix) {
      try {
        const items = await getListItems(lists.requests);
        const titles = items
          .map((item) => item[fields.requests.title] || "")
          .filter((title) => title.startsWith(prefix) && !title.includes("-Rev."));
        let maxSeq = 0;
        titles.forEach((title) => {
          const num = parseInt(title.replace(prefix, "").split("-")[0], 10);
          if (!Number.isNaN(num) && num > maxSeq) maxSeq = num;
        });
        genRefLastMax = { prefix, seq: maxSeq };
      } catch {
        genRefLastMax = { prefix, seq: 0 };
      }
    }
    genRefLastMax.seq += 1;
    return `${prefix}${String(genRefLastMax.seq).padStart(4, "0")}`;
  }));
  return result;
}

export function resetRequestNoCache() {
  genRefLastMax = null;
}

// ══════════════════════════════════════════════════════════════
// SharePoint ↔ Local mapping
// ══════════════════════════════════════════════════════════════

function fromSharePoint(item) {
  const f = fields.requests;
  return {
    id: item.id,
    requestNo: item[f.title],
    title: `${item[f.projectName] || ""}${item[f.drawingNo] ? " - " + item[f.drawingNo] : ""}`,
    requestType: item[f.requestType],
    projectName: item[f.projectName],
    department: item[f.department],
    drawingNo: item[f.drawingNo],
    drawingName: item[f.drawingName],
    drawingCategory: item[f.drawingCategory],
    kwp: item[f.kwp],
    location: item[f.location],
    requesterEmail: item[f.requesterEmail],
    requesterName: item[f.requesterName],
    dataLink: item[f.dataLink],
    reviseNumber: item[f.reviseNumber],
    currentRevise: item[f.currentRevise],
    priority: item[f.priority] || "ปกติ",
    dueDate: item[f.dueDate],
    description: item[f.description],
    revisionReason: item[f.revisionReason],
    refRequestId: item[f.refRequestId],
    isRevision: item[f.isRevision] === "Yes",
    status: item[f.status] || STATUS.PENDING,
    submittedAt: item[f.submittedAt],
    assignedToName: item[f.assignedToName],
    assignedToEmail: item[f.assignedToEmail],
    reviewerLv1: item[f.reviewerLv1],
    reviewerLv2: item[f.reviewerLv2],
    assignNote: item[f.assignNote],
    approvedLv2At: item[f.approvedLv2At],
    rejectReason: item[f.rejectReason],
    dwgFileUrl: extractUrl(item[f.dwgFileUrl]),
    pdfFileUrl: extractUrl(item[f.pdfFileUrl]),
    noteFromDrawing: item[f.noteFromDrawing],
    deliveredAt: item[f.deliveredAt],
    mgrApprovedBy: item[f.mgrApprovedBy],
    mgrApprovedAt: item[f.mgrApprovedAt],
    mgrRejectReason: item[f.mgrRejectReason],
    mgrRejectedBy: item[f.mgrRejectedBy],
    mgrRejectedAt: item[f.mgrRejectedAt],
    reviewResult: item[f.reviewResult],
    reviseComment: item[f.reviseComment],
    deliveryRejectReason: item[f.deliveryRejectReason],
    reviewedAt: item[f.reviewedAt],
    doneAt: item[f.doneAt],
    reviewDeadline: item[f.reviewDeadline],
    autoApproved: item[f.autoApproved] === true || item[f.autoApproved] === "Yes",
  };
}

function extractUrl(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.Url || value.url || "";
}

function toSharePoint(request) {
  const f = fields.requests;
  // helper: แปลง URL string → SharePoint Hyperlink object
  const hyperlink = (url) => (url ? { Url: url, Description: url } : undefined);
  const payload = {
    [f.title]: request.requestNo,
    [f.requestType]: request.requestType,
    [f.projectName]: request.projectName,
    [f.department]: request.department,
    [f.drawingNo]: request.drawingNo,
    [f.drawingName]: request.drawingName,
    [f.drawingCategory]: request.drawingCategory,
    [f.kwp]: request.kwp,
    [f.location]: request.location,
    [f.requesterEmail]: request.requesterEmail,
    [f.requesterName]: request.requesterName,
    [f.dataLink]: hyperlink(request.dataLink),
    [f.reviseNumber]: request.reviseNumber,
    [f.priority]: request.priority,
    [f.description]: request.description,
    [f.revisionReason]: request.revisionReason,
    [f.refRequestId]: request.refRequestId,
    [f.isRevision]: request.isRevision ? "Yes" : "No",
    [f.status]: request.status,
    [f.submittedAt]: request.submittedAt,
  };
  if (request.dueDate) payload[f.dueDate] = new Date(request.dueDate).toISOString();
  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined || payload[key] === "") delete payload[key];
  });
  return payload;
}

// ══════════════════════════════════════════════════════════════
// HYDRATE
// ══════════════════════════════════════════════════════════════

export async function hydrateRequests() {
  const items = await getListItems(lists.requests);
  const requests = items.map(fromSharePoint);
  setRequests(requests);
  // เช็ค auto-approve หลังโหลดข้อมูลทุกครั้ง (ระบบไม่มี server แยก จึงเช็คได้แค่ตอนมีคนเปิดแอป)
  await checkAndAutoApproveOverdue(requests);
}

/**
 * เช็คคำร้องสถานะ "ส่งมอบแล้ว รอตรวจรับ" (delivered) ที่เกินกำหนด reviewDeadline แล้ว
 * → อนุมัติให้อัตโนมัติเป็น "เสร็จสิ้น" (done) แทนผู้ร้องขอ
 * หมายเหตุ: ระบบนี้ไม่มี server/cron job แยกต่างหาก จึงเช็คได้เฉพาะตอนมีคนเปิดแอปขึ้นมาเท่านั้น
 * (ไม่ใช่ทันทีตอนเที่ยงคืนของวัน deadline แต่จะถูกตรวจจับและอนุมัติในครั้งถัดไปที่มีคน login)
 */
async function checkAndAutoApproveOverdue(requests) {
  const now = Date.now();
  const overdueItems = requests.filter(
    (item) => item.status === STATUS.DELIVERED && item.reviewDeadline && new Date(item.reviewDeadline).getTime() < now
  );
  if (!overdueItems.length) return;

  for (const item of overdueItems) {
    try {
      await autoApproveOverdueRequest(item);
    } catch (error) {
      console.warn(`Auto-approve failed for ${item.requestNo} (non-critical):`, error.message);
    }
  }
  // โหลดข้อมูลใหม่อีกครั้งหลัง auto-approve เพื่อให้ state ตรงกับ SharePoint ล่าสุด
  const refreshed = await getListItems(lists.requests);
  setRequests(refreshed.map(fromSharePoint));
}

async function autoApproveOverdueRequest(request) {
  const now = new Date().toISOString();
  await patchRequest(request, {
    status: STATUS.DONE,
    reviewResult: "approved",
    reviewedAt: now,
    doneAt: now,
    autoApproved: true,
  }, "ระบบอนุมัติอัตโนมัติ (เกินกำหนด 3 วันทำการ)");

  if (request.requesterEmail) {
    const lines = [
      "🤖 <b>PPG Drawing e-Service — ระบบอนุมัติงานให้อัตโนมัติ</b>", "",
      `📋 <b>เลขคำขอ:</b> ${request.requestNo}`,
      `📁 <b>โครงการ:</b> ${request.projectName || "—"}`,
      "",
      "เนื่องจากเกินกำหนด 3 วันทำการนับจากวันที่ส่งมอบงานโดยไม่มีการตรวจรับ ระบบจึงอนุมัติงานนี้ให้อัตโนมัติและปิดงานเป็นเสร็จสิ้น",
    ];
    await sendTeams1on1(request.requesterEmail, lines.join("<br>")).catch(() => {});
  }
}

// ══════════════════════════════════════════════════════════════
// CREATE REQUEST — ส่งคำร้องใหม่ (ทุกประเภท, รองรับ Drawing หลายรายการ)
// ══════════════════════════════════════════════════════════════

export async function createRequest(formData, files = []) {
  const user = state.user || {};
  const requestNo = await generateRequestNo(formData.requestType, formData.projectCode);
  const now = new Date().toISOString();

  const request = {
    requestNo,
    requestType: formData.requestType,
    projectName: formData.projectName,
    department: formData.department || "",
    drawingNo: formData.drawingNo,
    drawingName: formData.drawingName,
    drawingCategory: formData.drawingCategory || "",
    kwp: formData.kwp,
    location: formData.location || "",
    requesterEmail: user.email || formData.requesterEmail,
    requesterName: user.name || formData.requesterName,
    dataLink: formData.dataLink || formData.referenceLink || "",
    reviseNumber: formData.reviseNumber || "",
    priority: formData.priority || "ปกติ",
    dueDate: formData.dueDate,
    description: formData.description || "",
    revisionReason: formData.revisionReason || "",
    refRequestId: formData.refRequestId || "",
    isRevision: Boolean(formData.isRevision),
    status: STATUS.PENDING,
    submittedAt: now,
    id: crypto.randomUUID(),
    dwgFileUrl: "",
    pdfFileUrl: "",
  };

  try {
    await ensureRequestFolder(requestNo);
  } catch {
    // โฟลเดอร์อาจมีอยู่แล้ว ไม่ใช่ปัญหาร้ายแรง
  }

  if (files?.length) {
    try {
      await uploadRequestFiles(requestNo, files);
    } catch (error) {
      console.warn("Upload file failed (non-critical):", error.message);
    }
  }

  try {
    const created = await addItem(lists.requests, toSharePoint(request));
    request.id = created.id;
  } catch (error) {
    console.error("createRequest addItem failed:", error.message);
    throw error;
  }

  setRequests([request, ...state.requests]);
  await writeAudit({ requestNo, action: "ส่งคำร้อง", detail: request.description });
  await notifyNewRequest(request);

  return request;
}

async function notifyNewRequest(request) {
  const chatId = appConfig.teams.drawingTeamChatId;
  if (!chatId) return;
  const thaiDate = new Date(request.submittedAt).toLocaleDateString("th-TH", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const lines = [
    request.isRevision ? "✏️ <b>Revision เข้ามาแล้ว!</b>" : "📋 <b>คำร้องใหม่เข้ามาแล้ว!</b>",
    "",
    `🔖 <b>เลขที่:</b> ${request.requestNo}`,
    request.isRevision ? `🔗 <b>อ้างอิงจาก:</b> ${request.refRequestId || "—"}` : "",
    `📦 <b>ประเภท:</b> ${request.requestType}`,
    `🏗️ <b>โครงการ:</b> ${request.projectName}`,
    `📐 <b>Drawing:</b> ${request.drawingNo} — ${request.drawingName}`,
    `👤 <b>ผู้ส่ง:</b> ${request.requesterName}`,
    `📅 <b>วันที่ส่ง:</b> ${thaiDate}`,
    "",
    `<a href="${appConfig.azure.redirectUri}">🖥️ เข้าระบบตรวจสอบ</a>`,
  ].filter(Boolean);
  await sendTeamsGroup(chatId, lines.join("<br>"));
}

// ══════════════════════════════════════════════════════════════
// TRANSITION — ใช้ patchItem โดยตรงพร้อม audit + notify
// ══════════════════════════════════════════════════════════════

// SharePoint Hyperlink fields — ต้องส่งเป็น { Url, Description } ไม่ใช่ string ธรรมดา
const HYPERLINK_LOCAL_KEYS = new Set(["dwgFileUrl", "pdfFileUrl", "dataLink"]);

// SharePoint Date/Time fields — ต้องส่งเป็น ISO 8601 string เสมอ
const DATE_LOCAL_KEYS = new Set([
  "dueDate", "submittedAt", "approvedLv2At", "deliveredAt",
  "mgrApprovedAt", "mgrRejectedAt", "reviewedAt", "doneAt", "reviewDeadline",
]);

export async function patchRequest(request, patch, auditAction = "") {
  const f = fields.requests;
  const spPatch = {};
  Object.entries(patch).forEach(([localKey, value]) => {
    const spField = f[localKey];
    if (!spField) return;
    if (value === undefined || value === null) return;

    // Hyperlink field: SharePoint ต้องการ { Url, Description }
    if (HYPERLINK_LOCAL_KEYS.has(localKey)) {
      const urlStr = typeof value === "string" ? value.trim() : (value?.Url || "");
      spPatch[spField] = urlStr ? { Url: urlStr, Description: urlStr } : null;
      return;
    }

    // Date/Time field: ต้องเป็น ISO 8601 string เสมอ (ไม่ใช่ locale string)
    if (DATE_LOCAL_KEYS.has(localKey) && value) {
      try {
        spPatch[spField] = new Date(value).toISOString();
      } catch {
        spPatch[spField] = value;
      }
      return;
    }

    spPatch[spField] = value;
  });
  if (Object.keys(spPatch).length === 0) {
    console.warn("patchRequest: no valid fields to patch for", request.requestNo, patch);
    return state.requests.find((item) => item.requestNo === request.requestNo);
  }
  await patchItem(lists.requests, request.id, spPatch);
  updateRequest(request.requestNo, () => patch);
  if (auditAction) {
    await writeAudit({ requestNo: request.requestNo, action: auditAction, detail: patch.rejectReason || patch.mgrRejectReason || "" });
  }
  return state.requests.find((item) => item.requestNo === request.requestNo);
}

// ══════════════════════════════════════════════════════════════
// LV.1 APPROVE + ASSIGN — มอบหมายผู้รับผิดชอบ → inprogress_lv1
// ══════════════════════════════════════════════════════════════

export async function approveLv1AndAssign(request, assignee, note = "") {
  const user = state.user || {};
  await patchRequest(request, {
    status: STATUS.INPROGRESS_LV1,
    assignedToName: assignee.name,
    assignedToEmail: assignee.email,
    reviewerLv1: user.name || "",
    assignNote: note,
  }, "อนุมัติ Lv.1 + มอบหมาย");

  await notifyAssignee(request, assignee, note, "Lv.1");
}

// ══════════════════════════════════════════════════════════════
// LV.2 APPROVE — มี Lv.1 อยู่แล้ว → approved (ไม่ต้องเลือกผู้รับผิดชอบใหม่)
// ══════════════════════════════════════════════════════════════

export async function approveLv2(request, note = "") {
  const user = state.user || {};
  await patchRequest(request, {
    status: STATUS.APPROVED,
    reviewerLv2: user.name || "",
    approvedLv2At: new Date().toISOString(),
    assignNote: note || request.assignNote,
  }, "อนุมัติ Lv.2");

  await notifyRequesterApproved(request);
}

/** Lv.2 รับงานเอง (ไม่มี Lv.1 มาก่อน) — ต้องเลือกผู้รับผิดชอบเหมือน Lv.1 */
export async function approveLv2AndAssign(request, assignee, note = "") {
  const user = state.user || {};
  await patchRequest(request, {
    status: STATUS.APPROVED,
    assignedToName: assignee.name,
    assignedToEmail: assignee.email,
    reviewerLv2: user.name || "",
    approvedLv2At: new Date().toISOString(),
    assignNote: note,
  }, "อนุมัติ Lv.2 + มอบหมาย");

  await notifyAssignee(request, assignee, note, "Lv.2");
  await notifyRequesterApproved(request);
}

async function notifyAssignee(request, assignee, note, level) {
  const lines = [
    "✅ <b>PPG Drawing e-Service — งานถูกมอบหมายให้คุณ</b>",
    "",
    `📋 <b>เลขคำขอ:</b> ${request.requestNo}`,
    `🏗️ <b>ระบบงาน:</b> ${request.requestType || "—"}`,
    `📁 <b>โครงการ:</b> ${request.projectName || "—"}`,
    `🎯 <b>ผู้อนุมัติ:</b> ${state.user?.name || ""} (${level})`,
    request.description ? `💬 <b>รายละเอียดคำขอ:</b> ${request.description}` : "",
    request.dataLink ? `🔗 <b>ลิงก์แนบ:</b> <a href="${request.dataLink}">${request.dataLink}</a>` : "",
    note ? `📌 <b>หมายเหตุ:</b> ${note}` : "",
  ].filter(Boolean);
  await sendTeams1on1(assignee.email, lines.join("<br>"));
}

async function notifyRequesterApproved(request) {
  if (!request.requesterEmail) return;
  const thaiDate = new Date().toLocaleDateString("th-TH", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const lines = [
    "✅ <b>PPG Drawing e-Service — คำขอของคุณได้รับการอนุมัติแล้ว</b>",
    "",
    `🔖 <b>เลขคำขอ:</b> ${request.requestNo}`,
    `🏗️ <b>ประเภทงาน:</b> ${request.requestType || "—"}`,
    `📁 <b>โครงการ:</b> ${request.projectName || "—"}`,
    `👷 <b>ผู้เขียนแบบ:</b> ${request.assignedToName || "—"}`,
    `✔️ <b>อนุมัติโดย:</b> ${state.user?.name || ""} (Lv.2)`,
    `📅 <b>วันที่อนุมัติ:</b> ${thaiDate}`,
    request.dueDate ? `⏰ <b>กำหนดส่งงาน:</b> ${new Date(request.dueDate).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" })}` : "",
    "",
    `<a href="${appConfig.azure.redirectUri}">🖥️ ติดตามสถานะ</a>`,
  ].filter(Boolean);
  await sendTeams1on1(request.requesterEmail, lines.join("<br>"));
}

// ══════════════════════════════════════════════════════════════
// REJECT / CANCEL — ตามตาราง logic ที่ตกลงกันไว้:
//   Lv.1 reject/cancel              → แจ้งผู้ร้องขอ, status = rejected/cancelled
//   Lv.2 reject (มี Lv.1)           → กลับเป็น pending แจ้ง Lv.1 (ล้าง assignee)
//   Lv.2 reject (ไม่มี Lv.1)/cancel → แจ้งผู้ร้องขอ
// ══════════════════════════════════════════════════════════════

export async function adminReject(request, reason, { isManager, hasLv1 }) {
  const isBackToLv1 = isManager && hasLv1;
  const newStatus = isBackToLv1 ? STATUS.PENDING : STATUS.REJECTED;

  const patch = { status: newStatus, rejectReason: reason };
  if (isBackToLv1) {
    patch.assignedToName = "";
    patch.assignedToEmail = "";
    patch.reviewerLv1 = "";
  }

  await patchRequest(request, patch, isBackToLv1 ? "ส่งกลับ Lv.1" : "ส่งกลับผู้ร้องขอ");

  const targetEmail = isBackToLv1 ? request.assignedToEmail : request.requesterEmail;
  const lines = isBackToLv1
    ? [
      "↩️ <b>PPG Drawing e-Service — ส่งกลับแก้ไข (จาก Lv.2)</b>", "",
      `📋 <b>เลขคำขอ:</b> ${request.requestNo}`,
      `📁 <b>โครงการ:</b> ${request.projectName || "—"}`,
      `📄 <b>Drawing No.:</b> ${request.drawingNo || "—"}`,
      "", "📌 <b>สิ่งที่ต้องแก้ไข (จาก Lv.2):</b>", reason, "",
      `👤 <b>ส่งกลับโดย:</b> ${state.user?.name || ""} (ผู้จัดการ Lv.2)`, "",
      "📝 คำร้องถูกรีเซ็ตกลับเป็น <b>รอตรวจสอบ Lv.1</b> — กรุณาดำเนินการใน Admin tab",
      `<a href="${appConfig.azure.redirectUri}">${appConfig.azure.redirectUri}</a>`,
    ]
    : [
      "↩️ <b>PPG Drawing e-Service — ส่งกลับแก้ไข</b>", "",
      `📋 <b>เลขคำขอ:</b> ${request.requestNo}`,
      `📁 <b>โครงการ:</b> ${request.projectName || "—"}`,
      "📌 <b>เหตุผล / สิ่งที่ต้องแก้ไข:</b>", reason, "",
      `👤 <b>โดย:</b> ${state.user?.name || ""}`,
      `<a href="${appConfig.azure.redirectUri}">${appConfig.azure.redirectUri}</a>`,
    ];
  await sendTeams1on1(targetEmail, lines.join("<br>"));
}

export async function adminCancel(request, reason) {
  await patchRequest(request, { status: STATUS.CANCELLED, rejectReason: reason }, "ยกเลิกคำร้อง");

  // แจ้งเตือนผู้ส่งคำขอ (requester) เสมอ
  const notifyEmail = request.requesterEmail;
  if (!notifyEmail) {
    console.warn("adminCancel: ไม่มี requesterEmail — ไม่สามารถแจ้งเตือนได้", request.requestNo);
    return;
  }

  const thaiDate = new Date().toLocaleDateString("th-TH", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const lines = [
    "❌ <b>PPG Drawing e-Service — คำร้องถูกยกเลิก</b>", "",
    `📋 <b>เลขคำขอ:</b> ${request.requestNo}`,
    `📁 <b>โครงการ:</b> ${request.projectName || "—"}`,
    `📄 <b>Drawing No.:</b> ${request.drawingNo || "—"}`,
    `📝 <b>Drawing Name:</b> ${request.drawingName || "—"}`,
    "",
    `📌 <b>เหตุผลที่ยกเลิก:</b> ${reason}`,
    "",
    `👤 <b>ยกเลิกโดย:</b> ${state.user?.name || ""} (${thaiDate})`,
    `<a href="${appConfig.azure.redirectUri}#/track">🖥️ ดูประวัติคำร้องในระบบ</a>`,
  ];

  // ส่งทั้ง Teams และ Email เพื่อให้แน่ใจว่าผู้รับได้รับแจ้ง
  await sendTeams1on1(notifyEmail, lines.join("<br>")).catch((err) =>
    console.warn("adminCancel Teams notify failed:", err.message)
  );
  await sendMail(
    notifyEmail,
    `❌ [PPG Drawing] คำร้อง ${request.requestNo} ถูกยกเลิก`,
    `คำร้อง ${request.requestNo} (${request.projectName || ""}) ถูกยกเลิกโดย ${state.user?.name || ""}<br><br>เหตุผล: ${reason}<br><br><a href="${appConfig.azure.redirectUri}#/track">ดูสถานะในระบบ</a>`
  ).catch((err) => console.warn("adminCancel Email notify failed:", err.message));
}

// ══════════════════════════════════════════════════════════════
// WORK STATUS (working / approved) — ผู้เขียนแบบอัปเดตเอง
// ══════════════════════════════════════════════════════════════

export async function updateWorkStatus(request, status) {
  await patchRequest(request, { status }, `อัปเดตสถานะ: ${status}`);
}

// ══════════════════════════════════════════════════════════════
// SENDWORK — ผู้เขียนแบบส่งงาน → mgr_review (รอผู้จัดการตรวจ+ส่งมอบ)
// ══════════════════════════════════════════════════════════════

export async function submitSendwork(request, { dwgUrl, pdfUrl, reviseTag, note, files = [] }) {
  let finalDwgUrl = dwgUrl || "";
  let finalPdfUrl = pdfUrl || "";
  let otherFileLinks = []; // ไฟล์ที่ไม่ใช่ DWG/PDF

  if (files.length) {
    try {
      const uploaded = await uploadSendworkFiles(request, files, reviseTag);
      uploaded.forEach((file) => {
        const ext = (file.name || "").split(".").pop()?.toLowerCase();
        const url = file.webUrl || "";
        if (!url) return;
        if (ext === "dwg" && !finalDwgUrl) {
          finalDwgUrl = url;
        } else if (ext === "pdf" && !finalPdfUrl) {
          finalPdfUrl = url;
        } else {
          // ไฟล์ประเภทอื่น (jpg, png, docx, xlsx, zip, dxf ฯลฯ) เก็บ URL+ชื่อไว้
          otherFileLinks.push({ name: file.name, url });
        }
      });
    } catch (error) {
      console.warn("submitSendwork upload failed:", error.message);
    }
  }

  // เก็บลิงก์ไฟล์อื่นๆ ต่อท้าย noteFromDrawing ในรูป JSON เพื่อให้แสดงผลได้
  // รูปแบบ: <หมายเหตุปกติ>|||[{"name":"...","url":"..."}]
  let finalNote = note || "";
  if (otherFileLinks.length) {
    const encoded = JSON.stringify(otherFileLinks);
    finalNote = finalNote
      ? `${finalNote}|||${encoded}`
      : `|||${encoded}`;
  }

  await patchRequest(request, {
    status: STATUS.MGR_REVIEW,
    dwgFileUrl: finalDwgUrl,
    pdfFileUrl: finalPdfUrl,
    currentRevise: reviseTag || request.currentRevise,
    noteFromDrawing: finalNote,
  }, "ส่งงาน — รอผู้จัดการตรวจสอบ");

  await notifyManagersForReview(request, { dwgUrl: finalDwgUrl, pdfUrl: finalPdfUrl, note, otherFileLinks });
}

async function notifyManagersForReview(request, { dwgUrl, pdfUrl, note, otherFileLinks = [] }) {
  const lines = [
    "🔍 <b>PPG Drawing e-Service — รองานตรวจสอบก่อนส่งมอบ</b>", "",
    `📋 <b>เลขคำขอ:</b> ${request.requestNo}`,
    `🏗️ <b>ระบบงาน:</b> ${request.requestType || "—"}`,
    `📁 <b>โครงการ:</b> ${request.projectName || "—"}`,
    `📄 <b>Drawing No.:</b> ${request.drawingNo || "—"}`,
    `📝 <b>Drawing Name:</b> ${request.drawingName || "—"}`,
    `🔄 <b>Revise:</b> ${request.currentRevise || request.reviseNumber || "—"}`,
    `👤 <b>ผู้เขียนแบบ:</b> ${state.user?.name || ""}`,
    dwgUrl ? `📐 <a href="${dwgUrl}">เปิดไฟล์ DWG</a>` : "",
    pdfUrl ? `📄 <a href="${pdfUrl}">เปิดไฟล์ PDF</a>` : "",
    ...otherFileLinks.map((f) => `📎 <a href="${f.url}">${f.name}</a>`),
    note ? `📌 <b>หมายเหตุ:</b> ${note}` : "",
    "",
    "👉 <b>กรุณาเข้าระบบ หน้า \"ติดตามสถานะ\" เพื่อ ✅ ส่งมอบ หรือ ↩️ ส่งกลับแก้ไข</b>",
    `<a href="${appConfig.azure.redirectUri}">${appConfig.azure.redirectUri}</a>`,
  ].filter(Boolean);

  const allManagerEmails = getAllManagerEmails(appConfig.approverLv2Emails || []);
  for (const mgrEmail of allManagerEmails) {
    await sendTeams1on1(mgrEmail, lines.join("<br>"));
  }
}

// ══════════════════════════════════════════════════════════════
// MGR REVIEW — ผู้จัดการ ✅ ส่งมอบ หรือ ↩️ ส่งกลับให้ผู้เขียนแบบแก้ไข
// ══════════════════════════════════════════════════════════════

/**
 * คำนวณวันที่ห่างไปข้างหน้า N "วันทำการ" (ข้ามเสาร์-อาทิตย์ และวันหยุดนักขัตฤกษ์
 * จาก SharePoint List "HolidayList" ที่โหลดไว้ใน state.masterData.holidays)
 * ใช้สำหรับคำนวณ deadline 3 วันทำการที่ผู้ร้องขอต้องตรวจรับงาน
 */
function addBusinessDays(startDate, days) {
  const holidaySet = new Set(
    (state.masterData.holidays || [])
      .map((h) => h[fields.holidays.holidayDate])
      .filter(Boolean)
      .map((d) => new Date(d).toDateString())
  );

  const result = new Date(startDate);
  let remaining = days;
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const dayOfWeek = result.getDay(); // 0 = อาทิตย์, 6 = เสาร์
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = holidaySet.has(result.toDateString());
    if (!isWeekend && !isHoliday) remaining -= 1;
  }
  return result;
}

export async function mgrApproveDeliver(request) {
  const now = new Date().toISOString();
  const deadline = addBusinessDays(new Date(), 3);
  await patchRequest(request, {
    status: STATUS.DELIVERED,
    deliveredAt: now,
    mgrApprovedBy: state.user?.name || "",
    mgrApprovedAt: now,
    reviewDeadline: deadline.toISOString(),
  }, "ผู้จัดการอนุมัติส่งมอบ");

  const thaiDate = new Date(now).toLocaleDateString("th-TH", {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const thaiDeadline = deadline.toLocaleDateString("th-TH", {
    year: "numeric", month: "long", day: "numeric",
  });
  const lines = [
    "📦 <b>PPG Drawing e-Service — งานพร้อมส่งมอบแล้ว!</b>", "",
    `📋 <b>เลขคำขอ:</b> ${request.requestNo}`,
    `🏗️ <b>ระบบงาน:</b> ${request.requestType || "—"}`,
    `📁 <b>โครงการ:</b> ${request.projectName || "—"}`,
    `📄 <b>Drawing No.:</b> ${request.drawingNo || "—"}`,
    `📝 <b>Drawing Name:</b> ${request.drawingName || "—"}`,
    `🔄 <b>Revise:</b> ${request.currentRevise || request.reviseNumber || "—"}`,
    `👷 <b>ผู้เขียนแบบ:</b> ${request.assignedToName || "—"}`,
    `✅ <b>ตรวจสอบโดย:</b> ${state.user?.name || ""} (ผู้จัดการ)`,
    `📅 <b>วันที่ส่งมอบ:</b> ${thaiDate}`,
    request.dwgFileUrl ? `📐 <a href="${request.dwgFileUrl}">เปิดไฟล์ DWG</a>` : "",
    request.pdfFileUrl ? `📄 <a href="${request.pdfFileUrl}">เปิดไฟล์ PDF</a>` : "",
    "",
    `⏰ <b>กรุณาตรวจสอบและอนุมัติกลับภายในวันที่ ${thaiDeadline}</b> (ไม่เกิน 3 วันทำการ ไม่นับวันเสาร์-อาทิตย์และวันหยุดนักขัตฤกษ์) — หากเกินกำหนด ระบบจะอนุมัติให้อัตโนมัติ`,
    "",
    `👉 <a href="${appConfig.azure.redirectUri}#/track"><b>กรุณาตรวจรับงาน (คลิกที่นี่)</b></a>`,
  ].filter(Boolean);
  await sendTeams1on1(request.requesterEmail, lines.join("<br>"));
  await sendMail(
    request.requesterEmail,
    `📦 [PPG Drawing] งาน ${request.requestNo} พร้อมส่งมอบแล้ว — กรุณาตรวจรับภายใน ${thaiDeadline}`,
    `งาน ${request.requestNo} (${request.projectName || ""}) ได้รับการตรวจสอบและอนุมัติโดยผู้จัดการแล้ว กรุณาเข้าระบบเพื่อตรวจรับงานภายในวันที่ ${thaiDeadline} (ไม่เกิน 3 วันทำการ) มิฉะนั้นระบบจะอนุมัติให้อัตโนมัติ: <a href="${appConfig.azure.redirectUri}#/track">${appConfig.azure.redirectUri}#/track</a>`
  );
}

export async function mgrRejectWork(request, reason) {
  const now = new Date().toISOString();
  await patchRequest(request, {
    status: STATUS.MGR_REJECTED,
    mgrRejectReason: reason,
    mgrRejectedBy: state.user?.name || "",
    mgrRejectedAt: now,
  }, "ผู้จัดการส่งกลับแก้ไข");

  const lines = [
    "↩️ <b>PPG Drawing e-Service — งานถูกส่งกลับแก้ไขโดยผู้จัดการ</b>", "",
    `📋 <b>เลขคำขอ:</b> ${request.requestNo}`,
    `📁 <b>โครงการ:</b> ${request.projectName || "—"}`,
    `📄 <b>Drawing No.:</b> ${request.drawingNo || "—"}`,
    `📝 <b>Drawing Name:</b> ${request.drawingName || "—"}`,
    "", "📌 <b>เหตุผลที่ส่งกลับ:</b>", reason, "",
    `👤 <b>ส่งกลับโดย:</b> ${state.user?.name || ""} (ผู้จัดการ)`, "",
    "📝 กรุณาแก้ไขแล้วส่งงานใหม่ผ่านหน้า <b>นำส่งงาน</b>",
    `<a href="${appConfig.azure.redirectUri}">${appConfig.azure.redirectUri}</a>`,
  ];
  await sendTeams1on1(request.assignedToEmail, lines.join("<br>"));
}

// ══════════════════════════════════════════════════════════════
// REQUESTER REVIEW — ผู้ร้องขอตรวจรับงาน (อนุมัติ / ขอแก้ไข / Reject)
// ══════════════════════════════════════════════════════════════

export async function requesterReview(request, action, comment = "") {
  const now = new Date().toISOString();
  const patch = { reviewedAt: now };

  if (action === "approve") {
    patch.status = STATUS.DONE;
    patch.reviewResult = "approved";
    patch.doneAt = now;
  } else if (action === "revise") {
    patch.status = STATUS.APPROVED;
    patch.reviewResult = "revise";
    patch.reviseComment = comment;
  } else {
    patch.status = STATUS.REJECTED;
    patch.reviewResult = "reject";
    patch.deliveryRejectReason = comment;
  }

  await patchRequest(request, patch, `ผู้ร้องขอตรวจรับ: ${action}`);

  const emoji = action === "approve" ? "✅" : action === "revise" ? "✏️" : "❌";
  const actionTh = action === "approve" ? "อนุมัติรับงาน" : action === "revise" ? "ขอแก้ไข" : "Reject";
  const lines = [
    `${emoji} <b>PPG Drawing e-Service — ผลการตรวจรับงาน</b>`, "",
    `📋 <b>เลขคำขอ:</b> ${request.requestNo}`,
    `📦 <b>ระบบงาน:</b> ${request.requestType || "—"}`,
    `🏗️ <b>โครงการ:</b> ${request.projectName || "—"}`,
    `📐 <b>Drawing No.:</b> ${request.drawingNo || "—"}`,
    `📄 <b>Drawing Name:</b> ${request.drawingName || "—"}`,
    `🔄 <b>Revise:</b> ${request.currentRevise || request.reviseNumber || "—"}`,
    `📌 <b>ผล:</b> ${actionTh}`,
    `👤 <b>โดย:</b> ${state.user?.name || ""}`,
    `📅 <b>วันที่:</b> ${new Date(now).toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" })}`,
    comment ? `💬 <b>รายละเอียด:</b> ${comment}` : "",
    "",
    `📎 <a href="${appConfig.azure.redirectUri}?review=${request.requestNo}">ดูใบรับงาน / ตรวจสอบในระบบ</a>`,
  ].filter(Boolean);
  await sendTeams1on1(request.assignedToEmail, lines.join("<br>"));
}

// ══════════════════════════════════════════════════════════════
// REVISION — ค้นหาคำร้องเดิม สร้างคำร้องใหม่แบบ -Rev.XX
// ══════════════════════════════════════════════════════════════

export function findRevisionHistory(allRequests, baseTitle) {
  return allRequests.filter((item) => {
    const title = item.requestNo || "";
    return title.startsWith(baseTitle) && title.includes("-Rev.");
  });
}

export async function createRevisionRequest(sourceRequest, formData, files = []) {
  const baseTitle = (sourceRequest.requestNo || "").replace(/-Rev\.\d+$/, "");
  const allRevisions = findRevisionHistory(state.requests, baseTitle);
  const nextRevNum = String(allRevisions.length + 1).padStart(2, "0");
  const newRequestNo = `${baseTitle}-Rev.${nextRevNum}`;

  const request = {
    requestNo: newRequestNo,
    requestType: sourceRequest.requestType,
    projectName: sourceRequest.projectName,
    department: formData.department || sourceRequest.department,
    drawingNo: sourceRequest.drawingNo,
    drawingName: sourceRequest.drawingName,
    drawingCategory: sourceRequest.drawingCategory,
    kwp: sourceRequest.kwp,
    requesterEmail: state.user?.email || sourceRequest.requesterEmail,
    requesterName: state.user?.name || sourceRequest.requesterName,
    dataLink: formData.dataLink || "",
    reviseNumber: `Rev.${nextRevNum}`,
    priority: formData.priority || "ปกติ",
    dueDate: formData.dueDate,
    description: formData.description || "",
    revisionReason: formData.revisionReason || "",
    refRequestId: sourceRequest.requestNo,
    isRevision: true,
    status: STATUS.PENDING,
    submittedAt: new Date().toISOString(),
    id: crypto.randomUUID(),
  };

  try {
    await ensureRequestFolder(newRequestNo);
  } catch { /* folder may already exist */ }

  if (files?.length) {
    try {
      await uploadRequestFiles(newRequestNo, files);
    } catch (error) {
      console.warn("Revision upload failed (non-critical):", error.message);
    }
  }

  const created = await addItem(lists.requests, toSharePoint(request));
  request.id = created.id;

  setRequests([request, ...state.requests]);
  await writeAudit({ requestNo: newRequestNo, action: "ส่ง Revision", detail: formData.revisionReason });
  await notifyNewRequest(request);

  return request;
}
