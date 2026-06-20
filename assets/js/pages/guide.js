import { STATUS, STATUS_LABELS } from "../../../config/schema.js";

// ══════════════════════════════════════════════════════════════
// เนื้อหาคู่มือ — แบ่งเป็น section ตามหัวข้อ
// ══════════════════════════════════════════════════════════════

const tocItems = [
  { id: "workflow", label: "ขั้นตอนการทำงาน" },
  { id: "status", label: "สถานะคำร้อง" },
  { id: "numbering", label: "ระบบเลขคำขอ" },
  { id: "storage", label: "ระบบจัดเก็บไฟล์" },
  { id: "roles", label: "สิทธิ์การใช้งาน" },
  { id: "tips", label: "ข้อควรรู้" },
];

const workflowSteps = [
  {
    number: "1",
    title: "ส่งคำร้อง Drawing",
    owner: "ผู้ร้องขอ",
    text: "เลือกประเภทงาน โครงการ และ Drawing ที่ต้องการ (เลือกได้หลายรายการพร้อมกัน) ระบุวันที่ต้องการรับงาน ความเร่งด่วน และแนบไฟล์/ลิงก์อ้างอิง ระบบจะออกเลขคำร้องให้อัตโนมัติ",
  },
  {
    number: "2",
    title: "ตรวจสอบ Lv.1 + มอบหมายงาน",
    owner: "ฝ่ายเขียนแบบ (Lv.1)",
    text: "สมาชิกในทีมเขียนแบบตรวจสอบคำร้องที่หน้า \u201cรับงาน / อนุมัติ\u201d แล้วเลือกผู้รับผิดชอบ คำร้องจะเปลี่ยนเป็นสถานะ \u201cรอ LV.2 ผู้จัดการอนุมัติ\u201d หรือสามารถ \u21a9\ufe0f ส่งกลับ / \u274c ยกเลิก คำร้องพร้อมระบุเหตุผลถึงผู้ร้องขอได้",
  },
  {
    number: "3",
    title: "อนุมัติ Lv.2 โดยผู้จัดการ",
    owner: "ผู้จัดการ (Lv.2)",
    text: "ถ้ามี Lv.1 มอบหมายไว้แล้ว ผู้จัดการกดอนุมัติได้ทันทีโดยไม่ต้องเลือกผู้รับผิดชอบใหม่ หรือถ้าผู้จัดการรับงานเองโดยไม่ผ่าน Lv.1 ก็เลือกผู้รับผิดชอบได้เช่นกัน — ผู้จัดการยังสามารถ \u21a9\ufe0f ส่งกลับให้ Lv.1 ทบทวนใหม่ หรือ \u274c ยกเลิกคำร้องได้",
  },
  {
    number: "4",
    title: "ดำเนินงาน",
    owner: "ผู้รับผิดชอบ",
    text: "เริ่มทำงานได้หลังอนุมัติ Lv.2 แล้วเท่านั้น สามารถอัปเดตสถานะเป็น \u201cกำลังดำเนินการ\u201d ระหว่างทำงานได้จากหน้าติดตามงาน",
  },
  {
    number: "5",
    title: "ส่งงาน → รอผู้จัดการตรวจ+ส่งมอบ",
    owner: "ผู้รับผิดชอบ",
    text: "กดส่งงาน แนบลิงก์ DWG/PDF หรือไฟล์ พร้อม Revise และหมายเหตุ คำร้องเข้าสู่สถานะ \u201cรอผู้จัดการตรวจ+ส่งมอบ\u201d — ระบบแจ้ง Teams ไปยังผู้จัดการ Lv.2 ทุกคนทันที และสร้างโฟลเดอร์เก็บไฟล์งานแยกอัตโนมัติ",
  },
  {
    number: "6",
    title: "ผู้จัดการตรวจสอบก่อนส่งมอบ",
    owner: "ผู้จัดการ (Lv.2)",
    text: "เปิดหน้า \u201cติดตามงาน\u201d เพื่อเห็นรายการรออนุมัติส่งมอบพร้อม badge แจ้งเตือน กด \u2705 อนุมัติ + ส่งมอบ เพื่อแจ้งผู้ร้องขอทันที (Teams + Email) หรือ \u21a9\ufe0f ส่งกลับแก้ไข พร้อมระบุเหตุผลให้ผู้รับผิดชอบแก้ไขแล้วส่งใหม่",
  },
  {
    number: "7",
    title: "ผู้ร้องขอตรวจรับงาน",
    owner: "ผู้ร้องขอ",
    text: "เมื่อผู้จัดการอนุมัติส่งมอบแล้ว ผู้ร้องขอจะเห็นงานที่หน้า \u201cคำร้องของฉัน\u201d พร้อมไฟล์งาน เลือก \u2705 อนุมัติรับงาน (ปิดงานสมบูรณ์) / \u270f\ufe0f ขอแก้ไข (กลับไปดำเนินงานต่อ) / \u274c Reject พร้อมเหตุผลทุกครั้ง",
  },
];

const statusRows = [
  { status: STATUS.PENDING, meaning: "คำร้องถูกส่งเข้าระบบแล้ว รอฝ่ายเขียนแบบ (Lv.1) ตรวจสอบและมอบหมายผู้รับผิดชอบ", owner: "ฝ่ายเขียนแบบ (Lv.1)", next: "อนุมัติ Lv.1 + มอบหมาย หรือส่งกลับ/ยกเลิก" },
  { status: STATUS.INPROGRESS_LV1, meaning: "Lv.1 มอบหมายผู้รับผิดชอบแล้ว รอผู้จัดการ (Lv.2) อนุมัติก่อนเริ่มงานจริง", owner: "ผู้จัดการ (Lv.2)", next: "อนุมัติ Lv.2 / ส่งกลับ Lv.1 / ยกเลิก" },
  { status: STATUS.APPROVED, meaning: "ผู้จัดการอนุมัติเรียบร้อย ผู้รับผิดชอบสามารถเริ่มงานได้", owner: "ผู้รับผิดชอบ", next: "เปลี่ยนเป็นกำลังดำเนินการ หรือส่งงานได้เลย" },
  { status: STATUS.WORKING, meaning: "ผู้รับผิดชอบกำลังจัดทำ Drawing ตาม Revision และกำหนดส่งที่ระบุ", owner: "ผู้รับผิดชอบ", next: "ส่งงานเมื่อทำงานครบ" },
  { status: STATUS.MGR_REVIEW, meaning: "ผู้รับผิดชอบส่งไฟล์งานแล้ว รอผู้จัดการตรวจสอบและอนุมัติก่อนส่งมอบให้ผู้ร้องขอ", owner: "ผู้จัดการ (Lv.2)", next: "\u2705 อนุมัติ+ส่งมอบ หรือ \u21a9\ufe0f ส่งกลับแก้ไข" },
  { status: STATUS.MGR_REJECTED, meaning: "ผู้จัดการตรวจแล้วพบว่ายังไม่ถูกต้อง ส่งกลับให้ผู้รับผิดชอบแก้ไข", owner: "ผู้รับผิดชอบ", next: "แก้ไขแล้วส่งงานใหม่" },
  { status: STATUS.DELIVERED, meaning: "ผู้จัดการอนุมัติส่งมอบแล้ว แจ้งผู้ร้องขอทาง Teams + Email รอผู้ร้องขอตรวจรับ", owner: "ผู้ร้องขอ", next: "\u2705 อนุมัติรับงาน / \u270f\ufe0f ขอแก้ไข / \u274c Reject" },
  { status: STATUS.DONE, meaning: "ผู้ร้องขอตรวจรับและยืนยันความถูกต้องแล้ว งานเสร็จสมบูรณ์", owner: "ระบบ", next: "ค้นย้อนหลังได้จากตัวกรองเสร็จสิ้น" },
  { status: STATUS.REJECTED, meaning: "Lv.1, Lv.2 หรือผู้ร้องขอส่งกลับ/ปฏิเสธคำร้อง พร้อมเหตุผล", owner: "ผู้ร้องขอ / ผู้เกี่ยวข้อง", next: "ตรวจเหตุผลและส่งคำร้องใหม่ถ้าจำเป็น" },
  { status: STATUS.CANCELLED, meaning: "คำร้องถูกยกเลิกพร้อมเหตุผล ไม่ดำเนินการต่อ", owner: "—", next: "เก็บไว้เป็นประวัติ ค้นได้จากตัวกรอง" },
];

const numberingPrefixes = [
  { icon: "\ud83d\udccb", type: "เขียนแบบ Proposal", prefix: "DWG-DES-", example: "DWG-DES-2569-0001" },
  { icon: "\ud83c\udfdb\ufe0f", type: "ขออนุญาตก่อสร้าง", prefix: "DWG-PES-", example: "DWG-PES-2569-0001" },
  { icon: "\ud83c\udfd7\ufe0f", type: "เขียนแบบก่อสร้าง", prefix: "DWG-{รหัสโครงการ}-", example: "DWG-BEMV-2569-0001" },
  { icon: "\ud83c\udfc1", type: "As-Built Drawing", prefix: "DWG-ASB-{รหัสโครงการ}-", example: "DWG-ASB-BEMV-2569-0001" },
  { icon: "\ud83d\udcc1", type: "อื่นๆ", prefix: "DWG-OTH-", example: "DWG-OTH-2569-0001" },
];

const roleRows = [
  { role: "ผู้จัดการ Lv.2", cond: "อีเมลอยู่ในรายชื่อผู้อนุมัติ Lv.2 ที่ตั้งค่าไว้ในระบบ", access: "ทุกเมนู — อนุมัติ Lv.2, ตรวจสอบ+ส่งมอบงาน, ดูรายงาน" },
  { role: "ฝ่ายเขียนแบบ Lv.1", cond: "อีเมลอยู่ในรายชื่อสมาชิกทีมเขียนแบบ", access: "ภาพรวม, ส่งคำร้อง, ติดตามงาน, รับงาน/อนุมัติ Lv.1, คู่มือ" },
  { role: "ผู้ร้องขอ", cond: "อีเมล @primepower.co.th ทั่วไป (ไม่อยู่ใน 2 กลุ่มบน)", access: "ภาพรวม, ส่งคำร้อง, ติดตามงาน, คู่มือ" },
];

// ══════════════════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════════════════

export function renderGuide(view) {
  view.innerHTML = `
    <section class="content-section guide-page">
      <div class="guide-hero">
        <div class="guide-hero-kicker">PPG Drawing e-Service</div>
        <h2>คู่มือการใช้งานระบบ</h2>
        <p>รวมทุกขั้นตอนการทำงาน ความหมายของสถานะ ระบบเลขคำขอ และการจัดเก็บไฟล์ ไว้ในที่เดียว</p>
      </div>

      <nav class="guide-toc" aria-label="สารบัญคู่มือ">
        ${tocItems.map((item) => `<a href="#guide-${item.id}" class="guide-toc-link" data-toc="${item.id}">${item.label}</a>`).join("")}
      </nav>

      ${renderWorkflowSection()}
      ${renderStatusSection()}
      ${renderNumberingSection()}
      ${renderStorageSection()}
      ${renderRolesSection()}
      ${renderTipsSection()}
    </section>
  `;

  bindTocScrollSpy(view);
}

function renderWorkflowSection() {
  return `
    <section class="guide-section" id="guide-workflow">
      <div class="guide-section-heading">
        <span>Workflow</span>
        <h3>ขั้นตอนการทำงานทั้งหมด</h3>
        <p>ตั้งแต่ส่งคำร้องจนถึงผู้ร้องขอตรวจรับงานเสร็จสมบูรณ์ — 7 ขั้นตอนหลัก</p>
      </div>
      <div class="guide-flow-track">
        ${workflowSteps.map((item, index) => workflowStepHtml(item, index === workflowSteps.length - 1)).join("")}
      </div>
    </section>
  `;
}

function workflowStepHtml(item, isLast) {
  return `
    <article class="guide-step">
      <div class="guide-step-top">
        <span class="guide-step-num">${item.number}</span>
        ${isLast ? "" : '<span class="guide-step-connector" aria-hidden="true"></span>'}
      </div>
      <div class="guide-step-body">
        <small>${item.owner}</small>
        <h3>${item.title}</h3>
        <p>${item.text}</p>
      </div>
    </article>
  `;
}

function renderStatusSection() {
  return `
    <section class="guide-section" id="guide-status">
      <div class="guide-section-heading">
        <span>Status</span>
        <h3>ความหมายของสถานะคำร้อง</h3>
        <p>สถานะทั้งหมดที่คำร้องหนึ่งใบจะผ่านได้ และขั้นตอนถัดไปของแต่ละสถานะ</p>
      </div>
      <div class="guide-status-table-wrap">
        <table class="guide-status-table">
          <thead>
            <tr>
              <th>สถานะ</th>
              <th>ความหมาย</th>
              <th>ผู้ดำเนินการต่อ</th>
              <th>ขั้นตอนถัดไป</th>
            </tr>
          </thead>
          <tbody>
            ${statusRows.map(statusRow).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function statusRow(item) {
  return `
    <tr>
      <td><span class="badge badge-${item.status}">${STATUS_LABELS[item.status] || item.status}</span></td>
      <td>${item.meaning}</td>
      <td><strong>${item.owner}</strong></td>
      <td>${item.next}</td>
    </tr>
  `;
}

function renderNumberingSection() {
  return `
    <section class="guide-section" id="guide-numbering">
      <div class="guide-section-heading">
        <span>Numbering</span>
        <h3>ระบบเลขคำขอ</h3>
        <p>ระบบออกเลขคำร้องให้อัตโนมัติทุกครั้ง ไม่ซ้ำกันแม้ส่งพร้อมกันจากหลายเครื่อง</p>
      </div>

      <div class="guide-format-card">
        <div class="guide-format-label">รูปแบบเลขคำขอ</div>
        <div class="guide-format-pattern">
          <span class="fmt-seg fmt-fixed">DWG</span>
          <span class="fmt-dash">-</span>
          <span class="fmt-seg fmt-type">ประเภท</span>
          <span class="fmt-dash">-</span>
          <span class="fmt-seg fmt-year">ปี พ.ศ.</span>
          <span class="fmt-dash">-</span>
          <span class="fmt-seg fmt-seq">ลำดับ 4 หลัก</span>
        </div>
      </div>

      <div class="guide-numbering-grid">
        ${numberingPrefixes.map(numberingCard).join("")}
      </div>

      <div class="guide-info-cards">
        <div class="guide-info-card">
          <div class="guide-info-icon">\ud83d\udd12</div>
          <h4>ป้องกันเลขซ้ำ</h4>
          <p>ก่อนออกเลขแรกของแต่ละประเภท ระบบจะตรวจสอบเลขสูงสุดที่มีอยู่จริงบน SharePoint ก่อนเสมอ แม้เปิดใช้งานจากหลายเครื่องพร้อมกันก็ไม่มีทางได้เลขซ้ำ</p>
        </div>
        <div class="guide-info-card">
          <div class="guide-info-icon">\u270f\ufe0f</div>
          <h4>เลข Revision</h4>
          <p>เมื่อส่งคำร้องแก้ไขงานเดิม ระบบจะต่อท้ายเลขคำขอเดิมด้วย <code>-Rev.01</code>, <code>-Rev.02</code> ไล่ลำดับไปเรื่อยๆ ตามจำนวนครั้งที่เคยแก้ไข</p>
        </div>
      </div>

      <div class="guide-revision-flow">
        <span class="guide-revision-chip">DWG-DES-2569-0001</span>
        <span class="guide-revision-arrow">แก้ไขครั้งที่ 1 →</span>
        <span class="guide-revision-chip is-rev">DWG-DES-2569-0001-Rev.01</span>
        <span class="guide-revision-arrow">แก้ไขครั้งที่ 2 →</span>
        <span class="guide-revision-chip is-rev">DWG-DES-2569-0001-Rev.02</span>
      </div>
    </section>
  `;
}

function numberingCard(item) {
  return `
    <article class="guide-num-card">
      <div class="guide-num-icon">${item.icon}</div>
      <div class="guide-num-body">
        <strong>${item.type}</strong>
        <code class="guide-num-prefix">${item.prefix}</code>
        <span class="guide-num-example">${item.example}</span>
      </div>
    </article>
  `;
}

function renderStorageSection() {
  return `
    <section class="guide-section" id="guide-storage">
      <div class="guide-section-heading">
        <span>File Storage</span>
        <h3>ระบบจัดเก็บไฟล์</h3>
        <p>ทุกไฟล์เก็บบน SharePoint Document Library โฟลเดอร์ <code>DrawingRequests</code> จัดเรียงตามเลขคำขอโดยอัตโนมัติ</p>
      </div>

      <div class="guide-tree-card">
        <div class="guide-tree-label">โครงสร้างโฟลเดอร์จริง</div>
        <pre class="guide-folder-tree"><code>${folderTreeHtml()}</code></pre>
      </div>

      <div class="guide-storage-rules">
        ${storageRule("\ud83d\udcc2", "ส่งคำร้องครั้งแรก", "สร้างโฟลเดอร์ชื่อ <strong>เลขคำขอ</strong> ไฟล์ที่แนบมาเก็บไว้ที่ root ของโฟลเดอร์นั้นตรงๆ")}
        ${storageRule("\ud83d\udd01", "ส่งคำร้อง Revision", "สร้างโฟลเดอร์ย่อยชื่อ <strong>Rev.XX</strong> ซ้อนอยู่ใต้โฟลเดอร์คำขอเดิมเสมอ ไม่แยกเป็นโฟลเดอร์ใหม่ทั้งหมด")}
        ${storageRule("\ud83d\udce4", "นำส่งงาน (Sendwork)", "สร้างโฟลเดอร์ย่อยชื่อ <strong>DrawingNumber-DrawingName-Revise</strong> ซ้อนใต้โฟลเดอร์คำร้องนั้นๆ เสมอ ไม่ว่าจะเป็นคำร้องแรกหรือ Revision")}
      </div>

      <div class="guide-info-cards">
        <div class="guide-info-card">
          <div class="guide-info-icon">\ud83e\uddf9</div>
          <h4>ชื่อไฟล์ปลอดภัย</h4>
          <p>ระบบจะแทนที่อักขระต้องห้ามของ SharePoint (<code>" * : &lt; &gt; ? / \\ |</code>) ในชื่อ Drawing Name อัตโนมัติก่อนสร้างโฟลเดอร์ ป้องกันการอัปโหลดล้มเหลว</p>
        </div>
        <div class="guide-info-card">
          <div class="guide-info-icon">\ud83d\udd17</div>
          <h4>ลิงก์ไฟล์ในระบบ</h4>
          <p>หลังนำส่งงานสำเร็จ ระบบเก็บลิงก์ไฟล์ DWG และ PDF แยกไว้ในคำร้องอัตโนมัติ ผู้ร้องขอกดดูไฟล์ได้ทันทีจากหน้าติดตามงานโดยไม่ต้องเข้า SharePoint เอง</p>
        </div>
      </div>
    </section>
  `;
}

function storageRule(icon, title, text) {
  return `
    <article class="guide-storage-rule">
      <div class="guide-storage-icon">${icon}</div>
      <div>
        <strong>${title}</strong>
        <p>${text}</p>
      </div>
    </article>
  `;
}

function folderTreeHtml() {
  const lines = [
    `<span class="tree-root">\ud83d\udcc1 DrawingRequests/</span>`,
    `<span class="tree-l1">\u2514\u2500 \ud83d\udcc1 DWG-DES-2569-0001/</span>  <span class="tree-note">\u2190 โฟลเดอร์คำร้องแรก</span>`,
    `<span class="tree-l2">   \u251c\u2500 \ud83d\udcc4 ไฟล์ที่ผู้ร้องขอแนบ.pdf</span>  <span class="tree-note">\u2190 เก็บที่ root ตรงๆ</span>`,
    `<span class="tree-l2">   \u251c\u2500 \ud83d\udcc1 E001-SLD-Single Line Diagram-R1/</span>  <span class="tree-note">\u2190 โฟลเดอร์นำส่งงาน</span>`,
    `<span class="tree-l3">   \u2502     \u251c\u2500 \ud83d\udcd0 DWG_R1.dwg</span>`,
    `<span class="tree-l3">   \u2502     \u2514\u2500 \ud83d\udcc4 DWG_R1.pdf</span>`,
    `<span class="tree-l2">   \u2514\u2500 \ud83d\udcc1 Rev.01/</span>  <span class="tree-note">\u2190 คำร้อง Revision ซ้อนใต้คำขอเดิม</span>`,
    `<span class="tree-l3">         \u251c\u2500 \ud83d\udcc4 ไฟล์แนบตอนส่ง Rev.01.pdf</span>`,
    `<span class="tree-l3">         \u2514\u2500 \ud83d\udcc1 E001-SLD-Single Line Diagram-R2/</span>  <span class="tree-note">\u2190 นำส่งงานของ Rev.01</span>`,
    `<span class="tree-l4">               \u2514\u2500 \ud83d\udcd0 DWG_R2.dwg</span>`,
  ];
  return lines.join("\n");
}

function renderRolesSection() {
  return `
    <section class="guide-section" id="guide-roles">
      <div class="guide-section-heading">
        <span>Roles</span>
        <h3>สิทธิ์การใช้งานตามบทบาท</h3>
        <p>ระบบกำหนดสิทธิ์อัตโนมัติจากอีเมลที่ใช้ login เทียบกับรายชื่อในระบบ ไม่ต้องตั้งค่าแยก</p>
      </div>
      <div class="guide-role-cards">
        ${roleRows.map(roleCard).join("")}
      </div>
    </section>
  `;
}

function roleCard(item) {
  return `
    <article class="guide-role-card">
      <h4>${item.role}</h4>
      <div class="guide-role-cond"><span>เงื่อนไข</span><p>${item.cond}</p></div>
      <div class="guide-role-access"><span>เข้าถึงเมนู</span><p>${item.access}</p></div>
    </article>
  `;
}

function renderTipsSection() {
  return `
    <section class="guide-section" id="guide-tips">
      <div class="guide-section-heading">
        <span>Tips</span>
        <h3>ข้อควรรู้ในการใช้งาน</h3>
      </div>
      <div class="guide-tips-grid">
        ${tip("ผู้ร้องขอ", "ระบุวันที่ต้องการรับงานและรายละเอียดให้ครบตั้งแต่ส่งคำร้อง ติดตามสถานะและตรวจรับงานได้จากหน้า \u201cติดตามงาน\u201d")}
        ${tip("ฝ่ายเขียนแบบ (Lv.1)", "ทุกคนในทีมเขียนแบบสามารถตรวจสอบและมอบหมายงาน Lv.1 ได้ที่หน้า \u201cรับงาน / อนุมัติ\u201d")}
        ${tip("ผู้จัดการ (Lv.2)", "ถ้ามี Lv.1 มอบหมายไว้แล้ว กดอนุมัติได้ทันทีไม่ต้องเลือกผู้รับผิดชอบซ้ำ ระบบจะแสดงข้อมูลที่ Lv.1 กรอกไว้ให้ตรวจสอบก่อนเสมอ")}
        ${tip("ส่งกลับระหว่าง Lv.1/Lv.2", "ถ้า Lv.2 พบว่าข้อมูลที่ Lv.1 มอบหมายไม่ถูกต้อง สามารถส่งกลับให้ Lv.1 แก้ไขใหม่ได้ คำร้องจะกลับเป็นรอตรวจสอบ Lv.1 อัตโนมัติ")}
        ${tip("ตรวจสอบก่อนส่งมอบ", "หน้า \u201cติดตามงาน\u201d ของผู้จัดการจะมี badge แจ้งจำนวนงานที่รอตรวจสอบก่อนส่งมอบเสมอ")}
        ${tip("งานย้อนหลัง", "งานที่เสร็จสิ้นหรือยกเลิกแล้วจะไม่แสดงในรายการงานปัจจุบัน แต่ยังค้นหาได้จากหน้าติดตามงาน")}
        ${tip("ชื่อโฟลเดอร์ไฟล์งาน", "โฟลเดอร์นำส่งงานตั้งชื่อจาก Drawing Number และ Drawing Name ที่กรอกไว้ตอนส่งคำร้อง — กรอกให้ถูกต้องตั้งแต่แรกจะช่วยให้ค้นหาไฟล์ง่ายขึ้นมาก")}
        ${tip("เลขคำขอหาย/พิมพ์ผิด", "ใช้ช่องค้นหาในหน้าติดตามงานพิมพ์บางส่วนของเลขคำขอหรือชื่อโครงการได้ ไม่ต้องพิมพ์เลขเต็มให้ถูกทุกตัว")}
      </div>
    </section>
  `;
}

function tip(title, text) {
  return `<article class="guide-tip"><strong>${title}</strong><p>${text}</p></article>`;
}

// ══════════════════════════════════════════════════════════════
// TOC scroll-spy — ไฮไลต์หัวข้อที่กำลังดูอยู่ + เลื่อนแบบนุ่มนวล
// ══════════════════════════════════════════════════════════════

function bindTocScrollSpy(view) {
  const tocLinks = Array.from(view.querySelectorAll(".guide-toc-link"));
  const sections = tocItems.map((item) => view.querySelector(`#guide-${item.id}`)).filter(Boolean);
  const scrollContainer = view.closest(".main-panel") || view;

  tocLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const target = view.querySelector(`#guide-${link.dataset.toc}`);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  const setActive = (id) => {
    tocLinks.forEach((link) => link.classList.toggle("is-active", link.dataset.toc === id));
  };

  if (!sections.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActive(visible.target.id.replace("guide-", ""));
    },
    { root: scrollContainer, threshold: [0.2, 0.5, 0.8] }
  );

  sections.forEach((section) => observer.observe(section));
  setActive(tocItems[0].id);
}
