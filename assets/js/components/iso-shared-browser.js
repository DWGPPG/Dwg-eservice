// ══════════════════════════════════════════════════════════════
// เอกสาร ISO ที่แชร์ให้ผู้ร้องขอ / บุคคล (หน้าคู่มือ → เอกสาร ISO)
//  - เห็นเฉพาะโฟลเดอร์ที่ผู้จัดการแชร์ให้ (รวมโฟลเดอร์ย่อย)
//  - "ดูอย่างเดียว": เปิดผ่านลิงก์ SharePoint แบบห้ามดาวน์โหลด · ไม่มีปุ่มดาวน์โหลด/ZIP ในระบบ
// ══════════════════════════════════════════════════════════════

import { loadAccess, SHARE_MODES, sharesForUser } from "../services/iso-access.js";
import { escapeHtml, formatDate } from "../utils.js";

const fileIcon = (name) => {
  const ext = String(name).split(".").pop().toLowerCase();
  if (ext === "pdf") return "📕";
  if (["dwg", "dxf"].includes(ext)) return "📐";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📗";
  if (["doc", "docx"].includes(ext)) return "📘";
  if (["ppt", "pptx"].includes(ext)) return "📙";
  if (["jpg", "jpeg", "png", "gif", "webp", "tif", "tiff"].includes(ext)) return "🖼️";
  return "📄";
};
const sizeText = (b) => (!b ? "" : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const lastPart = (p) => String(p).split("/").pop();
const parentOf = (p) => String(p).split("/").slice(0, -1).join("/");

const ui = { share: "", rel: "", q: "" }; // จำตำแหน่งไว้ข้ามการวาดใหม่

export function renderSharedIsoBrowser(container) {
  container.innerHTML = `<div class="iso-browser"><div class="iso-body"><p class="iso-empty">กำลังโหลด...</p></div></div>`;
  const body = container.querySelector(".iso-body");
  let shares = [];

  loadAccess().then((m) => {
    shares = sharesForUser(m);
    if (ui.share && !shares.some((s) => s.path === ui.share)) { ui.share = ""; ui.rel = ""; }
    draw();
  }).catch((error) => {
    body.innerHTML = `<p class="iso-empty">⚠️ โหลดเอกสารไม่สำเร็จ: ${escapeHtml(error.message)}</p>`;
  });

  const current = () => shares.find((s) => s.path === ui.share);

  function crumbs() {
    const links = [`<button type="button" class="iso-crumb" data-sh-go="">🗂️ เอกสารที่แชร์ให้คุณ</button>`];
    if (ui.share) {
      links.push(`<span aria-hidden="true">›</span><button type="button" class="iso-crumb" data-sh-go="${escapeHtml(ui.share)}|">${escapeHtml(lastPart(ui.share))}</button>`);
      const parts = ui.rel ? ui.rel.split("/") : [];
      parts.forEach((part, i) => links.push(`<span aria-hidden="true">›</span><button type="button" class="iso-crumb" data-sh-go="${escapeHtml(ui.share)}|${escapeHtml(parts.slice(0, i + 1).join("/"))}">${escapeHtml(part)}</button>`));
    }
    return `<nav class="iso-crumbs" aria-label="ตำแหน่งโฟลเดอร์">${links.join("")}</nav>`;
  }

  function fileRow(share, it, showWhere = false) {
    const name = lastPart(it.p);
    const view = share.mode === "view";
    const where = showWhere ? `📂 ${lastPart(share.path)}${parentOf(it.p) ? `/${parentOf(it.p)}` : ""} · ` : "";
    if (!it.link) return "";
    return `
      <li class="iso-row">
        <a class="iso-open" href="${escapeHtml(it.link)}" target="_blank" rel="noopener noreferrer" title="${view ? "เปิดดู (ดาวน์โหลดไม่ได้)" : "เปิดดู"}">
          <span class="iso-icon">${fileIcon(name)}</span>
          <span class="iso-name"><b>${escapeHtml(name)}</b><small>${escapeHtml(where)}${escapeHtml(formatDate(it.modified))}</small></span>
          <span class="iso-meta">${sizeText(it.size)}</span>
        </a>
        <span class="iso-actions"><span class="iso-shared ${view ? "is-view" : ""}">${view ? "🔒 ดูอย่างเดียว" : "👁️ เปิดดู"}</span></span>
      </li>`;
  }

  function list() {
    const q = ui.q.trim().toLowerCase();
    if (q) {
      const hits = [];
      shares.forEach((s) => (s.items || []).forEach((it) => { if (!it.isFolder && lastPart(it.p).toLowerCase().includes(q)) hits.push([s, it]); }));
      return hits.length
        ? `<p class="iso-count">พบ ${hits.length} ไฟล์</p><ul class="iso-list">${hits.slice(0, 300).map(([s, it]) => fileRow(s, it, true)).join("")}</ul>`
        : `<p class="iso-empty">ไม่พบ "${escapeHtml(ui.q)}" ในเอกสารที่แชร์ให้คุณ</p>`;
    }
    if (!ui.share) {
      return `<ul class="iso-list is-grid">${shares.map((s) => `
        <li class="iso-row is-folder">
          <button type="button" class="iso-open" data-sh-go="${escapeHtml(s.path)}|">
            <span class="iso-icon">📁</span>
            <span class="iso-name"><b>${escapeHtml(lastPart(s.path))}</b><small>${escapeHtml(parentOf(s.path) || "เอกสาร ISO")}</small></span>
            <span class="iso-meta">${(s.items || []).filter((x) => !x.isFolder).length} ไฟล์ · ${escapeHtml(SHARE_MODES[s.mode]?.short || "")}</span>
          </button>
        </li>`).join("")}</ul>`;
    }
    const s = current();
    if (!s) return "";
    const kids = (s.items || []).filter((it) => parentOf(it.p) === ui.rel)
      .sort((a, b) => (Number(b.isFolder) - Number(a.isFolder)) || a.p.localeCompare(b.p, "th", { numeric: true }));
    if (!kids.length) return `<p class="iso-empty">โฟลเดอร์ว่าง</p>`;
    return `<ul class="iso-list">${kids.map((it) => it.isFolder ? `
      <li class="iso-row is-folder">
        <button type="button" class="iso-open" data-sh-go="${escapeHtml(s.path)}|${escapeHtml(it.p)}">
          <span class="iso-icon">📁</span>
          <span class="iso-name"><b>${escapeHtml(lastPart(it.p))}</b></span>
          <span class="iso-meta">${(s.items || []).filter((x) => parentOf(x.p) === it.p).length} รายการ</span>
        </button>
      </li>` : fileRow(s, it)).join("")}</ul>`;
  }

  function draw() {
    if (!shares.length) {
      body.innerHTML = `<p class="iso-empty">ยังไม่มีเอกสาร ISO ที่แชร์ให้คุณ</p>`;
      return;
    }
    const s = current();
    body.innerHTML = `
      ${crumbs()}
      <div class="iso-guide">${s?.mode === "download" ? "👁️ เอกสารที่แชร์ให้คุณ — เปิดดูได้" : "🔒 เอกสารที่แชร์ให้คุณ — <b>เปิดดูได้อย่างเดียว ดาวน์โหลด/พิมพ์ไม่ได้</b>"} · กดชื่อไฟล์เพื่อเปิดดูใน SharePoint</div>
      <div class="iso-filter"><label class="iso-search"><span aria-hidden="true">🔍</span>
        <input type="search" data-sh-q placeholder="ค้นหาชื่อไฟล์ในเอกสารที่แชร์ให้คุณ..." value="${escapeHtml(ui.q)}" autocomplete="off" /></label></div>
      <div class="iso-list-host">${list()}</div>`;
  }

  body.addEventListener("click", (event) => {
    const go = event.target.closest("[data-sh-go]");
    if (!go) return;
    const [share, rel = ""] = go.dataset.shGo.split("|");
    ui.share = share; ui.rel = share ? rel : ""; ui.q = "";
    draw();
  });
  body.addEventListener("input", (event) => {
    if (!event.target.matches("[data-sh-q]")) return;
    ui.q = event.target.value;
    const host = body.querySelector(".iso-list-host");
    if (host) host.innerHTML = list();
  });
  // ดูอย่างเดียว: กันคลิกขวา "บันทึกลิงก์เป็น..." ในระบบ (ตัวไฟล์จริงถูกบล็อกที่ SharePoint)
  body.addEventListener("contextmenu", (event) => { if (event.target.closest(".iso-open[href]")) event.preventDefault(); });
}
