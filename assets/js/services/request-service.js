import { appConfig } from "../../../config/config.js";
import { fields, lists, STATUS } from "../../../config/schema.js";
import { sendMail, sendTeams1on1, sendTeamsWebhook, sendNewRequestWebhook, sendGroupWebhook } from "../graph.js";
import { addItem, deleteItem, ensureSite, getListItems, patchItem } from "../sharepoint.js";
import { setRequests, state, updateRequest } from "../state.js";
import { writeAudit } from "./audit-service.js";
import { ensureRequestFolder, uploadRequestFiles, uploadSendworkFiles } from "./drawing-service.js";
import { getAllManagerEmails, getDrawingTeamMembers } from "./team-service.js";
import { acquireToken } from "../auth.js";

// ══════════════════════════════════════════════════════════════
// PROPOSAL ROUTING — งานประเภท "📋 เขียนแบบ Proposal" แจ้งเตือนทุกขั้นตอน
// เข้ากลุ่ม "The Nexus - Project Sales X DWG" (แทนกลุ่ม Drawing Dept.)
// route อัตโนมัติจาก requestType ที่ผู้ร้องขอเลือกตอนส่งคำร้อง — ไม่ต้องตั้งค่ารายบุคคล
// ══════════════════════════════════════════════════════════════

/** true ถ้าคำร้องนี้เป็นงานเขียนแบบ Proposal */
export function isProposalRequest(request) {
  return String(request?.requestType || "").includes("Proposal");
}

/**
 * ยิงข้อความเข้ากลุ่ม Teams ผ่าน Flow relay (Flow เดิมของ Drawing Dept. — URL เดียวที่ยิงได้)
 * โค้ดเป็นคนบอกว่าจะโพสต์เข้ากลุ่มไหนผ่าน groupChatId → Flow แค่รับมาโพสต์
 * @param {string} chatId       — รหัส Group Chat ปลายทาง (เช่น 19:xxxx@thread.v2)
 * @param {string} title
 * @param {string} htmlMessage
 */
async function sendGroupMessage(chatId, title, htmlMessage) {
  const url = appConfig.teams?.drawingTeamWebhookUrl; // Flow relay ตัวเดียว ใช้ร่วมทุกกลุ่ม
  if (!url || !chatId) {
    console.warn("sendGroupMessage: ขาด webhook URL หรือ chatId");
    return false;
  }
  return sendGroupWebhook(url, { groupChatId: chatId, title: title || "", message: htmlMessage || "" });
}

/**
 * แจ้งเตือนเข้ากลุ่ม Nexus — ทำงานเฉพาะเมื่อคำร้องเป็นงาน Proposal (มิฉะนั้น no-op)
 * ไม่ throw เพื่อไม่ให้ flow หลักสะดุด คืน true/false ว่าส่งสำเร็จหรือไม่
 */
export async function notifyNexusGroup(request, title, htmlMessage) {
  if (!isProposalRequest(request)) return false;
  const chatId = appConfig.teams?.nexusChatId;
  if (!chatId) {
    console.warn("notifyNexusGroup: ยังไม่ได้ตั้งค่า teams.nexusChatId ใน config.js — งาน Proposal จะยังไม่แจ้งเข้ากลุ่ม Nexus");
    return false;
  }
  try {
    return await sendGroupMessage(chatId, title, htmlMessage);
  } catch (error) {
    console.warn("notifyNexusGroup failed (non-critical):", error.message);
    return false;
  }
}

/** ประกอบข้อความสรุปมาตรฐานสำหรับโพสต์เข้ากลุ่ม Nexus (ใช้ร่วมทุกขั้นตอน) */
function proposalGroupMessage(request, headline, extraLines = []) {
  return [
    `<b>${headline}</b>`,
    "",
    `📋 <b>เลขคำขอ:</b> ${request.requestNo || "—"}`,
    `📁 <b>โครงการ:</b> ${request.projectName || "—"}`,
    `📐 <b>Drawing:</b> ${request.drawingNo || "—"} ${request.drawingName || ""}`,
    ...extraLines.filter(Boolean),
    "",
    `<a href="${appConfig.azure.redirectUri}#/track">🖥️ ดูรายละเอียดในระบบ</a>`,
  ].join("<br>");
}

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
    revisionSource: item[f.revisionSource],
    revisionCount:  item[f.revisionCount],
    refRequestId: item[f.refRequestId],
    isRevision: item[f.isRevision] === true || item[f.isRevision] === "Yes" || item[f.isRevision] === 1,
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

// ── Hyperlink helper — ใช้ร่วมกันทั้ง toSharePoint และ patchRequest ──
// SharePoint Hyperlink field: Url ≤ 255 ตัวอักษร, ต้องเป็น http/https เท่านั้น
function safeHyperlink(url) {
  if (!url) return undefined;
  const trimmed = String(url).trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) return undefined;
    if (trimmed.length > 255) {
      console.warn("safeHyperlink: URL ยาวเกิน 255 ตัวอักษร →", trimmed.slice(0, 80) + "...");
      const cut = trimmed.slice(0, 255);
      return { Url: cut, Description: cut };
    }
    return { Url: trimmed, Description: trimmed };
  } catch {
    console.warn("safeHyperlink: URL ผิดรูปแบบ →", trimmed.slice(0, 80));
    return undefined;
  }
}

function toSharePoint(request) {
  const f = fields.requests;
  const hyperlink = safeHyperlink; // alias ใช้ชื่อเดิมใน toSharePoint
  // sanitize: ตัดอักขระ control characters ออกจาก text fields
  const safe = (v) => (v ? String(v).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") : "");

  const payload = {
    [f.title]: safe(request.requestNo),
    [f.requestType]: safe(request.requestType),
    [f.projectName]: safe(request.projectName),
    [f.department]: safe(request.department),
    [f.drawingNo]: safe(request.drawingNo),
    [f.drawingName]: safe(request.drawingName),
    [f.drawingCategory]: safe(request.drawingCategory),
    [f.kwp]: safe(request.kwp),
    [f.location]: safe(request.location),
    [f.requesterEmail]: safe(request.requesterEmail),
    [f.requesterName]: safe(request.requesterName),
    [f.dataLink]: safe(request.dataLink || ""),
    [f.reviseNumber]: safe(request.reviseNumber),
    [f.priority]: safe(request.priority),
    [f.description]: safe(request.description),
    [f.revisionReason]: safe(request.revisionReason),
    [f.revisionSource]: safe(request.revisionSource),
    [f.revisionEvidence]: safe(request.revisionEvidence),
    [f.refRequestId]: safe(request.refRequestId),
    [f.isRevision]: request.isRevision ? "Yes" : "No",
    [f.status]: safe(request.status),
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
      `📐 <b>Drawing:</b> ${request.drawingNo || "—"} — ${request.drawingName || ""}`,
      "",
      "เนื่องจากเกินกำหนด 3 วันทำการนับจากวันที่ส่งมอบงานโดยไม่มีการตรวจรับ ระบบจึงอนุมัติงานนี้ให้อัตโนมัติและปิดงานเป็นเสร็จสิ้น",
      `<a href="${appConfig.azure.redirectUri}#/track">🖥️ ดูรายละเอียดในระบบ</a>`,
    ];
    const msg = lines.join("<br>");
    // ส่งหา requester (เจ้าของงาน)
    await sendTeams1on1(request.requesterEmail, msg).catch(() => {});
    // ส่งหา designer ที่รับงาน (ถ้าต่างกัน)
    if (request.assignedToEmail && request.assignedToEmail !== request.requesterEmail) {
      await sendTeams1on1(request.assignedToEmail, msg).catch(() => {});
    }
  }

  await notifyNexusGroup(
    request,
    "🤖 Proposal — ระบบอนุมัติอัตโนมัติ",
    proposalGroupMessage(request, "🤖 ระบบอนุมัติงานอัตโนมัติ (เกินกำหนดตรวจรับ 3 วันทำการ)", [
      `👷 <b>ผู้เขียนแบบ:</b> ${request.assignedToName || "—"}`,
    ])
  );
}

// ══════════════════════════════════════════════════════════════
// CREATE REQUEST — ส่งคำร้องใหม่ (ทุกประเภท, รองรับ Drawing หลายรายการ)
// ══════════════════════════════════════════════════════════════

export async function createRequest(formData, files = [], onProgress = null) {
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

  // ── ติดตาม resource ที่สร้างไปแล้ว เพื่อ rollback ถ้าพัง ──
  let sharePointItemId = null;

  try {
    // ขั้น 1 — สร้างโฟลเดอร์ SharePoint (ถ้ามีอยู่แล้วก็ไม่เป็นไร)
    try {
      await ensureRequestFolder(requestNo);
    } catch {
      // โฟลเดอร์อาจมีอยู่แล้ว — ไม่ถือว่า fail
    }

    // ขั้น 2 — อัปโหลดไฟล์ (ถ้ามี) — ถ้าพังให้ throw ออกไปเลย
    if (files?.length) {
      await uploadRequestFiles(requestNo, files, onProgress);
    }

    // ขั้น 3 — บันทึก List Item ใน SharePoint
    let created;
    try {
      created = await addItem(lists.requests, toSharePoint(request));
    } catch (spError) {
      // แสดง error message ที่อ่านง่ายขึ้น แทนที่จะโชว์ raw JSON
      const msg = spError.message || "";
      if (msg.includes("400") || msg.includes("invalidRequest")) {
        throw new Error(
          "SharePoint ปฏิเสธข้อมูล — อาจเกิดจากลิงก์แนบที่ไม่ถูกรูปแบบ หรือข้อความในช่องรายละเอียดมีอักขระพิเศษ\n" +
          "ลองตรวจสอบ URL ที่แนบ และลองส่งใหม่อีกครั้ง\n\n(รายละเอียด: " + msg + ")"
        );
      }
      throw spError;
    }
    request.id = created.id;
    sharePointItemId = created.id;

    // ขั้น 4 — อัปเดต state + audit log
    setRequests([request, ...state.requests]);
    await writeAudit({ requestNo, action: "ส่งคำร้อง", detail: request.description });

    // ขั้น 5 — แจ้งเตือน (non-critical — ถ้าพังไม่ rollback)
    notifyNewRequest(request).catch((err) =>
      console.warn("notifyNewRequest failed (non-critical):", err.message)
    );

    return request;

  } catch (error) {
    // ── ROLLBACK — ลบ List Item ที่บันทึกไปแล้ว (ถ้ามี) ──
    if (sharePointItemId) {
      try {
        await deleteItem(lists.requests, sharePointItemId);
        console.info(`Rollback: ลบ List Item ${sharePointItemId} (${requestNo}) เรียบร้อย`);
      } catch (rollbackErr) {
        console.error(`Rollback failed: ลบ ${sharePointItemId} ไม่สำเร็จ —`, rollbackErr.message);
      }
    }

    // ── โยน error กลับไปให้ UI แสดงข้อความที่อ่านได้ ──
    const msg = error.message || "เกิดข้อผิดพลาด";
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("Load failed")) {
      throw new Error("เน็ตหลุดหรือเชื่อมต่อไม่ได้ — กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง");
    }
    if (msg.includes("401") || msg.includes("403")) {
      throw new Error("Session หมดอายุ — กรุณา Refresh หน้าแล้ว Login ใหม่");
    }
    if (msg.includes("timeout") || msg.includes("408")) {
      throw new Error("เชื่อมต่อช้าเกินไป — กรุณาลองใหม่อีกครั้ง หรือลดขนาดไฟล์ที่แนบ");
    }
    throw new Error(`ส่งคำร้องไม่สำเร็จ: ${msg}`);
  }
}

async function notifyNewRequest(request) {
  const thaiDate = new Date(request.submittedAt).toLocaleDateString("th-TH", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const emoji = request.isRevision ? "✏️" : "📋";
  const title = request.isRevision
    ? `${emoji} Revision เข้ามาแล้ว! — ${request.requestNo}`
    : `${emoji} คำร้องใหม่เข้ามาแล้ว! — ${request.requestNo}`;

  const msg = [
    `<b>${title}</b>`,
    `📌 เลขที่: <b>${request.requestNo || "—"}</b>`,
    `🏷️ ประเภท: ${request.requestType || "—"}`,
    `🏗️ โครงการ: ${request.projectName || "—"}`,
    `📐 Drawing: ${request.drawingNo || "—"} ${request.drawingName || ""}`,
    `👤 ผู้ส่ง: ${request.requesterName || "—"}`,
    `🕐 วันที่: ${thaiDate}`,
  ].join("<br>");

  // ── 0) งาน Proposal → เข้ากลุ่ม Nexus เท่านั้น (แทนกลุ่ม Drawing Dept.) ──
  if (isProposalRequest(request)) {
    const ok = await notifyNexusGroup(request, title, msg);
    if (ok) {
      console.log("notifyNewRequest: ส่งเข้ากลุ่ม Nexus สำเร็จ");
      return;
    }
    // ถ้ากลุ่ม Nexus ส่งไม่สำเร็จ (เช่นยังไม่ได้ตั้ง URL) — ตกลง 1:1 หาทีมเขียนแบบไว้กันตกหล่น
    // แต่ไม่ fallback ไปกลุ่ม Drawing Dept. ตาม design "แทนกลุ่มเดิม"
    console.warn("notifyNewRequest: Nexus ส่งไม่สำเร็จ — fallback 1:1 หาทีมเขียนแบบแทน (ไม่เข้ากลุ่ม Drawing Dept.)");
    await notifyTeam1on1(msg);
    return;
  }

  // ── 1) งานประเภทอื่น → กลุ่ม Drawing Dept. ผ่าน Flow relay ตัวเดิม (บอก groupChatId ให้) ──
  const drawingChatId = appConfig.teams?.drawingTeamChatId;
  if (appConfig.teams?.drawingTeamWebhookUrl && drawingChatId) {
    const relayOk = await sendGroupMessage(drawingChatId, title, msg);
    if (relayOk) {
      console.log("notifyNewRequest: ส่งเข้ากลุ่ม Drawing Dept. (relay) สำเร็จ");
      return;
    }
    console.warn("notifyNewRequest: relay ส่งไม่สำเร็จ ลอง direct Graph ต่อ");
  }

  // ── 2) Fallback — ส่งเข้า Group Chat "Drawing Dept. นะจ๊ะ" ตรงด้วย token ของผู้ส่งเอง
  //    (ใช้ได้เฉพาะถ้าผู้ส่งเป็นสมาชิก Group Chat นี้อยู่แล้ว) ──
  const GROUP_CHAT_ID = "19:e668fd9c854447918fdb8218e2f023bb@thread.v2";

  try {
    const token = await acquireToken();
    const resp = await fetch(
      `https://graph.microsoft.com/v1.0/chats/${GROUP_CHAT_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: { contentType: "html", content: msg },
        }),
      }
    );
    if (resp.ok) {
      console.log("notifyNewRequest: ส่ง Group Chat สำเร็จ");
    } else {
      const detail = await resp.text();
      console.warn("notifyNewRequest Group Chat failed:", resp.status, detail);
      // ── 3) Fallback สุดท้าย — ส่ง 1:1 หาสมาชิกทีมแทน ──
      await notifyTeam1on1(msg);
    }
  } catch (err) {
    console.warn("notifyNewRequest error:", err.message);
    await notifyTeam1on1(msg);
  }
}

async function notifyTeam1on1(msg) {
  const teamMembers = getDrawingTeamMembers();
  console.log(`notifyTeam1on1: กำลังส่งหา ${teamMembers.length} คน`, teamMembers.map((m) => m.email));
  if (!teamMembers.length) {
    console.warn("notifyTeam1on1: ไม่พบสมาชิกทีมเขียนแบบ — ตรวจสอบ DrawingTeam SharePoint List");
    return;
  }
  const results = await Promise.allSettled(
    teamMembers.map((m) =>
      sendTeams1on1(m.email, msg).catch((e) => {
        console.warn(`notify 1:1 to ${m.email} failed:`, e.message);
        throw e;
      })
    )
  );
  const ok = results.filter((r) => r.status === "fulfilled").length;
  console.log(`notifyTeam1on1: สำเร็จ ${ok}/${teamMembers.length}`);
}

// ══════════════════════════════════════════════════════════════
// TRANSITION — ใช้ patchItem โดยตรงพร้อม audit + notify
// ══════════════════════════════════════════════════════════════

// SharePoint Hyperlink fields — ต้องส่งเป็น { Url, Description } ไม่ใช่ string ธรรมดา
// ไม่มี Hyperlink fields ที่ต้องส่งเป็น {Url, Description} แล้ว
// dataLink, dwgFileUrl, pdfFileUrl ทั้งหมดเปลี่ยนเป็น Multiple lines of text ใน SharePoint
// ส่งเป็น plain text string ตรงๆ แทน
const HYPERLINK_LOCAL_KEYS = new Set([]);

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

    // Hyperlink field: ใช้ safeHyperlink เดียวกับ toSharePoint
    if (HYPERLINK_LOCAL_KEYS.has(localKey)) {
      const urlStr = typeof value === "string" ? value.trim() : (value?.Url || "");
      spPatch[spField] = safeHyperlink(urlStr) ?? null;
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

  await notifyNexusGroup(
    request,
    "✅ Proposal — มอบหมายงานแล้ว",
    proposalGroupMessage(request, `✅ มอบหมายงานให้ ${assignee.name || "—"} (${level})`, [
      `🎯 <b>ผู้อนุมัติ:</b> ${state.user?.name || "—"}`,
      note ? `📌 <b>หมายเหตุ:</b> ${note}` : "",
    ])
  );
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

  await notifyNexusGroup(
    request,
    "✅ Proposal — อนุมัติแล้ว เริ่มงานได้",
    proposalGroupMessage(request, "✅ อนุมัติแล้ว (Lv.2) เริ่มดำเนินการได้", [
      `👷 <b>ผู้เขียนแบบ:</b> ${request.assignedToName || "—"}`,
      `✔️ <b>อนุมัติโดย:</b> ${state.user?.name || "—"}`,
      request.dueDate ? `⏰ <b>กำหนดส่งงาน:</b> ${new Date(request.dueDate).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" })}` : "",
    ])
  );
}

// ══════════════════════════════════════════════════════════════
// REJECT / CANCEL — ตามตาราง logic ที่ตกลงกันไว้:
//   Lv.1 reject/cancel              → แจ้งผู้ร้องขอ, status = rejected/cancelled
//   Lv.2 reject (มี Lv.1)           → กลับเป็น pending แจ้ง Lv.1 (ล้าง assignee)
//   Lv.2 reject (ไม่มี Lv.1)/cancel → แจ้งผู้ร้องขอ
// ══════════════════════════════════════════════════════════════

/**
 * โอนคำร้องให้ผู้ร้องขอคนใหม่ — ใช้กรณี Requester เดิมลาออก/ย้ายงาน
 * เปลี่ยน requesterEmail/requesterName โดยคำร้องเดิมไม่ขาดตอน ประวัติ Audit Log ยังครบ
 */
export async function transferRequester(request, newRequester, reason = "") {
  const oldName  = request.requesterName  || "—";
  const oldEmail = request.requesterEmail || "—";

  await patchRequest(
    request,
    {
      requesterEmail: newRequester.email,
      requesterName:  newRequester.name,
    },
    `โอนผู้ร้องขอ: ${oldName} (${oldEmail}) → ${newRequester.name} (${newRequester.email})${reason ? " — " + reason : ""}`
  );

  const thaiDate = new Date().toLocaleDateString("th-TH", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const lines = [
    "🔄 <b>PPG Drawing e-Service — คำร้องถูกโอนมาให้คุณ</b>", "",
    `📋 <b>เลขคำขอ:</b> ${request.requestNo}`,
    `🏗️ <b>โครงการ:</b> ${request.projectName || "—"}`,
    `📐 <b>Drawing No.:</b> ${request.drawingNo || "—"}`,
    `📄 <b>Drawing Name:</b> ${request.drawingName || "—"}`, "",
    `👤 <b>เดิม:</b> ${oldName}`,
    `👤 <b>ผู้รับช่วงต่อ:</b> ${newRequester.name}`,
    reason ? `📌 <b>เหตุผล:</b> ${reason}` : "",
    `📅 <b>วันที่โอน:</b> ${thaiDate}`, "",
    "💡 คำร้องนี้จะปรากฏใน \"งานของฉัน\" ของคุณตั้งแต่บัดนี้",
    `<a href="${appConfig.azure.redirectUri}">เข้าระบบเพื่อดูรายละเอียด</a>`,
  ].filter(Boolean);

  // แจ้ง Requester คนใหม่
  await sendTeams1on1(newRequester.email, lines.join("<br>")).catch((err) =>
    console.warn("transferRequester notify (new) failed:", err.message)
  );

  // แจ้ง Designer/ผู้รับผิดชอบงานปัจจุบัน (ถ้ามี) ให้รู้ว่าผู้ร้องขอเปลี่ยน
  if (request.assignedToEmail && request.assignedToEmail !== newRequester.email) {
    const designerMsg = [
      "ℹ️ <b>แจ้งเปลี่ยนผู้ร้องขอ</b>", "",
      `📋 <b>เลขคำขอ:</b> ${request.requestNo}`,
      `👤 <b>เปลี่ยนจาก:</b> ${oldName} → ${newRequester.name}`,
    ].join("<br>");
    await sendTeams1on1(request.assignedToEmail, designerMsg).catch(() => {});
  }

  await notifyNexusGroup(
    request,
    "🔄 Proposal — โอนผู้ร้องขอ",
    proposalGroupMessage(request, "🔄 โอนผู้ร้องขอ", [
      `👤 <b>เดิม:</b> ${oldName}`,
      `👤 <b>ผู้รับช่วงต่อ:</b> ${newRequester.name}`,
      reason ? `📌 <b>เหตุผล:</b> ${reason}` : "",
    ])
  );
}

/**
 * ตีกลับคำร้องก่อนรับงาน — ใช้เมื่อ Designer/Manager ตรวจดูในแท็บ "รับงาน"
 * แล้วพบว่าข้อมูลไม่เพียงพอ ไม่ต้องรับงานมาก่อน
 * ส่งกลับตรงไปหา Requester ทันที พร้อมเหตุผล
 */
export async function rejectBeforePickup(request, reason) {
  await patchRequest(
    request,
    { status: STATUS.REJECTED, rejectReason: reason },
    "ตีกลับก่อนรับงาน (ข้อมูลไม่เพียงพอ)"
  );

  const thaiDate = new Date().toLocaleDateString("th-TH", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const lines = [
    "↩️ <b>PPG Drawing e-Service — คำร้องถูกตีกลับ</b>", "",
    `📋 <b>เลขคำขอ:</b> ${request.requestNo}`,
    `🏗️ <b>โครงการ:</b> ${request.projectName || "—"}`,
    `📐 <b>Drawing No.:</b> ${request.drawingNo || "—"}`,
    `📄 <b>Drawing Name:</b> ${request.drawingName || "—"}`,
    "", "📌 <b>เหตุผลที่ตีกลับ (ข้อมูลไม่เพียงพอ):</b>", reason, "",
    `👤 <b>ตีกลับโดย:</b> ${state.user?.name || ""}`,
    `📅 <b>วันที่:</b> ${thaiDate}`,
    "", "💡 กรุณาแก้ไขข้อมูลและส่งคำร้องใหม่อีกครั้ง",
    `<a href="${appConfig.azure.redirectUri}">เข้าระบบเพื่อแก้ไข</a>`,
  ];

  if (request.requesterEmail) {
    await sendTeams1on1(request.requesterEmail, lines.join("<br>")).catch((err) =>
      console.warn("rejectBeforePickup notify failed:", err.message)
    );
  }

  await notifyNexusGroup(
    request,
    "↩️ Proposal — ตีกลับก่อนรับงาน",
    proposalGroupMessage(request, "↩️ ตีกลับก่อนรับงาน (ข้อมูลไม่เพียงพอ)", [
      `📌 <b>เหตุผล:</b> ${reason}`,
      `👤 <b>โดย:</b> ${state.user?.name || "—"}`,
    ])
  );
}

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

  await notifyNexusGroup(
    request,
    "↩️ Proposal — ส่งกลับแก้ไข",
    proposalGroupMessage(request, isBackToLv1 ? "↩️ ส่งกลับ Lv.1 (จากผู้จัดการ)" : "↩️ ส่งกลับผู้ร้องขอ", [
      `📌 <b>สิ่งที่ต้องแก้ไข:</b> ${reason}`,
      `👤 <b>โดย:</b> ${state.user?.name || "—"}`,
    ])
  );
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

  await notifyNexusGroup(
    request,
    "❌ Proposal — ยกเลิกคำร้อง",
    proposalGroupMessage(request, "❌ ยกเลิกคำร้อง", [
      `📌 <b>เหตุผล:</b> ${reason}`,
      `👤 <b>ยกเลิกโดย:</b> ${state.user?.name || "—"}`,
    ])
  );
}

// ══════════════════════════════════════════════════════════════
// WORK STATUS (working / approved) — ผู้เขียนแบบอัปเดตเอง
// ══════════════════════════════════════════════════════════════

export async function updateWorkStatus(request, status) {
  // Optimistic update — เปลี่ยน state ทันทีก่อนรอ API
  const prevStatus = request.status;
  updateRequest(request.requestNo, () => ({ status }));

  try {
    const f = fields.requests;
    await patchItem(lists.requests, request.id, { [f.status]: status });
    await writeAudit({ requestNo: request.requestNo, action: `อัปเดตสถานะ: ${status}`, detail: "" });
  } catch (error) {
    // ถ้า API error ให้คืนสถานะเดิม
    updateRequest(request.requestNo, () => ({ status: prevStatus }));
    throw error;
  }
}

// ══════════════════════════════════════════════════════════════
// SENDWORK — ผู้เขียนแบบส่งงาน → mgr_review (รอผู้จัดการตรวจ+ส่งมอบ)
// ══════════════════════════════════════════════════════════════

export async function submitSendwork(request, { dwgUrl, pdfUrl, reviseTag, note, files = [], onProgress = null }) {
  let finalDwgUrl = dwgUrl || "";
  let finalPdfUrl = pdfUrl || "";
  let otherFileLinks = [];

  if (files.length) {
    try {
      const uploaded = await uploadSendworkFiles(request, files, reviseTag, onProgress);
      uploaded.forEach((file) => {
        const ext = (file.name || "").split(".").pop()?.toLowerCase();
        // ดึง URL — webUrl คือ SharePoint page URL, downloadUrl คือ direct download
        const url = file.webUrl || file["@microsoft.graph.downloadUrl"] || "";
        if (!url) return;
        if (ext === "dwg" && !finalDwgUrl) {
          finalDwgUrl = url;
        } else if (ext === "pdf" && !finalPdfUrl) {
          finalPdfUrl = url;
        } else {
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

  await notifyNexusGroup(
    request,
    "🔍 Proposal — ส่งงานแล้ว รอตรวจสอบ",
    proposalGroupMessage(request, "🔍 ผู้เขียนแบบส่งงานแล้ว รอผู้จัดการตรวจสอบ", [
      `🔄 <b>Revise:</b> ${request.currentRevise || request.reviseNumber || "—"}`,
      `👤 <b>ผู้เขียนแบบ:</b> ${state.user?.name || "—"}`,
      dwgUrl ? `📐 <a href="${dwgUrl}">เปิดไฟล์ DWG</a>` : "",
      pdfUrl ? `📄 <a href="${pdfUrl}">เปิดไฟล์ PDF</a>` : "",
      ...otherFileLinks.map((f) => `📎 <a href="${f.url}">${f.name}</a>`),
      note ? `📌 <b>หมายเหตุ:</b> ${note}` : "",
    ])
  );
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
    // ไฟล์อื่นๆ ที่แนบมาเพิ่มเติม (เก็บใน noteFromDrawing หลัง |||)
    ...(() => {
      try {
        const raw = request.noteFromDrawing || "";
        const sep = raw.indexOf("|||");
        if (sep === -1) return [];
        return JSON.parse(raw.slice(sep + 3)).map((f) => `📎 <a href="${f.url}">${f.name}</a>`);
      } catch { return []; }
    })(),
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

  await notifyNexusGroup(
    request,
    "📦 Proposal — ส่งมอบงานแล้ว",
    proposalGroupMessage(request, "📦 งานพร้อมส่งมอบแล้ว รอผู้ร้องขอตรวจรับ", [
      `🔄 <b>Revise:</b> ${request.currentRevise || request.reviseNumber || "—"}`,
      `👷 <b>ผู้เขียนแบบ:</b> ${request.assignedToName || "—"}`,
      `✅ <b>ตรวจสอบโดย:</b> ${state.user?.name || "—"} (ผู้จัดการ)`,
      request.dwgFileUrl ? `📐 <a href="${request.dwgFileUrl}">เปิดไฟล์ DWG</a>` : "",
      request.pdfFileUrl ? `📄 <a href="${request.pdfFileUrl}">เปิดไฟล์ PDF</a>` : "",
      `⏰ <b>ผู้ร้องขอต้องตรวจรับภายใน:</b> ${thaiDeadline} (ไม่เกิน 3 วันทำการ)`,
    ])
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

  await notifyNexusGroup(
    request,
    "↩️ Proposal — ผู้จัดการส่งกลับแก้ไข",
    proposalGroupMessage(request, "↩️ ผู้จัดการส่งกลับให้แก้ไข", [
      `📌 <b>เหตุผล:</b> ${reason}`,
      `👤 <b>ส่งกลับโดย:</b> ${state.user?.name || "—"} (ผู้จัดการ)`,
    ])
  );
}

// ══════════════════════════════════════════════════════════════
// REQUESTER REVIEW — ผู้ร้องขอตรวจรับงาน (อนุมัติ / ขอแก้ไข / Reject)
// ══════════════════════════════════════════════════════════════

export async function requesterReview(request, action, comment = "", revisionSource = "") {
  const now = new Date().toISOString();
  const patch = { reviewedAt: now };

  if (action === "approve") {
    patch.status = STATUS.DONE;
    patch.reviewResult = "approved";
    patch.doneAt = now;
  } else if (action === "revise") {
    patch.status = STATUS.WORKING;
    patch.reviewResult = "revise";
    patch.reviseComment = comment;      // เก็บ comment ตัวเดิมไว้ด้วย (backward compat)
    patch.isRevision = true;            // flag สำหรับ report/KPI
    patch.revisionReason = comment;     // free text ที่ report.js อ่าน
    patch.revisionCount = (parseInt(request.revisionCount || "0", 10) + 1).toString();
    if (revisionSource) patch.revisionSource = revisionSource;
  } else {
    patch.status = STATUS.WORKING;
    patch.reviewResult = "reject";
    patch.deliveryRejectReason = comment;
  }

  await patchRequest(request, patch, `ผู้ร้องขอตรวจรับ: ${action}`);

  const emoji     = action === "approve" ? "✅" : action === "revise" ? "✏️" : "❌";
  const actionTh  = action === "approve" ? "อนุมัติรับงาน" : action === "revise" ? "ขอแก้ไข" : "Reject (ส่งกลับแก้ไขใหม่)";
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
    (action === "revise" && revisionSource) ? `🏷️ <b>สาเหตุ:</b> ${revisionSource}` : "",
    "",
    `📎 <a href="${appConfig.azure.redirectUri}">ดูใบรับงาน / ตรวจสอบในระบบ</a>`,
  ].filter(Boolean);

  const msg = lines.join("<br>");

  // แจ้ง Designer (คนรับงานเดิม) เสมอ
  if (request.assignedToEmail) {
    await sendTeams1on1(request.assignedToEmail, msg).catch(() => {});
  }

  // งาน Proposal → แจ้งผลการตรวจรับเข้ากลุ่ม Nexus ทุกกรณี (อนุมัติ / ขอแก้ไข / reject)
  await notifyNexusGroup(
    request,
    `${emoji} Proposal — ผลตรวจรับ: ${actionTh}`,
    proposalGroupMessage(request, `${emoji} ผลการตรวจรับ: ${actionTh}`, [
      `🔄 <b>Revise:</b> ${request.currentRevise || request.reviseNumber || "—"}`,
      `👤 <b>โดย:</b> ${state.user?.name || "—"}`,
      comment ? `💬 <b>รายละเอียด:</b> ${comment}` : "",
      (action === "revise" && revisionSource) ? `🏷️ <b>สาเหตุ:</b> ${revisionSource}` : "",
    ])
  );

  // ถ้า Reject → แจ้ง Manager + Group Chat ด้วย
  if (action === "reject") {
    const mgrEmails = getAllManagerEmails();
    await Promise.allSettled(
      mgrEmails.map((email) => sendTeams1on1(email, msg).catch(() => {}))
    );

    // งาน Proposal แจ้งเข้ากลุ่ม Nexus ไปแล้วด้านบน → ไม่ต้องเข้ากลุ่ม Drawing Dept. อีก
    if (isProposalRequest(request)) return;

    // แจ้ง Group Chat "Drawing Dept. นะจ๊ะ" (เฉพาะงานประเภทอื่น)
    const GROUP_CHAT_ID = "19:e668fd9c854447918fdb8218e2f023bb@thread.v2";
    try {
      const token = await acquireToken();
      await fetch(`https://graph.microsoft.com/v1.0/chats/${GROUP_CHAT_ID}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ body: { contentType: "html", content: msg } }),
      });
    } catch (err) {
      console.warn("notifyGroupChat (reject) failed:", err.message);
    }
  }
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

  try {
    await notifyNewRequest(request);
  } catch (notifyErr) {
    console.warn("notifyNewRequest (revision) failed (non-critical):", notifyErr.message);
  }

  return request;
}
