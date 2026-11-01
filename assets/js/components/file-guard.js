// ══════════════════════════════════════════════════════════════
// ตรวจไฟล์ก่อนอัปโหลด — ประหยัดพื้นที่ SharePoint
//  - ไฟล์ใหญ่เกิน config.files.largeFileMB → ถามก่อน: แนบเป็นลิงก์แทน (แนะนำ) หรืออัปโหลดต่อ
//  - ไฟล์ซ้ำ (ชื่อ+ขนาดเดียวกัน) ในรายการเดียวกัน → ข้าม พร้อมแจ้ง
//  - ไฟล์เดียวกันแนบไว้กับ Drawing อื่นในคำร้องเดียวกัน → เตือนว่าจะถูกอัปโหลดซ้ำทุก Drawing
// ══════════════════════════════════════════════════════════════

import { appConfig } from "../../../config/config.js";
import { escapeHtml } from "../utils.js";
import { formatBytes } from "./cloud-picker.js";
import { showToast } from "./toast.js";

const sameFile = (a, b) => a.name === b.name && a.size === b.size;

function askLargeFiles(large, limitMb) {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "cloud-picker-backdrop file-guard-backdrop";
    root.innerHTML = `
      <section class="cloud-picker file-guard" role="alertdialog" aria-modal="true" aria-labelledby="file-guard-title">
        <header class="cp-head"><h2 id="file-guard-title">📦 ไฟล์ขนาดใหญ่ (เกิน ${limitMb} MB)</h2></header>
        <div class="file-guard-body">
          <ul class="file-guard-list">
            ${large.map((f) => `<li><span title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span><b>${formatBytes(f.size)}</b></li>`).join("")}
          </ul>
          <p>ไฟล์ใหญ่ที่อัปโหลดจะถูกคัดลอกเก็บใน SharePoint อีกชุด ทำให้พื้นที่ (1TB) เต็มเร็ว และอัปโหลดนาน</p>
          <p><b>แนะนำ:</b> ถ้าไฟล์นี้อยู่ใน SharePoint / OneDrive อยู่แล้ว ให้กดปุ่ม <b>📂 เลือกจาก SharePoint / OneDrive</b> ที่ช่องลิงก์แทน — ระบบเก็บแค่ลิงก์ ไม่กินพื้นที่เพิ่ม</p>
        </div>
        <footer class="cp-foot">
          <span></span>
          <div class="cp-actions">
            <button type="button" class="secondary-button" data-guard="upload">อัปโหลดต่อ</button>
            <button type="button" class="primary-button" data-guard="skip">ไม่อัปโหลดไฟล์ใหญ่ (แนบเป็นลิงก์แทน)</button>
          </div>
        </footer>
      </section>`;
    document.body.appendChild(root);
    document.body.classList.add("picker-open");
    const done = (value) => {
      root.remove();
      if (!document.getElementById("cloud-picker-root")) document.body.classList.remove("picker-open");
      resolve(value);
    };
    root.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-guard]");
      if (btn) done(btn.dataset.guard === "upload");
    });
    root.querySelector('[data-guard="skip"]').focus();
  });
}

/**
 * @param {File[]} incoming ไฟล์ที่ผู้ใช้เพิ่งเลือก/ลากมา
 * @param {object} opts
 * @param {File[]} opts.existing   ไฟล์ที่อยู่ในรายการนี้แล้ว
 * @param {File[]} opts.elsewhere  ไฟล์ที่แนบกับ Drawing อื่นในคำร้องเดียวกัน
 * @returns {Promise<File[]>} ไฟล์ที่ควรเพิ่มเข้ารายการ
 */
export async function reviewIncomingFiles(incoming, { existing = [], elsewhere = [] } = {}) {
  const files = Array.from(incoming || []).filter((f) => f instanceof File && f.name && typeof f.size === "number");
  const unique = [];
  let dupCount = 0;
  files.forEach((f) => {
    if (existing.some((e) => sameFile(e, f)) || unique.some((u) => sameFile(u, f))) dupCount += 1;
    else unique.push(f);
  });
  if (dupCount) showToast(`ข้ามไฟล์ซ้ำ ${dupCount} ไฟล์ (ชื่อและขนาดเดียวกับที่แนบไว้แล้ว)`, "info");

  const repeated = unique.filter((f) => elsewhere.some((e) => sameFile(e, f)));
  if (repeated.length) {
    showToast(`${repeated.map((f) => f.name).slice(0, 2).join(", ")}${repeated.length > 2 ? " …" : ""} แนบกับ Drawing อื่นในคำร้องนี้แล้ว — จะถูกอัปโหลดซ้ำทุก Drawing ถ้าเป็นไฟล์ใหญ่แนะนำแนบเป็นลิงก์`, "warning");
  }

  const limitMb = Number(appConfig.files?.largeFileMB) || 0;
  if (!limitMb) return unique;
  const large = unique.filter((f) => f.size > limitMb * 1024 * 1024);
  if (!large.length) return unique;
  const uploadAnyway = await askLargeFiles(large, limitMb);
  if (uploadAnyway) return unique;
  showToast(`ไม่ได้เพิ่มไฟล์ใหญ่ ${large.length} ไฟล์ — กดปุ่ม 📂 เลือกจาก SharePoint / OneDrive เพื่อแนบเป็นลิงก์`, "info");
  return unique.filter((f) => !large.includes(f));
}
