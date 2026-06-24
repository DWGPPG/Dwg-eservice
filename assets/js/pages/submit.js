import { lists } from "../../../config/schema.js";
import { openModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import { createRequest } from "../services/request-service.js";
import { addItem, patchItem } from "../sharepoint.js";
import { state } from "../state.js";
import { escapeHtml, serializeForm } from "../utils.js";

const REQUEST_TYPES = [
  "📋 เขียนแบบ Proposal",
  "🏛️ ขออนุญาตก่อสร้าง",
  "🏗️ เขียนแบบก่อสร้าง",
  "🏁 As-Built Drawing",
  "📁 อื่นๆ",
];

const categoryMeta = {
  "General Drawing": { label: "General", short: "GE", className: "age" },
  "Architectural Drawing": { label: "Architectural", short: "A", className: "aa" },
  "Structural Drawing": { label: "Structural", short: "S", className: "ac" },
  "Electrical Drawing": { label: "Electrical", short: "E", className: "ae" },
  "Mechanical Drawing": { label: "Mechanical", short: "M", className: "am" },
};

// หมวด Drawing พิเศษ — แสดงเพิ่มเติมเฉพาะตอนสร้าง/แก้ไขโครงการขณะเลือกประเภทคำร้อง "ขออนุญาตก่อสร้าง"
const PERMIT_REQUEST_TYPE = "🏛️ ขออนุญาตก่อสร้าง";
const permitCategoryMeta = {
  "ขออนุญาต อ.1": { label: "ขออนุญาต อ.1", short: "อ1", className: "ap1" },
  "ขออนุญาต PEA/MEA": { label: "ขออนุญาต PEA/MEA", short: "PM", className: "ap2" },
  "ขออนุญาต กกพ/พค.2": { label: "ขออนุญาต กกพ/พค.2", short: "กพ", className: "ap3" },
  "ขออนุญาต COP/รง.4": { label: "ขออนุญาต COP/รง.4", short: "รง", className: "ap4" },
  "อื่นๆ (ขออนุญาต)": { label: "อื่นๆ (ระบุรายละเอียด)", short: "อ", className: "ap5" },
};

let selectedProjectName = "";
let pendingDrawingEdits = new Map(); // itemId -> { no, name } — แก้ไข Drawing เดิมหลายรายการสลับกันใน popup เพิ่ม/แก้โครงการ
let selectedDrawings = []; // [{ key, no, name, category, prevRev }]
let drawingDetails = {};   // key -> { dueDate, priority, description, referenceLink, files, newRev }
let activeCategory = "";

export function renderSubmit(view) {
  document.querySelectorAll("body > #project-options").forEach((menu) => menu.remove());
  selectedProjectName = "";
  selectedDrawings = [];
  drawingDetails = {};
  activeCategory = "";

  view.innerHTML = `
    <form id="drawing-submit-form" class="submit-flow">
      <section class="content-section submit-card submit-project-card">
        <div class="submit-kicker">ระบบจัดการงานออกแบบ Solar PV / รายละเอียดโครงการ</div>
        <div class="card-header-line">ข้อมูลโครงการ</div>
        <div class="submit-project-grid">
          <div class="field request-type-field">
            <span>เลือกประเภท <b class="req">*</b></span>
            <div class="request-type-options">
              ${REQUEST_TYPES.map((type) => `
                <label class="request-type-check">
                  <input type="radio" name="requestType" value="${escapeHtml(type)}" />
                  <span>${escapeHtml(type)}</span>
                </label>
              `).join("")}
            </div>
          </div>
          <div class="field project-select-field submit-project-field-hidden" id="project-select-wrapper">
            <span>ชื่อโครงการ <b class="req">*</b></span>
            <div class="project-picker">
              <div class="combo" id="project-combo">
                <span class="combo-icon">⌕</span>
                <input id="project-search" type="text" autocomplete="off" placeholder="พิมพ์ค้นหาหรือเลือกโครงการ..." />
                <button id="project-clear" class="combo-clear" type="button" hidden>×</button>
                <span class="combo-caret">▾</span>
                <div id="project-options" class="combo-menu"></div>
              </div>
              <div class="project-actions">
                <button id="add-project" class="primary-button small-flow-button" type="button">+ โครงการใหม่</button>
              </div>
            </div>
            <div id="project-info" class="project-info"></div>
          </div>
        </div>
      </section>

      <section class="content-section submit-card submit-drawing-card submit-section-hidden" id="drawing-section">
        <div class="card-header-line">รายการ Drawing - เลือกได้หลายรายการ</div>
        <div id="drawing-category-row" class="category-row request-category-row" hidden></div>
        <div id="drawing-list" class="drawing-list-empty">เลือกโครงการก่อน เพื่อดูรายการ Drawing</div>
      </section>

      <section class="content-section submit-card submit-queue-card submit-section-hidden" id="queue-section">
        <div class="card-header-line">รายการที่จะส่ง</div>
        <div id="selected-drawing-queue" class="selected-drawing-empty">ติ๊ก Drawing อย่างน้อย 1 รายการ เพื่อกรอกรายละเอียดรายชีท</div>
        <div class="submit-area">
          <button id="reset-submit" class="secondary-button" type="button">ล้างข้อมูล</button>
          <button class="primary-button" type="submit">✓ ส่งทั้งหมด</button>
        </div>
      </section>
    </form>
  `;

  bindSubmitFlow(view);
}

function bindSubmitFlow(view) {
  const form = view.querySelector("#drawing-submit-form");
  const search = view.querySelector("#project-search");
  const menu = view.querySelector("#project-options");
  document.body.appendChild(menu);

  search.addEventListener("focus", () => renderProjectOptions(view));
  search.addEventListener("click", () => renderProjectOptions(view));
  search.addEventListener("input", () => renderProjectOptions(view));
  window.addEventListener("resize", () => positionProjectMenu(view));
  window.addEventListener("scroll", () => positionProjectMenu(view), true);
  view.querySelector("#project-clear").addEventListener("click", () => clearProject(view));
  view.querySelector("#add-project").addEventListener("click", () => {
    const checkedType = view.querySelector("#drawing-submit-form input[name='requestType']:checked")?.value || "";
    openAddProjectModal(view, checkedType, selectedProjectName);
  });
  view.querySelector("#reset-submit").addEventListener("click", () => renderSubmit(view));

  view.querySelectorAll("input[name='requestType']").forEach((radio) => {
    radio.addEventListener("change", () => {
      selectedDrawings = [];
      drawingDetails = {};
      activeCategory = "";
      renderDrawingArea(view);
      renderSelectedDrawingQueue(view);

      // โชว์ section โครงการ, Drawing, และรายการที่จะส่ง เมื่อเลือกประเภทงานแล้ว
      const projectWrapper = view.querySelector("#project-select-wrapper");
      const drawingSection = view.querySelector("#drawing-section");
      const queueSection = view.querySelector("#queue-section");
      [projectWrapper, drawingSection, queueSection].forEach((el) => {
        if (el) {
          el.classList.remove("submit-project-field-hidden", "submit-section-hidden");
          el.classList.add("submit-section-visible");
        }
      });
    });
  });

  document.addEventListener("click", function closeMenu(event) {
    if (!view.isConnected) {
      document.removeEventListener("click", closeMenu);
      return;
    }
    if (!view.querySelector(".project-picker")?.contains(event.target) && !menu.contains(event.target)) closeProjectMenu(view);
  });

  let _submitLock = false;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (_submitLock) return; // ป้องกันกด submit ซ้ำตอนเน็ตช้า
    if (!getSelectedRequestType(form)) {
      showToast("กรุณาเลือกประเภทคำร้อง", "warning");
      return;
    }
    if (!selectedProjectName) {
      showToast("กรุณาเลือกโครงการก่อนส่งงาน", "warning");
      return;
    }
    if (!selectedDrawings.length) {
      showToast("กรุณาเลือก Drawing อย่างน้อย 1 รายการก่อนส่งงาน", "warning");
      return;
    }
    if (!validateSelectedDrawingDetails()) {
      showToast("กรุณากรอกวันที่ต้องการรับงานให้ครบทุกรายการ", "warning");
      return;
    }
    _submitLock = true;
    openConfirmSubmit(view, form, () => { _submitLock = false; });
  });
}

// ══════════════════════════════════════════════════════════════
// PROJECT PICKER — เชื่อม state.masterData.projects (SharePoint ProjectList จริง)
// ══════════════════════════════════════════════════════════════

function getProjects() {
  return (state.masterData.projects || []).filter((project) => !project.IsHidden);
}

function renderProjectOptions(view) {
  const query = view.querySelector("#project-search").value.toLowerCase().trim();
  const menu = getProjectMenu(view);
  const filtered = getProjects().filter((project) => (project.Title || "").toLowerCase().includes(query));
  menu.innerHTML = filtered.length
    ? filtered.map((project) => `
      <button class="combo-option" data-project="${escapeHtml(project.Title)}" type="button">
        <strong>${escapeHtml(project.Title)}</strong>
        <small>${escapeHtml(project.DefaultKwp || project.SolarKwp || "")}</small>
      </button>
    `).join("")
    : `<div class="combo-empty">ไม่พบโครงการ — กด “+ โครงการใหม่” เพื่อสร้าง</div>`;
  openProjectMenu(view);

  menu.querySelectorAll("[data-project]").forEach((option) => {
    option.addEventListener("click", () => pickProject(view, option.dataset.project));
  });
}

function getProjectMenu(view) {
  return document.querySelector("body > #project-options") || view.querySelector("#project-options");
}

function openProjectMenu(view) {
  const menu = getProjectMenu(view);
  const form = view.querySelector("#drawing-submit-form");
  if (!menu || !form) return;
  menu.classList.add("open");
  positionProjectMenu(view);
}

function closeProjectMenu(view) {
  getProjectMenu(view)?.classList.remove("open");
}

function positionProjectMenu(view) {
  const combo = view.querySelector("#project-combo");
  const menu = getProjectMenu(view);
  if (!combo || !menu?.classList.contains("open")) return;
  const rect = combo.getBoundingClientRect();
  menu.style.left = `${Math.round(rect.left)}px`;
  menu.style.top = `${Math.round(rect.bottom + 6)}px`;
  menu.style.width = `${Math.round(rect.width)}px`;
}

function pickProject(view, projectName) {
  selectedProjectName = projectName;
  selectedDrawings = [];
  drawingDetails = {};
  activeCategory = "";
  view.querySelector("#project-search").value = projectName;
  view.querySelector("#project-clear").hidden = false;
  closeProjectMenu(view);
  updateAddProjectButtonText(view);

  const project = getProjects().find((item) => item.Title === projectName);
  const kwp = project?.DefaultKwp || project?.SolarKwp || "—";
  const location = project?.DefaultLocation || "";
  view.querySelector("#project-info").innerHTML = `
    <div><span>ขนาด Solar</span><strong>${escapeHtml(kwp)}</strong></div>
    ${location ? `<div><span>ที่ตั้งโครงการ</span><a href="${escapeHtml(location)}" target="_blank" rel="noreferrer">เปิดแผนที่ 📍</a></div>` : ""}
  `;
  view.querySelector("#project-info").classList.add("show");
  renderDrawingArea(view);
  renderSelectedDrawingQueue(view);
}

function clearProject(view) {
  selectedProjectName = "";
  selectedDrawings = [];
  drawingDetails = {};
  activeCategory = "";
  view.querySelector("#project-search").value = "";
  view.querySelector("#project-clear").hidden = true;
  view.querySelector("#project-info").classList.remove("show");
  view.querySelector("#project-info").innerHTML = "";
  updateAddProjectButtonText(view);
  renderDrawingArea(view);
  renderSelectedDrawingQueue(view);
}

/**
 * เปลี่ยนข้อความปุ่ม "+ โครงการใหม่" เป็น "✏️ แก้ไขโครงการ" เมื่อมีการเลือกโครงการที่มีอยู่แล้ว
 * เพราะตอนนี้กดปุ่มนี้จะเปิด popup ในโหมดแก้ไขโครงการเดิม ไม่ใช่สร้างใหม่
 */
function updateAddProjectButtonText(view) {
  const button = view.querySelector("#add-project");
  if (!button) return;
  const isExisting = selectedProjectName && getProjects().some((p) => p.Title === selectedProjectName);
  button.textContent = isExisting ? "✏️ แก้ไขโครงการ" : "+ โครงการใหม่";
}

// ══════════════════════════════════════════════════════════════
// DRAWING NUMBER LIST — เชื่อม state.masterData.drawingNumbers จริง
// ══════════════════════════════════════════════════════════════

function getDrawingsForProject(projectName) {
  return (state.masterData.drawingNumbers || [])
    .filter((item) => !item.IsHidden)
    .filter((item) => !projectName || item.ProjectName === projectName);
}

function getAvailableCategories(projectName) {
  const drawings = getDrawingsForProject(projectName);
  return [...new Set(drawings.map((item) => item.DrawingCategory).filter(Boolean))];
}

function renderDrawingArea(view) {
  const form = view.querySelector("#drawing-submit-form");
  const requestType = getSelectedRequestType(form);
  const categoryRow = view.querySelector("#drawing-category-row");
  const listEl = view.querySelector("#drawing-list");

  if (!selectedProjectName) {
    categoryRow.hidden = true;
    listEl.innerHTML = `<p class="drawing-list-empty">เลือกโครงการก่อน เพื่อดูรายการ Drawing</p>`;
    return;
  }
  if (!requestType) {
    categoryRow.hidden = true;
    listEl.innerHTML = `<p class="drawing-list-empty">เลือกประเภทคำร้องก่อน เพื่อดูรายการ Drawing</p>`;
    return;
  }

  const categories = getAvailableCategories(selectedProjectName);
  if (!categories.length) {
    categoryRow.hidden = true;
    listEl.innerHTML = `<p class="drawing-list-empty">ยังไม่มี Drawing ในโครงการนี้ — กด “+ โครงการใหม่” เพื่อเพิ่ม Drawing</p>`;
    return;
  }

  if (!activeCategory || !categories.includes(activeCategory)) activeCategory = "";
  categoryRow.hidden = false;
  categoryRow.innerHTML = categories.map((category) => {
    const meta = categoryMeta[category] || { label: category, short: category.slice(0, 2).toUpperCase(), className: "ao" };
    const count = getDrawingsForProject(selectedProjectName).filter((item) => item.DrawingCategory === category).length;
    const isActive = activeCategory === category;
    return `
      <button class="category-pill ${isActive ? meta.className : ""}" data-category="${escapeHtml(category)}" type="button">
        <b class="doc-badge ${meta.className}">${escapeHtml(meta.short)}</b>
        <span>${escapeHtml(meta.label)}</span>
        <small>${count} รายการ</small>
      </button>
    `;
  }).join("");

  categoryRow.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      activeCategory = button.dataset.category;
      renderDrawingArea(view);
    });
  });

  if (!activeCategory) {
    listEl.innerHTML = `<p class="drawing-list-empty">เลือกหมวดด้านบน เพื่อแสดงรายการ Drawing</p>`;
    return;
  }

  const drawings = getDrawingsForProject(selectedProjectName).filter((item) => item.DrawingCategory === activeCategory);
  const meta = categoryMeta[activeCategory] || { short: "?", className: "ao" };

  listEl.innerHTML = `
    <section class="drawing-category-group">
      <div class="drawing-head">
        <span></span><span>Drawing No.</span><span>Drawing Name</span><span>Revise ก่อนหน้า</span><span>Revise ใหม่</span>
      </div>
      ${drawings.map((doc) => {
        const key = doc.id;
        const isSelected = selectedDrawings.some((item) => item.key === key);
        const prevRev = getPreviousRevision(doc.Title);
        return `
          <label class="drawing-row ${isSelected ? "selected" : ""}">
            <input type="checkbox" data-drawing-key="${escapeHtml(key)}" ${isSelected ? "checked" : ""} />
            <span class="drawing-code"><b class="doc-badge ${meta.className}">${meta.short}</b>${escapeHtml(doc.Title || "—")}</span>
            <span>${escapeHtml(doc.DrawingName || "—")}</span>
            <span class="rev-prev">${escapeHtml(prevRev)}</span>
            <input class="rev-new" data-rev-key="${escapeHtml(key)}" type="text" placeholder="-" value="${escapeHtml(drawingDetails[key]?.newRev || "")}" ${isSelected ? "" : "disabled"} />
          </label>
        `;
      }).join("")}
    </section>
  `;

  listEl.querySelectorAll("[data-drawing-key]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const key = checkbox.dataset.drawingKey;
      const doc = drawings.find((item) => item.id === key);
      toggleDrawingSelection(key, doc, activeCategory);
      renderDrawingArea(view);
      renderSelectedDrawingQueue(view);
    });
  });

  listEl.querySelectorAll("[data-rev-key]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.revKey;
      if (!drawingDetails[key]) drawingDetails[key] = {};
      drawingDetails[key].newRev = input.value.trim();
      const queueInput = document.querySelector(`[data-queue-revnew="${key}"]`);
      if (queueInput) queueInput.value = input.value.trim();
    });
  });
}

function getPreviousRevision(drawingNo) {
  const hits = (state.requests || [])
    .filter((item) => item.drawingNo === drawingNo)
    .sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
  return hits.length ? (hits[0].reviseNumber || hits[0].currentRevise || "0") : "0";
}

function toggleDrawingSelection(key, doc, category) {
  const exists = selectedDrawings.some((item) => item.key === key);
  if (!exists) {
    selectedDrawings.push({
      key,
      no: doc.Title || "",
      name: doc.DrawingName || "",
      category,
      prevRev: getPreviousRevision(doc.Title),
    });
    if (!drawingDetails[key]) {
      drawingDetails[key] = { dueDate: "", priority: "ปกติ", description: "", referenceLink: "", files: [], newRev: "" };
    }
  } else {
    selectedDrawings = selectedDrawings.filter((item) => item.key !== key);
    delete drawingDetails[key];
  }
}

// ══════════════════════════════════════════════════════════════
// QUEUE — รายการที่จะส่ง (หลาย Drawing พร้อมกัน)
// ══════════════════════════════════════════════════════════════

function getDetail(key) {
  return drawingDetails[key] || { dueDate: "", priority: "ปกติ", description: "", referenceLink: "", files: [], newRev: "" };
}

function validateSelectedDrawingDetails() {
  return selectedDrawings.every((item) => getDetail(item.key).dueDate);
}

function renderSelectedDrawingQueue(view) {
  const target = view.querySelector("#selected-drawing-queue");
  if (!target) return;
  if (!selectedDrawings.length) {
    target.className = "selected-drawing-empty";
    target.innerHTML = "ติ๊ก Drawing อย่างน้อย 1 รายการ เพื่อกรอกรายละเอียดรายชีท";
    return;
  }

  target.className = "selected-drawing-list";
  target.innerHTML = selectedDrawings.map((item, index) => {
    const detail = getDetail(item.key);
    const meta = categoryMeta[item.category] || { short: "?", className: "ao" };
    return `
      <article class="selected-drawing-card" data-selected-drawing="${escapeHtml(item.key)}">
        <div class="selected-drawing-title">
          <span class="auto-request-no">เลขที่คำร้อง: อัตโนมัติ-${String(index + 1).padStart(2, "0")}</span>
          <div>
            <strong><b class="doc-badge ${meta.className}">${meta.short}</b>${escapeHtml(item.no)}</strong>
            <small>${escapeHtml(item.name)} · Rev ${escapeHtml(item.prevRev)} → ${escapeHtml(detail.newRev || "—")}</small>
          </div>
          <button class="icon-button remove-selected-drawing" type="button" data-remove-selected="${escapeHtml(item.key)}" aria-label="Remove">×</button>
        </div>
        <div class="selected-drawing-main-fields">
          <label class="field">
            <span>วันที่ต้องการรับงาน <b class="req">*</b></span>
            <input data-detail="dueDate" type="date" value="${escapeHtml(detail.dueDate)}" />
          </label>
          <label class="field">
            <span>ระดับความเร่งด่วน</span>
            <select data-detail="priority">
              <option value="ปกติ" ${detail.priority === "ปกติ" ? "selected" : ""}>ปกติ</option>
              <option value="เร่งด่วน" ${detail.priority === "เร่งด่วน" ? "selected" : ""}>เร่งด่วน</option>
              <option value="เร่งด่วนมาก" ${detail.priority === "เร่งด่วนมาก" ? "selected" : ""}>เร่งด่วนมาก</option>
            </select>
          </label>
          <label class="field">
            <span>รายละเอียดเพิ่มเติม</span>
            <input data-detail="description" type="text" placeholder="รายละเอียดเฉพาะ Drawing นี้..." value="${escapeHtml(detail.description)}" />
          </label>
        </div>
        <div class="selected-drawing-source-fields">
          <label class="field">
            <span>แนบลิงก์ข้อมูล <small>ถ้ามี</small></span>
            <input data-detail="referenceLink" type="text" placeholder="Google Drive, OneDrive, SharePoint..." value="${escapeHtml(detail.referenceLink)}" />
          </label>
          <span class="attachment-or">หรือ</span>
          <label class="drawing-file-drop ${detail.files?.length ? "has-files" : ""}" data-file-drop="${escapeHtml(item.key)}">
            <input data-detail="files" type="file" multiple accept=".pdf,.dwg,.dxf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip" />
            <span class="drawing-file-drop-icon">⇧</span>
            <span class="drawing-file-drop-copy">
              <strong>${detail.files?.length ? `${detail.files.length} ไฟล์` : "ลากไฟล์มาวาง หรือคลิกเลือก"}</strong>
              <small>${detail.files?.length ? escapeHtml(detail.files.map((file) => file.name).join(", ")) : "PDF, DWG, Office, รูปภาพ หรือ ZIP"}</small>
            </span>
          </label>
        </div>
      </article>
    `;
  }).join("");

  target.querySelectorAll("[data-detail]").forEach((input) => {
    input.addEventListener("input", () => syncDetailFromQueue(input));
    input.addEventListener("change", () => syncDetailFromQueue(input));
  });

  target.querySelectorAll("[data-remove-selected]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.removeSelected;
      selectedDrawings = selectedDrawings.filter((item) => item.key !== key);
      delete drawingDetails[key];
      renderDrawingArea(view);
      renderSelectedDrawingQueue(view);
    });
  });

  target.querySelectorAll("[data-file-drop]").forEach((dropZone) => {
    const input = dropZone.querySelector("input[type='file']");
    const key = dropZone.dataset.fileDrop;
    const saveFiles = (files) => {
      if (!drawingDetails[key]) drawingDetails[key] = {};
      drawingDetails[key].files = Array.from(files || []);
      renderSelectedDrawingQueue(view);
    };
    input.addEventListener("change", () => saveFiles(input.files));
    dropZone.addEventListener("dragover", (event) => { event.preventDefault(); dropZone.classList.add("is-dragging"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("is-dragging"));
    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropZone.classList.remove("is-dragging");
      saveFiles(event.dataTransfer?.files);
    });
  });
}

function syncDetailFromQueue(input) {
  const card = input.closest("[data-selected-drawing]");
  const key = card?.dataset.selectedDrawing;
  if (!key) return;
  if (!drawingDetails[key]) drawingDetails[key] = {};
  drawingDetails[key][input.dataset.detail] = input.value;
}

// ══════════════════════════════════════════════════════════════
// SUBMIT — confirm modal → createRequest() ทีละรายการ
// ══════════════════════════════════════════════════════════════

function openConfirmSubmit(view, form, onModalClose) {
  const requestType = getSelectedRequestType(form);
  const body = `
    <div class="confirm-stack">
      ${confirmRow("ประเภทคำร้อง", requestType)}
      ${confirmRow("ชื่อโครงการ", selectedProjectName)}
      ${confirmRow("จำนวนคำร้องที่จะสร้าง", `${selectedDrawings.length} Drawing`)}
      <div class="confirm-batch-list">
        ${selectedDrawings.map((item, index) => {
          const detail = getDetail(item.key);
          return `
            <article>
              <b>เลขที่คำร้อง: อัตโนมัติ-${String(index + 1).padStart(2, "0")} · ${escapeHtml(item.no)}</b>
              <span>${escapeHtml(item.name)}</span>
              <small>Rev ${escapeHtml(item.prevRev)} → ${escapeHtml(detail.newRev || "-")} · ${escapeHtml(detail.dueDate)} · ${escapeHtml(detail.priority)} · ${detail.files?.length || 0} ไฟล์</small>
            </article>
          `;
        }).join("")}
      </div>
    </div>
  `;

  openModal({
    title: "ยืนยันการส่งงาน",
    body,
    onClose: onModalClose,
    actions: [
      { label: "แก้ไข", className: "secondary-button" },
      {
        label: "✓ ยืนยันส่งงาน",
        className: "primary-button",
        onClick: async (close) => {
          await submitConfirmed(view, form);
          close();
        },
      },
    ],
  });
}

async function submitConfirmed(view, form) {
  const requestType = getSelectedRequestType(form);
  const project = getProjects().find((item) => item.Title === selectedProjectName);
  const created = [];

  for (const item of selectedDrawings) {
    const detail = getDetail(item.key);
    try {
      const request = await createRequest({
        requestType,
        projectName: selectedProjectName,
        projectCode: selectedProjectName,
        drawingNo: item.no,
        drawingName: item.name,
        drawingCategory: item.category,
        kwp: project?.DefaultKwp || project?.SolarKwp || "",
        priority: detail.priority,
        dueDate: detail.dueDate,
        reviseNumber: detail.newRev || "",
        dataLink: detail.referenceLink || "",
        description: detail.description || "",
      }, detail.files || []);
      created.push(request);
    } catch (error) {
      showToast(`ส่งคำร้อง ${item.no} ไม่สำเร็จ: ${error.message}`, "error");
    }
  }

  if (created.length) {
    showToast(`ส่งงานสำเร็จ ${created.length} รายการ`, "success");
    location.hash = "#/track";
  }
}

function getSelectedRequestType(form) {
  return new FormData(form).get("requestType") || "";
}

function confirmRow(label, value) {
  return `<div class="confirm-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

// ══════════════════════════════════════════════════════════════
// ADD PROJECT MODAL — เขียนลง SharePoint ProjectList + DrawingNumberList จริง
// ══════════════════════════════════════════════════════════════

function openAddProjectModal(view, requestType = "", prefilledProjectName = "") {
  const isPermitFlow = requestType === PERMIT_REQUEST_TYPE;
  const effectiveCategories = isPermitFlow
    ? { ...categoryMeta, ...permitCategoryMeta }
    : categoryMeta;
  const isEditMode = prefilledProjectName && getProjects().some((p) => p.Title === prefilledProjectName);

  const body = `
    <form id="new-project-form" class="new-project-form">
      <label class="field">
        <span>ชื่อโครงการ <b class="req">*</b></span>
        <input id="new-project-name" name="name" type="text" list="existing-project-list" autocomplete="off" required placeholder="พิมพ์ชื่อโครงการใหม่ หรือเลือกโครงการเดิม..." value="${escapeHtml(prefilledProjectName)}" />
        <datalist id="existing-project-list">
          ${getProjects().map((project) => `<option value="${escapeHtml(project.Title)}"></option>`).join("")}
        </datalist>
      </label>

      <div id="existing-project-note" class="existing-project-note" hidden>
        ℹ️ พบโครงการนี้ในระบบแล้ว — กำลังแก้ไขข้อมูลโครงการเดิม ไม่ใช่สร้างใหม่
      </div>

      ${isPermitFlow ? `<div class="permit-flow-note">🏛️ กำลังเพิ่ม Drawing สำหรับคำร้อง "ขออนุญาตก่อสร้าง" — มีหมวดขออนุญาตเพิ่มเติมให้เลือกด้านล่าง</div>` : ""}

      <div class="form-grid">
        <label class="field"><span>ขนาด Solar (kWp)</span><input id="new-project-kwp" name="kwp" type="text" placeholder="500" /></label>
        <label class="field"><span>Google Maps link</span><input id="new-project-location" name="location" type="text" /></label>
      </div>

      <div id="existing-drawings-block" class="existing-drawings-block" hidden>
        <span class="new-doc-picker-title">Drawing ที่มีอยู่แล้วในโครงการนี้</span>
        <div class="existing-drawing-picker">
          <select id="existing-drawing-category-select" class="existing-drawing-select"></select>
          <select id="existing-drawing-item-select" class="existing-drawing-select"></select>
          <button id="existing-drawing-edit-btn" class="small-button" type="button" disabled>✏️ แก้ไข</button>
        </div>
        <div id="existing-drawing-edit-box" class="existing-drawing-edit-box" hidden></div>
      </div>

      <div class="new-doc-picker">
        <span>เพิ่ม Drawing ใหม่ (เลือกได้หลายหมวด หลายแถว — ไม่บังคับ)</span>
        <div id="new-drawing-categories" class="new-drawing-categories">
          ${Object.keys(effectiveCategories).map((key) => newDrawingCategoryBlock(key, effectiveCategories)).join("")}
        </div>
      </div>
    </form>
  `;

  openModal({
    title: isEditMode ? "แก้ไขโครงการ" : "เพิ่มโครงการใหม่",
    body,
    actions: [
      { label: "ยกเลิก", className: "secondary-button" },
      {
        label: isEditMode ? "บันทึกการแก้ไข" : "บันทึกโครงการ",
        className: "primary-button",
        onClick: async (close) => {
          const form = document.querySelector("#new-project-form");
          if (!form.reportValidity()) return;
          const data = serializeForm(form);
          const isExisting = getProjects().some((project) => project.Title === data.name);

          // เก็บแถว Drawing ใหม่ทั้งหมดจากทุกหมวด (รวมหมวดขออนุญาตพิเศษถ้าอยู่ในโหมด permit)
          const newDrawings = [];
          Object.keys(effectiveCategories).forEach((category) => {
            document.querySelectorAll(`[data-drawing-row][data-category="${cssEscapeAttr(category)}"]`).forEach((row) => {
              const no = row.querySelector("[data-row-no]")?.value.trim();
              const name = row.querySelector("[data-row-name]")?.value.trim();
              if (no) newDrawings.push({ category, no, name: name || "" });
            });
          });

          // หมวด "อื่นๆ (ขออนุญาต)" ใส่รายละเอียดได้แม้ไม่กรอก Drawing No. — ใช้ค่าจาก textarea แทน
          const permitOtherDetail = document.querySelector('[data-permit-other-for="อื่นๆ (ขออนุญาต)"]')?.value.trim();
          if (isPermitFlow && permitOtherDetail) {
            const hasOtherRow = newDrawings.some((d) => d.category === "อื่นๆ (ขออนุญาต)");
            if (!hasOtherRow) {
              newDrawings.push({ category: "อื่นๆ (ขออนุญาต)", no: "OTHER", name: permitOtherDetail });
            }
          }

          // ── ตรวจสอบ Drawing No. ซ้ำกับที่มีในโครงการนี้ ก่อนบันทึก ──
          const existingNosInProject = (state.masterData.drawingNumbers || [])
            .filter((d) => !d.IsHidden && (d.ProjectName || "").toLowerCase() === data.name.toLowerCase())
            .map((d) => (d.Title || "").trim().toLowerCase());

          // ตรวจซ้ำในแถวที่กรอกใหม่ด้วยกันเอง (เช่น กรอก GE-001 สองแถว)
          const newNosLower = newDrawings
            .filter((d) => d.no !== "OTHER")
            .map((d) => d.no.trim().toLowerCase());
          const hasDupAmongNew = newNosLower.some((no, idx) => newNosLower.indexOf(no) !== idx);

          const dupWithExisting = newDrawings
            .filter((d) => d.no !== "OTHER")
            .filter((d) => existingNosInProject.includes(d.no.trim().toLowerCase()));

          if (hasDupAmongNew || dupWithExisting.length) {
            const dupList = [
              ...dupWithExisting.map((d) => `"${d.no}" (มีในโครงการอยู่แล้ว)`),
              ...(hasDupAmongNew ? ["มี Drawing No. ที่กรอกซ้ำกันในแถวที่เพิ่มใหม่"] : []),
            ];
            showToast(`ไม่สามารถบันทึกได้: ${dupList.join(", ")}`, "error");
            // ไฮไลต์แถวที่ซ้ำ
            document.querySelectorAll("[data-drawing-row] [data-row-no]").forEach((inp) => {
              const v = (inp.value || "").trim().toLowerCase();
              if (v && existingNosInProject.includes(v)) {
                inp.classList.add("is-error");
                if (!inp.closest(".new-drawing-row")?.querySelector(".dup-warning")) {
                  const warn = document.createElement("span");
                  warn.className = "dup-warning";
                  warn.textContent = `⚠️ "${inp.value.trim()}" มีอยู่แล้ว`;
                  inp.closest(".new-drawing-row")?.appendChild(warn);
                }
              }
            });
            return; // หยุด ไม่บันทึก
          }

          // เก็บการแก้ไข Drawing เดิม — รวมทั้งแถวที่เปิดอยู่ตอนนี้ และค่าที่เก็บไว้ตอนสลับดูรายการอื่นก่อนหน้า
          const editedMap = new Map(pendingDrawingEdits);
          document.querySelectorAll("[data-existing-drawing-row]").forEach((row) => {
            const itemId = row.dataset.existingDrawingRow;
            const no = row.querySelector("[data-existing-no]")?.value.trim() || "";
            const name = row.querySelector("[data-existing-name]")?.value.trim() || "";
            editedMap.set(itemId, { no, name });
          });
          const editedDrawings = [];
          editedMap.forEach((value, itemId) => {
            const original = state.masterData.drawingNumbers.find((d) => String(d.id) === String(itemId));
            if (!original) return;
            if (value.no !== (original.Title || "") || value.name !== (original.DrawingName || "")) {
              editedDrawings.push({ itemId, no: value.no, name: value.name });
            }
          });

          try {
            if (!isExisting) {
              await addItem(lists.projects, {
                Title: data.name,
                DefaultKwp: data.kwp ? `${data.kwp} kWp` : "",
                SolarKwp: data.kwp ? `${data.kwp} kWp` : "",
                DefaultLocation: data.location || "",
              });
              state.masterData.projects.push({ Title: data.name, DefaultKwp: data.kwp ? `${data.kwp} kWp` : "", DefaultLocation: data.location || "" });
            } else {
              const project = getProjects().find((p) => p.Title === data.name);
              if (project?.id) {
                await patchItem(lists.projects, project.id, {
                  DefaultKwp: data.kwp ? `${data.kwp} kWp` : "",
                  SolarKwp: data.kwp ? `${data.kwp} kWp` : "",
                  DefaultLocation: data.location || "",
                });
                project.DefaultKwp = data.kwp ? `${data.kwp} kWp` : "";
                project.SolarKwp = project.DefaultKwp;
                project.DefaultLocation = data.location || "";
              }
            }

            for (const edit of editedDrawings) {
              await patchItem(lists.drawingNumbers, edit.itemId, {
                Title: edit.no,
                DrawingName: edit.name,
              });
              const target = state.masterData.drawingNumbers.find((d) => String(d.id) === String(edit.itemId));
              if (target) { target.Title = edit.no; target.DrawingName = edit.name; }
            }

            for (const drawing of newDrawings) {
              await addItem(lists.drawingNumbers, {
                Title: drawing.no,
                ProjectName: data.name,
                DrawingCategory: drawing.category,
                DrawingName: drawing.name,
                IsHidden: false,
              });
              state.masterData.drawingNumbers.push({
                id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                Title: drawing.no,
                ProjectName: data.name,
                DrawingCategory: drawing.category,
                DrawingName: drawing.name,
              });
            }

            close();
            pickProject(view, data.name);
            const parts = [];
            if (!isExisting) parts.push(`เพิ่มโครงการ "${data.name}" แล้ว`);
            else parts.push(`บันทึกการแก้ไขโครงการ "${data.name}" แล้ว`);
            if (editedDrawings.length) parts.push(`แก้ไข Drawing ${editedDrawings.length} รายการ`);
            if (newDrawings.length) parts.push(`เพิ่ม Drawing ใหม่ ${newDrawings.length} รายการ`);
            showToast(parts.join(" — "), "success");
          } catch (error) {
            showToast(`บันทึกไม่สำเร็จ: ${error.message}`, "error");
          }
        },
      },
    ],
  });

  bindAddProjectModalEvents();
}

function newDrawingCategoryBlock(category, categorySource = categoryMeta) {
  const meta = categorySource[category];
  return `
    <div class="new-drawing-category" data-new-category="${escapeHtml(category)}">
      <div class="new-drawing-category-head">
        <b class="doc-badge ${meta.className}">${escapeHtml(meta.short)}</b>
        <span>${escapeHtml(meta.label)}</span>
        <button class="small-button" data-add-row="${escapeHtml(category)}" type="button">+ เพิ่มแถว</button>
      </div>
      <div class="new-drawing-rows" data-rows-for="${escapeHtml(category)}"></div>
      ${category === "อื่นๆ (ขออนุญาต)" ? `<textarea class="permit-other-detail" data-permit-other-for="${escapeHtml(category)}" rows="2" placeholder="ระบุรายละเอียดประเภทการขออนุญาตอื่นๆ..."></textarea>` : ""}
    </div>
  `;
}

function newDrawingRowHtml(category) {
  return `
    <div class="new-drawing-row" data-drawing-row data-category="${escapeHtml(category)}">
      <input type="text" placeholder="Drawing No. เช่น E001-SLD" data-row-no />
      <input type="text" placeholder="Drawing Name เช่น Single Line Diagram" data-row-name />
      <button class="icon-button" data-remove-row type="button" aria-label="ลบแถว">×</button>
    </div>
  `;
}

function bindAddProjectModalEvents() {
  const nameInput = document.querySelector("#new-project-name");
  const kwpInput = document.querySelector("#new-project-kwp");
  const locationInput = document.querySelector("#new-project-location");
  const existingNote = document.querySelector("#existing-project-note");
  const existingBlock = document.querySelector("#existing-drawings-block");
  const categorySelect = document.querySelector("#existing-drawing-category-select");
  const itemSelect = document.querySelector("#existing-drawing-item-select");
  const editButton = document.querySelector("#existing-drawing-edit-btn");
  const editBox = document.querySelector("#existing-drawing-edit-box");
  const saveButton = document.querySelector(".modal footer .primary-button");

  let currentDrawings = []; // Drawing ทั้งหมดของโครงการที่กำลังแก้ไข
  pendingDrawingEdits = new Map(); // รีเซ็ตทุกครั้งที่เปิด popup ใหม่

  const saveCurrentEditBoxIfAny = () => {
    const row = editBox.querySelector("[data-existing-drawing-row]");
    if (!row) return;
    const itemId = row.dataset.existingDrawingRow;
    const no = row.querySelector("[data-existing-no]")?.value.trim() || "";
    const name = row.querySelector("[data-existing-name]")?.value.trim() || "";
    pendingDrawingEdits.set(itemId, { no, name });
  };

  const renderItemOptions = () => {
    const cat = categorySelect.value;
    const items = currentDrawings.filter((d) => (d.DrawingCategory || "อื่นๆ") === cat);
    itemSelect.innerHTML = items
      .map((d) => `<option value="${escapeHtml(String(d.id))}">${escapeHtml(d.Title || "(ไม่มีเลข)")} — ${escapeHtml(d.DrawingName || "ไม่มีชื่อ")}</option>`)
      .join("");
    editButton.disabled = items.length === 0;
    editBox.hidden = true;
    editBox.innerHTML = "";
  };

  categorySelect?.addEventListener("change", () => {
    saveCurrentEditBoxIfAny();
    renderItemOptions();
  });

  itemSelect?.addEventListener("change", () => {
    saveCurrentEditBoxIfAny();
    editBox.hidden = true;
    editBox.innerHTML = "";
  });

  editButton?.addEventListener("click", () => {
    const itemId = itemSelect.value;
    const drawing = currentDrawings.find((d) => String(d.id) === String(itemId));
    if (!drawing) return;
    const pending = pendingDrawingEdits.get(itemId);
    const noValue = pending ? pending.no : (drawing.Title || "");
    const nameValue = pending ? pending.name : (drawing.DrawingName || "");
    editBox.hidden = false;
    editBox.innerHTML = `
      <div class="existing-drawing-row" data-existing-drawing-row="${escapeHtml(String(drawing.id))}">
        <input type="text" value="${escapeHtml(noValue)}" data-existing-no placeholder="Drawing No." />
        <input type="text" value="${escapeHtml(nameValue)}" data-existing-name placeholder="Drawing Name" />
      </div>
    `;
  });

  const syncProjectModeFromName = () => {
    const project = getProjects().find((item) => item.Title === nameInput.value);
    if (!project) {
      existingNote.hidden = true;
      existingBlock.hidden = true;
      if (saveButton) saveButton.textContent = "บันทึกโครงการ";
      return;
    }

    existingNote.hidden = false;
    if (saveButton) saveButton.textContent = "บันทึกการแก้ไข";
    kwpInput.value = (project.DefaultKwp || project.SolarKwp || "").replace(/\s*kWp\s*$/i, "");
    locationInput.value = project.DefaultLocation || "";

    currentDrawings = (state.masterData.drawingNumbers || []).filter(
      (item) => !item.IsHidden && item.ProjectName === project.Title
    );

    if (currentDrawings.length) {
      existingBlock.hidden = false;
      const categories = [...new Set(currentDrawings.map((d) => d.DrawingCategory || "อื่นๆ"))];
      categorySelect.innerHTML = categories
        .map((cat) => {
          const meta = categoryMeta[cat] || permitCategoryMeta[cat] || { label: cat };
          const count = currentDrawings.filter((d) => (d.DrawingCategory || "อื่นๆ") === cat).length;
          return `<option value="${escapeHtml(cat)}">${escapeHtml(meta.label)} (${count})</option>`;
        })
        .join("");
      renderItemOptions();
    } else {
      existingBlock.hidden = true;
      currentDrawings = [];
    }
  };

  nameInput?.addEventListener("input", syncProjectModeFromName);

  // ถ้าเปิด popup มาพร้อมชื่อโครงการเดิมอยู่แล้ว (กดจากช่องที่เลือกโครงการไว้แล้ว)
  // ให้เช็คโหมดแก้ไขทันที ไม่ต้องรอผู้ใช้พิมพ์ใหม่
  if (nameInput?.value) syncProjectModeFromName();

  document.querySelectorAll("[data-add-row]").forEach((button) => {
    button.addEventListener("click", () => {
      const category = button.dataset.addRow;
      const container = document.querySelector(`[data-rows-for="${cssEscapeAttr(category)}"]`);
      if (!container) return;
      const wrapper = document.createElement("div");
      wrapper.innerHTML = newDrawingRowHtml(category).trim();
      const row = wrapper.firstElementChild;
      container.appendChild(row);
      row.querySelector("[data-remove-row]").addEventListener("click", () => row.remove());

      // ── ตรวจสอบซ้ำ real-time ขณะพิมพ์ Drawing No. ──
      const noInput = row.querySelector("[data-row-no]");
      noInput?.addEventListener("input", () => checkDuplicateDrawingNo(noInput, nameInput?.value));
      noInput?.addEventListener("blur",  () => checkDuplicateDrawingNo(noInput, nameInput?.value));
      noInput?.focus();
    });
  });
}

/**
 * ตรวจสอบว่า Drawing No. ที่กรอกซ้ำกับที่มีในโครงการนี้หรือไม่
 * (เฉพาะโครงการที่เลือก — ต่างโครงการซ้ำกันได้)
 */
function checkDuplicateDrawingNo(noInput, projectName) {
  const val = (noInput.value || "").trim().toLowerCase();

  // ลบ warning เดิมออกก่อน
  noInput.closest(".new-drawing-row")?.querySelector(".dup-warning")?.remove();
  noInput.classList.remove("is-error");

  if (!val || !projectName) return;

  // Drawing ที่มีอยู่แล้วในโครงการนี้
  const existingNos = (state.masterData.drawingNumbers || [])
    .filter((d) => !d.IsHidden && (d.ProjectName || "").toLowerCase() === projectName.toLowerCase())
    .map((d) => (d.Title || "").trim().toLowerCase());

  // ตรวจสอบซ้ำกับแถวอื่นๆ ที่กรอกอยู่ใน popup เดียวกันด้วย
  const siblingNos = Array.from(
    document.querySelectorAll("[data-drawing-row] [data-row-no]")
  )
    .filter((el) => el !== noInput)
    .map((el) => (el.value || "").trim().toLowerCase())
    .filter(Boolean);

  const isDup = [...existingNos, ...siblingNos].includes(val);

  if (isDup) {
    noInput.classList.add("is-error");
    const warn = document.createElement("span");
    warn.className = "dup-warning";
    warn.textContent = `⚠️ "${noInput.value.trim()}" มีอยู่ในโครงการนี้แล้ว`;
    noInput.closest(".new-drawing-row")?.appendChild(warn);
  }
}

function cssEscapeAttr(value) {
  return String(value).replace(/"/g, '\\"');
}
