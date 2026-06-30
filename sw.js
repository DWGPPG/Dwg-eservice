const CACHE_NAME = "ppg-drawing-shell-v1";

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

  // Shell files: cache-first (เร็ว, ใช้ offline ได้บางส่วน)
  // ไฟล์อื่น (เช่น JS modules): network-first กัน cache ค้างเวอร์ชันเก่าตอน deploy ใหม่
  const isShellFile = SHELL_FILES.some((file) => event.request.url.endsWith(file.replace("./", "")));

  if (isShellFile) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  } else {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  }
});
