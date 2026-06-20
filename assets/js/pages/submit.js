import { lists } from "../../../config/schema.js";
import { openModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import { createRequest } from "../services/request-service.js";
import { addItem } from "../sharepoint.js";
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

let selectedProjectName = "";
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
          <div class="field project-select-field">
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

      <section class="content-section submit-card submit-drawing-card">
        <div class="card-header-line">รายการ Drawing - เลือกได้หลายรายการ</div>
        <div id="drawing-category-row" class="category-row request-category-row" hidden></div>
        <div id="drawing-list" class="drawing-list-empty">เลือกโครงการก่อน เพื่อดูรายการ Drawing</div>
      </section>

      <section class="content-section submit-card submit-queue-card">
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
  view.querySelector("#add-project").addEventListener("click", () => openAddProjectModal(view));
  view.querySelector("#reset-submit").addEventListener("click", () => renderSubmit(view));

  view.querySelectorAll("input[name='requestType']").forEach((radio) => {
    radio.addEventListener("change", () => {
      selectedDrawings = [];
      drawingDetails = {};
      activeCategory = "";
      renderDrawingArea(view);
      renderSelectedDrawingQueue(view);
    });
  });

  document.addEventListener("click", function closeMenu(event) {
    if (!view.isConnected) {
      document.removeEventListener("click", closeMenu);
      return;
    }
    if (!view.querySelector(".project-picker")?.contains(event.target) && !menu.contains(event.target)) closeProjectMenu(view);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
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
    openConfirmSubmit(view, form);
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
  renderDrawingArea(view);
  renderSelectedDrawingQueue(view);
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

function openConfirmSubmit(view, form) {
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

function openAddProjectModal(view) {
  const body = `
    <form id="new-project-form" class="new-project-form">
      <label class="field"><span>ชื่อโครงการ <b class="req">*</b></span><input name="name" type="text" required /></label>
      <div class="form-grid">
        <label class="field"><span>ขนาด Solar (kWp)</span><input name="kwp" type="text" placeholder="500" /></label>
        <label class="field"><span>Google Maps link</span><input name="location" type="text" /></label>
      </div>
      <div class="new-doc-picker">
        <span>เพิ่ม Drawing แรกของโครงการ (เพิ่มเพิ่มเติมได้ภายหลังจากหน้าส่งคำร้อง)</span>
        <div class="form-grid">
          <label class="field">
            <span>หมวด</span>
            <select name="category">
              ${Object.keys(categoryMeta).map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(categoryMeta[key].label)}</option>`).join("")}
            </select>
          </label>
          <label class="field"><span>Drawing No.</span><input name="drawingNo" type="text" placeholder="E001-SLD" /></label>
        </div>
        <label class="field"><span>Drawing Name</span><input name="drawingName" type="text" placeholder="Single Line Diagram" /></label>
      </div>
    </form>
  `;
  openModal({
    title: "เพิ่มโครงการใหม่",
    body,
    actions: [
      { label: "ยกเลิก", className: "secondary-button" },
      {
        label: "บันทึกโครงการ",
        className: "primary-button",
        onClick: async (close) => {
          const form = document.querySelector("#new-project-form");
          if (!form.reportValidity()) return;
          const data = serializeForm(form);
          try {
            await addItem(lists.projects, {
              Title: data.name,
              DefaultKwp: data.kwp ? `${data.kwp} kWp` : "",
              SolarKwp: data.kwp ? `${data.kwp} kWp` : "",
              DefaultLocation: data.location || "",
            });
            if (data.drawingNo) {
              await addItem(lists.drawingNumbers, {
                Title: data.drawingNo,
                ProjectName: data.name,
                DrawingCategory: data.category,
                DrawingName: data.drawingName || "",
                IsHidden: false,
              });
            }
            state.masterData.projects.push({ Title: data.name, DefaultKwp: data.kwp ? `${data.kwp} kWp` : "", DefaultLocation: data.location || "" });
            if (data.drawingNo) {
              state.masterData.drawingNumbers.push({
                id: `local-${Date.now()}`,
                Title: data.drawingNo,
                ProjectName: data.name,
                DrawingCategory: data.category,
                DrawingName: data.drawingName || "",
              });
            }
            close();
            pickProject(view, data.name);
            showToast(`เพิ่มโครงการ "${data.name}" เรียบร้อยแล้ว`, "success");
          } catch (error) {
            showToast(`เพิ่มโครงการไม่สำเร็จ: ${error.message}`, "error");
          }
        },
      },
    ],
  });
}
