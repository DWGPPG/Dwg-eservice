// ══════════════════════════════════════════════════════════════
// ตัวเปิดดูเอกสาร ISO (ใช้ทั้งหน้าคู่มือ = ดูอย่างเดียว และหน้าจัดการข้อมูล = แก้ไขได้)
// ══════════════════════════════════════════════════════════════

import {
  DISCIPLINES, DRAWING_STAGES, PERMIT_FOLDERS, PERMIT_STAGE, categoryFoldersOf, ISO_ROOT_LABEL, ISO_SECTIONS, KINDS, PRESALE_STAGES, PROJECT_FOLDER, PROJECT_STAGES,
  auditKindFolder, createDrawingFolders, searchIso, createIsoFolder, createProjectFolder, createStandardTree, deleteIsoItem,
  createFilingContext, disciplineOfCategory, drawingFolderName, ensureAllProjectFolders, fileDeliveryToIso, importIsoZip, stageOfRequestType, joinPath, listIso, buildIsoRequestIndex, requestsForIsoItem, isoDownloadUrl, listIsoTree, zipIsoFolder, ZIP_LIMIT_BYTES, promotePresale, renameIsoItem, safeName, uploadIsoFiles,
} from "../services/iso-service.js";
import { state } from "../state.js";
import { loadAccess, refreshAllShares, SHARE_MODES, shareFolder, unshareFolder } from "../services/iso-access.js";
import { getKnownRequesters } from "../services/team-service.js";
import { projectKey } from "../utils.js";
import { writeAudit } from "../services/audit-service.js";
import { escapeHtml, formatDate } from "../utils.js";
import { openModal } from "./modal.js";
import { showToast } from "./toast.js";

const paths = { view: "", edit: "" }; // จำโฟลเดอร์ล่าสุดไว้ข้ามการวาดใหม่ (หน้าคู่มือ / หน้าจัดการข้อมูล แยกกัน)

const fileIcon = (name) => {
  const ext = String(name).split(".").pop().toLowerCase();
  if (ext === "pdf") return "📕";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📗";
  if (["doc", "docx"].includes(ext)) return "📘";
  if (["dwg", "dxf"].includes(ext)) return "📐";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "🖼️";
  if (["zip", "rar", "7z"].includes(ext)) return "🗜️";
  return "📄";
};
const sizeText = (b) => (!b ? "" : b > 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const sectionOf = (name) => ISO_SECTIONS.find((s) => s.name === name);

/** ตำแหน่งในโครงสร้าง 8-Project: { year, kind, project } */
function projectContext(path) {
  const parts = path.split("/");
  if (parts[0] !== PROJECT_FOLDER) return null;
  return { yearFolder: parts[1] || "", kind: parts[2] || "", project: parts[3] || "", stage: parts[4] || "", discipline: parts[5] || "", depth: parts.length };
}

export function renderIsoBrowser(container, { editable = false } = {}) {
  const mode = editable ? "edit" : "view";
  const ui = { get path() { return paths[mode]; }, set path(v) { paths[mode] = v; } };
  container.innerHTML = `<div class="iso-browser" data-editable="${editable}"><div class="iso-body"><p class="iso-empty">กำลังโหลด...</p></div></div>`;
  const root = container.querySelector(".iso-browser");
  const body = root.querySelector(".iso-body");
  let items = [];
  let busy = false;
  let access = null; // รายการแชร์ (เฉพาะหน้าจัดการ)

  const go = (path) => { ui.path = path; filter.q = ""; filter.results = null; filter.scope = "here"; load(); };

  async function load() {
    body.innerHTML = `<p class="iso-empty">กำลังโหลด...</p>`;
    try {
      items = await listIso(ui.path);
    } catch (error) {
      body.innerHTML = `<p class="iso-empty">⚠️ โหลดเอกสารไม่สำเร็จ: ${escapeHtml(error.message)}</p>`;
      return;
    }
    if (items === null && ui.path) { ui.path = ""; return load(); } // โฟลเดอร์ถูกลบไปแล้ว → กลับราก
    draw();
    if (editable) loadAccess().then((m) => { access = m; drawList(); body.querySelector("[data-iso-act='shares'] b")?.replaceChildren(String(Object.keys(m.shares || {}).length)); }).catch(() => {});
  }

  function crumbs() {
    const parts = ui.path ? ui.path.split("/") : [];
    const links = [`<button type="button" class="iso-crumb" data-iso-go="">🗂️ ${escapeHtml(ISO_ROOT_LABEL)}</button>`];
    parts.forEach((part, i) => links.push(`<span aria-hidden="true">›</span><button type="button" class="iso-crumb" data-iso-go="${escapeHtml(parts.slice(0, i + 1).join("/"))}">${escapeHtml(part)}</button>`));
    return `<nav class="iso-crumbs" aria-label="ตำแหน่งโฟลเดอร์">${links.join("")}</nav>`;
  }

  function toolbar() {
    if (!editable) return "";
    const ctx = projectContext(ui.path);
    const inKind = ctx && ctx.depth === 3 && Object.values(KINDS).includes(ctx.kind);
    const isPresaleProject = ctx && ctx.depth === 4 && ctx.kind === KINDS.presale;
    const inDiscipline = ctx && ctx.depth === 6 && DRAWING_STAGES.includes(ctx.stage) && categoryFoldersOf(ctx.stage).includes(ctx.discipline);
    return `
      <div class="iso-toolbar">
        <button type="button" class="primary-button" data-iso-act="upload">⬆️ อัปโหลดไฟล์</button>
        <button type="button" class="secondary-button" data-iso-act="folder">📁 โฟลเดอร์ใหม่</button>
        <button type="button" class="secondary-button" data-iso-act="zip" title="แตก ZIP แล้วอัปโหลดทั้งโครงสร้างโฟลเดอร์">🗜️ นำเข้า ZIP</button>
        ${ui.path.startsWith(PROJECT_FOLDER) || !ui.path ? `<button type="button" class="secondary-button" data-iso-act="project">➕ โครงการใหม่</button>` : ""}
        ${isPresaleProject ? `<button type="button" class="secondary-button" data-iso-act="promote" title="ย้ายโฟลเดอร์ไป 2-Project พร้อมไฟล์ แล้วเพิ่มโฟลเดอร์ขั้นขออนุญาต/ก่อสร้าง/As-built">⇢ เลื่อนเป็นโครงการ</button>` : ""}
        ${inKind ? `<button type="button" class="secondary-button" data-iso-act="audit">✅ ตรวจความครบถ้วน (Audit)</button>` : ""}
        ${inDiscipline ? `<button type="button" class="secondary-button" data-iso-act="drawing">📐 เพิ่ม Drawing</button>
        <button type="button" class="secondary-button" data-iso-act="pull" title="สร้างโฟลเดอร์ตามรายการ Drawing ของโครงการในระบบ e-Service">📥 ดึงรายการ Drawing จากระบบ</button>` : ""}
        ${!ui.path || ui.path.startsWith(PROJECT_FOLDER) ? `<button type="button" class="secondary-button" data-iso-act="backfill" title="คัดลอกไฟล์งานที่ส่งมอบแล้วในระบบ e-Service ลงโฟลเดอร์ ISO ของแต่ละโครงการ">🔄 จัดเก็บไฟล์งานย้อนหลัง</button>` : ""}
        ${ui.path ? `<button type="button" class="secondary-button" data-iso-act="share" title="ให้ผู้ร้องขอ/บุคคลเปิดดูโฟลเดอร์นี้ได้ (กำหนดได้ว่าดาวน์โหลดได้หรือไม่)">👥 แชร์โฟลเดอร์นี้</button>` : ""}
        <button type="button" class="secondary-button" data-iso-act="shares" title="โฟลเดอร์ที่แชร์ให้ผู้ร้องขอ/บุคคล">🔐 การแชร์ทั้งหมด (<b>${access ? Object.keys(access.shares || {}).length : "…"}</b>)</button>
        ${!ui.path ? `<button type="button" class="secondary-button" data-iso-act="standard" title="สร้างโฟลเดอร์ 1-SP … 8-Project และปีปัจจุบัน (โฟลเดอร์ที่มีอยู่แล้วไม่ถูกแตะ)">🏗️ สร้างโครงสร้างมาตรฐาน</button>` : ""}
        <input type="file" multiple hidden data-iso-file />
        <input type="file" accept=".zip,application/zip" hidden data-iso-zip />
      </div>`;
  }

  function guidePanel() {
    const ctx = projectContext(ui.path);
    if (!ui.path) {
      return `<div class="iso-guide">📌 โครงสร้างตามแฟ้ม ISO ฝ่ายเขียนแบบ — เอกสารหลัก <b>1-SP … 7-KPI</b> · เอกสารโครงการ <b>8-Project → ปี → 1-Presale / 2-Project → โครงการ</b> (ใช้ตรวจ Audit ได้ทีละโครงการ)</div>`;
    }
    const sec = sectionOf(ui.path.split("/")[0]);
    if (ctx && ctx.depth === 4) {
      const stages = ctx.kind === KINDS.presale ? PRESALE_STAGES : PROJECT_STAGES;
      return `<div class="iso-guide">📐 โครงสร้าง${ctx.kind === KINDS.presale ? "งาน Presale" : "โครงการ"}: <code>00-Ref</code> · <code>01-Document/1-RFD/{1-รับมา, 2-ส่งออก}</code> · ${stages.map((s) => `<code>${escapeHtml(s)}</code>`).join(" · ")} → หมวด ${DISCIPLINES.map((d) => `<b>${d.code}</b>`).join(" / ")}${ctx.kind === KINDS.presale ? "" : ` (03-DWG Permission มีหมวดขออนุญาต P1–P5 เพิ่ม)`} → โฟลเดอร์ <b>เลขDrawing-ชื่อDrawing</b></div>`;
    }
    if (ctx && ctx.depth === 5 && DRAWING_STAGES.includes(ctx.stage)) {
      return `<div class="iso-guide">📂 แยกหมวด: ${DISCIPLINES.map((d) => `<b>${d.code}</b> ${escapeHtml(d.label)}`).join(" · ")}${ctx.stage === PERMIT_STAGE ? ` · หมวดขออนุญาต: ${PERMIT_FOLDERS.map((f) => `<b>${escapeHtml(f.name)}</b>`).join(" · ")}` : ""}</div>`;
    }
    if (ctx && ctx.depth === 6 && DRAWING_STAGES.includes(ctx.stage)) {
      return `<div class="iso-guide">📐 1 โฟลเดอร์ต่อ 1 Drawing ชื่อ <b>เลขDrawing-ชื่อDrawing</b> — เก็บทุก Revision ไว้ในโฟลเดอร์เดียว ตั้งชื่อไฟล์มี Rev เช่น <code>EE-001_Rev.A.pdf</code> · ฉบับเก่าที่ยกเลิกแล้วย้ายเข้าโฟลเดอร์ย่อย <code>_Superseded</code></div>`;
    }
    return sec ? `<div class="iso-guide">ℹ️ <b>${escapeHtml(sec.label)}</b> — ${escapeHtml(sec.hint)}</div>` : "";
  }

  // ── ค้นหา/กรอง: ในโฟลเดอร์นี้ (ทันที) หรือทุกโฟลเดอร์ย่อย (ค้นใน SharePoint) ──
  const filter = { q: "", type: "all", scope: "here", results: null, searching: false };
  let searchTimer = 0;
  let searchSeq = 0;
  const TYPE_TEST = {
    all: () => true,
    folder: (it) => it.isFolder,
    pdf: (it) => !it.isFolder && /\.pdf$/i.test(it.name),
    dwg: (it) => !it.isFolder && /\.(dwg|dxf)$/i.test(it.name),
    office: (it) => !it.isFolder && /\.(xlsx?|csv|docx?|pptx?)$/i.test(it.name),
    image: (it) => !it.isFolder && /\.(jpe?g|png|gif|webp|tiff?)$/i.test(it.name),
    other: (it) => !it.isFolder && !/\.(pdf|dwg|dxf|xlsx?|csv|docx?|pptx?|jpe?g|png|gif|webp|tiff?)$/i.test(it.name),
  };
  const matches = (it) => TYPE_TEST[filter.type](it) && (!filter.q || it.name.toLowerCase().includes(filter.q.toLowerCase()));

  // ── เลขคำร้องของไฟล์/โฟลเดอร์ Drawing (จับคู่จากตำแหน่งโฟลเดอร์ + Rev ในชื่อไฟล์) ──
  let reqIndex = null;
  let reqIndexSrc = null;
  function requestChips(it, folderPath) {
    if (!["designer", "manager"].includes(state.user?.role) && !editable) return "";
    if (reqIndexSrc !== state.requests) { reqIndexSrc = state.requests; reqIndex = buildIsoRequestIndex(state.requests || []); }
    const list = requestsForIsoItem(reqIndex, folderPath, it.name, it.isFolder);
    if (!list.length) return "";
    const shown = list.slice(0, 3);
    return `<span class="iso-reqs">${shown.map((r) => `<button type="button" class="iso-req" data-iso-req="${escapeHtml(r.requestNo)}" title="ดูรายละเอียดและประวัติคำร้อง ${escapeHtml(r.requestNo)}">📋 ${escapeHtml(r.requestNo)}</button>`).join("")}${list.length > shown.length ? `<small>+${list.length - shown.length}</small>` : ""}</span>`;
  }

  // ── ดาวน์โหลด: ไฟล์ = ขอลิงก์ใหม่ทุกครั้ง (ลิงก์เดิมหมดอายุ ~1 ชม.) · โฟลเดอร์ = รวมเป็น ZIP ในเบราว์เซอร์ ──
  const saveAs = (href, name) => {
    const a = document.createElement("a");
    a.href = href; a.download = name; a.rel = "noopener"; a.style.display = "none";
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); if (href.startsWith("blob:")) URL.revokeObjectURL(href); }, 60000);
  };
  async function downloadFile(btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    try { saveAs(await isoDownloadUrl(btn.dataset.isoDl), btn.dataset.name); }
    catch (error) { showToast(`ดาวน์โหลดไม่สำเร็จ: ${error.message}`, "error"); }
    finally { btn.disabled = false; }
  }
  let zipping = false;
  async function downloadFolder(btn) {
    if (zipping) { showToast("กำลังเตรียม ZIP อีกโฟลเดอร์อยู่ — รอสักครู่", "info"); return; }
    zipping = true;
    btn.disabled = true;
    const name = btn.dataset.name;
    try {
      progress(`📦 กำลังรวบรวมรายการไฟล์ใน ${name}...`);
      const files = await listIsoTree(btn.dataset.isoZipDl);
      if (!files.length) { showToast(`โฟลเดอร์ ${name} ยังไม่มีไฟล์`, "info"); return; }
      const total = files.reduce((n, f) => n + f.size, 0);
      if (total > ZIP_LIMIT_BYTES) { showToast(`โฟลเดอร์ใหญ่เกินไป (${sizeText(total)}) — เลือกโฟลเดอร์ย่อย หรือดาวน์โหลดจาก SharePoint`, "error"); return; }
      if (total > 300 * 1024 * 1024 && !confirm(`โฟลเดอร์ ${name} มี ${files.length} ไฟล์ รวม ${sizeText(total)} — ดาวน์โหลดเป็น ZIP?`)) return;
      const blob = await zipIsoFolder(btn.dataset.isoZipDl, safeName(name), (n, all, f) => progress(`📦 ดาวน์โหลด ${n}/${all} — ${f}`), files);
      saveAs(URL.createObjectURL(blob), `${safeName(name)}.zip`);
      showToast(`ดาวน์โหลด ${name}.zip แล้ว (${files.length} ไฟล์)`, "success");
    } catch (error) {
      showToast(`ดาวน์โหลดโฟลเดอร์ไม่สำเร็จ: ${error.message}`, "error");
    } finally {
      zipping = false;
      btn.disabled = false;
      progress("");
    }
  }

  function shareBadge(path) {
    const s = access?.shares?.[path];
    if (!s) return "";
    const who = s.everyone ? "ผู้ร้องขอทุกคน" : `${(s.users || []).length} คน`;
    return `<small class="iso-shared ${s.mode === "view" ? "is-view" : ""}">👥 แชร์ให้ ${who} · ${SHARE_MODES[s.mode]?.short || ""}</small>`;
  }

  // ── แชร์โฟลเดอร์ให้ผู้ร้องขอ/บุคคล ──
  function openShareForm(path) {
    const cur = access?.shares?.[path] || { mode: "view", everyone: false, users: [] };
    const picked = new Set((cur.users || []).map((u) => u.email.toLowerCase()));
    const people = getKnownRequesters(state.user?.email || "");
    (cur.users || []).forEach((u) => { if (!people.some((p) => p.email.toLowerCase() === u.email.toLowerCase())) people.unshift({ name: u.name, email: u.email }); });
    openModal({
      title: "👥 แชร์โฟลเดอร์เอกสาร ISO",
      body: `
        <p class="iso-share-path">📁 ${escapeHtml(path)}</p>
        <fieldset class="field iso-kind"><span>สิทธิ์</span>
          ${Object.entries(SHARE_MODES).map(([k, m]) => `<label><input type="radio" name="iso-share-mode" value="${k}" ${cur.mode === k ? "checked" : ""} /> ${escapeHtml(m.label)}</label>`).join("")}
        </fieldset>
        <label class="iso-share-all"><input type="checkbox" id="iso-share-everyone" ${cur.everyone ? "checked" : ""} /> ผู้ร้องขอ<b>ทุกคน</b>ในระบบ</label>
        <div class="iso-share-people">
          <input type="search" id="iso-share-q" placeholder="🔍 ค้นหาชื่อ / อีเมล..." autocomplete="off" />
          <div class="iso-share-list">${people.map((p) => `
            <label data-q="${escapeHtml(`${p.name} ${p.email}`.toLowerCase())}"><input type="checkbox" value="${escapeHtml(p.email)}" data-name="${escapeHtml(p.name || p.email)}" ${picked.has(p.email.toLowerCase()) ? "checked" : ""} />
              <span><b>${escapeHtml(p.name || p.email)}</b><small>${escapeHtml(p.email)}</small></span></label>`).join("")}</div>
          <label class="field"><span>อีเมลเพิ่มเติม (คั่นด้วย , หรือขึ้นบรรทัดใหม่)</span><textarea id="iso-share-extra" rows="2" placeholder="name@primepower.co.th"></textarea></label>
        </div>
        <p class="manage-hint">ผู้ที่ได้รับสิทธิ์จะเห็นโฟลเดอร์นี้ (รวมโฟลเดอร์ย่อย) ในเมนู <b>คู่มือ → เอกสาร ISO</b> · โหมด "ดูอย่างเดียว" เปิดผ่านตัวดูของ SharePoint ที่ปิดปุ่มดาวน์โหลด/พิมพ์ · ไฟล์ที่เพิ่มทีหลังกด <b>🔐 การแชร์ทั้งหมด → 🔄 อัปเดตไฟล์ที่แชร์</b></p>`,
      actions: [
        { label: "ยกเลิก", className: "secondary-button" },
        ...(access?.shares?.[path] ? [{
          label: "🚫 เลิกแชร์",
          className: "secondary-button danger",
          onClick: async (close) => {
            close();
            await run(`เลิกแชร์ ${path}`, async () => { await unshareFolder(path); access = await loadAccess(); showToast("เลิกแชร์แล้ว", "success"); });
          },
        }] : []),
        {
          label: "💾 บันทึกการแชร์",
          className: "primary-button",
          onClick: async (close) => {
            const mode = document.querySelector('input[name="iso-share-mode"]:checked')?.value || "view";
            const everyone = Boolean(document.querySelector("#iso-share-everyone")?.checked);
            const users = [...document.querySelectorAll(".iso-share-list input:checked")].map((i) => ({ email: i.value, name: i.dataset.name }));
            String(document.querySelector("#iso-share-extra")?.value || "").split(/[\s,;]+/).map((e) => e.trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
              .forEach((email) => { if (!users.some((u) => u.email.toLowerCase() === email.toLowerCase())) users.push({ email, name: email }); });
            if (!everyone && !users.length) { showToast("กรุณาเลือกผู้ที่จะแชร์ให้ หรือเลือก 'ผู้ร้องขอทุกคน'", "warning"); return; }
            close();
            await run(`แชร์ ${path}`, async () => {
              progress("📂 กำลังรวบรวมไฟล์ในโฟลเดอร์...");
              const res = await shareFolder(path, { mode, everyone, users }, (n, total, name) => progress(`🔗 สร้างลิงก์ ${n}/${total} — ${name}`));
              access = await loadAccess();
              if (res.failures.length) shareReport("แชร์แล้ว แต่บางไฟล์สร้างลิงก์ไม่สำเร็จ", res.failures);
              else showToast(`แชร์แล้ว (${res.files} ไฟล์ · ${SHARE_MODES[mode].short})`, "success");
            });
          },
        },
      ],
    });
    const q = document.querySelector("#iso-share-q");
    q?.addEventListener("input", () => {
      const v = q.value.trim().toLowerCase();
      document.querySelectorAll(".iso-share-list label").forEach((l) => { l.hidden = Boolean(v) && !l.dataset.q.includes(v); });
    });
  }

  function shareReport(title, failures) {
    setTimeout(() => openModal({
      title: `⚠️ ${title} (${failures.length})`,
      body: `<div class="track-table-wrap iso-report"><table class="manage-table"><thead><tr><th>ไฟล์</th><th>สาเหตุ</th></tr></thead>
        <tbody>${failures.map((f) => `<tr class="is-fail"><td>${escapeHtml(f.p)}</td><td>${escapeHtml(f.error)}</td></tr>`).join("")}</tbody></table></div>
        <p class="manage-hint">ไฟล์ที่ไม่สำเร็จจะไม่แสดงให้ผู้ได้รับสิทธิ์เห็น — ลองกด 🔄 อัปเดตไฟล์ที่แชร์ อีกครั้ง · ถ้ายังไม่ได้ อาจเป็นเพราะบัญชีของคุณไม่มีสิทธิ์สร้างลิงก์แชร์ใน SharePoint</p>`,
      actions: [{ label: "ปิด", className: "secondary-button" }],
    }), 300);
  }

  function openShareList() {
    const entries = Object.entries(access?.shares || {}).sort((a, b) => a[0].localeCompare(b[0], "th", { numeric: true }));
    openModal({
      title: `🔐 โฟลเดอร์ที่แชร์ (${entries.length})`,
      body: entries.length ? `<div class="iso-share-rows">${entries.map(([path, s]) => `
          <div class="iso-share-row">
            <span><b>📁 ${escapeHtml(path)}</b>
              <small>${escapeHtml(SHARE_MODES[s.mode]?.short || "")} · ${s.everyone ? "ผู้ร้องขอทุกคน" : escapeHtml((s.users || []).map((u) => u.name || u.email).join(", "))}</small>
              <small>${(s.items || []).filter((x) => !x.isFolder).length} ไฟล์ · โดย ${escapeHtml(s.by || "-")} · ${escapeHtml(formatDate(s.at))}</small></span>
            <button type="button" class="small-button" data-share-edit="${escapeHtml(path)}">✏️ แก้ไข</button>
            <button type="button" class="small-button" data-iso-go-share="${escapeHtml(path)}">📂 เปิด</button>
          </div>`).join("")}</div>` : `<p class="iso-empty">ยังไม่ได้แชร์โฟลเดอร์ใด — เปิดโฟลเดอร์แล้วกด 👥 แชร์โฟลเดอร์นี้</p>`,
      actions: [
        { label: "ปิด", className: "secondary-button" },
        ...(entries.length ? [{
          label: "🔄 อัปเดตไฟล์ที่แชร์",
          className: "primary-button",
          onClick: async (close) => {
            close();
            await run("อัปเดตไฟล์ที่แชร์", async () => {
              const res = await refreshAllShares((i, n, path, f, total) => progress(`🔄 โฟลเดอร์ ${i}/${n} — ${path} · ไฟล์ ${f}/${total}`));
              access = await loadAccess();
              if (res.failures.length) shareReport("อัปเดตแล้ว แต่บางรายการไม่สำเร็จ", res.failures);
              else showToast(`อัปเดตไฟล์ที่แชร์แล้ว (${res.folders} โฟลเดอร์)`, "success");
            });
          },
        }] : []),
      ],
    });
    document.querySelectorAll("#modal-root [data-share-edit]").forEach((b) => b.addEventListener("click", () => {
      document.querySelector("#modal-root .modal header .icon-button")?.click();
      openShareForm(b.dataset.shareEdit);
    }));
    document.querySelectorAll("#modal-root [data-iso-go-share]").forEach((b) => b.addEventListener("click", () => {
      document.querySelector("#modal-root .modal header .icon-button")?.click();
      go(b.dataset.isoGoShare);
    }));
  }

  function rowHtml(it, { showPath = false } = {}) {
    const sec = !ui.path && !showPath && it.isFolder ? sectionOf(it.name) : null;
    const where = showPath ? (it.path || ISO_ROOT_LABEL) : "";
    const actions = editable && !showPath ? `
        <button type="button" class="small-button" data-iso-rename="${it.id}" title="เปลี่ยนชื่อ">✏️</button>
        <button type="button" class="small-button danger" data-iso-delete="${it.id}" title="ลบ">🗑️</button>` : "";
    if (it.isFolder) {
      const target = showPath ? joinPath(it.path, it.name) : joinPath(ui.path, it.name);
      return `
          <li class="iso-row is-folder">
            <button type="button" class="iso-open" data-iso-go="${escapeHtml(target)}">
              <span class="iso-icon">📁</span>
              <span class="iso-name"><b>${highlight(it.name)}</b>${sec ? `<small>${escapeHtml(sec.label)}</small>` : ""}${where ? `<small>📂 ${escapeHtml(where)}</small>` : ""}${shareBadge(target)}</span>
              <span class="iso-meta">${showPath ? "" : `${it.childCount} รายการ`}</span>
            </button>
            <span class="iso-actions">${requestChips(it, showPath ? it.path : ui.path)}<button type="button" class="small-button" data-iso-zip-dl="${it.id}" data-name="${escapeHtml(it.name)}" title="ดาวน์โหลดทั้งโฟลเดอร์เป็น ZIP">⬇️</button>${editable && !showPath ? `<button type="button" class="small-button" data-iso-share="${escapeHtml(target)}" title="แชร์โฟลเดอร์ให้ผู้ร้องขอ/บุคคล">👥</button>` : ""}${actions}</span>
          </li>`;
    }
    return `
        <li class="iso-row">
          <a class="iso-open" href="${escapeHtml(it.webUrl)}" target="_blank" rel="noopener noreferrer" title="เปิดใน SharePoint">
            <span class="iso-icon">${fileIcon(it.name)}</span>
            <span class="iso-name"><b>${highlight(it.name)}</b><small>${where ? `📂 ${escapeHtml(where)} · ` : ""}${escapeHtml(formatDate(it.modified))}${it.modifiedBy ? ` · ${escapeHtml(it.modifiedBy)}` : ""}</small></span>
            <span class="iso-meta">${sizeText(it.size)}</span>
          </a>
          <span class="iso-actions">
            ${requestChips(it, showPath ? it.path : ui.path)}
            <button type="button" class="small-button" data-iso-dl="${it.id}" data-name="${escapeHtml(it.name)}" title="ดาวน์โหลด">⬇️</button>
            ${showPath && it.path !== undefined ? `<button type="button" class="small-button" data-iso-go="${escapeHtml(it.path)}" title="เปิดโฟลเดอร์ที่เก็บไฟล์นี้">📂</button>` : ""}
            ${actions}
          </span>
        </li>`;
  }

  function highlight(name) {
    const text = escapeHtml(name);
    if (!filter.q) return text;
    const q = escapeHtml(filter.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.replace(new RegExp(q, "ig"), (m) => `<mark>${m}</mark>`);
  }

  function filterBar() {
    if (items === null) return "";
    return `
      <div class="iso-filter">
        <label class="iso-search"><span aria-hidden="true">🔍</span>
          <input type="search" data-iso-q placeholder="ค้นหาชื่อไฟล์ / โฟลเดอร์ / เลข Drawing..." value="${escapeHtml(filter.q)}" autocomplete="off" />
        </label>
        <select data-iso-type title="ประเภท">
          ${[["all", "ทุกประเภท"], ["folder", "📁 โฟลเดอร์"], ["pdf", "📕 PDF"], ["dwg", "📐 DWG/DXF"], ["office", "📗 Excel/Word"], ["image", "🖼️ รูปภาพ"], ["other", "📄 อื่นๆ"]]
            .map(([v, l]) => `<option value="${v}" ${filter.type === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <div class="iso-scope" role="group" aria-label="ขอบเขตการค้นหา">
          <button type="button" class="${filter.scope === "here" ? "is-active" : ""}" data-iso-scope="here">ในโฟลเดอร์นี้</button>
          <button type="button" class="${filter.scope === "all" ? "is-active" : ""}" data-iso-scope="all" title="ค้นทุกโฟลเดอร์ย่อยใต้โฟลเดอร์นี้">ทุกโฟลเดอร์ย่อย</button>
        </div>
      </div>`;
  }

  /** วาดเฉพาะรายการ (ไม่วาดช่องค้นหาใหม่ — เคอร์เซอร์ไม่หลุดตอนพิมพ์) */
  function drawList() {
    const host = body.querySelector(".iso-list-host");
    if (!host) return;
    if (items === null) {
      host.innerHTML = `<p class="iso-empty">ยังไม่มีโฟลเดอร์เอกสาร ISO ${editable ? "— กด <b>🏗️ สร้างโครงสร้างมาตรฐาน</b> หรือ <b>🗜️ นำเข้า ZIP</b>" : "— ผู้จัดการสร้างได้ที่หน้าจัดการข้อมูล → เอกสาร ISO"}</p>`;
      return;
    }
    if (filter.scope === "all" && (filter.q || filter.type !== "all")) {
      if (!filter.q.trim()) { host.innerHTML = `<p class="iso-empty">พิมพ์คำค้นเพื่อค้นทุกโฟลเดอร์ย่อย</p>`; return; }
      if (filter.searching && !filter.results) { host.innerHTML = `<p class="iso-empty">กำลังค้นหาใน SharePoint...</p>`; return; }
      const found = (filter.results || []).filter((it) => TYPE_TEST[filter.type](it));
      host.innerHTML = found.length
        ? `<p class="iso-count">พบ ${found.length.toLocaleString("th-TH")} รายการ${filter.results?.length >= 200 ? " (แสดง 200 รายการแรก — พิมพ์คำค้นให้เจาะจงขึ้น)" : ""}</p><ul class="iso-list">${found.map((it) => rowHtml(it, { showPath: true })).join("")}</ul>`
        : `<p class="iso-empty">ไม่พบ "${escapeHtml(filter.q)}" ในโฟลเดอร์นี้และโฟลเดอร์ย่อย</p>`;
      return;
    }
    const list = items.filter(matches);
    const filtered = filter.q || filter.type !== "all";
    host.innerHTML = list.length
      ? `${filtered ? `<p class="iso-count">${list.length} จาก ${items.length} รายการ · <button type="button" class="iso-crumb" data-iso-scope="all">ค้นทุกโฟลเดอร์ย่อย ›</button></p>` : ""}<ul class="iso-list${!ui.path && !filtered && list.every((it) => it.isFolder) ? " is-grid" : ""}">${list.map((it) => rowHtml(it)).join("")}</ul>`
      : filtered
        ? `<p class="iso-empty">ไม่พบในโฟลเดอร์นี้ — <button type="button" class="iso-crumb" data-iso-scope="all">ค้นทุกโฟลเดอร์ย่อย ›</button></p>`
        : `<p class="iso-empty">โฟลเดอร์ว่าง${editable ? " — ลากไฟล์มาวางที่นี่ หรือกดอัปโหลดไฟล์" : ""}</p>`;
  }

  function runSearch() {
    clearTimeout(searchTimer);
    if (filter.scope !== "all" || !filter.q.trim()) { filter.results = null; drawList(); return; }
    filter.searching = true;
    filter.results = null;
    drawList();
    const seq = ++searchSeq;
    searchTimer = setTimeout(async () => {
      try {
        const res = await searchIso(ui.path, filter.q.trim());
        if (seq !== searchSeq) return;
        filter.results = res;
      } catch (error) {
        if (seq !== searchSeq) return;
        filter.results = [];
        showToast(`ค้นหาไม่สำเร็จ: ${error.message}`, "error");
      }
      filter.searching = false;
      drawList();
    }, 350);
  }

  function draw() {
    body.innerHTML = `
      ${crumbs()}
      ${toolbar()}
      ${guidePanel()}
      ${filterBar()}
      <div class="iso-progress" hidden></div>
      <div class="iso-list-host"></div>
      <div class="iso-audit"></div>`;
    drawList();
    if (filter.scope === "all" && filter.q) runSearch();
  }

  root.addEventListener("input", (event) => {
    if (event.target.matches("[data-iso-q]")) {
      filter.q = event.target.value;
      if (filter.scope === "all") runSearch(); else drawList();
    }
  });
  root.addEventListener("change", (event) => {
    if (event.target.matches("[data-iso-type]")) { filter.type = event.target.value; drawList(); }
  });
  root.addEventListener("click", (event) => {
    const scopeBtn = event.target.closest("[data-iso-scope]");
    if (!scopeBtn) return;
    filter.scope = scopeBtn.dataset.isoScope;
    body.querySelectorAll(".iso-scope [data-iso-scope]").forEach((b) => b.classList.toggle("is-active", b.dataset.isoScope === filter.scope));
    runSearch();
    body.querySelector("[data-iso-q]")?.focus();
  });

  const progress = (text) => {
    const el = body.querySelector(".iso-progress");
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
  };

  async function run(label, task) {
    if (busy) return;
    busy = true;
    try {
      await task();
      writeAudit({ action: `เอกสาร ISO: ${label}`, detail: ui.path || "/" }).catch(() => {});
    } catch (error) {
      showToast(`${label} ไม่สำเร็จ: ${error.message}`, "error");
    } finally {
      busy = false;
      progress("");
      load();
    }
  }

  async function upload(files) {
    if (!files.length) return;
    await run(`อัปโหลด ${files.length} ไฟล์`, async () => {
      await uploadIsoFiles(ui.path, files, (n, total, name) => progress(`⬆️ อัปโหลด ${n}/${total} — ${name}`));
      showToast(`อัปโหลด ${files.length} ไฟล์แล้ว`, "success");
    });
  }

  function askText(title, label, initial = "", hint = "") {
    return new Promise((resolve) => {
      openModal({
        title,
        body: `<label class="field"><span>${label}</span><input id="iso-input" type="text" value="${escapeHtml(initial)}" autocomplete="off" /></label>${hint ? `<p class="manage-hint">${hint}</p>` : ""}`,
        actions: [
          { label: "ยกเลิก", className: "secondary-button", onClick: (close) => { close(); resolve(null); } },
          { label: "ตกลง", className: "primary-button", onClick: (close) => { const v = document.querySelector("#iso-input")?.value.trim(); close(); resolve(v || null); } },
        ],
      });
      setTimeout(() => document.querySelector("#iso-input")?.focus(), 50);
    });
  }

  function openProjectForm() {
    const year = new Date().getFullYear();
    openModal({
      title: "➕ โครงการใหม่ (สร้างโฟลเดอร์มาตรฐานให้อัตโนมัติ)",
      body: `
        <label class="field"><span>ปี (ค.ศ.)</span><input id="iso-year" type="number" min="2020" max="2100" value="${year}" /></label>
        <fieldset class="field iso-kind"><span>ประเภท</span>
          <label><input type="radio" name="iso-kind" value="presale" checked /> 1-Presale <small>(งานเสนอราคา/Proposal — 00-Ref, 01-Document, 02-DWG Concept design)</small></label>
          <label><input type="radio" name="iso-kind" value="project" /> 2-Project <small>(โครงการที่ได้งาน — ครบ 00–05 รวม Permission / Construction / As-built)</small></label>
        </fieldset>
        <label class="field"><span>ชื่อโครงการ</span><input id="iso-name" type="text" placeholder="เช่น MLT Solar Floating" autocomplete="off" /></label>
        <p class="manage-hint">ระบบใส่เลขลำดับนำหน้าให้เอง (01-, 02-, …) ตามลำดับในปีนั้น</p>`,
      actions: [
        { label: "ยกเลิก", className: "secondary-button" },
        {
          label: "สร้างโฟลเดอร์",
          className: "primary-button",
          onClick: async (close) => {
            const y = Number(document.querySelector("#iso-year")?.value);
            const kind = document.querySelector('input[name="iso-kind"]:checked')?.value || "presale";
            const name = document.querySelector("#iso-name")?.value || "";
            if (!y || y < 2000) { showToast("กรุณาระบุปี", "warning"); return; }
            if (!safeName(name)) { showToast("กรุณาระบุชื่อโครงการ", "warning"); return; }
            close();
            await run(`สร้างโครงการ ${name}`, async () => {
              progress("กำลังสร้างโฟลเดอร์...");
              const path = await createProjectFolder({ year: y, kind, name });
              ui.path = path;
              showToast(`สร้างโฟลเดอร์ ${path.split("/").pop()} แล้ว`, "success");
            });
          },
        },
      ],
    });
  }

  async function showAudit() {
    const box = body.querySelector(".iso-audit");
    box.innerHTML = `<p class="iso-empty">กำลังตรวจโฟลเดอร์ทุกโครงการ...</p>`;
    try {
      const { subs, rows } = await auditKindFolder(ui.path);
      const short = (s) => s.replace(/^0\d-/, "").replace("DWG ", "");
      const cell = (c) => (c === null ? `<td class="is-missing">ไม่มีโฟลเดอร์</td>` : c.size ? `<td class="is-ok">✓ ${sizeText(c.size)}</td>` : `<td class="is-empty">–</td>`);
      box.innerHTML = rows.length ? `
        <h4>✅ ความครบถ้วนของเอกสาร (ขนาดไฟล์รวมในแต่ละโฟลเดอร์ รวมทุกหมวด/ทุก Drawing ข้างใน)</h4>
        <div class="track-table-wrap"><table class="manage-table iso-audit-table">
          <thead><tr><th>โครงการ</th>${subs.map((s) => `<th title="${escapeHtml(s)}">${escapeHtml(short(s))}</th>`).join("")}</tr></thead>
          <tbody>${rows.map((r) => `<tr><td><button type="button" class="iso-crumb" data-iso-go="${escapeHtml(joinPath(ui.path, r.name))}">${escapeHtml(r.name)}</button></td>${r.cells.map(cell).join("")}</tr>`).join("")}</tbody>
        </table></div>
        <p class="manage-hint">✓ = มีไฟล์ · – = ยังไม่มีไฟล์ · ไม่มีโฟลเดอร์ = โครงสร้างไม่ครบ (เปิดโครงการแล้วสร้างโฟลเดอร์ที่ขาด)</p>` : `<p class="iso-empty">ยังไม่มีโครงการในโฟลเดอร์นี้</p>`;
    } catch (error) {
      box.innerHTML = `<p class="iso-empty">⚠️ ตรวจไม่สำเร็จ: ${escapeHtml(error.message)}</p>`;
    }
  }

  /** คำร้องที่ส่งมอบแล้ว (ส่งมอบ/ตรวจรับแล้ว) ในระบบ → คัดลอกไฟล์ลงโฟลเดอร์ ISO ย้อนหลัง */
  function openBackfill() {
    const delivered = (state.requests || []).filter((r) => ["delivered", "done"].includes(r.status) && stageOfRequestType(r.requestType) && r.projectName);
    if (!delivered.length) { showToast("ยังไม่มีงานที่ส่งมอบแล้วในระบบ", "warning"); return; }
    const projects = [...new Set(delivered.map((r) => r.projectName.trim()))].sort((a, b) => a.localeCompare(b, "th", { numeric: true }));
    const ctx = projectContext(ui.path);
    const here = ctx?.project ? projects.find((p) => projectKey(p) === projectKey(ctx.project.replace(/^\d+-/, ""))) : "";
    openModal({
      title: "🔄 จัดเก็บไฟล์งานย้อนหลังลงเอกสาร ISO",
      body: `
        <label class="field"><span>โครงการ</span>
          <select id="iso-bf-project">
            <option value="">ทุกโครงการ (${delivered.length} งาน)</option>
            ${projects.map((p) => `<option value="${escapeHtml(p)}" ${p === here ? "selected" : ""}>${escapeHtml(p)} (${delivered.filter((r) => r.projectName.trim() === p).length} งาน)</option>`).join("")}
          </select>
        </label>
        <label class="manage-check"><input type="checkbox" id="iso-bf-all" checked /> <span>สร้างโฟลเดอร์ให้<b>ทุกโครงการในระบบ</b>ด้วย (แม้ยังไม่มีงานส่งมอบ)</span></label>
        <p class="manage-hint">คัดลอกไฟล์ที่ฝ่ายเขียนแบบส่ง (อัปโหลดในระบบ หรือลิงก์ SharePoint/OneDrive ที่แนบตอนส่งงาน) ไปไว้ที่ โครงการ → ขั้นแบบตามประเภทงาน → หมวด → โฟลเดอร์ Drawing — ทำซ้ำได้ ไฟล์ชื่อเดิมจะถูกแทนที่ ไม่ซ้ำซ้อน · ไฟล์ต้นฉบับไม่ถูกย้าย</p>`,
      actions: [
        { label: "ยกเลิก", className: "secondary-button" },
        {
          label: "เริ่มจัดเก็บ",
          className: "primary-button",
          onClick: (close) => {
            const proj = document.querySelector("#iso-bf-project")?.value || "";
            const allFolders = document.querySelector("#iso-bf-all")?.checked && !proj;
            const list = proj ? delivered.filter((r) => r.projectName.trim() === proj) : delivered;
            close();
            const report = [];
            run(`จัดเก็บไฟล์งานย้อนหลัง ${proj || "ทุกโครงการ"} (${list.length} งาน)`, async () => {
              const ctx = createFilingContext(state.requests || []);
              if (allFolders) {
                const res = await ensureAllProjectFolders(state.requests || [], (n, total, name) => progress(`📂 สร้างโฟลเดอร์โครงการ ${n}/${total} — ${name}`), ctx);
                res.failures.forEach((f) => report.push({ r: { requestNo: "สร้างโฟลเดอร์โครงการ", projectName: f.name, drawingNo: "" }, fail: true, text: f.error.slice(0, 160) }));
              }
              // ทำพร้อมกัน 4 งาน (ใช้บริบทเดียวกัน — โฟลเดอร์ที่สร้าง/พบแล้วไม่ต้องถาม SharePoint ซ้ำ)
              let next = 0;
              let done = 0;
              const worker = async () => {
                while (next < list.length) {
                  const r = list[next++];
                  try {
                    const res = await fileDeliveryToIso(r, state.requests || [], ctx);
                    report.push(res?.already ? { r, ok: true, text: `มีครบแล้ว → ${res.path.split("/").slice(3).join(" / ")}` }
                      : res?.path ? { r, ok: true, text: `${res.copied} ไฟล์ → ${res.path.split("/").slice(3).join(" / ")}` }
                      : { r, skip: true, text: res?.skipped || "ข้าม" });
                  } catch (error) {
                    report.push({ r, fail: true, text: error.message.slice(0, 160) });
                  }
                  done += 1;
                  progress(`🔄 ${done}/${list.length} — ${r.requestNo} ${r.projectName}`);
                }
              };
              await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker));
              showReport(report);
            });
          },
        },
      ],
    });
  }

  function showReport(report) {
    const ok = report.filter((x) => x.ok);
    const skip = report.filter((x) => x.skip);
    const fail = report.filter((x) => x.fail);
    const rows = (items, cls) => items.map((x) => `<tr class="${cls}"><td>${escapeHtml(x.r.requestNo)}</td><td>${escapeHtml(x.r.projectName || "")}</td><td>${escapeHtml(x.r.drawingNo || "")}</td><td>${escapeHtml(x.text)}</td></tr>`).join("");
    setTimeout(() => openModal({
      title: `📋 ผลการจัดเก็บ — สำเร็จ ${ok.length} · ข้าม ${skip.length} · ไม่สำเร็จ ${fail.length}`,
      body: `
        <div class="track-table-wrap iso-report"><table class="manage-table">
          <thead><tr><th>เลขคำร้อง</th><th>โครงการ</th><th>Drawing</th><th>ผล</th></tr></thead>
          <tbody>${rows(fail, "is-fail")}${rows(skip, "is-skip")}${rows(ok, "is-ok")}</tbody>
        </table></div>
        <p class="manage-hint">ข้าม = งานนั้นไม่มีไฟล์ที่อัปโหลดผ่านระบบ และลิงก์ที่แนบเปิดไม่ได้ (เช่น ลิงก์นอกองค์กร / ไม่มีสิทธิ์) — อัปโหลดไฟล์เองในโฟลเดอร์ Drawing ได้</p>`,
      actions: [{ label: "ปิด", className: "primary-button" }],
    }), 400);
  }

  function openDrawingForm() {
    openModal({
      title: "📐 เพิ่มโฟลเดอร์ Drawing",
      body: `
        <label class="field"><span>เลข Drawing</span><input id="iso-dno" type="text" placeholder="เช่น EE-001" autocomplete="off" /></label>
        <label class="field"><span>ชื่อ Drawing</span><input id="iso-dname" type="text" placeholder="เช่น Single Line Diagram" autocomplete="off" /></label>
        <p class="manage-hint">ชื่อโฟลเดอร์: <b>เลขDrawing-ชื่อDrawing</b></p>`,
      actions: [
        { label: "ยกเลิก", className: "secondary-button" },
        {
          label: "สร้าง",
          className: "primary-button",
          onClick: (close) => {
            const no = document.querySelector("#iso-dno")?.value || "";
            const name = document.querySelector("#iso-dname")?.value || "";
            if (!no.trim()) { showToast("กรุณาระบุเลข Drawing", "warning"); return; }
            close();
            run(`เพิ่ม Drawing ${drawingFolderName(no, name)}`, () => createDrawingFolders(ui.path, [{ no, name }]));
          },
        },
      ],
    });
  }

  /** ดึงรายการ Drawing ของโครงการในระบบ e-Service (เฉพาะหมวดของโฟลเดอร์นี้) มาสร้างโฟลเดอร์ */
  function openPullDrawings() {
    const ctx = projectContext(ui.path);
    const all = (state.masterData?.drawingNumbers || []).filter((d) => !d.IsHidden && d.Title);
    const projects = [...new Set(all.map((d) => String(d.ProjectName || "").trim()).filter(Boolean))];
    const folderKey = projectKey(ctx.project.replace(/^\d+-/, ""));
    const score = (p) => { const k = projectKey(p); return k === folderKey ? 3 : (k.includes(folderKey) || folderKey.includes(k)) ? 2 : 0; };
    projects.sort((a, b) => score(b) - score(a) || a.localeCompare(b, "th", { numeric: true }));
    const listFor = (proj) => all.filter((d) => projectKey(d.ProjectName) === projectKey(proj) && disciplineOfCategory(d.DrawingCategory) === ctx.discipline)
      .sort((a, b) => String(a.Title).localeCompare(String(b.Title), "th", { numeric: true }));
    const rowsHtml = (proj) => {
      const items = listFor(proj);
      return items.length
        ? items.map((d, i) => `<label class="iso-pull-row"><input type="checkbox" data-pull="${i}" checked /> <b>${escapeHtml(d.Title)}</b> ${escapeHtml(d.DrawingName || "")} <small>${escapeHtml(d.DrawingCategory || "")}</small></label>`).join("")
        : `<p class="manage-hint">ไม่มี Drawing หมวด ${escapeHtml(ctx.discipline)} ในโครงการนี้</p>`;
    };
    if (!projects.length) { showToast("ยังไม่มีรายการ Drawing ในระบบ", "warning"); return; }
    let current = projects[0];
    openModal({
      title: `📥 ดึงรายการ Drawing หมวด ${ctx.discipline} จากระบบ`,
      body: `
        <label class="field"><span>โครงการในระบบ e-Service</span>
          <select id="iso-pull-project">${projects.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}${score(p) ? " ✓" : ""}</option>`).join("")}</select>
        </label>
        <div class="iso-pull-list" id="iso-pull-list">${rowsHtml(current)}</div>
        <p class="manage-hint">สร้างโฟลเดอร์ <b>เลขDrawing-ชื่อDrawing</b> ใน ${escapeHtml(ctx.stage)}/${escapeHtml(ctx.discipline)} — ชื่อที่มีอยู่แล้วจะข้ามให้</p>`,
      actions: [
        { label: "ยกเลิก", className: "secondary-button" },
        {
          label: "สร้างโฟลเดอร์",
          className: "primary-button",
          onClick: (close) => {
            const items = listFor(current);
            const picked = [...document.querySelectorAll("[data-pull]")].filter((c) => c.checked).map((c) => items[Number(c.dataset.pull)]).filter(Boolean);
            if (!picked.length) { showToast("ยังไม่ได้เลือก Drawing", "warning"); return; }
            close();
            run(`ดึง Drawing ${picked.length} รายการจาก ${current}`, async () => {
              const n = await createDrawingFolders(ui.path, picked.map((d) => ({ no: d.Title, name: d.DrawingName })));
              showToast(`สร้างโฟลเดอร์ Drawing ${n} รายการ${picked.length - n ? ` (มีอยู่แล้ว ${picked.length - n})` : ""}`, "success");
            });
          },
        },
      ],
    });
    document.querySelector("#iso-pull-project")?.addEventListener("change", (e) => {
      current = e.target.value;
      document.querySelector("#iso-pull-list").innerHTML = rowsHtml(current);
    });
  }

  root.addEventListener("click", async (event) => {
    const goBtn = event.target.closest("[data-iso-go]");
    if (goBtn) { go(goBtn.dataset.isoGo); return; }
    const dlBtn = event.target.closest("[data-iso-dl]");
    if (dlBtn) { downloadFile(dlBtn); return; }
    const zipBtn = event.target.closest("[data-iso-zip-dl]");
    if (zipBtn) { downloadFolder(zipBtn); return; }
    const reqBtn = event.target.closest("[data-iso-req]");
    if (reqBtn) {
      const no = reqBtn.dataset.isoReq;
      const request = (state.requests || []).find((r) => r.requestNo === no);
      if (request) import("../pages/track.js").then((m) => m.openRequestDetail(request));
      return;
    }
    if (!editable) return;
    const shareBtn = event.target.closest("[data-iso-share]");
    if (shareBtn) { openShareForm(shareBtn.dataset.isoShare); return; }
    const act = event.target.closest("[data-iso-act]")?.dataset.isoAct;
    if (act === "share") { openShareForm(ui.path); return; }
    if (act === "shares") { openShareList(); return; }
    if (act === "upload") body.querySelector("[data-iso-file]")?.click();
    if (act === "zip") body.querySelector("[data-iso-zip]")?.click();
    if (act === "project") openProjectForm();
    if (act === "audit") showAudit();
    if (act === "drawing") openDrawingForm();
    if (act === "backfill") openBackfill();
    if (act === "pull") openPullDrawings();
    if (act === "folder") {
      const name = await askText("📁 โฟลเดอร์ใหม่", "ชื่อโฟลเดอร์", "", "แนะนำให้ใส่เลขลำดับนำหน้า เช่น 2026 หรือ 06-Transmittal");
      if (name) run(`สร้างโฟลเดอร์ ${name}`, () => createIsoFolder(joinPath(ui.path, safeName(name))));
    }
    if (act === "standard") {
      run("สร้างโครงสร้างมาตรฐาน", async () => {
        progress("กำลังสร้างโฟลเดอร์ 1-SP … 8-Project...");
        await createStandardTree();
        showToast("สร้างโครงสร้างมาตรฐานแล้ว", "success");
      });
    }
    if (act === "promote") {
      const name = ui.path.split("/").pop();
      openModal({
        title: "⇢ เลื่อน Presale เป็นโครงการ",
        body: `<p>ย้ายโฟลเดอร์ <b>${escapeHtml(name)}</b> พร้อมไฟล์ทั้งหมดไปที่ <b>2-Project</b> ของปีเดียวกัน แล้วเพิ่มโฟลเดอร์ 03-DWG Permission / 04-DWG Construction / 05-DWG As-built ให้อัตโนมัติ</p>`,
        actions: [
          { label: "ยกเลิก", className: "secondary-button" },
          { label: "ย้าย", className: "primary-button", onClick: (close) => { close(); run(`เลื่อน ${name} เป็นโครงการ`, async () => { ui.path = await promotePresale(ui.path); showToast("ย้ายไป 2-Project แล้ว", "success"); }); } },
        ],
      });
    }
    const renameId = event.target.closest("[data-iso-rename]")?.dataset.isoRename;
    if (renameId) {
      const it = items.find((x) => x.id === renameId);
      const name = await askText("✏️ เปลี่ยนชื่อ", "ชื่อใหม่", it?.name || "");
      if (name && name !== it?.name) run(`เปลี่ยนชื่อ ${it?.name} → ${name}`, () => renameIsoItem(renameId, name));
    }
    const deleteId = event.target.closest("[data-iso-delete]")?.dataset.isoDelete;
    if (deleteId) {
      const it = items.find((x) => x.id === deleteId);
      openModal({
        title: "🗑️ ยืนยันการลบ",
        body: `<p>ลบ${it?.isFolder ? "โฟลเดอร์" : "ไฟล์"} <b>${escapeHtml(it?.name || "")}</b>${it?.isFolder ? " และทุกไฟล์ข้างใน" : ""}?</p><p class="manage-hint">กู้คืนได้จากถังรีไซเคิลของ SharePoint ภายใน 93 วัน</p>`,
        actions: [
          { label: "ยกเลิก", className: "secondary-button" },
          { label: "ลบ", className: "primary-button danger", onClick: (close) => { close(); run(`ลบ ${it?.name}`, () => deleteIsoItem(deleteId)); } },
        ],
      });
    }
  });

  root.addEventListener("change", (event) => {
    if (event.target.matches("[data-iso-file]")) upload([...event.target.files]);
    if (event.target.matches("[data-iso-zip]")) {
      const zip = event.target.files?.[0];
      if (!zip) return;
      run(`นำเข้า ZIP ${zip.name}`, async () => {
        progress("กำลังแตกไฟล์ ZIP...");
        const res = await importIsoZip(ui.path, zip, (n, total, name) => progress(`🗜️ ${n}/${total} — ${name}`));
        showToast(`นำเข้าแล้ว ${res.folders} โฟลเดอร์ · ${res.files} ไฟล์`, "success");
      });
    }
  });

  if (editable) {
    root.addEventListener("dragover", (event) => { event.preventDefault(); root.classList.add("is-drop"); });
    root.addEventListener("dragleave", (event) => { if (!root.contains(event.relatedTarget)) root.classList.remove("is-drop"); });
    root.addEventListener("drop", (event) => {
      event.preventDefault();
      root.classList.remove("is-drop");
      upload([...(event.dataTransfer?.files || [])].filter((f) => f.size || f.type));
    });
  }

  load();
}
