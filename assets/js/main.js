import { appConfig } from "../../config/config.js";
import { consumeReturnRoute, hasPendingOrCachedLogin, initAuth, login, logout, refreshUserRole } from "./auth.js";
import { initRouter, navigate, refreshNavBadges } from "./router.js";
import {
  VIEW_AS_OPTIONS, canSwitchView, isViewingAsOther, switchViewTo,
} from "./services/view-as-service.js";
import { hydrateMasterFromCache, loadMasterData } from "./sharepoint.js";
import { hydrateRequests, hydrateRequestsFromCache } from "./services/request-service.js";
import { onSyncStatus, pollIntervalMs, syncInfo } from "./services/request-sync.js";
import {
  checkAndNotifyManager,
  requestNotificationPermission,
  resetNotificationBaseline,
} from "./services/notification-service.js";
import { state, subscribe } from "./state.js";
import { qs } from "./utils.js";
import { showToast } from "./components/toast.js";
import { startLinkInputEnhancer } from "./components/cloud-picker.js";
import { startResponsiveTables } from "./components/responsive-tables.js";
import { displayVersion } from "./services/app-settings.js";
import { autoMigrateBootstrap } from "./services/admin-migration.js";
import { getMyPhoto } from "./services/profile-photo.js";

const MAX_BACKOFF_MS = 2 * 60 * 1000;
let pollTimer = null;
let pollingStarted = false;
let lastRequestsHash = "";

/** hash ง่ายๆ จาก requests array เพื่อเช็คว่าข้อมูลเปลี่ยนหรือไม่ */
function hashRequests(requests) {
  return (requests || []).map((r) => `${r.id}:${r.status}:${r.currentRevise || ""}`).join("|");
}

/** หน้าที่ห้าม re-render ระหว่าง polling เพราะผู้ใช้อาจกรอกข้อมูลอยู่ */
const NO_POLL_RENDER_ROUTES = new Set(["/submit", "/manage"]);

/** ตรวจสอบว่ามี modal เปิดอยู่หรือไม่ */
function isModalOpen() {
  // หน้าต่างเลือกไฟล์ SharePoint/OneDrive เปิดอยู่ก็นับเป็น modal — ห้ามวาดหน้าใหม่ทับช่องที่กำลังจะเติมลิงก์
  if (document.body.classList.contains("picker-open")) return true;
  return document.querySelector("#modal-root")?.children?.length > 0;
}

/** ตรวจสอบว่า user กำลังพิมพ์อยู่ในฟอร์มหรือไม่ */
function isUserTyping() {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || active.isContentEditable;
}

/** ตรวจสอบว่าควร re-render หรือไม่ */
function shouldRender() {
  if (NO_POLL_RENDER_ROUTES.has(state.currentRoute)) return false;
  if (isModalOpen()) return false;
  if (isUserTyping()) return false;
  return true;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

async function boot() {
  document.documentElement.dataset.theme = state.theme;

  // แสดงเวอร์ชันระบบใต้ปุ่มออกจากระบบ — ดึงจาก config ที่เดียว ไม่ hardcode ซ้ำใน HTML
  renderVersionLabel(state);

  // โหลด background video — ลอง path หลายแบบ
  const video = document.getElementById("auth-bg-video");
  if (video) {
    const paths = [
      "./Footage%20login.mp4",
      "./Footage login.mp4",
      "./footage login.mp4",
      "./footage%20login.mp4",
      "./Footage_login.mp4",
      "./footage_login.mp4",
    ];
    const tryLoad = (index) => {
      if (index >= paths.length) return;
      video.src = paths[index];
      video.load();
      video.play().catch(() => tryLoad(index + 1));
      video.onerror = () => tryLoad(index + 1);
    };
    tryLoad(0);
  }

  // เพิ่งกลับจาก Microsoft หรือมีบัญชีค้างในเครื่อง → แสดงหน้า "กำลังเข้าสู่ระบบ" จนกว่าแอปจะพร้อมจริง
  // (เดิมแสดงหน้า login ระหว่างโหลดข้อมูล ผู้ใช้เห็นปุ่ม Sign in ค้างหลายวินาทีทั้งที่ล็อกอินแล้ว)
  const isRedirectCallback = window.location.href.includes("code=") || window.location.href.includes("error=");
  if (hasPendingOrCachedLogin()) {
    showSigninOverlay("กำลังยืนยันตัวตนกับ Microsoft 365…");
  } else {
    document.documentElement.classList.remove("signing-in");
    showAuthPanel(true);
  }

  bindChrome();
  startLinkInputEnhancer();
  startResponsiveTables();
  subscribe(updateShell);
  subscribe(onRequestsChanged);
  updateShell(state);
  initRouter();

  try {
    await initAuth();
    if (state.account) {
      setSigninStatus("กำลังโหลดข้อมูลคำร้อง…");
      await afterSignedIn();
      hideSigninOverlay();
      return;
    }
  } catch (error) {
    console.error("initAuth failed:", error);
    if (!isRedirectCallback) {
      showToast("เริ่มต้นระบบ Microsoft 365 ไม่สำเร็จ — ลองรีเฟรชหน้าเว็บ", "error");
    }
  }

  hideSigninOverlay();
  showAuthPanel(true);
}

// ── หน้า "กำลังเข้าสู่ระบบ" — อยู่จนกว่าแอปพร้อม (หรือรู้ว่ายังไม่ได้ล็อกอิน) ──
function showSigninOverlay(message) {
  if (document.getElementById("signin-overlay")) return setSigninStatus(message);
  document.body.insertAdjacentHTML("beforeend", `
    <div id="signin-overlay" class="signin-overlay" role="status" aria-live="polite">
      <div class="signin-card">
        <img src="./PPG%20logo%20for%20Web.png" alt="" class="signin-logo" onerror="this.style.display='none'">
        <strong class="signin-title">PPG Drawing<span>.</span></strong>
        <div class="signin-spinner" aria-hidden="true"></div>
        <p class="signin-status" id="signin-status">${message}</p>
        <small>ลงชื่อเข้าใช้ด้วยบัญชี Microsoft 365 แล้ว — กรุณารอสักครู่</small>
      </div>
    </div>
  `);
}

function setSigninStatus(message) {
  const el = document.getElementById("signin-status");
  if (el) el.textContent = message;
}

function hideSigninOverlay() {
  document.documentElement.classList.remove("signing-in");
  const overlay = document.getElementById("signin-overlay");
  if (!overlay) return;
  overlay.classList.add("is-leaving");
  setTimeout(() => overlay.remove(), 350);
}

async function afterSignedIn() {
  try {
    // ── มีสำเนาข้อมูลในเครื่อง → แสดงแอปทันที แล้วซิงค์กับ SharePoint เบื้องหลัง ──
    const [hasMaster, hasRequests] = await Promise.all([
      hydrateMasterFromCache(state.account).catch(() => false),
      hydrateRequestsFromCache(state.account).catch(() => false),
    ]);
    if (hasMaster && hasRequests) {
      refreshUserRole();
      enterApp();
      hideSigninOverlay();
      const roleBefore = state.user?.role;
      Promise.all([loadMasterData(), hydrateRequests()])
        .then(() => {
          refreshUserRole();
          lastRequestsHash = hashRequests(state.requests);
          // สิทธิ์เปลี่ยน (เช่นถูกเพิ่ม/ลบจากทีม) → ต้องวาดใหม่แม้ผู้ใช้กำลังพิมพ์ เพื่อไม่ให้เห็นเมนูที่ไม่มีสิทธิ์
          if (state.user?.role !== roleBefore || shouldRender()) navigate();
          runAutoMigration();
        })
        .catch((error) => handleSyncFailure(error, true));
      afterAppReady();
      return;
    }

    // ── ครั้งแรกบนเครื่องนี้ (หรือแคชหมดอายุ) → โหลดจริงก่อนแสดง ──
    await Promise.all([loadMasterData(), hydrateRequests()]);
    refreshUserRole();
    enterApp();
    afterAppReady();
    runAutoMigration();
  } catch (error) {
    await handleSyncFailure(error, false);
  }
}

/** ย้ายสิทธิ์ผู้จัดการจาก config.js เข้า SharePoint ครั้งแรก (ทำเบื้องหลัง ไม่ขวางการใช้งาน) */
async function runAutoMigration() {
  const changed = await autoMigrateBootstrap();
  if (!changed) return;
  await loadMasterData().catch(() => {});
  refreshUserRole();
  if (shouldRender()) navigate();
}

function enterApp() {
  // กลับไปหน้าที่อยู่ตอนกดล็อกอิน (MSAL ไม่โหลดหน้าซ้ำเพื่อพากลับแล้ว)
  const returnRoute = consumeReturnRoute();
  if (returnRoute && returnRoute !== location.hash && !returnRoute.includes("code=")) {
    history.replaceState(null, "", `${location.pathname}${location.search}${returnRoute}`);
  }
  // แสดง app shell ก่อนเสมอ — ต้อง unhide ก่อน navigate() จะได้ layout ถูกต้อง
  showAuthPanel(false);
  navigate();
  lastRequestsHash = hashRequests(state.requests);
}

async function afterAppReady() {
  if (state.user?.role === "manager") {
    await requestNotificationPermission();
  }
  startPolling();
}

function isAuthFailure(error) {
  const msg = String(error?.message || "");
  return error?.status === 401 || msg.includes("Missing Microsoft Graph access token") || msg.includes("Graph API error 401");
}

/** โหลดไม่สำเร็จ: ถ้าเป็นเรื่องสิทธิ์/เซสชัน → ออกจากระบบแบบเดิม, ถ้าแค่เน็ตหลุดและมีสำเนาในเครื่อง → ใช้สำเนาต่อ */
async function handleSyncFailure(error, hasCachedView) {
  if (hasCachedView && !isAuthFailure(error)) {
    console.warn("Background sync failed — showing cached data:", error.message);
    showToast("เชื่อมต่อ SharePoint ไม่สำเร็จ — กำลังแสดงข้อมูลที่บันทึกไว้ในเครื่อง ระบบจะลองใหม่อัตโนมัติ", "warning");
    return;
  }
  console.error("Failed to load SharePoint data:", error);
  showToast("เซสชันหมดอายุหรือเชื่อมต่อ SharePoint ไม่สำเร็จ — กรุณาเข้าสู่ระบบใหม่", "error");
  await logout();
  resetNotificationBaseline();
  showAuthPanel(true);
}

/**
 * เช็คคำร้องใหม่เป็นระยะตอนเปิดแอปค้างไว้ — ไม่ใช่ push notification จริง (ระบบนี้ไม่มี backend
 * server แยกต่างหาก) แต่เป็น polling ฝั่ง client เพื่อให้เห็น badge/แจ้งเตือนอัปเดตโดยไม่ต้อง
 * รีเฟรชหน้าเอง ช่องทางแจ้งเตือนหลักของระบบยังคงเป็น Teams 1:1 chat ที่ทำงานได้แม้ปิดแอปสนิท
 */
function startPolling() {
  if (pollingStarted) return;
  pollingStarted = true;
  let failures = 0;

  const refreshData = async (forceRender = false, full = false) => {
    if (!state.account || document.hidden) return;
    try {
      await hydrateRequests({ full });
      failures = 0;

      const newHash = hashRequests(state.requests);
      const changed = newHash !== lastRequestsHash;

      if (changed) {
        lastRequestsHash = newHash;
        if (state.currentRoute && shouldRender()) navigate();
      } else if (forceRender && shouldRender()) {
        if (state.currentRoute) navigate();
      }
    } catch (error) {
      failures += 1;
      console.warn("Polling refresh failed (non-critical):", error.message);
    }
  };

  // รอบถัดไปนับจากรอบก่อน "จบ" (ไม่ใช่ setInterval) → ไม่มีวันยิงซ้อนกันแม้ SharePoint ตอบช้า
  // ล้มเหลวติดกัน → เว้นห่างขึ้นเรื่อยๆ (สูงสุด 2 นาที) ไม่ไปกระหน่ำตอนระบบ Microsoft มีปัญหา
  const scheduleNext = () => {
    clearTimeout(pollTimer);
    const base = pollIntervalMs();
    const delay = failures ? Math.min(base * 2 ** failures, MAX_BACKOFF_MS) : base;
    pollTimer = setTimeout(async () => {
      await refreshData(false);
      scheduleNext();
    }, delay);
  };
  scheduleNext();

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

  // ปุ่มป้ายสถานะซิงค์ → โหลดข้อมูลใหม่ทั้งหมด
  manualFullSync = async () => {
    await refreshData(true, true);
    if (syncInfo.phase === "ok") showToast(`โหลดข้อมูลใหม่ทั้งหมดแล้ว (${syncInfo.count.toLocaleString("th-TH")} คำร้อง)`, "success");
  };
}

let manualFullSync = null;

// ── ป้ายสถานะซิงค์บนแถบหัว: "กำลังซิงค์…" / "อัปเดตล่าสุด 10:32" / "ออฟไลน์" ──
function bindSyncIndicator() {
  // มี 2 จุด: แถบเมนูซ้าย (จอคอม) และแถบหัว (มือถือ — แถบเมนูเป็นลิ้นชักที่ซ่อนอยู่)
  const buttons = [...document.querySelectorAll("[data-sync-indicator]")];
  if (!buttons.length) return;
  const fmt = (ts) => (ts ? new Date(ts).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "");
  const render = (info) => {
    let text = "";
    if (info.phase === "syncing") text = info.source === "none" ? "กำลังโหลดข้อมูล…" : "กำลังซิงค์…";
    else if (info.phase === "cached") text = "ข้อมูลในเครื่อง · กำลังซิงค์…";
    else if (info.phase === "ok") text = `อัปเดตล่าสุด ${fmt(info.lastSyncAt)}`;
    else if (info.phase === "offline") text = `ออฟไลน์ · ข้อมูลเมื่อ ${fmt(info.lastSyncAt) || "-"}`;
    else if (info.phase === "error") text = `ซิงค์ไม่สำเร็จ · ข้อมูลเมื่อ ${fmt(info.lastSyncAt) || "-"}`;
    // ป้ายแถบหัว (มือถือ) พื้นที่น้อย — ใช้ข้อความสั้น
    const shortText = { syncing: "ซิงค์…", cached: "ซิงค์…", ok: fmt(info.lastSyncAt), offline: "ออฟไลน์", error: "ซิงค์ไม่ได้" }[info.phase] || "";
    const modeText = info.mode === "delta" ? "โหลดเฉพาะรายการที่เปลี่ยน" : info.mode === "full" ? "โหลดทั้งหมดทุกรอบ" : "";
    const title = `${text}${info.count ? ` · ${info.count.toLocaleString("th-TH")} คำร้อง` : ""}${modeText ? ` · ${modeText}` : ""}\nคลิกเพื่อโหลดข้อมูลใหม่ทั้งหมด`;
    buttons.forEach((button) => {
      button.hidden = !state.account || info.phase === "idle";
      button.dataset.phase = info.phase;
      const label = button.querySelector(".sync-label");
      if (label) label.textContent = button.classList.contains("sync-indicator-top") ? shortText : text;
      button.title = title;
      button.setAttribute("aria-label", title);
    });
  };
  onSyncStatus(render);
  subscribe(() => render(syncInfo));
  buttons.forEach((button) => button.addEventListener("click", async () => {
    if (!manualFullSync || buttons.some((b) => b.disabled)) return;
    buttons.forEach((b) => { b.disabled = true; });
    try { await manualFullSync(); } finally { buttons.forEach((b) => { b.disabled = false; }); }
  }));
}

function bindChrome() {
  const loginButtons = [qs("#login-button"), qs("#login-button-panel")].filter(Boolean);
  loginButtons.forEach((button) => {
    button.hidden = false;
    button.addEventListener("click", async () => {
      // แสดง loading state ทันที ป้องกันกดซ้ำ
      button.disabled = true;
      const originalHTML = button.innerHTML;
      button.innerHTML = `
        <span style="display:inline-flex;align-items:center;gap:8px;">
          <span style="width:16px;height:16px;border:2px solid rgba(255,255,255,0.4);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;display:inline-block;"></span>
          <span>กำลังเชื่อมต่อ Microsoft 365...</span>
        </span>`;
      try {
        const account = await login();
        if (account) await afterSignedIn();
      } catch (error) {
        showToast(error.message || "เข้าสู่ระบบไม่สำเร็จ", "error");
        button.disabled = false;
        button.innerHTML = originalHTML;
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
  bindSidebarCollapse();
  bindSyncIndicator();
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

// ── ย่อ/ขยายแถบเมนู (จอคอม) — จำค่าไว้ในเครื่อง ──
function bindSidebarCollapse() {
  // ประกาศในฟังก์ชัน: boot() ถูกเรียกตอนโมดูลยังประเมินไม่จบ ค่าคงที่ระดับโมดูลที่อยู่ด้านล่างยังใช้ไม่ได้ (TDZ)
  const SIDEBAR_KEY = "ppg-sidebar-collapsed";
  const pin = qs("#sidebar-pin");
  if (!pin) return;
  const apply = (collapsed) => {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    pin.setAttribute("aria-pressed", String(collapsed));
    pin.title = collapsed ? "ขยายเมนู" : "ย่อเมนู";
  };
  let collapsed = false;
  try { collapsed = localStorage.getItem(SIDEBAR_KEY) === "1"; } catch { /* storage ปิดอยู่ */ }
  apply(collapsed);
  pin.addEventListener("click", () => {
    collapsed = !document.body.classList.contains("sidebar-collapsed");
    apply(collapsed);
    if (collapsed) pin.blur(); // ไม่ให้โฟกัสค้างที่ปุ่ม (แถบจะขยายค้างตอนมีโฟกัสจากคีย์บอร์ด)
    try { localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0"); } catch { /* ignore */ }
  });
}

function toggleTheme() {
  const theme = state.theme === "light" ? "dark" : "light";
  localStorage.setItem("ppg-theme-v2", theme);
  document.documentElement.dataset.theme = theme;
  state.theme = theme;
}

/** อักษรย่อ 2 ตัวจากชื่อ (ข้ามคำนำหน้า นาย/นางสาว/Mr.) — "Narakorn Pankord" → "NP" */
function initialsOf(name) {
  const words = String(name).replace(/^(?:นางสาว|นาง|นาย|mrs?\.?|ms\.?)\s+/i, "").split(/[\s@._]+/).filter(Boolean);
  return words.slice(0, 2).map((w) => [...w][0]).join("").toUpperCase();
}

function renderVersionLabel(nextState) {
  const versionLabel = qs("#app-version-label");
  if (!versionLabel) return;
  const text = `V${displayVersion(nextState)}`;
  if (versionLabel.textContent !== text) versionLabel.textContent = text;
}

// รูปโปรไฟล์ Microsoft 365 (ถ้ามี) — ไม่มีรูปใช้อักษรย่อชื่อ
// ใช้ var: boot() เรียก updateShell ตอนโมดูลยังประเมินไม่ถึงบรรทัดนี้ (let/const จะติด TDZ ทำให้แอปพังทั้งหน้า)
var avatarPhoto; // eslint-disable-line no-var
function renderAvatar(avatar, nextState) {
  avatarPhoto ||= { key: "", url: null, requested: false };
  const initials = initialsOf(nextState.user?.name || nextState.user?.email || "");
  const key = nextState.account?.homeAccountId || nextState.account?.username || "";
  if (key !== avatarPhoto.key) avatarPhoto = { key, url: null, requested: false };
  if (key && !avatarPhoto.requested) {
    avatarPhoto.requested = true;
    getMyPhoto(nextState.account).then((url) => {
      if (avatarPhoto.key !== key) return;
      avatarPhoto.url = url;
      renderAvatar(avatar, state);
    });
  }
  if (avatarPhoto.url) {
    if (avatar.dataset.photo !== avatarPhoto.url.slice(-32)) {
      avatar.dataset.photo = avatarPhoto.url.slice(-32);
      avatar.classList.add("has-photo");
      avatar.innerHTML = `<img src="${avatarPhoto.url}" alt="" />`;
    }
  } else if (avatar.textContent !== initials || avatar.classList.contains("has-photo")) {
    avatar.classList.remove("has-photo");
    delete avatar.dataset.photo;
    avatar.textContent = initials;
  }
}

function updateShell(nextState) {
  renderVersionLabel(nextState);
  const roleChip = qs("#user-role-chip");
  if (roleChip) roleChip.textContent = nextState.user?.roleLabel || "";
  const userName = qs("#sidebar-user-name");
  if (userName) userName.textContent = nextState.user?.name || "";
  // การ์ดผู้ใช้ในแถบเมนู: วงกลมอักษรย่อ (ไม่มีรูปโปรไฟล์จาก M365 ในระบบนี้)
  const userCard = qs("#sidebar-user-card");
  if (userCard) userCard.hidden = !nextState.account;
  const avatar = qs("#sidebar-avatar");
  if (avatar) renderAvatar(avatar, nextState);
  const newRequest = qs("#sidebar-new-request");
  if (newRequest) newRequest.hidden = !nextState.account || nextState.user?.role === "viewer";
  const logoutButton = qs("#logout-button");
  if (logoutButton) logoutButton.hidden = !nextState.account;
  const loginButton = qs("#login-button");
  if (loginButton) loginButton.hidden = Boolean(nextState.account);
  const authNote = qs("#sidebar-auth-note");
  if (authNote) authNote.hidden = Boolean(nextState.account);
  renderViewAsSwitcher(nextState);
}

/**
 * ปุ่มสลับมุมมอง — แสดงใต้ชื่อผู้ใช้ เฉพาะผู้ที่มีสิทธิ์จริงเป็นผู้จัดการ
 *
 * หมายเหตุสำคัญ: applyState() ถูกเรียกทุกครั้งที่ state เปลี่ยน ถ้าสร้าง HTML ใหม่ทั้งก้อนทุกครั้ง
 * ปุ่มจะถูกทำลายและสร้างใหม่ตลอดเวลา ทำให้ event listener หลุดและกดปุ่มไม่ติด
 * จึงสร้างโครงปุ่มครั้งเดียว แล้วอัปเดตเฉพาะสถานะที่เปลี่ยนจริงเท่านั้น
 */
function renderViewAsSwitcher(nextState) {
  const box = qs("#view-as-switcher");
  if (!box) return;

  const user = nextState.user;
  if (!nextState.account || !canSwitchView(user)) {
    box.hidden = true;
    box.innerHTML = "";
    box.dataset.builtFor = "";
    document.body.classList.remove("viewing-as-other");
    return;
  }

  box.hidden = false;

  // สร้างโครงครั้งเดียวต่อผู้ใช้หนึ่งคน
  if (box.dataset.builtFor !== user.email) {
    box.dataset.builtFor = user.email;
    box.innerHTML = `
      <div class="view-as-title">🔄 มุมมองที่กำลังดู</div>
      <div class="view-as-options">
        ${VIEW_AS_OPTIONS.map((o) => `
          <button type="button" class="view-as-btn" data-view-as="${o.role}" title="${o.desc}">
            <span class="view-as-icon">${o.icon}</span>
            <span class="view-as-label">${o.label}</span>
            ${o.role === user.actualRole ? '<span class="view-as-self">(ของคุณ)</span>' : ""}
          </button>
        `).join("")}
      </div>
      <div class="view-as-warning" hidden>⚠️ กำลังดูในมุมมองอื่น ไม่ใช่มุมมองจริงของคุณ</div>
    `;

    box.querySelectorAll("[data-view-as]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.viewAs;
        if (target === state.user.role) return;      // กดซ้ำมุมมองเดิม ไม่ต้องทำอะไร
        if (!switchViewTo(target)) return;

        const label = VIEW_AS_OPTIONS.find((o) => o.role === target)?.label || target;
        showToast(`🔄 เปลี่ยนเป็นมุมมอง: ${label}`, "info");

        // กลับหน้าภาพรวมเสมอ เพราะหน้าที่ค้างอยู่อาจไม่มีสิทธิ์เข้าถึงในมุมมองใหม่
        navigate("/dashboard");
        refreshNavBadges();
      });
    });
  }

  // อัปเดตเฉพาะสถานะ — ไม่แตะโครง DOM เดิม ปุ่มจึงไม่หลุด listener
  const viewingOther = isViewingAsOther(user);
  document.body.classList.toggle("viewing-as-other", viewingOther);
  box.querySelectorAll("[data-view-as]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.viewAs === user.role);
  });
  const warn = box.querySelector(".view-as-warning");
  if (warn) warn.hidden = !viewingOther;
}

// ── PWA: ลงทะเบียน Service Worker เพื่อให้ "เพิ่มลงหน้าจอโฮม" ได้ทั้ง Android/iOS ──
// ไม่ block boot flow หลัก — ถ้าลงทะเบียนไม่สำเร็จ แอปยังใช้งานได้ปกติทุกอย่างผ่านเครือข่าย
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").then((registration) => {
      // เช็คอัปเดตทันทีตอนโหลดหน้า — ไม่ต้องรอ browser เช็คเองตามรอบ (อาจช้าถึง 24 ชม.)
      registration.update().catch(() => {});

      // กลับมาที่แท็บ/แอปอีกครั้ง (เช่น สลับแอปแล้วกลับมา) → เช็คอัปเดตซ้ำ
      // สำคัญสำหรับ PWA ที่เปิดค้างไว้นานบนมือถือ ไม่ปิดแอปเอง
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") registration.update().catch(() => {});
      });

      // มี Service Worker เวอร์ชันใหม่เข้าควบคุมหน้านี้ → reload ครั้งเดียวอัตโนมัติ
      // เพื่อให้ผู้ใช้ได้โค้ด/CSS ล่าสุดทันที ไม่ต้องกดรีเฟรชเองหลายรอบ
      // กัน loop ด้วย sessionStorage flag (reload ได้แค่ครั้งเดียวต่อ session)
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        if (sessionStorage.getItem("sw-reloaded") === "1") return;
        refreshing = true;
        sessionStorage.setItem("sw-reloaded", "1");
        showToast("🔄 มีอัปเดตใหม่ กำลังโหลดเวอร์ชันล่าสุด...", "info");
        setTimeout(() => window.location.reload(), 600);
      });
    }).catch((error) => {
      console.warn("Service worker registration failed (non-critical):", error.message);
    });
  });
}
