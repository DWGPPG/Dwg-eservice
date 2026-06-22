import { STATUS, STATUS_LABELS } from "../../../config/schema.js";

// ══════════════════════════════════════════════════════════════
// เนื้อหาคู่มือ — แบ่งเป็น section ตามหัวข้อ
// ══════════════════════════════════════════════════════════════

const tocItems = [
  { id: "workflow", label: "ขั้นตอนการทำงาน" },
  { id: "pickup", label: "การรับงาน" },
  { id: "autoapprove", label: "ตรวจรับอัตโนมัติ 3 วัน" },
  { id: "status", label: "สถานะคำร้อง" },
  { id: "submit", label: "ส่งคำร้อง & จัดการโครงการ" },
  { id: "numbering", label: "ระบบเลขคำขอ" },
  { id: "storage", label: "ระบบจัดเก็บไฟล์" },
  { id: "roles", label: "สิทธิ์การใช้งาน" },
  { id: "mobile", label: "การใช้งานบนมือถือ" },
  { id: "tips", label: "ข้อควรรู้" },
];

const workflowSteps = [
  {
    number: "1",
    title: "ส่งคำร้อง Drawing",
    owner: "ผู้ร้องขอ",
    text: "เลือกประเภทงาน โครงการ และ Drawing ที่ต้องการ (เลือกได้หลายรายการพร้อมกัน) ระบุวันที่ต้องการรับงาน ความเร่งด่วน และแนบไฟล์/ลิงก์อ้างอิง ระบบจะออกเลขคำร้องให้อัตโนมัติ — ถ้าเลือกโครงการเดิมที่เคยมีอยู่แล้ว ระบบจะดึงข้อมูล Drawing เดิมมาแสดงให้ดูด้วย",
  },
  {
    number: "2",
    title: "รับงาน (Lv.1)",
    owner: "ฝ่ายเขียนแบบ (Lv.1)",
    text: "สมาชิกในทีมเขียนแบบเปิดหน้า \u201cรับงาน / อนุมัติ\u201d เลือกงานที่ต้องการรับผิดชอบได้ทีละรายการ หรือติ๊กเลือกหลายรายการพร้อมกันแล้วกดปุ่ม \u201cรับงาน\u201d ครั้งเดียว คำร้องจะเปลี่ยนเป็นสถานะ \u201cรอ LV.2 ผู้จัดการอนุมัติ\u201d ทันที",
  },
  {
    number: "3",
    title: "อนุมัติเริ่มงาน (Lv.2)",
    owner: "ผู้จัดการ (Lv.2)",
    text: "ถ้ามี Lv.1 รับงานไว้แล้ว ผู้จัดการกดอนุมัติเริ่มงานได้ทันทีโดยไม่ต้องเลือกผู้รับผิดชอบใหม่ หรือถ้าผู้จัดการรับงานเองโดยไม่ผ่าน Lv.1 ก็เลือกผู้รับผิดชอบได้เช่นกัน — ผู้จัดการยังสามารถ \u21a9\ufe0f ส่งกลับให้ Lv.1 ทบทวนใหม่ หรือ \u274c ยกเลิกคำร้องได้ ทุกขั้นตอนนี้อยู่ในหน้า \u201cรับงาน / อนุมัติ\u201d เดียวกัน",
  },
  {
    number: "4",
    title: "ดำเนินงาน",
    owner: "ผู้รับผิดชอบ",
    text: "เริ่มทำงานได้หลังผู้จัดการอนุมัติเท่านั้น ระหว่างทำงานเปิดหน้า \u201cติดตามงาน\u201d เพื่อดูกำหนดส่งและเปลี่ยนสถานะตามความคืบหน้าได้เองทุกเมื่อ (รอดำเนินการ / กำลังดำเนินการ)",
  },
  {
    number: "5",
    title: "ส่งงานให้ผู้จัดการตรวจ",
    owner: "ผู้รับผิดชอบ",
    text: "เลือก \u201c\u2705 เสร็จสิ้น\u201d จากช่องสถานะเพื่อเปิดหน้าต่างส่งมอบงาน เพิ่มลิงก์ไฟล์ DWG/PDF หรือลากไฟล์เข้าไปในโฟลเดอร์งานได้โดยตรง ระบุ Revise และหมายเหตุ — เมื่อกดยืนยัน งานจะเข้าสู่สถานะ \u201cรอผู้จัดการตรวจ+ส่งมอบ\u201d ยังไม่ถูกส่งออกไปหาผู้ร้องขอในขั้นตอนนี้ และระบบแจ้ง Teams ไปยังผู้จัดการ Lv.2 ทุกคนทันที",
  },
  {
    number: "6",
    title: "ผู้จัดการตรวจสอบและส่งมอบ",
    owner: "ผู้จัดการ (Lv.2)",
    text: "เปิดหน้า \u201cรับงาน / อนุมัติ\u201d ส่วน \u201cตรวจสอบและส่งมอบงาน\u201d เพื่อเห็นรายการรอตรวจพร้อม badge แจ้งเตือน กด \u2705 อนุมัติ + ส่งมอบ เพื่อแจ้งผู้ร้องขอทันที (Teams + Email) หรือ \u21a9\ufe0f ส่งกลับแก้ไข พร้อมระบุเหตุผลให้ผู้รับผิดชอบแก้ไขแล้วเลือก \u201c\u2705 เสร็จสิ้น\u201d ส่งใหม่อีกครั้ง",
  },
  {
    number: "7",
    title: "ผู้ร้องขอตรวจรับงาน",
    owner: "ผู้ร้องขอ",
    text: "เมื่อผู้จัดการอนุมัติส่งมอบแล้ว ผู้ร้องขอจะเห็นงานที่หน้า \u201cคำร้องของฉัน\u201d พร้อมไฟล์งาน เลือก \u2705 อนุมัติรับงาน (ปิดงานสมบูรณ์) / \u270f\ufe0f ขอแก้ไข (กลับไปดำเนินงานต่อ) / \u274c Reject พร้อมเหตุผลทุกครั้ง — ต้องดำเนินการภายใน 3 วันทำการนับจากวันที่ส่งมอบ มิฉะนั้นระบบจะอนุมัติให้อัตโนมัติ (ดูรายละเอียดหัวข้อถัดไป)",
  },
];

const statusRows = [
  { status: STATUS.PENDING, meaning: "คำร้องถูกส่งเข้าระบบแล้ว รอฝ่ายเขียนแบบ (Lv.1) เลือกรับงาน", owner: "ฝ่ายเขียนแบบ (Lv.1)", next: "รับงานเอง หรือเลือกหลายรายการแล้วกด \"รับงาน\" ที่หน้ารับงาน/อนุมัติ" },
  { status: STATUS.INPROGRESS_LV1, meaning: "Lv.1 รับงานแล้ว รอผู้จัดการ (Lv.2) อนุมัติก่อนเริ่มงานจริง", owner: "ผู้จัดการ (Lv.2)", next: "อนุมัติเริ่มงาน / ส่งกลับ Lv.1 / ยกเลิก ที่หน้ารับงาน/อนุมัติ" },
  { status: STATUS.APPROVED, meaning: "ผู้จัดการอนุมัติเรียบร้อย ผู้รับผิดชอบสามารถเริ่มงานได้", owner: "ผู้รับผิดชอบ", next: "เปลี่ยนเป็นกำลังดำเนินการ หรือเลือกเสร็จสิ้นเพื่อส่งงานได้เลย" },
  { status: STATUS.WORKING, meaning: "ผู้รับผิดชอบกำลังจัดทำ Drawing ตาม Revision และกำหนดส่งที่ระบุ", owner: "ผู้รับผิดชอบ", next: "เลือกเสร็จสิ้นเมื่อทำงานครบ เพื่อเปิดหน้าต่างส่งมอบ" },
  { status: STATUS.MGR_REVIEW, meaning: "ผู้รับผิดชอบส่งไฟล์งานแล้ว รอผู้จัดการตรวจสอบและอนุมัติก่อนส่งมอบให้ผู้ร้องขอ", owner: "ผู้จัดการ (Lv.2)", next: "\u2705 อนุมัติ+ส่งมอบ หรือ \u21a9\ufe0f ส่งกลับแก้ไข ที่หน้ารับงาน/อนุมัติ" },
  { status: STATUS.MGR_REJECTED, meaning: "ผู้จัดการตรวจแล้วพบว่ายังไม่ถูกต้อง ส่งกลับให้ผู้รับผิดชอบแก้ไข", owner: "ผู้รับผิดชอบ", next: "แก้ไขแล้วเลือก \"เสร็จสิ้น\" จากช่องสถานะเพื่อส่งงานใหม่" },
  { status: STATUS.DELIVERED, meaning: "ผู้จัดการอนุมัติส่งมอบแล้ว แจ้งผู้ร้องขอทาง Teams + Email พร้อมกำหนดวันครบ 3 วันทำการ รอผู้ร้องขอตรวจรับ", owner: "ผู้ร้องขอ", next: "\u2705 อนุมัติรับงาน / \u270f\ufe0f ขอแก้ไข / \u274c Reject — ถ้าเกิน 3 วันทำการระบบจะอนุมัติให้อัตโนมัติ" },
  { status: STATUS.DONE, meaning: "งานเสร็จสมบูรณ์ — ผู้ร้องขอตรวจรับและยืนยันเอง หรือระบบอนุมัติให้อัตโนมัติเพราะเกิน 3 วันทำการ", owner: "ระบบ", next: "ค้นย้อนหลังได้จากแท็บเสร็จสิ้นในหน้าติดตามงาน" },
  { status: STATUS.REJECTED, meaning: "Lv.1, Lv.2 หรือผู้ร้องขอส่งกลับ/ปฏิเสธคำร้อง พร้อมเหตุผล", owner: "ผู้ร้องขอ / ผู้เกี่ยวข้อง", next: "ตรวจเหตุผลและส่งคำร้องใหม่ถ้าจำเป็น" },
  { status: STATUS.CANCELLED, meaning: "คำร้องถูกยกเลิกพร้อมเหตุผล ไม่ดำเนินการต่อ", owner: "—", next: "เก็บไว้เป็นประวัติ ค้นได้จากแท็บยกเลิกในหน้าติดตามงาน" },
];

const numberingPrefixes = [
  { icon: "\ud83d\udccb", type: "เขียนแบบ Proposal", prefix: "DWG-DES-", example: "DWG-DES-2569-0001" },
  { icon: "\ud83c\udfdb\ufe0f", type: "ขออนุญาตก่อสร้าง", prefix: "DWG-PES-", example: "DWG-PES-2569-0001" },
  { icon: "\ud83c\udfd7\ufe0f", type: "เขียนแบบก่อสร้าง", prefix: "DWG-{รหัสโครงการ}-", example: "DWG-BEMV-2569-0001" },
  { icon: "\ud83c\udfc1", type: "As-Built Drawing", prefix: "DWG-ASB-{รหัสโครงการ}-", example: "DWG-ASB-BEMV-2569-0001" },
  { icon: "\ud83d\udcc1", type: "อื่นๆ", prefix: "DWG-OTH-", example: "DWG-OTH-2569-0001" },
];

const standardDrawingCategories = ["General", "Architectural", "Structural", "Electrical", "Mechanical"];
const permitDrawingCategories = [
  "ขออนุญาต อ.1",
  "ขออนุญาต PEA/MEA",
  "ขออนุญาต กกพ/พค.2",
  "ขออนุญาต COP/รง.4",
  "อื่นๆ (ระบุรายละเอียด)",
];

const lv2ManagerEmails = [
  { email: "jeerapat.up@primepower.co.th" },
  { email: "narakorn.pa@primepower.co.th" },
  { email: "archan.sa@primepower.co.th" },
  { email: "sarit.sr@primepower.co.th", note: "แสดงผลเป็น \"Admin ผู้ดูแลระบบ · วิศวกรไฟฟ้าเขียนแบบอาวุโส\" — สิทธิ์การใช้งานเหมือน Lv.2 ทุกประการ" },
]; // รายชื่อปัจจุบัน — ตั้งค่าจริงอยู่ที่ SharePoint List "DrawingTeam" คอลัมน์ IsAdmin/DisplayLabel
   // ถ้ามีการเปลี่ยนแปลงที่ SharePoint ในภายหลัง รายการนี้ในคู่มืออาจไม่ตรงกับของจริงเสมอไป
   // ดูค่าล่าสุดที่ถูกต้องได้จาก SharePoint โดยตรง

const roleRows = [
  { role: "ผู้จัดการ Lv.2", cond: "อีเมลอยู่ในรายชื่อผู้อนุมัติ Lv.2 ที่ตั้งค่าไว้ในระบบ (ดูรายชื่อปัจจุบันด้านล่าง)", access: "ทุกเมนู — รับงาน, อนุมัติเริ่มงาน, ตรวจสอบและส่งมอบงาน, ดูรายงาน" },
  { role: "ฝ่ายเขียนแบบ Lv.1", cond: "อีเมลอยู่ในรายชื่อสมาชิกทีมเขียนแบบ", access: "ภาพรวม, ส่งคำร้อง, ติดตามงาน, รับงาน/อนุมัติ, คู่มือ" },
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
      ${renderPickupSection()}
      ${renderAutoApproveSection()}
      ${renderStatusSection()}
      ${renderSubmitSection()}
      ${renderNumberingSection()}
      ${renderStorageSection()}
      ${renderRolesSection()}
      ${renderMobileSection()}
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

function renderPickupSection() {
  return `
    <section class="guide-section" id="guide-pickup">
      <div class="guide-section-heading">
        <span>Pickup</span>
        <h3>การรับงานและการอัปเดตสถานะ</h3>
        <p>วิธีใช้หน้า "รับงาน / อนุมัติ" และช่องสถานะที่หน้า "ติดตามงาน"</p>
      </div>

      <div class="guide-info-cards">
        <div class="guide-info-card">
          <div class="guide-info-icon">📥</div>
          <h4>ปุ่ม "รับงาน" ด้านบนสุด — ใช้ได้ 2 แบบในปุ่มเดียว</h4>
          <p>หน้า "รับงาน / อนุมัติ" (เฉพาะมุมมองผู้จัดการ Lv.2) มีแถบปุ่ม 3 ปุ่มติดอยู่ด้านบนสุด: <strong>รับงาน</strong>, <strong>อนุมัติเริ่มงาน</strong>, <strong>ตรวจสอบและส่งมอบงาน</strong> — แต่ละปุ่มมีตัวเลขบอกจำนวนรายการที่รอดำเนินการ และจะมีกรอบสีแดงเด่นขึ้นถ้ามีงานค้างอยู่</p>
        </div>
        <div class="guide-info-card">
          <div class="guide-info-icon">✅</div>
          <h4>ติ๊กเลือกแล้วกดปุ่ม "รับงาน" เพื่อรับจริง</h4>
          <p>ในตาราง "รอฝ่ายแบบรับงาน" ติ๊ก checkbox หน้าแถวที่ต้องการ ปุ่ม "รับงาน" ด้านบนจะเปลี่ยนข้อความเป็น <strong>"✅ รับงานที่เลือก"</strong> พร้อมตัวเลขจำนวนที่เลือกไว้ กดแล้วรับงานทั้งหมดพร้อมกันทันที (หรือกดปุ่ม <strong>"รับเอง"</strong> ที่แต่ละแถวเพื่อรับทีละรายการก็ได้)</p>
        </div>
      </div>

      <div class="guide-info-cards">
        <div class="guide-info-card">
          <div class="guide-info-icon">🔍</div>
          <h4>กดปุ่มเพื่อกรองดูเฉพาะหัวข้อ</h4>
          <p>ถ้ายังไม่ติ๊กเลือกอะไรในตาราง การกดปุ่ม "รับงาน" / "อนุมัติเริ่มงาน" / "ตรวจสอบและส่งมอบงาน" จะกรองหน้าจอให้แสดงเฉพาะส่วนนั้นส่วนเดียว ซ่อนอีก 2 ส่วนไปชั่วคราว — กดปุ่มเดิมซ้ำอีกครั้งเพื่อกลับมาแสดงทั้งหมด</p>
        </div>
        <div class="guide-info-card">
          <div class="guide-info-icon">🔄</div>
          <h4>ช่องสถานะที่หน้าติดตามงาน</h4>
          <p>หลังผู้จัดการอนุมัติเริ่มงานแล้ว ผู้รับผิดชอบจะเห็นช่อง dropdown สถานะที่หน้า "ติดตามงาน" เปลี่ยนได้เองทุกเมื่อระหว่าง <strong>รอดำเนินการ</strong> และ <strong>กำลังดำเนินการ</strong> เพื่อบอกความคืบหน้า</p>
        </div>
      </div>

      <div class="guide-storage-rules">
        ${storageRule("✅", "เลือก \"เสร็จสิ้น\"", "เปิดหน้าต่างส่งมอบงานทันที ใส่ลิงก์ไฟล์ DWG/PDF หรือลากไฟล์วางในโฟลเดอร์งานได้โดยตรง ระบุ Revise และหมายเหตุ แล้วกดยืนยัน — งานจะเข้าสู่สถานะรอผู้จัดการตรวจ ยังไม่ถูกส่งออกไปหาผู้ร้องขอในขั้นตอนนี้ และตัวเลือก \"เสร็จสิ้น\" จะไม่ถูกบันทึกเป็นสถานะจริง ถ้ายังไม่กดยืนยันในหน้าต่างที่เปิดขึ้นมา สถานะเดิมจะยังคงอยู่")}
        ${storageRule("❌", "เลือก \"ยกเลิก\"", "ระบบจะเปิดหน้าต่างให้ระบุเหตุผลก่อนเสมอ กรอกแล้วกดยืนยันจึงจะเปลี่ยนเป็นสถานะยกเลิกจริง — ถ้าปิดหน้าต่างโดยไม่กรอกเหตุผล สถานะเดิมจะไม่เปลี่ยน")}
        ${storageRule("↩️", "งานที่ถูกส่งกลับแก้ไข", "ช่องสถานะจะแสดง \"ถูกส่งกลับแก้ไข\" เป็นค่าเริ่มต้น แก้ไขงานตามที่ผู้จัดการระบุแล้วเลือก \"เสร็จสิ้น\" เพื่อเปิดหน้าต่างส่งงานใหม่ได้เหมือนเดิม")}
      </div>
    </section>
  `;
}

function renderAutoApproveSection() {
  return `
    <section class="guide-section" id="guide-autoapprove">
      <div class="guide-section-heading">
        <span>Auto-Approve</span>
        <h3>ตรวจรับอัตโนมัติภายใน 3 วันทำการ</h3>
        <p>เงื่อนไขใหม่ที่ป้องกันงานค้างอยู่ที่ขั้นตอนตรวจรับนานเกินไป</p>
      </div>

      <div class="guide-info-cards">
        <div class="guide-info-card">
          <div class="guide-info-icon">⏰</div>
          <h4>เริ่มนับตั้งแต่วันที่ส่งมอบ</h4>
          <p>ทันทีที่ผู้จัดการกด "✅ อนุมัติ + ส่งมอบ" ระบบจะคำนวณวันครบกำหนด <strong>3 วันทำการ</strong> นับจากวันนั้น โดย<strong>ไม่นับวันเสาร์-อาทิตย์และวันหยุดนักขัตฤกษ์</strong> (อ้างอิงจากปฏิทินวันหยุดที่ตั้งค่าไว้ในระบบ) และแจ้งวันครบกำหนดไปพร้อมกับข้อความแจ้งเตือนส่งมอบงานทาง Teams และ Email ทันที</p>
        </div>
        <div class="guide-info-card">
          <div class="guide-info-icon">🤖</div>
          <h4>เกินกำหนด = อนุมัติให้อัตโนมัติ</h4>
          <p>ถ้าผู้ร้องขอไม่ได้กด อนุมัติ / ขอแก้ไข / Reject ภายในเวลาที่กำหนด ระบบจะเปลี่ยนสถานะเป็น <strong>"เสร็จสิ้น"</strong> ให้อัตโนมัติแทน เสมือนผู้ร้องขอกดอนุมัติเอง พร้อมส่งข้อความแจ้งเตือนทาง Teams ว่างานนี้ถูกอนุมัติอัตโนมัติเนื่องจากเกินกำหนด</p>
        </div>
      </div>

      <div class="guide-storage-rules">
        ${storageRule("📲", "การตรวจสอบทำงานเมื่อมีคนเปิดแอป", "ระบบนี้เป็นเว็บไซต์ที่ไม่มีเซิร์ฟเวอร์ทำงานอยู่เบื้องหลังตลอดเวลา การตรวจสอบว่าเกินกำหนดหรือยังจะเกิดขึ้น<strong>เฉพาะตอนที่มีผู้ใช้คนใดคนหนึ่งเปิดแอปขึ้นมาเท่านั้น</strong> (ไม่ใช่ทันทีที่นาฬิกาตีเที่ยงคืนของวันครบกำหนดเป๊ะ) — ระบบจะตรวจจับและอนุมัติให้อัตโนมัติในครั้งถัดไปที่มีใครก็ตามเปิดแอปหลังจากเวลาเกินกำหนดไปแล้ว")}
        ${storageRule("📋", "ตรวจสอบได้จากประวัติคำร้อง", "คำร้องที่ถูกอนุมัติอัตโนมัติจะถูกบันทึกไว้ใน Audit Log เช่นเดียวกับการอนุมัติด้วยตนเอง — เปิดดูรายละเอียดคำร้องที่หน้าติดตามงานเพื่อดูว่าใครเป็นผู้อนุมัติ (หรือระบบอนุมัติอัตโนมัติ) และเมื่อไหร่")}
      </div>
    </section>
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

function renderSubmitSection() {
  return `
    <section class="guide-section" id="guide-submit">
      <div class="guide-section-heading">
        <span>Submit</span>
        <h3>ส่งคำร้องและจัดการโครงการ</h3>
        <p>วิธีเลือกโครงการเดิม สร้างโครงการใหม่ แก้ไขข้อมูลโครงการ และเพิ่มหมวด Drawing พิเศษสำหรับงานขออนุญาต</p>
      </div>

      <div class="guide-info-cards">
        <div class="guide-info-card">
          <div class="guide-info-icon">🔍</div>
          <h4>เลือกโครงการเดิม</h4>
          <p>พิมพ์ชื่อโครงการในช่องค้นหา ถ้าเป็นโครงการที่เคยส่งคำร้องมาก่อน ระบบจะแสดงให้เลือกพร้อมดึงข้อมูลขนาด Solar (kWp) และพิกัด Google Maps มาแสดงอัตโนมัติ ไม่ต้องกรอกซ้ำ</p>
        </div>
        <div class="guide-info-card">
          <div class="guide-info-icon">✏️</div>
          <h4>ปุ่มเปลี่ยนเป็น "แก้ไขโครงการ" อัตโนมัติ</h4>
          <p>ทันทีที่เลือกโครงการที่มีอยู่แล้ว ปุ่มที่เคยเขียนว่า "+ โครงการใหม่" จะเปลี่ยนข้อความเป็น <strong>"✏️ แก้ไขโครงการ"</strong> ทันที เพื่อบอกชัดเจนว่ากดแล้วจะเข้าสู่โหมดแก้ไขข้อมูลโครงการเดิม ไม่ใช่สร้างใหม่ซ้ำซ้อน</p>
        </div>
      </div>

      <div class="guide-info-cards">
        <div class="guide-info-card">
          <div class="guide-info-icon">📂</div>
          <h4>Drawing เดิมในโครงการ — เลือกด้วย Dropdown</h4>
          <p>ในหน้าต่างแก้ไขโครงการ ส่วน "Drawing ที่มีอยู่แล้วในโครงการนี้" ใช้ Dropdown 2 ชั้น: เลือก<strong>หมวด</strong>ก่อน แล้วเลือก<strong>รายการ Drawing</strong> ในหมวดนั้น จากนั้นกดปุ่ม <strong>"✏️ แก้ไข"</strong> เพื่อเปิดช่องแก้ไข Drawing No. และ Drawing Name ของรายการนั้นโดยตรง — ออกแบบให้กระชับ ไม่ต้องเลื่อนดูรายการยาวๆ</p>
        </div>
        <div class="guide-info-card">
          <div class="guide-info-icon">➕</div>
          <h4>เพิ่ม Drawing ใหม่ได้หลายแถวหลายหมวด</h4>
          <p>กดปุ่ม "+ เพิ่มแถว" ในแต่ละหมวดเพื่อเพิ่มแถวกรอก Drawing No. และ Drawing Name ใหม่ได้ไม่จำกัดจำนวน เลือกได้พร้อมกันหลายหมวดในการบันทึกครั้งเดียว</p>
        </div>
      </div>

      <div class="guide-section-heading" style="margin-top: 28px;">
        <h3 style="font-size: 18px;">หมวด Drawing มาตรฐาน (ทุกประเภทคำร้อง)</h3>
      </div>
      <div class="guide-category-chip-row">
        ${standardDrawingCategories.map((c) => `<span class="guide-category-chip">${c}</span>`).join("")}
      </div>

      <div class="guide-section-heading" style="margin-top: 24px;">
        <h3 style="font-size: 18px;">🏛️ หมวด Drawing เพิ่มเติม — เฉพาะคำร้อง "ขออนุญาตก่อสร้าง"</h3>
        <p>เลือกประเภทคำร้องเป็น "🏛️ ขออนุญาตก่อสร้าง" ก่อน แล้วกดปุ่ม "✏️ แก้ไขโครงการ" / "+ โครงการใหม่" — จะเห็นหมวดเพิ่มเติม 5 หมวดนี้ปรากฏขึ้นมาให้เลือกใช้ นอกเหนือจากหมวดมาตรฐานด้านบน</p>
      </div>
      <div class="guide-category-chip-row">
        ${permitDrawingCategories.map((c) => `<span class="guide-category-chip is-permit">${c}</span>`).join("")}
      </div>

      <div class="guide-storage-rules" style="margin-top: 20px;">
        ${storageRule("📝", "หมวด \"อื่นๆ (ระบุรายละเอียด)\"", "มีช่องข้อความให้กรอกรายละเอียดเพิ่มเติมได้โดยตรง ไม่บังคับต้องมี Drawing No. เหมือนหมวดอื่น — ใช้สำหรับกรณีขออนุญาตที่ไม่ตรงกับ 4 หมวดมาตรฐานข้างต้น")}
      </div>
    </section>
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

      <div class="guide-admin-list-card">
        <div class="guide-admin-list-heading">
          รายชื่อผู้จัดการ Lv.2 (แอดมิน) ปัจจุบัน
          <span class="guide-admin-live-badge">✅ ใช้งานจริงผ่าน SharePoint แล้ว</span>
        </div>
        <p class="guide-admin-list-sub">ผู้ที่มีสิทธิ์ระดับนี้จะมองเห็นและจัดการได้ทุกรายการในระบบ — ระบบอ่านรายชื่อจาก SharePoint โดยตรงทุกครั้งที่ login จึงไม่ต้องแก้โค้ดหรือ deploy ใหม่เมื่อเปลี่ยนแปลง</p>
        <div class="guide-admin-chip-list">
          ${lv2ManagerEmails.map(adminChipRow).join("")}
        </div>
        <div class="guide-admin-howto">
          <strong>🔧 วิธีเพิ่ม/ถอดสิทธิ์ผู้จัดการ Lv.2 — แก้ที่ SharePoint ได้เลย ไม่ต้องแก้โค้ด</strong>
          <ol>
            <li>เปิด SharePoint List <code>DrawingTeam</code></li>
            <li>หาแถวของคนที่ต้องการ (หรือเพิ่มแถวใหม่ถ้ายังไม่มีชื่อในทีม)</li>
            <li>ตั้งค่าคอลัมน์ <code>IsAdmin</code> เป็น <strong>Yes</strong> เพื่อให้สิทธิ์ หรือ <strong>No</strong> เพื่อถอดสิทธิ์</li>
            <li>(ไม่บังคับ) กรอกคอลัมน์ <code>DisplayLabel</code> ถ้าต้องการให้แสดงตำแหน่ง/ป้ายชื่อพิเศษแทน "ผู้จัดการ Lv.2" มาตรฐาน — ปัจจุบันมี Sarit Sribangsai ใช้ฟีเจอร์นี้อยู่</li>
            <li>บันทึก — มีผลทันทีตั้งแต่ครั้งถัดไปที่คนนั้น login เข้าระบบ ไม่ต้องรอ deploy เว็บใหม่</li>
          </ol>
        </div>
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

function adminChipRow(item) {
  return `
    <div class="guide-admin-chip-item">
      <span class="guide-admin-chip">${item.email}</span>
      ${item.note ? `<small class="guide-admin-chip-note">${item.note}</small>` : ""}
    </div>
  `;
}

function renderMobileSection() {
  return `
    <section class="guide-section" id="guide-mobile">
      <div class="guide-section-heading">
        <span>Mobile</span>
        <h3>การใช้งานบนมือถือ</h3>
        <p>ระบบรองรับการใช้งานผ่านเบราว์เซอร์มือถือเต็มรูปแบบ เมนูจะถูกย่อเป็นปุ่มแฮมเบอร์เกอร์อัตโนมัติ</p>
      </div>

      <div class="guide-info-cards">
        <div class="guide-info-card">
          <div class="guide-info-icon">☰</div>
          <h4>เปิดเมนูด้วยปุ่มแฮมเบอร์เกอร์</h4>
          <p>บนหน้าจอแคบ (มือถือ/แท็บเล็ต) เมนูด้านซ้ายจะถูกซ่อนไว้ กดปุ่ม <strong>☰</strong> มุมซ้ายบนของหน้าจอเพื่อเปิดเมนูแบบเลื่อนเข้ามาจากด้านซ้าย (Drawer) พร้อมพื้นหลังสีเข้มคลุมเนื้อหาด้านหลังให้เห็นชัดว่ากำลังอยู่ในโหมดเมนู</p>
        </div>
        <div class="guide-info-card">
          <div class="guide-info-icon">✕</div>
          <h4>ปิดเมนูได้หลายวิธี</h4>
          <p>กดปุ่ม ☰ ซ้ำอีกครั้ง หรือแตะที่พื้นหลังสีเข้มด้านนอกเมนู หรือเลือกเมนูใดก็ได้ — ทั้ง 3 วิธีจะปิดเมนูและพากลับไปที่เนื้อหาหลักทันที</p>
        </div>
      </div>
    </section>
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
        ${tip("ฝ่ายเขียนแบบ (Lv.1)", "รับงานได้ทั้งทีละรายการและเลือกหลายรายการพร้อมกันที่หน้า \u201cรับงาน / อนุมัติ\u201d — งานที่ยังไม่มีใครรับจะอยู่ในตาราง \u201cรอฝ่ายแบบรับงาน\u201d เสมอ")}
        ${tip("ผู้จัดการ (Lv.2)", "ถ้ามี Lv.1 รับงานไว้แล้ว กดอนุมัติเริ่มงานได้ทันทีไม่ต้องเลือกผู้รับผิดชอบซ้ำ — หน้า \u201cรับงาน / อนุมัติ\u201d รวมทั้งรับงาน, อนุมัติเริ่มงาน และตรวจสอบ+ส่งมอบงานไว้ในที่เดียว")}
        ${tip("ส่งกลับระหว่าง Lv.1/Lv.2", "ถ้า Lv.2 พบว่าผู้รับงานไม่เหมาะสม สามารถส่งกลับให้ Lv.1 เลือกผู้รับผิดชอบใหม่ได้ คำร้องจะกลับเป็นรอรับงานอัตโนมัติ")}
        ${tip("อัปเดตสถานะระหว่างทำงาน", "ผู้รับผิดชอบเปลี่ยนสถานะรอดำเนินการ/กำลังดำเนินการได้เองทุกเมื่อที่หน้าติดตามงาน จนกว่าจะเลือก \u201cเสร็จสิ้น\u201d เพื่อส่งงานให้ผู้จัดการตรวจ")}
        ${tip("ตรวจสอบก่อนส่งมอบ", "หน้า \u201cรับงาน / อนุมัติ\u201d ของผู้จัดการจะมี badge แจ้งจำนวนงานที่รอดำเนินการรวมทุกขั้นตอน (รับงาน, อนุมัติ, ตรวจสอบส่งมอบ) ไว้ที่เมนูเดียวเสมอ")}
        ${tip("งานย้อนหลัง", "ใช้แท็บ \u201cเสร็จสิ้น\u201d หรือ \u201cยกเลิก\u201d ที่หน้าติดตามงานเพื่อค้นหางานที่ปิดไปแล้ว — แท็บ \u201cงานปัจจุบัน\u201d จะไม่แสดงงานเหล่านี้")}
        ${tip("ชื่อโฟลเดอร์ไฟล์งาน", "โฟลเดอร์นำส่งงานตั้งชื่อจาก Drawing Number และ Drawing Name ที่กรอกไว้ตอนส่งคำร้อง — กรอกให้ถูกต้องตั้งแต่แรกจะช่วยให้ค้นหาไฟล์ง่ายขึ้นมาก")}
        ${tip("เลขคำขอหาย/พิมพ์ผิด", "ใช้ช่องค้นหาในหน้าติดตามงานพิมพ์บางส่วนของเลขคำขอหรือชื่อโครงการได้ ไม่ต้องพิมพ์เลขเต็มให้ถูกทุกตัว")}
        ${tip("เพิ่ม/แก้ไขโครงการ", "พิมพ์ชื่อโครงการที่หน้าส่งคำร้องแล้วเลือกจากรายการที่ขึ้นมาได้เลยถ้าเป็นโครงการเดิม ปุ่ม \u201c+ โครงการใหม่\u201d จะเปลี่ยนเป็น \u201c✏️ แก้ไขโครงการ\u201d อัตโนมัติ ระบบจะดึงขนาด Solar พิกัด และ Drawing เดิมมาแสดงให้ทันที — ถ้าเป็นโครงการใหม่จริง ก็กรอกข้อมูลและเพิ่ม Drawing ได้หลายแถวหลายหมวดพร้อมกัน")}
        ${tip("กำหนดตรวจรับ 3 วันทำการ", "หลังผู้จัดการส่งมอบงาน ผู้ร้องขอมีเวลา 3 วันทำการในการตรวจรับ (ไม่นับเสาร์-อาทิตย์และวันหยุดนักขัตฤกษ์) หากไม่ดำเนินการภายในเวลา ระบบจะอนุมัติให้อัตโนมัติเมื่อมีผู้ใช้คนใดเปิดแอปหลังเลยกำหนด")}
        ${tip("ใช้งานบนมือถือ", "กดปุ่ม ☰ มุมซ้ายบนเพื่อเปิดเมนู ปิดเมนูได้โดยกดปุ่มซ้ำ แตะพื้นหลังสีเข้ม หรือเลือกเมนูใดก็ได้")}
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
