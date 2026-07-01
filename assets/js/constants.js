// หมายเหตุ: STATUS / STATUS_LABELS ย้ายไปอยู่ที่ config/schema.js แล้ว (single source of truth)
// ไฟล์นี้เก็บเฉพาะค่าคงที่ของ UI

export const REQUEST_TYPES = [
  "📋 เขียนแบบ Proposal",
  "🏛️ ขออนุญาตก่อสร้าง",
  "🏗️ เขียนแบบก่อสร้าง",
  "🏁 As-Built Drawing",
  "📁 อื่นๆ",
];

export const PRIORITIES = ["ปกติ", "เร่งด่วน", "เร่งด่วนมาก"];

// role model จริง: viewer (ยังไม่ login) / requester (ทุกคนใน primepower.co.th) /
// designer (อยู่ใน DrawingTeam = ทำหน้าที่ Lv.1 ได้) / manager (3 อีเมล Lv.2)
export const NAV_ITEMS = [
  { route: "/dashboard", label: "ภาพรวม", icon: "01", roles: ["manager", "requester", "designer", "viewer"] },
  { route: "/submit", label: "ส่งคำร้อง", icon: "02", roles: ["requester", "designer", "manager"] },
  { route: "/track", label: "ติดตามงาน", icon: "03", roles: ["manager", "requester", "designer", "viewer"] },
  { route: "/admin", label: "รับงาน / อนุมัติ", icon: "04", roles: ["manager", "designer"] },
  { route: "/report", label: "รายงาน", icon: "05", roles: ["manager"] },
  { route: "/guide", label: "คู่มือ", icon: "06", roles: ["manager", "requester", "designer"] },
];

export const PAGE_TITLES = {
  "/dashboard": "ภาพรวมงาน Drawing",
  "/submit": "ส่งคำร้อง Drawing",
  "/track": "ติดตามคำร้อง",
  "/admin": "รับงานและอนุมัติ",
  "/report": "รายงาน",
  "/guide": "คู่มือการใช้งาน",
};
