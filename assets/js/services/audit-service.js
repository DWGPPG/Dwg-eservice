import { fields, lists } from "../../../config/schema.js";
import { addItem, ensureListId, ensureSite, getListItems } from "../sharepoint.js";
import { graphFetch } from "../graph.js";
import { state } from "../state.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const WRITE_RETRY_MS = [800, 2000, 4500];
const RETRYABLE = /\b(429|503|504|500)\b|throttl|timeout|Failed to fetch|NetworkError/i;

/**
 * บันทึก audit log ลง SharePoint List "AuditLog"
 * action เช่น 'ส่งคำร้อง', 'อนุมัติ Lv.1', 'นำส่งงาน'
 * - SharePoint จำกัดความถี่ (429/503) ตอนมีหลายรายการพร้อมกัน → ลองใหม่อัตโนมัติ (เดิมพลาดแล้วหายเงียบ)
 */
export async function writeAudit({ requestNo, action, detail = "" }) {
  const user = state.user || {};
  const item = {
    [fields.audit.title]: action,
    [fields.audit.requestId]: requestNo || "",
    [fields.audit.userEmail]: user.email || "",
    [fields.audit.userName]: user.name || "",
    [fields.audit.detail]: detail,
    [fields.audit.actionAt]: new Date().toISOString(),
  };

  for (let attempt = 0; ; attempt += 1) {
    try {
      const saved = await addItem(lists.auditLog, item);
      auditCache = null; // ให้ประวัติที่เปิดดูครั้งถัดไปเห็นรายการใหม่
      oneRequestCache.delete(requestNo);
      return saved;
    } catch (error) {
      if (RETRYABLE.test(String(error.message)) && attempt < WRITE_RETRY_MS.length) {
        await wait(WRITE_RETRY_MS[attempt] + Math.random() * 300);
        continue;
      }
      console.warn("writeAudit failed (non-critical):", error.message);
      return null;
    }
  }
}

// ── อ่าน AuditLog ทั้ง List ครั้งเดียวแล้วใช้ซ้ำ 60 วินาที (เปิดหลายคำร้องติดกันไม่ต้องโหลดใหม่ทุกครั้ง) ──
let auditCache = null; // { at, promise }
const AUDIT_TTL_MS = 60 * 1000;

function loadAuditItems() {
  if (auditCache && Date.now() - auditCache.at < AUDIT_TTL_MS) return auditCache.promise;
  const promise = getListItems(lists.auditLog).catch((error) => {
    auditCache = null;
    throw error;
  });
  auditCache = { at: Date.now(), promise };
  return promise;
}

const norm = (v) => String(v ?? "").trim().toLowerCase();

/**
 * ดึงประวัติ audit log ของคำร้องหนึ่งใบ เรียงจากล่าสุดไปเก่าสุด (สำหรับ timeline)
 * โหลดไม่สำเร็จ → throw (ให้หน้าจอบอกว่า "โหลดไม่สำเร็จ" แทน "ยังไม่มีประวัติ")
 */
export async function getAuditHistory(requestNo) {
  if (!requestNo) return [];
  const key = norm(requestNo);
  const items = await loadAuditItems();
  return items
    .filter((item) => {
      const id = norm(item[fields.audit.requestId]);
      if (id) return id === key;
      // รายการเก่าที่ไม่มีรหัสคำร้อง — ดูจากข้อความแทน
      return norm(item[fields.audit.title]).includes(key) || norm(item[fields.audit.detail]).includes(key);
    })
    .map((item) => ({
      action: item[fields.audit.title] || "",
      userName: item[fields.audit.userName] || "",
      userEmail: item[fields.audit.userEmail] || "",
      detail: item[fields.audit.detail] || "",
      actionAt: item[fields.audit.actionAt] || item.Created || "",
    }))
    .sort((a, b) => new Date(b.actionAt || 0) - new Date(a.actionAt || 0));
}

/**
 * ประวัติหลักที่สร้างจากวันเวลาที่บันทึกในตัวคำร้องเอง (ส่ง / อนุมัติ / ส่งงาน / ตรวจ / ส่งมอบ / ตรวจรับ / ยกเลิก)
 * ใช้เติมขั้นที่ไม่มีใน AuditLog — ประวัติจึงไม่ว่างแม้บันทึก AuditLog บางรายการหายไป
 */
export function requestEvents(r) {
  const ev = (at, action, userName = "", detail = "") => (at ? { action, userName, detail, actionAt: at, derived: true } : null);
  return [
    ev(r.submittedAt, "ส่งคำร้อง", r.requesterName),
    ev(r.approvedLv2At, "อนุมัติเริ่มงาน", r.reviewerLv2 || "", r.assignedToName ? `ผู้รับผิดชอบ: ${r.assignedToName}` : ""),
    ev(r.deptFinishedAt, "ฝ่ายเขียนแบบส่งงานให้ผู้จัดการตรวจ", r.assignedToName),
    ev(r.mgrRejectedAt, "ผู้จัดการส่งกลับแก้ไข", r.mgrRejectedBy || "", r.mgrRejectReason || ""),
    ev(r.mgrApprovedAt || r.deliveredAt, "ผู้จัดการตรวจและส่งมอบงาน", r.mgrApprovedBy || ""),
    ev(r.reviewedAt && r.reviewResult && r.reviewResult !== "approved" ? r.reviewedAt : "", "ผู้ร้องขอขอแก้ไข", r.requesterName, r.reviseComment || r.deliveryRejectReason || ""),
    ev(r.doneAt, r.autoApproved ? "ตรวจรับอัตโนมัติ (ครบกำหนด)" : "ผู้ร้องขอตรวจรับงาน", r.autoApproved ? "" : r.requesterName),
    ev(r.cancelledAt, "ยกเลิกคำร้อง", r.cancelledByName || "", r.rejectReason || ""),
  ].filter(Boolean);
}

/** รวมประวัติจาก AuditLog + จากตัวคำร้อง (ตัดขั้นที่ซ้ำ: มีบันทึก AuditLog ภายใน 5 นาทีของเวลาเดียวกันแล้ว) */
export function mergeHistory(auditEntries, derived) {
  const times = auditEntries.map((e) => new Date(e.actionAt).getTime()).filter((t) => !Number.isNaN(t));
  const extra = derived.filter((d) => {
    const t = new Date(d.actionAt).getTime();
    return !Number.isNaN(t) && !times.some((x) => Math.abs(x - t) < 5 * 60 * 1000);
  });
  return [...auditEntries, ...extra].sort((a, b) => new Date(b.actionAt || 0) - new Date(a.actionAt || 0));
}

// ══════════════════════════════════════════════════════════════
// ใบทวนสอบและอนุมัติแบบ FM-ENG-009 — 1 ใบต่อการตอบกลับของผู้ร้องขอ 1 ครั้ง (อนุมัติ / ขอแก้ไข / Reject)
//  - บันทึกข้อมูลรอบนั้นไว้ใน AuditLog (detail = JSON) → สร้างฟอร์มย้อนหลังได้ทุกรอบ แม้คำร้องถูกแก้ต่อ
//  - TRANS NO = เลขที่คำร้อง-Rev.<rev> (ถ้า Rev ซ้ำกันหลายรอบ ต่อท้าย -2, -3 ...)
// ══════════════════════════════════════════════════════════════
export const TRANSMITTAL_ACTION = "ใบทวนสอบและอนุมัติแบบ FM-ENG-009";
const RESULT_CODE = { approve: "AP", approved: "AP", revise: "RC", reject: "X" };

export const cleanRev = (rev) => String(rev ?? "").trim().replace(/^rev\.?\s*/i, "") || "0";

/** บันทึกรอบการตอบกลับ (เรียกหลังผู้ร้องขออนุมัติ/ขอแก้ไข/Reject สำเร็จ) */
export function writeTransmittal(request, { action, comment = "", source = "", at = new Date().toISOString() }) {
  const round = {
    v: 1,
    code: RESULT_CODE[action] || "AP",
    rev: cleanRev(request.currentRevise || request.reviseNumber),
    at,
    by: state.user?.name || request.requesterName || "",
    comment,
    source,
    issuedName: request.assignedToName || "",
    issuedAt: request.deptFinishedAt || request.approvedLv2At || "",
    checkerName: request.mgrApprovedBy || "",
    checkerAt: request.mgrApprovedAt || request.deliveredAt || "",
  };
  return writeAudit({ requestNo: request.requestNo, action: TRANSMITTAL_ACTION, detail: JSON.stringify(round) });
}

/**
 * ทุกรอบที่ผู้ร้องขอตอบกลับ เรียงเก่า → ใหม่ (สำหรับเลือกพิมพ์ FM-ENG-009 แยกใบ)
 * รอบก่อนมีระบบนี้: ดูจาก AuditLog "ผู้ร้องขอตรวจรับ: ..." และวันเวลาในตัวคำร้อง
 */
/**
 * AuditLog ของคำร้องเดียว — กรองที่ SharePoint (เร็วกว่าโหลดทั้ง List มาก)
 * ถ้า List ใหญ่และคอลัมน์ RequestId ไม่ได้ทำ Index แล้ว SharePoint ปฏิเสธ → ใช้วิธีเดิม (โหลดทั้ง List)
 */
const oneRequestCache = new Map(); // requestNo → { at, promise }
async function auditForRequest(requestNo) {
  if (auditCache && Date.now() - auditCache.at < AUDIT_TTL_MS) return getAuditHistory(requestNo);
  const hit = oneRequestCache.get(requestNo);
  if (hit && Date.now() - hit.at < AUDIT_TTL_MS) return hit.promise;
  const promise = (async () => {
    try {
      const site = await ensureSite();
      const listId = await ensureListId(lists.auditLog);
      const no = String(requestNo).replace(/'/g, "''");
      let url = `/sites/${site}/lists/${listId}/items?expand=fields&$top=200&$filter=fields/${fields.audit.requestId} eq '${no}'`;
      const items = [];
      while (url) {
        const res = await graphFetch(url, { headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" } });
        (res?.value || []).forEach((it) => items.push(it.fields || {}));
        url = res?.["@odata.nextLink"] || null;
      }
      return items.map((item) => ({
        action: item[fields.audit.title] || "",
        userName: item[fields.audit.userName] || "",
        userEmail: item[fields.audit.userEmail] || "",
        detail: item[fields.audit.detail] || "",
        actionAt: item[fields.audit.actionAt] || item.Created || "",
      })).sort((a, b) => new Date(b.actionAt || 0) - new Date(a.actionAt || 0));
    } catch (error) {
      console.warn("กรอง AuditLog ไม่สำเร็จ — โหลดทั้ง List แทน:", error.message);
      return getAuditHistory(requestNo);
    }
  })();
  oneRequestCache.set(requestNo, { at: Date.now(), promise });
  promise.catch(() => oneRequestCache.delete(requestNo));
  return promise;
}

export async function getTransmittals(request) {
  let audit = [];
  try { audit = await auditForRequest(request.requestNo); } catch (_) { audit = []; }
  const near = (a, b) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 5 * 60 * 1000;
  const rounds = [];
  audit.filter((e) => e.action === TRANSMITTAL_ACTION).forEach((e) => {
    try { rounds.push({ ...JSON.parse(e.detail), at: JSON.parse(e.detail).at || e.actionAt }); } catch (_) { /* ข้อมูลเสีย */ }
  });
  // รอบเก่า (ก่อนบันทึก FM-ENG-009) จาก AuditLog
  audit.forEach((e) => {
    const m = String(e.action).match(/ผู้ร้องขอตรวจรับ:\s*(approve|revise|reject)/i);
    if (!m || rounds.some((r) => near(r.at, e.actionAt))) return;
    const code = RESULT_CODE[m[1].toLowerCase()];
    rounds.push({ code, rev: "", at: e.actionAt, by: e.userName, comment: code === "AP" ? "" : (e.detail || ""), legacy: true });
  });
  // รอบล่าสุดจากตัวคำร้อง (กรณี AuditLog ไม่มี) + ตรวจรับอัตโนมัติเมื่อครบกำหนด
  const rev = cleanRev(request.currentRevise || request.reviseNumber);
  if (request.reviewedAt && request.reviewResult && !rounds.some((r) => near(r.at, request.reviewedAt))) {
    const code = RESULT_CODE[request.reviewResult] || "AP";
    rounds.push({ code, rev, at: request.reviewedAt, by: request.requesterName, comment: code === "RC" ? (request.reviseComment || request.revisionReason || "") : code === "X" ? (request.deliveryRejectReason || "") : "", source: code === "RC" ? request.revisionSource || "" : "", legacy: true });
  }
  if (request.doneAt && !rounds.some((r) => r.code === "AP" && near(r.at, request.doneAt))) {
    rounds.push({ code: "AP", rev, at: request.doneAt, by: request.autoApproved ? "ตรวจรับอัตโนมัติ (ครบกำหนด)" : request.requesterName, comment: request.autoApproved ? "ตรวจรับอัตโนมัติเมื่อครบกำหนด" : "", legacy: true, auto: Boolean(request.autoApproved) });
  }
  rounds.sort((a, b) => new Date(a.at) - new Date(b.at));
  // รอบเก่าที่ไม่รู้ Rev: ใช้ Rev ของรอบถัดไปที่รู้ (ส่งมอบก่อนแก้ไข) ไม่งั้นใช้ Rev ปัจจุบัน
  rounds.forEach((r, i) => { if (!r.rev) r.rev = rounds.slice(i + 1).find((x) => x.rev)?.rev || rev; });
  const seen = new Map();
  rounds.forEach((r, i) => {
    r.no = i + 1;
    const base = `${request.requestNo}-Rev.${r.rev}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    r.transNo = n > 1 ? `${base}-${n}` : base;
  });
  return rounds;
}
