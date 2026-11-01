// ══════════════════════════════════════════════════════════════
// ย้ายสิทธิ์ผู้จัดการจาก config.js เข้า SharePoint (List DrawingTeam: IsAdmin) — อัตโนมัติครั้งเดียว
//
// ครั้งแรกที่ผู้จัดการเปิดเว็บเวอร์ชันนี้:
//   1) ตั้ง IsAdmin = Yes (+ ป้ายแสดงผล) ให้ทุกอีเมลใน bootstrapAdminEmails ใน DrawingTeam
//   2) บันทึก "bootstrapMigrated" ใน List AppSettings
// หลังจากนั้นสิทธิ์ผู้จัดการมาจากหน้า "จัดการข้อมูล → ทีม & สิทธิ์" อย่างเดียว (ถอด/เพิ่มได้ทุกคน)
// รายชื่อใน config.js เหลือไว้เป็น "ทางกู้คืนฉุกเฉิน" เท่านั้น — มีผลเมื่อ SharePoint ไม่มีผู้จัดการเหลือเลย
// ══════════════════════════════════════════════════════════════

import { appConfig } from "../../../config/config.js";
import { lists } from "../../../config/schema.js";
import { addItem, patchItem, saveSetting } from "../sharepoint.js";
import { state } from "../state.js";
import { writeAudit } from "./audit-service.js";
import { BOOTSTRAP_MIGRATED_KEY, bootstrapMigrated } from "./role-service.js";

const norm = (v) => String(v ?? "").trim().toLowerCase();
const isTrue = (v) => v === true || v === "Yes" || v === 1 || v === "true";
const isInactive = (row) => row.IsActive !== undefined && row.IsActive !== null && !isTrue(row.IsActive);

/** อีเมลใน config ที่ยังไม่ได้เป็นผู้จัดการใน SharePoint (หรือยังไม่ได้ย้ายป้ายแสดงผล) */
export function pendingBootstrap() {
  const team = state.masterData.team || [];
  const labels = appConfig.bootstrapRoleLabels || {};
  return (appConfig.bootstrapAdminEmails || []).map((email) => {
    const member = team.find((m) => norm(m.Email) === norm(email));
    const label = labels[norm(email)] || "";
    const needsAdmin = !member || !isTrue(member.IsAdmin) || isInactive(member);
    const needsLabel = Boolean(label) && !String(member?.DisplayLabel || "").trim();
    return { email: norm(email), member, label, needsAdmin, needsLabel };
  }).filter((p) => p.needsAdmin || p.needsLabel);
}

function knownName(email) {
  const requests = state.requests || [];
  if (norm(state.user?.email) === email && state.user?.name) return state.user.name;
  return requests.find((r) => norm(r.requesterEmail) === email)?.requesterName
    || requests.find((r) => norm(r.assignedToEmail) === email)?.assignedToName
    || email.split("@")[0];
}

/** ตั้ง IsAdmin ใน SharePoint ให้รายชื่อที่ค้าง — คืน { done, total } (throw ถ้าไม่ครบ) */
export async function migrateBootstrapAdmins() {
  const pending = pendingBootstrap();
  const done = [];
  for (const p of pending) {
    const patch = {};
    if (p.needsAdmin) Object.assign(patch, { IsAdmin: true, IsActive: true });
    if (p.needsLabel) patch.DisplayLabel = p.label;
    if (p.member) await patchItem(lists.team, p.member.id, patch);
    else await addItem(lists.team, { Title0: knownName(p.email), Email: p.email, Role: "Manager", ...patch });
    done.push(p.email);
  }
  if (done.length) await writeAudit({ action: "จัดการข้อมูล: ย้ายผู้จัดการจาก config เข้า SharePoint", detail: done.join(", ") });
  return { done, total: pending.length };
}

/**
 * เรียกหลังโหลดข้อมูลหลักเสร็จ — ทำครั้งเดียวต่อระบบ (ไม่ใช่ต่อเครื่อง)
 * ทำเฉพาะเมื่อ: ยังไม่เคยย้าย + ทีมโหลดจาก SharePoint จริง (ไม่ใช่สำเนาสำรอง) + ผู้ใช้เป็นผู้จัดการ
 * @returns {Promise<boolean>} true ถ้าเพิ่งย้ายเสร็จ (ควรโหลดข้อมูลหลักใหม่)
 */
let running = null;
export function autoMigrateBootstrap() {
  if (running) return running;
  if (bootstrapMigrated()) return Promise.resolve(false);
  if (state.masterData.teamSource !== "sharepoint") return Promise.resolve(false);
  if (state.user?.actualRole !== "manager") return Promise.resolve(false);
  running = (async () => {
    try {
      await migrateBootstrapAdmins();
      await saveSetting(BOOTSTRAP_MIGRATED_KEY, new Date().toISOString());
      await writeAudit({ action: "ระบบ: สิทธิ์ผู้จัดการดูแลจากหน้าจัดการข้อมูลแล้ว", detail: "รายชื่อใน config.js ใช้เป็นทางกู้คืนฉุกเฉินเท่านั้น" });
      return true;
    } catch (error) {
      console.warn("Auto-migrate managers failed (will retry next sign-in):", error.message);
      return false;
    } finally {
      running = null;
    }
  })();
  return running;
}
