// ══════════════════════════════════════════════════════════════
// หน้าจัดการข้อมูล → แท็บ "ข้อมูลสถิติ" — นำเข้า/สำรองข้อมูลคำขอก่อนเริ่มใช้ระบบ (Excel ฟอร์มเดิม)
//  - อัปโหลดไฟล์ .xlsx ครั้งเดียว → ระบบแปลงและเก็บใน SharePoint (Documents/DrawingLegacy)
//  - สถิติรวมเข้ากับหน้าภาพรวม (รายบุคคล + ทั้งฝ่าย) อัตโนมัติ
//  - ดาวน์โหลดไฟล์สำรอง (ต้นฉบับ .xlsx / ข้อมูล .json / ตาราง CSV) ได้จากแท็บนี้
// ══════════════════════════════════════════════════════════════

import { showToast } from "../components/toast.js";
import { writeAudit } from "../services/audit-service.js";
import { importLegacyFile, legacyBackupFiles, legacyMeta, legacyRecords, legacyRequests, loadLegacy } from "../services/legacy-service.js";
import { getDrawingTeamMembers } from "../services/team-service.js";
import { downloadCsv, escapeHtml, formatDate, formatDateOnly } from "../utils.js";

const TYPES = ["📋 เขียนแบบ Proposal", "🏛️ ขออนุญาตก่อสร้าง", "🏗️ เขียนแบบก่อสร้าง", "🏁 As-Built Drawing", "📁 อื่นๆ"];
const STATUS_TEXT = { done: "เสร็จแล้ว", cancelled: "ยกเลิก", hold: "พักไว้/รออัพเดท", open: "ยังไม่เสร็จ" };
let backups = null;
let loadingBackups = false;
let busy = false;

const fmt = (n) => Number(n || 0).toLocaleString("th-TH");
const sizeText = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function renderLegacyTab() {
  const meta = legacyMeta();
  const records = legacyRecords();
  const people = summarizePeople();
  const teamEmails = new Set(getDrawingTeamMembers().map((m) => m.email.toLowerCase()));
  const unmatched = people.filter((p) => !teamEmails.has(p.email));

  return `
    <div class="legacy-panel">
      <div class="manage-setting-card">
        <h3>📦 ข้อมูลคำขอก่อนเริ่มใช้ระบบ</h3>
        <p class="manage-hint">
          อัปโหลดไฟล์ Excel การตอบกลับของฟอร์มเดิม (ENGINEERING DRAWING REQUEST FORM) — ระบบจะนำสถิติไปรวมในหน้าภาพรวม
          ของแต่ละบุคคลและทั้งฝ่ายโดยอัตโนมัติ (ไม่นับเป็นภาระงานปัจจุบัน) และเก็บไฟล์ต้นฉบับสำรองไว้ใน SharePoint
          โฟลเดอร์ <b>Documents/DrawingLegacy</b>
        </p>
        ${meta ? `
          <div class="legacy-stats">
            <div><span>รายการทั้งหมด</span><strong>${fmt(meta.count)}</strong></div>
            <div><span>ช่วงวันที่</span><strong>${escapeHtml(meta.from ? formatDateOnly(meta.from) : "—")} – ${escapeHtml(meta.to ? formatDateOnly(meta.to) : "—")}</strong></div>
            <div><span>ไฟล์ต้นฉบับ</span><strong title="${escapeHtml(meta.source)}">${escapeHtml(meta.source || "—")}</strong></div>
            <div><span>นำเข้าเมื่อ</span><strong>${escapeHtml(formatDate(meta.importedAt))}</strong></div>
          </div>` : `<p class="manage-hint"><b>ยังไม่มีข้อมูล</b> — กดปุ่มด้านล่างเพื่อเลือกไฟล์ .xlsx</p>`}
        <div class="manage-setting-actions">
          <button class="primary-button" type="button" data-legacy="upload" ${busy ? "disabled" : ""}>${busy ? "กำลังนำเข้า..." : meta ? "⬆️ อัปโหลดไฟล์ใหม่แทนที่" : "⬆️ อัปโหลดไฟล์ Excel"}</button>
          ${records.length ? `<button class="secondary-button" type="button" data-legacy="csv">⬇ CSV (ข้อมูลที่นำเข้า)</button>` : ""}
          ${records.length ? `<button class="secondary-button" type="button" data-legacy="json">⬇ JSON</button>` : ""}
          <button class="secondary-button" type="button" data-legacy="reload">⟳ โหลดใหม่</button>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-legacy-file hidden />
        </div>
      </div>

      ${records.length ? `
        <div class="manage-setting-card">
          <h3>👤 แยกตามบุคคลและประเภทงาน</h3>
          ${unmatched.length ? `<p class="manage-hint warn">⚠️ ชื่อที่ไม่ตรงกับรายชื่อทีมปัจจุบัน (ไม่แสดงในสไลด์รายบุคคล แต่นับในภาพรวมฝ่าย): ${unmatched.map((p) => `<b>${escapeHtml(p.name)}</b>`).join(", ")} — แก้ชื่อในแท็บทีมงานให้ตรงกันได้</p>` : ""}
          <div class="track-table-wrap">
            <table class="manage-table legacy-table">
              <thead>
                <tr><th>บุคคล</th>${TYPES.map((t) => `<th>${escapeHtml(t)}</th>`).join("")}<th>รวม</th><th>ยกเลิก</th><th>เกินกำหนด</th></tr>
              </thead>
              <tbody>
                ${people.map((p) => `
                  <tr>
                    <td><strong>${escapeHtml(p.name)}</strong></td>
                    ${TYPES.map((t) => `<td class="num">${p.types[t] ? fmt(p.types[t]) : "–"}</td>`).join("")}
                    <td class="num"><b>${fmt(p.total)}</b></td>
                    <td class="num">${p.cancelled ? fmt(p.cancelled) : "–"}</td>
                    <td class="num">${p.overdue ? fmt(p.overdue) : "–"}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </div>` : ""}

      <div class="manage-setting-card">
        <h3>🗄️ ไฟล์สำรองใน SharePoint</h3>
        ${backups === null
          ? `<p class="manage-hint">${loadingBackups ? "กำลังโหลด..." : "—"}</p>`
          : backups.length
            ? `<ul class="legacy-files">${backups.map((f) => `
                <li>
                  <span>📄 <b>${escapeHtml(f.name)}</b> <small>${sizeText(f.size)} · ${escapeHtml(formatDate(f.modified))}</small></span>
                  <span>
                    ${f.url ? `<a class="small-button" href="${escapeHtml(f.url)}" download="${escapeHtml(f.name)}">⬇ ดาวน์โหลด</a>` : ""}
                    ${f.webUrl ? `<a class="small-button secondary-button" href="${escapeHtml(f.webUrl)}" target="_blank" rel="noopener noreferrer">เปิดใน SharePoint</a>` : ""}
                  </span>
                </li>`).join("")}</ul>`
            : `<p class="manage-hint">ยังไม่มีไฟล์สำรอง</p>`}
      </div>
    </div>`;
}

export function bindLegacyTab(body, rerender) {
  if (!body.querySelector(".legacy-panel")) return;
  if (backups === null && !loadingBackups) {
    loadingBackups = true;
    legacyBackupFiles().then((files) => { backups = files; }).catch(() => { backups = []; })
      .finally(() => { loadingBackups = false; rerender(); });
  }
  const input = body.querySelector("[data-legacy-file]");
  body.querySelector('[data-legacy="upload"]')?.addEventListener("click", () => input?.click());
  input?.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    busy = true;
    rerender();
    try {
      const result = await importLegacyFile(file);
      writeAudit({ action: "นำเข้าข้อมูลสถิติ (ก่อนเริ่มระบบ)", detail: `${result.meta.count} รายการ จากไฟล์ ${file.name}` }).catch(() => {});
      showToast(result.backupOk
        ? `นำเข้า ${fmt(result.meta.count)} รายการแล้ว — สถิติในหน้าภาพรวมอัปเดตแล้ว`
        : `นำเข้า ${fmt(result.meta.count)} รายการแล้ว — แต่สำรองไฟล์ต้นฉบับไม่สำเร็จ (ไฟล์ถูกล็อก) กดอัปโหลดอีกครั้งภายหลังเพื่อสำรอง`, result.backupOk ? "success" : "warning");
      backups = null;
    } catch (error) {
      showToast(/423|locked/i.test(error.message)
        ? "นำเข้าไม่สำเร็จ: ไฟล์ในโฟลเดอร์ DrawingLegacy ถูกล็อก (มีคนเปิดค้างใน Excel/SharePoint) — ปิดไฟล์แล้วรอ 1–2 นาทีแล้วลองใหม่"
        : `นำเข้าไม่สำเร็จ: ${error.message}`, "error");
    } finally {
      busy = false;
      rerender();
    }
  });
  body.querySelector('[data-legacy="reload"]')?.addEventListener("click", async () => {
    backups = null;
    await loadLegacy(true);
    rerender();
  });
  body.querySelector('[data-legacy="csv"]')?.addEventListener("click", () => {
    const header = ["แถวในไฟล์เดิม", "ผู้รับผิดชอบเขียนแบบ", "ประเภทงาน", "โครงการ", "ชื่ออาคาร", "พื้นที่ติดตั้ง", "สถานะ", "วันเวลาส่งคำขอ", "วันที่ต้องการ", "เกินกำหนด (วันทำการ)", "ผู้มอบหมาย", "รายละเอียด"];
    const rows = legacyRecords().map((r) => [r.n, r.a.join(", "), r.t, r.p, r.b, r.ar, STATUS_TEXT[r.s] || r.s, r.at, r.due, r.od || "", r.by, r.d]);
    downloadCsv(`drawing-legacy-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows]);
  });
  body.querySelector('[data-legacy="json"]')?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ meta: legacyMeta(), records: legacyRecords() }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "legacy-requests.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}

/** สรุปต่อบุคคล (จับคู่ชื่อกับรายชื่อทีมแล้ว) */
function summarizePeople() {
  const map = new Map();
  legacyRequests().forEach((r) => {
    r.assignees.forEach((email, i) => {
      const name = r.assignedToName.split(", ")[i] || email;
      const p = map.get(email) || { email, name, types: {}, total: 0, cancelled: 0, overdue: 0 };
      p.types[r.requestType] = (p.types[r.requestType] || 0) + 1;
      p.total += 1;
      if (r.status === "cancelled") p.cancelled += 1;
      if (r.legacyOverdue > 0) p.overdue += 1;
      map.set(email, p);
    });
  });
  return [...map.values()].sort((a, b) => b.total - a.total);
}
