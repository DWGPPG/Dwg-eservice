import { STATUS } from "../../../config/schema.js";
import { state } from "../state.js";

// ══════════════════════════════════════════════════════════════
// COUNTS — จำนวนงานที่ผู้จัดการ Lv.2 ต้องอนุมัติ ครอบคลุมทุกจุดในระบบ
// ══════════════════════════════════════════════════════════════

/**
 * จำนวนคำร้องที่รออนุมัติ Lv.2 ที่หน้า "รับงาน / อนุมัติ"
 * (pending ที่ยังไม่มี Lv.1 รับ + inprogress_lv1 ที่ Lv.1 มอบหมายแล้วรอ Lv.2)
 */
export function adminPendingCount() {
  return state.requests.filter((item) => [STATUS.PENDING, STATUS.INPROGRESS_LV1].includes(item.status)).length;
}

/**
 * จำนวนงานที่รอผู้จัดการตรวจสอบ+ส่งมอบ ที่หน้า "ติดตามงาน" (mgr_review)
 */
export function mgrReviewPendingCount() {
  return state.requests.filter((item) => item.status === STATUS.MGR_REVIEW).length;
}

/** รวมทุกจุดที่ผู้จัดการต้องดำเนินการ — ใช้แสดง badge รวมที่ระดับ sidebar/แอปไอคอนได้ถ้าต้องการ */
export function totalManagerActionCount() {
  return adminPendingCount() + mgrReviewPendingCount();
}

// ══════════════════════════════════════════════════════════════
// BROWSER NOTIFICATION — แจ้งเตือนตอนเปิดแอปค้างไว้เบื้องหลัง
// (เสริมจาก Teams 1:1 chat ที่เป็นช่องทางหลักอยู่แล้ว ไม่ได้แทนที่)
// ══════════════════════════════════════════════════════════════

let notifyPermissionRequested = false;
let lastKnownCounts = { admin: null, mgrReview: null };

export function isNotificationSupported() {
  return "Notification" in window;
}

export function notificationPermission() {
  return isNotificationSupported() ? Notification.permission : "unsupported";
}

/** ขอสิทธิ์แจ้งเตือนครั้งแรก — เรียกจาก user gesture เท่านั้น (เช่นหลัง login สำเร็จ) */
export async function requestNotificationPermission() {
  if (!isNotificationSupported() || notifyPermissionRequested) return notificationPermission();
  notifyPermissionRequested = true;
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      // ผู้ใช้ปิด prompt หรือเบราว์เซอร์ไม่รองรับ — ไม่ critical ปล่อยผ่าน
    }
  }
  return notificationPermission();
}

function sendBrowserNotification(title, body, tag) {
  if (notificationPermission() !== "granted") return;
  try {
    const notification = new Notification(title, {
      body,
      tag, // ใช้ tag กันแจ้งเตือนซ้ำเรื่องเดียวกันหลายครั้ง (อันใหม่แทนอันเก่าอัตโนมัติ)
      icon: "./assets/icons/icon-192.png",
      badge: "./assets/icons/icon-192.png",
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // บาง browser/OS อาจ throw ถ้าไม่อยู่ใน secure context หรือถูกปิดสิทธิ์ระดับ OS — ไม่ critical
  }
}

/**
 * ตรวจสอบจำนวนงานที่ต้องอนุมัติ เทียบกับครั้งก่อนหน้า ถ้าเพิ่มขึ้น → แจ้งเตือนผู้จัดการ
 * เรียกได้ทุกครั้งหลัง state.requests อัปเดต (เช่นหลัง hydrateRequests หรือ polling)
 */
export function checkAndNotifyManager(isManager) {
  if (!isManager) return;

  const adminCount = adminPendingCount();
  const mgrReviewCount = mgrReviewPendingCount();

  if (lastKnownCounts.admin !== null && adminCount > lastKnownCounts.admin) {
    const diff = adminCount - lastKnownCounts.admin;
    sendBrowserNotification(
      "📋 มีคำร้องรออนุมัติเพิ่มขึ้น",
      `มีคำร้องรออนุมัติ Lv.2 อีก ${diff} รายการ (รวม ${adminCount} รายการ)`,
      "admin-pending"
    );
  }

  if (lastKnownCounts.mgrReview !== null && mgrReviewCount > lastKnownCounts.mgrReview) {
    const diff = mgrReviewCount - lastKnownCounts.mgrReview;
    sendBrowserNotification(
      "📦 มีงานรอตรวจสอบ+ส่งมอบเพิ่มขึ้น",
      `มีงานที่ส่งกลับมารอท่านตรวจสอบอีก ${diff} รายการ (รวม ${mgrReviewCount} รายการ)`,
      "mgr-review-pending"
    );
  }

  lastKnownCounts = { admin: adminCount, mgrReview: mgrReviewCount };
}

/** เรียกตอน logout หรือสลับบัญชี เพื่อไม่ให้แจ้งเตือนข้ามบัญชีกัน */
export function resetNotificationBaseline() {
  lastKnownCounts = { admin: null, mgrReview: null };
}
