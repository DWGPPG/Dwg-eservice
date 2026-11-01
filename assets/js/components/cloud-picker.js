// ══════════════════════════════════════════════════════════════
// เลือกไฟล์จาก SharePoint / OneDrive — "แนบเป็นลิงก์" แทนการอัปโหลดสำเนา (ไม่กินพื้นที่ SharePoint เพิ่ม)
//
// - ใช้ Microsoft Graph ด้วยสิทธิ์ที่ระบบมีอยู่แล้ว (Files.ReadWrite.All / Sites.ReadWrite.All) ไม่ต้องตั้งค่าเพิ่ม
// - ไฟล์ใน SharePoint ฝ่ายเขียนแบบ → ใช้ลิงก์ไฟล์ตรง (สมาชิกฝ่ายเปิดได้อยู่แล้ว)
// - ไฟล์ใน OneDrive ส่วนตัว → สร้างลิงก์แชร์ "ทุกคนในองค์กรดูได้" ให้อัตโนมัติ ฝ่ายเขียนแบบจะได้เปิดได้
// - ช่องลิงก์ทุกช่องในระบบได้ปุ่ม 📂 + ตรวจลิงก์อัตโนมัติ ผ่าน enhanceLinkInputs() (ไม่ต้องแก้ทุกหน้า)
// ══════════════════════════════════════════════════════════════

import { graphFetch } from "../graph.js";
import { ensureSite } from "../sharepoint.js";
import { escapeHtml } from "../utils.js";
import { showToast } from "./toast.js";

const ITEM_SELECT = "$select=id,name,size,folder,file,webUrl,lastModifiedDateTime";

let siteDrivePromise = null;
let myDrivePromise = null;
function siteDriveId() {
  siteDrivePromise ||= ensureSite()
    .then((siteId) => graphFetch(`/sites/${siteId}/drive?$select=id`))
    .then((d) => d.id)
    .catch((e) => { siteDrivePromise = null; throw e; });
  return siteDrivePromise;
}
function myDriveId() {
  myDrivePromise ||= graphFetch("/me/drive?$select=id")
    .then((d) => d.id)
    .catch((e) => { myDrivePromise = null; throw e; });
  return myDrivePromise;
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** ข้อความที่เก็บลงช่องลิงก์: "ชื่อไฟล์ | ลิงก์ ; ชื่อไฟล์ | ลิงก์" — หน้าแสดงไฟล์อ่านชื่อจากรูปแบบนี้ */
export function formatLinkEntries(files) {
  return files.map((f) => `${String(f.name || "").replace(/[|;]/g, " ").trim()} | ${f.url}`).join(" ; ");
}

const SOURCES = [
  { key: "site", label: "🏢 SharePoint ฝ่ายเขียนแบบ", driveId: siteDriveId, rootName: "เอกสารฝ่ายเขียนแบบ" },
  { key: "me", label: "☁️ OneDrive ของฉัน", driveId: myDriveId, rootName: "OneDrive ของฉัน" },
];

/**
 * เปิดหน้าต่างเลือกไฟล์
 * @returns {Promise<Array<{name,size,url,shared}>|null>} null = ยกเลิก
 */
export function openCloudPicker({ multiple = true, title = "เลือกไฟล์จาก SharePoint / OneDrive" } = {}) {
  if (document.getElementById("cloud-picker-root")) return Promise.resolve(null);
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.id = "cloud-picker-root";
    root.className = "cloud-picker-backdrop";
    root.innerHTML = `
      <section class="cloud-picker" role="dialog" aria-modal="true" aria-labelledby="cloud-picker-title">
        <header class="cp-head">
          <h2 id="cloud-picker-title">📂 ${escapeHtml(title)}</h2>
          <button type="button" class="icon-button cp-close" aria-label="ปิด">×</button>
        </header>
        <div class="cp-sources" role="tablist">
          ${SOURCES.map((s, i) => `<button type="button" role="tab" class="cp-source ${i === 0 ? "is-active" : ""}" data-cp-source="${s.key}">${s.label}</button>`).join("")}
        </div>
        <div class="cp-toolbar">
          <nav class="cp-crumbs" aria-label="ตำแหน่งโฟลเดอร์"></nav>
          <input type="search" class="cp-search" placeholder="ค้นหาชื่อไฟล์…" aria-label="ค้นหาไฟล์" />
        </div>
        <div class="cp-list" role="listbox" aria-multiselectable="${multiple}"></div>
        <p class="cp-note">💡 ระบบเก็บเฉพาะ<b>ลิงก์</b> ไม่สร้างสำเนาไฟล์ — ไม่กินพื้นที่ SharePoint เพิ่ม และเปิดไฟล์ฉบับล่าสุดได้เสมอ</p>
        <footer class="cp-foot">
          <span class="cp-selected">ยังไม่ได้เลือกไฟล์</span>
          <div class="cp-actions">
            <button type="button" class="secondary-button cp-cancel">ยกเลิก</button>
            <button type="button" class="primary-button cp-confirm" disabled>แนบลิงก์</button>
          </div>
        </footer>
      </section>`;
    document.body.appendChild(root);
    document.body.classList.add("picker-open");

    const $ = (sel) => root.querySelector(sel);
    const list = $(".cp-list");
    const crumbs = $(".cp-crumbs");
    const search = $(".cp-search");
    const confirmBtn = $(".cp-confirm");
    const selectedLabel = $(".cp-selected");

    let source = SOURCES[0];
    let driveId = null;
    let stack = [];          // [{ id, name }] — id null = root
    let items = [];
    const selected = new Map(); // `${driveId}:${id}` → { item, driveId, sourceKey }
    let loadSeq = 0;
    let searchTimer = null;

    const finish = (value) => {
      document.removeEventListener("keydown", onKey, true);
      root.remove();
      document.body.classList.remove("picker-open");
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); finish(null); }
    };
    document.addEventListener("keydown", onKey, true);

    const renderCrumbs = () => {
      crumbs.innerHTML = search.value.trim()
        ? `<span class="cp-crumb is-current">🔎 ผลการค้นหา “${escapeHtml(search.value.trim())}”</span>`
        : stack.map((c, i) => i === stack.length - 1
          ? `<span class="cp-crumb is-current">${escapeHtml(c.name)}</span>`
          : `<button type="button" class="cp-crumb" data-cp-crumb="${i}">${escapeHtml(c.name)}</button><span class="cp-sep">›</span>`).join("");
    };

    const renderSelected = () => {
      const n = selected.size;
      const total = [...selected.values()].reduce((s, x) => s + (x.item.size || 0), 0);
      selectedLabel.textContent = n ? `เลือกแล้ว ${n} ไฟล์ · ${formatBytes(total)}` : "ยังไม่ได้เลือกไฟล์";
      confirmBtn.disabled = !n;
      confirmBtn.textContent = n ? `แนบลิงก์ (${n})` : "แนบลิงก์";
    };

    const renderList = () => {
      if (!items.length) {
        list.innerHTML = `<div class="cp-empty">${search.value.trim() ? "ไม่พบไฟล์ที่ค้นหา" : "โฟลเดอร์นี้ว่าง"}</div>`;
        return;
      }
      list.innerHTML = items.map((it, i) => {
        const isFolder = Boolean(it.folder);
        const key = `${driveId}:${it.id}`;
        const checked = selected.has(key);
        const date = it.lastModifiedDateTime ? new Date(it.lastModifiedDateTime).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }) : "";
        return `
          <button type="button" class="cp-row ${isFolder ? "is-folder" : ""} ${checked ? "is-checked" : ""}" data-cp-index="${i}" role="option" aria-selected="${checked}">
            <span class="cp-check" aria-hidden="true">${isFolder ? "📁" : checked ? "☑" : "☐"}</span>
            <span class="cp-name" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</span>
            <span class="cp-meta">${isFolder ? `${it.folder.childCount ?? ""} รายการ` : formatBytes(it.size)}</span>
            <span class="cp-meta cp-date">${date}</span>
          </button>`;
      }).join("");
    };

    const sortItems = (arr) => arr.sort((a, b) => (Boolean(b.folder) - Boolean(a.folder)) || a.name.localeCompare(b.name, "th", { numeric: true }));

    const load = async () => {
      const seq = ++loadSeq;
      list.innerHTML = `<div class="cp-empty"><span class="cp-spinner" aria-hidden="true"></span> กำลังโหลด…</div>`;
      renderCrumbs();
      try {
        driveId = await source.driveId();
        const q = search.value.trim();
        let url;
        if (q) url = `/drives/${driveId}/root/search(q='${encodeURIComponent(q.replace(/'/g, "''"))}')?${ITEM_SELECT}&$top=100`;
        else {
          const current = stack[stack.length - 1];
          url = current?.id
            ? `/drives/${driveId}/items/${current.id}/children?${ITEM_SELECT}&$top=200`
            : `/drives/${driveId}/root/children?${ITEM_SELECT}&$top=200`;
        }
        const collected = [];
        let next = url;
        for (let page = 0; next && page < 5; page++) { // สูงสุด 1,000 รายการต่อโฟลเดอร์
          const res = await graphFetch(next);
          collected.push(...(res?.value || []));
          next = res?.["@odata.nextLink"] || null;
        }
        if (seq !== loadSeq) return;
        items = sortItems(collected.filter((it) => it.folder || it.file));
        renderList();
      } catch (error) {
        if (seq !== loadSeq) return;
        items = [];
        list.innerHTML = `<div class="cp-empty cp-error">⚠️ เปิดไม่สำเร็จ: ${escapeHtml(String(error.message || error).slice(0, 140))}</div>`;
      }
    };

    root.addEventListener("click", (e) => {
      if (e.target === root || e.target.closest(".cp-close, .cp-cancel")) return finish(null);
      const src = e.target.closest("[data-cp-source]");
      if (src) {
        root.querySelectorAll("[data-cp-source]").forEach((b) => b.classList.toggle("is-active", b === src));
        source = SOURCES.find((s) => s.key === src.dataset.cpSource);
        stack = [{ id: null, name: source.rootName }];
        search.value = "";
        load();
        return;
      }
      const crumb = e.target.closest("[data-cp-crumb]");
      if (crumb) {
        stack = stack.slice(0, Number(crumb.dataset.cpCrumb) + 1);
        load();
        return;
      }
      const row = e.target.closest("[data-cp-index]");
      if (row) {
        const it = items[Number(row.dataset.cpIndex)];
        if (!it) return;
        if (it.folder) {
          search.value = "";
          stack.push({ id: it.id, name: it.name });
          load();
          return;
        }
        const key = `${driveId}:${it.id}`;
        if (selected.has(key)) selected.delete(key);
        else {
          if (!multiple) selected.clear();
          selected.set(key, { item: it, driveId, sourceKey: source.key });
        }
        renderList();
        renderSelected();
      }
    });

    search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(load, 400);
    });

    confirmBtn.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "กำลังเตรียมลิงก์…";
      const result = [];
      let fallback = 0;
      for (const { item, driveId: dId, sourceKey } of selected.values()) {
        let url = item.webUrl;
        let shared = sourceKey === "site";
        if (sourceKey !== "site") {
          // OneDrive ส่วนตัว: สร้างลิงก์ "ทุกคนในองค์กรดูได้" — ถ้านโยบายบริษัทไม่อนุญาต ใช้ลิงก์ตรงแทน (ต้องแชร์เอง)
          try {
            const res = await graphFetch(`/drives/${dId}/items/${item.id}/createLink`, {
              method: "POST",
              body: JSON.stringify({ type: "view", scope: "organization" }),
            });
            if (res?.link?.webUrl) { url = res.link.webUrl; shared = true; }
          } catch (error) {
            fallback += 1;
            console.warn("createLink failed:", error.message);
          }
        }
        result.push({ name: item.name, size: item.size || 0, url, shared });
      }
      if (fallback) {
        showToast(`สร้างลิงก์แชร์ให้ ${fallback} ไฟล์ไม่สำเร็จ — กรุณาแชร์ไฟล์ใน OneDrive ให้ฝ่ายเขียนแบบเอง`, "warning");
      }
      finish(result);
    });

    stack = [{ id: null, name: source.rootName }];
    renderSelected();
    load();
    search.focus({ preventScroll: true });
  });
}

// ══════════════════════════════════════════════════════════════
// ตรวจลิงก์ — เปิดได้จริงไหม (เฉพาะลิงก์ SharePoint / OneDrive ขององค์กร)
// ══════════════════════════════════════════════════════════════

const linkCheckCache = new Map();

function encodeShareUrl(url) {
  const b64 = btoa(unescape(encodeURIComponent(url))).replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  return `u!${b64}`;
}

/** @returns {Promise<{state:"ok"|"denied"|"notfound"|"external"|"error", name?:string, personal?:boolean}>} */
export function checkLink(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return Promise.resolve({ state: "error" }); }
  if (!/\.sharepoint\.com$/i.test(parsed.hostname)) return Promise.resolve({ state: "external" });
  if (linkCheckCache.has(url)) return linkCheckCache.get(url);
  const personal = /-my\.sharepoint\.com$/i.test(parsed.hostname);
  const promise = graphFetch(`/shares/${encodeShareUrl(url)}/driveItem?$select=name,size,folder,file`)
    .then((item) => ({ state: "ok", name: item?.name || "", personal, isSharingLink: parsed.pathname.startsWith("/:") }))
    .catch((error) => {
      const status = error.status || Number(String(error.message).match(/error (\d{3})/)?.[1]);
      if (status === 403 || status === 401) return { state: "denied" };
      if (status === 404) return { state: "notfound" };
      return { state: "error" };
    });
  linkCheckCache.set(url, promise);
  return promise;
}

/** ลิงก์ทั้งหมดในข้อความ + ชื่อที่อยู่หน้าลิงก์ (รูปแบบ "ชื่อ | ลิงก์ ; ชื่อ | ลิงก์") */
export function parseLinkEntries(text = "") {
  return String(text)
    .split(/\n| ; /)
    .map((segment) => {
      const url = segment.match(/https?:\/\/[^\s<>"']+/)?.[0]?.replace(/[),.;]+$/, "");
      if (!url) return null;
      const name = segment.slice(0, segment.indexOf(url)).replace(/[|📎🔗\s]+$/u, "").replace(/^[\s📎🔗]+/u, "").trim();
      return { url, name };
    })
    .filter(Boolean);
}

// ══════════════════════════════════════════════════════════════
// ใส่ปุ่ม 📂 + สถานะตรวจลิงก์ ให้ช่องลิงก์ทุกช่องอัตโนมัติ
// ══════════════════════════════════════════════════════════════

const LINK_INPUTS = [
  { selector: 'input[data-detail="referenceLink"]', multiple: true },
  { selector: 'input[data-cloud-link="multi"]', multiple: true },
  { selector: 'input[name="dwgUrl"]', multiple: false, title: "เลือกไฟล์ DWG" },
  { selector: 'input[name="pdfUrl"]', multiple: false, title: "เลือกไฟล์ PDF" },
  { selector: 'input[id^="review-evidence-link-"]', multiple: false, title: "เลือกไฟล์หลักฐาน" },
];

function statusHtml(results) {
  if (!results.length) return "";
  const ok = results.filter((r) => r.state === "ok");
  const denied = results.filter((r) => r.state === "denied" || r.state === "notfound");
  const external = results.filter((r) => r.state === "external");
  const personalUnshared = ok.filter((r) => r.personal && !r.isSharingLink);
  const parts = [];
  if (ok.length) parts.push(`<span class="cl-ok">✅ เปิดได้ ${ok.length} ลิงก์${ok.length === 1 && ok[0].name ? `: ${escapeHtml(ok[0].name)}` : ""}</span>`);
  if (denied.length) parts.push(`<span class="cl-bad">⚠️ เปิดไม่ได้ ${denied.length} ลิงก์ — ตรวจสอบว่าลิงก์ถูกต้อง และแชร์สิทธิ์ให้ฝ่ายเขียนแบบแล้ว</span>`);
  if (personalUnshared.length) parts.push(`<span class="cl-warn">ℹ️ เป็นไฟล์ใน OneDrive ส่วนตัว — ฝ่ายเขียนแบบจะเปิดได้เมื่อแชร์ให้แล้วเท่านั้น (แนะนำกดปุ่ม 📂 ระบบจะแชร์ให้อัตโนมัติ)</span>`);
  if (external.length) parts.push(`<span class="cl-muted">ℹ️ ลิงก์ภายนอก ${external.length} ลิงก์ (เช่น Google Drive) — ระบบตรวจสิทธิ์ให้ไม่ได้ กรุณาตั้งค่าให้คนในบริษัทเปิดได้</span>`);
  return parts.join("");
}

async function runCheck(input, statusEl) {
  const entries = parseLinkEntries(input.value).slice(0, 6);
  if (!entries.length) { statusEl.innerHTML = ""; return; }
  const token = (input._checkToken = (input._checkToken || 0) + 1);
  statusEl.innerHTML = `<span class="cl-muted">⏳ กำลังตรวจลิงก์…</span>`;
  const results = await Promise.all(entries.map((e) => checkLink(e.url)));
  if (token !== input._checkToken || !statusEl.isConnected) return;
  statusEl.innerHTML = statusHtml(results);
}

function enhance(input, cfg) {
  if (input.dataset.cloudEnhanced) return;
  input.dataset.cloudEnhanced = "1";
  const tools = document.createElement("div");
  tools.className = "cloud-link-tools";
  tools.innerHTML = `
    <button type="button" class="cloud-pick-btn">📂 เลือกจาก SharePoint / OneDrive</button>
    <span class="cloud-link-status" aria-live="polite"></span>`;
  input.insertAdjacentElement("afterend", tools);
  const statusEl = tools.querySelector(".cloud-link-status");

  tools.querySelector(".cloud-pick-btn").addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const picked = await openCloudPicker({ multiple: cfg.multiple, title: cfg.title });
    if (!picked?.length || !input.isConnected) return;
    const text = cfg.multiple ? formatLinkEntries(picked) : picked[0].url;
    input.value = cfg.multiple && input.value.trim() ? `${input.value.trim()} ; ${text}` : text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const total = picked.reduce((s, f) => s + f.size, 0);
    showToast(`แนบลิงก์ ${picked.length} ไฟล์แล้ว (${formatBytes(total)}) — ไม่ต้องอัปโหลดซ้ำ`, "success");
    // หน้าอาจวาดใหม่หลัง input event — ตรวจลิงก์ที่ช่องตัวปัจจุบัน
    requestAnimationFrame(() => enhanceLinkInputs(document));
    if (statusEl.isConnected) runCheck(input, statusEl);
  });

  let timer = null;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => runCheck(input, statusEl), 900); });
  input.addEventListener("change", () => { clearTimeout(timer); runCheck(input, statusEl); });
  if (input.value.trim()) runCheck(input, statusEl);
}

export function enhanceLinkInputs(root = document) {
  LINK_INPUTS.forEach((cfg) => root.querySelectorAll(cfg.selector).forEach((input) => enhance(input, cfg)));
}

let observerStarted = false;
export function startLinkInputEnhancer() {
  if (observerStarted) return;
  observerStarted = true;
  let scheduled = false;
  const run = () => { scheduled = false; enhanceLinkInputs(document); };
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(run);
  }).observe(document.body, { childList: true, subtree: true });
  enhanceLinkInputs(document);
}
