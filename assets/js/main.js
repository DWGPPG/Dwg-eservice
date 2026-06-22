import { initAuth, login, logout, refreshUserRole } from "./auth.js";
import { initRouter, navigate, refreshNavBadges } from "./router.js";
import { loadMasterData } from "./sharepoint.js";
import { hydrateRequests } from "./services/request-service.js";
import {
  checkAndNotifyManager,
  requestNotificationPermission,
  resetNotificationBaseline,
} from "./services/notification-service.js";
import { state, subscribe } from "./state.js";
import { qs } from "./utils.js";
import { showToast } from "./components/toast.js";

const POLL_INTERVAL_MS = 10 * 1000;
let pollTimer = null;
let lastRequestsHash = "";

/** hash ง่ายๆ จาก requests array เพื่อเช็คว่าข้อมูลเปลี่ยนหรือไม่ */
function hashRequests(requests) {
  return (requests || []).map((r) => `${r.id}:${r.status}:${r.currentRevise || ""}`).join("|");
}

/** ตรวจสอบว่า user กำลังพิมพ์อยู่ในฟอร์มหรือไม่ */
function isUserTyping() {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || active.isContentEditable;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

async function boot() {
  document.documentElement.dataset.theme = state.theme;

  // ซ่อน app shell ทันทีตั้งแต่เริ่ม — แสดงเฉพาะหน้า login ก่อน
  showAuthPanel(true);

  bindChrome();
  subscribe(updateShell);
  subscribe(onRequestsChanged);
  updateShell(state);

  // เริ่ม router เพื่อให้ hashchange listener พร้อม แต่ยังไม่ render (guard ใน navigate())
  initRouter();

  try {
    await initAuth();
    if (state.account) {
      await afterSignedIn();
      return;
    }
  } catch (error) {
    console.error("initAuth failed:", error);
    showToast("เริ่มต้นระบบ Microsoft 365 ไม่สำเร็จ — ลองรีเฟรชหน้าเว็บ", "error");
  }

  // ยังไม่ได้ login — แสดงหน้า login
  showAuthPanel(true);
}

async function afterSignedIn() {
  try {
    await loadMasterData();
    refreshUserRole();
    await hydrateRequests();
    // แสดง app shell ก่อนเสมอ — ต้อง unhide ก่อน navigate() จะได้ layout ถูกต้อง
    showAuthPanel(false);
    navigate();

    if (state.user?.role === "manager") {
      await requestNotificationPermission();
    }
    startPolling();
  } catch (error) {
    console.error("Failed to load SharePoint data:", error);
    showToast("เซสชันหมดอายุหรือเชื่อมต่อ SharePoint ไม่สำเร็จ — กรุณาเข้าสู่ระบบใหม่", "error");
    await logout();
    resetNotificationBaseline();
    showAuthPanel(true);
  }
}

/**
 * เช็คคำร้องใหม่เป็นระยะตอนเปิดแอปค้างไว้ — ไม่ใช่ push notification จริง (ระบบนี้ไม่มี backend
 * server แยกต่างหาก) แต่เป็น polling ฝั่ง client เพื่อให้เห็น badge/แจ้งเตือนอัปเดตโดยไม่ต้อง
 * รีเฟรชหน้าเอง ช่องทางแจ้งเตือนหลักของระบบยังคงเป็น Teams 1:1 chat ที่ทำงานได้แม้ปิดแอปสนิท
 */
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);

  const refreshData = async (forceRender = false) => {
    if (!state.account || document.hidden) return;
    try {
      await hydrateRequests();

      const newHash = hashRequests(state.requests);
      const changed = newHash !== lastRequestsHash;

      if (changed) {
        lastRequestsHash = newHash;
        // re-render เฉพาะเมื่อข้อมูลเปลี่ยน และ user ไม่ได้พิมพ์อยู่
        if (state.currentRoute && !isUserTyping()) navigate();
      } else if (forceRender && !isUserTyping()) {
        // force render เมื่อกลับมาที่แท็บ แม้ข้อมูลไม่เปลี่ยน
        if (state.currentRoute) navigate();
      }
    } catch (error) {
      console.warn("Polling refresh failed (non-critical):", error.message);
    }
  };

  pollTimer = setInterval(() => refreshData(false), POLL_INTERVAL_MS);

  // Refresh ทันทีเมื่อกลับมาที่แท็บหรือ focus หน้าต่าง
  let lastRefresh = Date.now();
  const refreshIfStale = () => {
    if (!state.account) return;
    if (Date.now() - lastRefresh < 5000) return;
    lastRefresh = Date.now();
    refreshData(true);
  };

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshIfStale();
  });
  window.addEventListener("focus", refreshIfStale);
}

function bindChrome() {
  const loginButtons = [qs("#login-button"), qs("#login-button-panel")].filter(Boolean);
  loginButtons.forEach((button) => {
    button.hidden = false;
    button.addEventListener("click", async () => {
      try {
        const account = await login();
        if (account) await afterSignedIn();
      } catch (error) {
        showToast(error.message || "เข้าสู่ระบบไม่สำเร็จ", "error");
      }
    });
  });

  const logoutButton = qs("#logout-button");
  if (logoutButton) {
    logoutButton.hidden = false;
    logoutButton.addEventListener("click", async () => {
      await logout();
      location.reload();
    });
  }

  qs("#theme-toggle").addEventListener("click", toggleTheme);
  qs("#menu-toggle").addEventListener("click", () => document.body.classList.toggle("nav-open"));
  qs("#sidebar-backdrop")?.addEventListener("click", () => document.body.classList.remove("nav-open"));
}

let requestsChangedDebounce = null;

/**
 * ทำงานทุกครั้งที่ state เปลี่ยน (subscribe ทั่วไป) — กรองเฉพาะตอน requests array
 * เปลี่ยนค่าจริงๆ ด้วย debounce กันยิงถี่เกินไปตอน action เดียวเรียก setState หลายครั้งติดกัน
 */
let lastRequestsRef = null;
function onRequestsChanged(nextState) {
  if (nextState.requests === lastRequestsRef) return;
  lastRequestsRef = nextState.requests;

  if (requestsChangedDebounce) clearTimeout(requestsChangedDebounce);
  requestsChangedDebounce = setTimeout(() => {
    if (!nextState.account) return;
    refreshNavBadges();
    checkAndNotifyManager(nextState.user?.role === "manager");
  }, 150);
}

function showAuthPanel(show) {
  const panel = qs("#auth-panel");
  if (panel) panel.hidden = !show;
  const view = qs("#app-view");
  if (view) view.hidden = show;
  const topbar = document.querySelector(".topbar");
  if (topbar) topbar.hidden = show;
  document.body.classList.toggle("auth-mode", show);
}

function toggleTheme() {
  const theme = state.theme === "light" ? "dark" : "light";
  localStorage.setItem("ppg-theme", theme);
  document.documentElement.dataset.theme = theme;
  state.theme = theme;
}

function updateShell(nextState) {
  const roleChip = qs("#user-role-chip");
  if (roleChip) roleChip.textContent = nextState.user?.roleLabel || "";
  const userName = qs("#sidebar-user-name");
  if (userName) userName.textContent = nextState.user?.name || "";
  const logoutButton = qs("#logout-button");
  if (logoutButton) logoutButton.hidden = !nextState.account;
  const loginButton = qs("#login-button");
  if (loginButton) loginButton.hidden = Boolean(nextState.account);
  const authNote = qs("#sidebar-auth-note");
  if (authNote) authNote.hidden = Boolean(nextState.account);
}

// ── PWA: ลงทะเบียน Service Worker เพื่อให้ "เพิ่มลงหน้าจอโฮม" ได้ทั้ง Android/iOS ──
// ไม่ block boot flow หลัก — ถ้าลงทะเบียนไม่สำเร็จ แอปยังใช้งานได้ปกติทุกอย่างผ่านเครือข่าย
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed (non-critical):", error.message);
    });
  });
}
