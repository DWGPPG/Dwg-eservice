const CACHE_NAME = "ppg-drawing-shell-v20";

// เฉพาะไฟล์ static ของ shell — ไม่ cache ข้อมูลจาก SharePoint/Graph API เด็ดขาด
// (ข้อมูลคำร้องต้องสดใหม่เสมอ ไม่งั้นจะเห็นสถานะเก่าค้าง)
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/css/variables.css",
  "./assets/css/base.css",
  "./assets/css/layout.css",
  "./assets/css/components.css",
  "./assets/css/responsive.css",
  "./assets/css/dark-mode.css",
  "./assets/css/mobile-fixes.css",
  "./PPG%20logo%20for%20Web.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {
      // ถ้า cache บางไฟล์ไม่สำเร็จ ไม่ต้อง block การติดตั้ง — ยังใช้งานออนไลน์ได้ปกติ
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // ไม่แตะ request ไปยัง Microsoft Graph / SharePoint / MSAL endpoints เด็ดขาด — ต้องผ่านเครือข่ายจริงเสมอ
  const isAuthOrApi =
    url.hostname.includes("microsoftonline.com") ||
    url.hostname.includes("graph.microsoft.com") ||
    url.hostname.includes("sharepoint.com");
  if (isAuthOrApi || event.request.method !== "GET") return;

  // ══════════════════════════════════════════════════════════════
  // ทุกไฟล์ (HTML/CSS/JS) ใช้ network-first เหมือนกันหมด —
  // เดิม shell files (HTML+CSS) ใช้ cache-first ทำให้อัปเดตแล้วผู้ใช้ยังเห็นเวอร์ชันเก่าค้าง
  // แม้จะ bump CACHE_NAME ก็ตาม เพราะ browser ต้องรอ SW ใหม่ activate ก่อนถึงจะดึงจาก cache ใหม่
  // เปลี่ยนเป็น network-first: ถ้าออนไลน์ได้ไฟล์ล่าสุดเสมอ ไม่ต้องรอรอบ SW lifecycle เลย
  // ส่วน cache ยังอัปเดตไว้เป็น fallback รองรับกรณีออฟไลน์/เน็ตหลุดเท่านั้น
  // ══════════════════════════════════════════════════════════════
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
