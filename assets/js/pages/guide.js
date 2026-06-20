import { STATUS, STATUS_LABELS } from "../../../config/schema.js";

const workflowSteps = [
  {
    number: "1",
    title: "ส่งคำร้อง Drawing",
    owner: "ผู้ร้องขอ",
    text: "เลือกประเภทงาน โครงการ และ Drawing ที่ต้องการ (เลือกได้หลายรายการพร้อมกัน) ระบุวันที่ต้องการรับงาน ความเร่งด่วน และแนบไฟล์/ลิงก์อ้างอิง ระบบจะออกเลขคำร้องให้อัตโนมัติตามรูปแบบ DWG-XXX-2569-0001",
  },
  {
    number: "2",
    title: "ตรวจสอบ Lv.1 + มอบหมายงาน",
    owner: "ฝ่ายเขียนแบบ (Lv.1)",
    text: "สมาชิกในทีมเขียนแบบตรวจสอบคำร้องที่หน้า “รับงาน / อนุมัติ” แล้วเลือกผู้รับผิดชอบ คำร้องจะเปลี่ยนเป็นสถานะ “รอ LV.2 ผู้จัดการอนุมัติ” หรือสามารถ ↩️ ส่งกลับ / ❌ ยกเลิก คำร้องพร้อมระบุเหตุผลถึงผู้ร้องขอได้",
  },
  {
    number: "3",
    title: "อนุมัติ Lv.2 โดยผู้จัดการ",
    owner: "ผู้จัดการ (Lv.2)",
    text: "ถ้ามี Lv.1 มอบหมายไว้แล้ว ผู้จัดการกดอนุมัติได้ทันทีโดยไม่ต้องเลือกผู้รับผิดชอบใหม่ หรือถ้าผู้จัดการรับงานเองโดยไม่ผ่าน Lv.1 ก็เลือกผู้รับผิดชอบได้เช่นกัน — ผู้จัดการยังสามารถ ↩️ ส่งกลับให้ Lv.1 ทบทวนใหม่ (สถานะกลับเป็นรอตรวจสอบ Lv.1) หรือ ❌ ยกเลิกคำร้องได้",
  },
  {
    number: "4",
    title: "ดำเนินงาน",
    owner: "ผู้รับผิดชอบ",
    text: "เริ่มทำงานได้หลังอนุมัติ Lv.2 แล้วเท่านั้น สามารถอัปเดตสถานะเป็น “กำลังดำเนินการ” ระหว่างทำงานได้จากหน้าติดตามงาน",
  },
  {
    number: "5",
    title: "ส่งงาน → รอผู้จัดการตรวจ+ส่งมอบ",
    owner: "ผู้รับผิดชอบ",
    text: "กดส่งงาน แนบลิงก์ DWG/PDF หรือไฟล์ พร้อม Revise และหมายเหตุ คำร้องเข้าสู่สถานะ “รอผู้จัดการตรวจ+ส่งมอบ” (mgr_review) — ระบบแจ้ง Teams ไปยังผู้จัดการ Lv.2 ทุกคนทันที",
  },
  {
    number: "6",
    title: "ผู้จัดการตรวจสอบก่อนส่งมอบ",
    owner: "ผู้จัดการ (Lv.2)",
    text: "เปิดหน้า “ติดตามงาน” เพื่อเห็นรายการรออนุมัติส่งมอบพร้อม badge แจ้งเตือน กด ✅ อนุมัติ + ส่งมอบ เพื่อแจ้งผู้ร้องขอทันที (Teams + Email) หรือ ↩️ ส่งกลับแก้ไข พร้อมระบุเหตุผลให้ผู้รับผิดชอบแก้ไขแล้วส่งใหม่",
  },
  {
    number: "7",
    title: "ผู้ร้องขอตรวจรับงาน",
    owner: "ผู้ร้องขอ",
    text: "เมื่อผู้จัดการอนุมัติส่งมอบแล้ว ผู้ร้องขอจะเห็นงานที่หน้า “คำร้องของฉัน” พร้อมไฟล์งาน เลือก ✅ อนุมัติรับงาน (ปิดงานสมบูรณ์) / ✏️ ขอแก้ไข (กลับไปดำเนินงานต่อ) / ❌ Reject พร้อมเหตุผลทุกครั้ง",
  },
];

const statusRows = [
  {
    status: STATUS.PENDING,
    label: STATUS_LABELS[STATUS.PENDING],
    meaning: "คำร้องถูกส่งเข้าระบบแล้ว รอสมาชิกฝ่ายเขียนแบบ (Lv.1) ตรวจสอบและมอบหมายผู้รับผิดชอบ",
    owner: "ฝ่ายเขียนแบบ (Lv.1)",
    next: "อนุมัติ Lv.1 + มอบหมาย หรือส่งกลับ/ยกเลิก",
  },
  {
    status: STATUS.INPROGRESS_LV1,
    label: STATUS_LABELS[STATUS.INPROGRESS_LV1],
    meaning: "Lv.1 มอบหมายผู้รับผิดชอบแล้ว รอผู้จัดการ (Lv.2) อนุมัติก่อนเริ่มงานจริง",
    owner: "ผู้จัดการ (Lv.2)",
    next: "อนุมัติ Lv.2 / ส่งกลับ Lv.1 / ยกเลิก",
  },
  {
    status: STATUS.APPROVED,
    label: STATUS_LABELS[STATUS.APPROVED],
    meaning: "ผู้จัดการอนุมัติเรียบร้อย ผู้รับผิดชอบสามารถเริ่มงานได้",
    owner: "ผู้รับผิดชอบ",
    next: "เปลี่ยนเป็นกำลังดำเนินการ หรือส่งงานได้เลย",
  },
  {
    status: STATUS.WORKING,
    label: STATUS_LABELS[STATUS.WORKING],
    meaning: "ผู้รับผิดชอบกำลังจัดทำ Drawing ตาม Revision และกำหนดส่งที่ระบุ",
    owner: "ผู้รับผิดชอบ",
    next: "ส่งงานเมื่อทำงานครบ",
  },
  {
    status: STATUS.MGR_REVIEW,
    label: STATUS_LABELS[STATUS.MGR_REVIEW],
    meaning: "ผู้รับผิดชอบส่งไฟล์งานแล้ว รอผู้จัดการตรวจสอบและอนุมัติก่อนส่งมอบให้ผู้ร้องขอ",
    owner: "ผู้จัดการ (Lv.2)",
    next: "✅ อนุมัติ+ส่งมอบ หรือ ↩️ ส่งกลับแก้ไข",
  },
  {
    status: STATUS.MGR_REJECTED,
    label: STATUS_LABELS[STATUS.MGR_REJECTED],
    meaning: "ผู้จัดการตรวจแล้วพบว่ายังไม่ถูกต้อง ส่งกลับให้ผู้รับผิดชอบแก้ไข",
    owner: "ผู้รับผิดชอบ",
    next: "แก้ไขแล้วส่งงานใหม่",
  },
  {
    status: STATUS.DELIVERED,
    label: STATUS_LABELS[STATUS.DELIVERED],
    meaning: "ผู้จัดการอนุมัติส่งมอบแล้ว แจ้งผู้ร้องขอทาง Teams + Email รอผู้ร้องขอตรวจรับ",
    owner: "ผู้ร้องขอ",
    next: "✅ อนุมัติรับงาน / ✏️ ขอแก้ไข / ❌ Reject",
  },
  {
    status: STATUS.DONE,
    label: STATUS_LABELS[STATUS.DONE],
    meaning: "ผู้ร้องขอตรวจรับและยืนยันความถูกต้องแล้ว งานเสร็จสมบูรณ์",
    owner: "ระบบ",
    next: "ค้นย้อนหลังได้จากตัวกรองเสร็จสิ้น",
  },
  {
    status: STATUS.REJECTED,
    label: STATUS_LABELS[STATUS.REJECTED],
    meaning: "Lv.1, Lv.2 หรือผู้ร้องขอส่งกลับ/ปฏิเสธคำร้อง พร้อมเหตุผล",
    owner: "ผู้ร้องขอ / ผู้เกี่ยวข้อง",
    next: "ตรวจเหตุผลและส่งคำร้องใหม่ถ้าจำเป็น",
  },
  {
    status: STATUS.CANCELLED,
    label: STATUS_LABELS[STATUS.CANCELLED],
    meaning: "คำร้องถูกยกเลิกพร้อมเหตุผล ไม่ดำเนินการต่อ",
    owner: "—",
    next: "เก็บไว้เป็นประวัติ ค้นได้จากตัวกรอง",
  },
];

export function renderGuide(view) {
  view.innerHTML = `
    <section class="content-section guide-page">
      <div class="section-header">
        <h2>คู่มือการใช้งาน</h2>
        <p>ภาพรวม Workflow และความหมายของสถานะคำร้องในระบบ PPG Drawing e-Service</p>
      </div>

      <section class="guide-section">
        <div class="guide-section-heading">
          <span>Workflow</span>
          <h3>ขั้นตอนการทำงานทั้งหมด</h3>
        </div>
        <div class="guide-steps-grid">
          ${workflowSteps.map(step).join("")}
        </div>
      </section>

      <section class="guide-section">
        <div class="guide-section-heading">
          <span>Status</span>
          <h3>ความหมายของสถานะคำร้อง</h3>
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

      <section class="guide-section">
        <div class="guide-section-heading">
          <span>Tips</span>
          <h3>ข้อควรรู้ในการใช้งาน</h3>
        </div>
        <div class="guide-tips-grid">
          ${tip("ผู้ร้องขอ", "ระบุวันที่ต้องการรับงานและรายละเอียดให้ครบตั้งแต่ส่งคำร้อง ติดตามสถานะและตรวจรับงานได้จากหน้า “ติดตามงาน”")}
          ${tip("ฝ่ายเขียนแบบ (Lv.1)", "ทุกคนในทีมเขียนแบบสามารถตรวจสอบและมอบหมายงาน Lv.1 ได้ที่หน้า “รับงาน / อนุมัติ”")}
          ${tip("ผู้จัดการ (Lv.2)", "ถ้ามี Lv.1 มอบหมายไว้แล้ว กดอนุมัติได้ทันทีไม่ต้องเลือกผู้รับผิดชอบซ้ำ ระบบจะแสดงข้อมูลที่ Lv.1 กรอกไว้ให้ตรวจสอบก่อนเสมอ")}
          ${tip("ส่งกลับระหว่าง Lv.1/Lv.2", "ถ้า Lv.2 พบว่าข้อมูลที่ Lv.1 มอบหมายไม่ถูกต้อง สามารถส่งกลับให้ Lv.1 แก้ไขใหม่ได้ คำร้องจะกลับไปเป็นสถานะรอตรวจสอบ Lv.1 อัตโนมัติ")}
          ${tip("ตรวจสอบก่อนส่งมอบ", "หน้า “ติดตามงาน” ของผู้จัดการจะมี badge แจ้งจำนวนงานที่รอตรวจสอบก่อนส่งมอบเสมอ")}
          ${tip("งานย้อนหลัง", "งานที่เสร็จสิ้นหรือยกเลิกแล้วจะไม่แสดงในรายการงานปัจจุบัน แต่ยังค้นหาได้จากหน้าติดตามงาน")}
        </div>
      </section>
    </section>
  `;
}

function step(item) {
  return `
    <article class="guide-step">
      <span>${item.number}</span>
      <small>${item.owner}</small>
      <h3>${item.title}</h3>
      <p>${item.text}</p>
    </article>
  `;
}

function statusRow(item) {
  return `
    <tr>
      <td><span class="badge badge-${item.status}">${item.label}</span></td>
      <td>${item.meaning}</td>
      <td><strong>${item.owner}</strong></td>
      <td>${item.next}</td>
    </tr>
  `;
}

function tip(title, text) {
  return `<article class="guide-tip"><strong>${title}</strong><p>${text}</p></article>`;
}
