// ══════════════════════════════════════════════════════════════
// ตัวเปิดดูเอกสาร ISO (ใช้ทั้งหน้าคู่มือ = ดูอย่างเดียว และหน้าจัดการข้อมูล = แก้ไขได้)
// ══════════════════════════════════════════════════════════════

import {
  DISCIPLINES, DRAWING_STAGES, PERMIT_FOLDERS, PERMIT_STAGE, categoryFoldersOf, ISO_ROOT_LABEL, ISO_SECTIONS, KINDS, PRESALE_STAGES, PROJECT_FOLDER, PROJECT_STAGES,
  auditKindFolder, createDrawingFolders, createIsoFolder, createProjectFolder, createStandardTree, deleteIsoItem,
  disciplineOfCategory, drawingFolderName, importIsoZip, joinPath, listIso, promotePresale, renameIsoItem, safeName, uploadIsoFiles,
} from "../services/iso-service.js";
import { state } from "../state.js";
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
const sizeText = (b) => (!b ? "" : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
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

  const go = (path) => { ui.path = path; load(); };

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

  function draw() {
    const list = items || [];
    const rows = list.map((it) => {
      const sec = !ui.path && it.isFolder ? sectionOf(it.name) : null;
      const actions = editable ? `
        <button type="button" class="small-button" data-iso-rename="${it.id}" title="เปลี่ยนชื่อ">✏️</button>
        <button type="button" class="small-button danger" data-iso-delete="${it.id}" title="ลบ">🗑️</button>` : "";
      if (it.isFolder) {
        return `
          <li class="iso-row is-folder">
            <button type="button" class="iso-open" data-iso-go="${escapeHtml(joinPath(ui.path, it.name))}">
              <span class="iso-icon">📁</span>
              <span class="iso-name"><b>${escapeHtml(it.name)}</b>${sec ? `<small>${escapeHtml(sec.label)}</small>` : ""}</span>
              <span class="iso-meta">${it.childCount} รายการ</span>
            </button>
            <span class="iso-actions">${actions}</span>
          </li>`;
      }
      return `
        <li class="iso-row">
          <a class="iso-open" href="${escapeHtml(it.webUrl)}" target="_blank" rel="noopener noreferrer" title="เปิดใน SharePoint">
            <span class="iso-icon">${fileIcon(it.name)}</span>
            <span class="iso-name"><b>${escapeHtml(it.name)}</b><small>${escapeHtml(formatDate(it.modified))}${it.modifiedBy ? ` · ${escapeHtml(it.modifiedBy)}` : ""}</small></span>
            <span class="iso-meta">${sizeText(it.size)}</span>
          </a>
          <span class="iso-actions">
            ${it.downloadUrl ? `<a class="small-button" href="${escapeHtml(it.downloadUrl)}" download="${escapeHtml(it.name)}" title="ดาวน์โหลด">⬇️</a>` : ""}
            ${actions}
          </span>
        </li>`;
    }).join("");
    body.innerHTML = `
      ${crumbs()}
      ${toolbar()}
      ${guidePanel()}
      ${items === null
        ? `<p class="iso-empty">ยังไม่มีโฟลเดอร์เอกสาร ISO ${editable ? "— กด <b>🏗️ สร้างโครงสร้างมาตรฐาน</b> หรือ <b>🗜️ นำเข้า ZIP</b>" : "— ผู้จัดการสร้างได้ที่หน้าจัดการข้อมูล → เอกสาร ISO"}</p>`
        : list.length ? `<ul class="iso-list">${rows}</ul>` : `<p class="iso-empty">โฟลเดอร์ว่าง${editable ? " — ลากไฟล์มาวางที่นี่ หรือกดอัปโหลดไฟล์" : ""}</p>`}
      <div class="iso-progress" hidden></div>
      <div class="iso-audit"></div>`;
  }

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
    if (!editable) return;
    const act = event.target.closest("[data-iso-act]")?.dataset.isoAct;
    if (act === "upload") body.querySelector("[data-iso-file]")?.click();
    if (act === "zip") body.querySelector("[data-iso-zip]")?.click();
    if (act === "project") openProjectForm();
    if (act === "audit") showAudit();
    if (act === "drawing") openDrawingForm();
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
