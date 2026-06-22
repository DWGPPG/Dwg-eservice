import { appConfig } from "../../config/config.js";
import { setState, state } from "./state.js";
import { showToast } from "./components/toast.js";
import { computeRole, roleLabel } from "./services/role-service.js";

// ── กลยุทธ์ auth: popup บน desktop, redirect บนมือถือ ──
// เหตุผล: iOS Safari (โดยเฉพาะตอนรันเป็น PWA แบบ standalone ที่ติดตั้งจากหน้าจอโฮม) มักบล็อก
// popup window ของ MSAL เงียบๆ หรือเปิดไม่ขึ้นเลย ส่วน Android Chrome ก็มีปัญหาบ้างเช่นกัน
// จึงต้องใช้ redirect flow บนมือถือแทน
//
// ปัญหาที่ตามมา: MSAL redirect ใช้ location.hash รับ token กลับมา (#code=...) ซึ่งชนกับ
// SPA router ของแอปนี้ที่ใช้ location.hash เป็น route (#/dashboard ฯลฯ) เหมือนกัน
// แก้ด้วยการเรียก handleRedirectPromise() ให้เสร็จสมบูรณ์ "ก่อน" initRouter() ถูกเรียกเสมอ
// (ดู main.js boot() — ลำดับนี้ห้ามสลับ) เพื่อให้ MSAL อ่าน hash ไปแล้วก่อนที่ router จะมาเขียนทับ

let msalInstance;
let signingIn = false;

export function isMobileDevice() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

export async function initAuth() {
  await ensureMsal();
  if (!window.msal) {
    showToast("ไม่สามารถโหลดระบบ Microsoft 365 ได้ กรุณาตรวจสอบอินเทอร์เน็ต", "error");
    return null;
  }

  msalInstance = new window.msal.PublicClientApplication({
    auth: {
      clientId: appConfig.azure.clientId,
      authority: appConfig.azure.authority,
      redirectUri: appConfig.azure.redirectUri,
      knownAuthorities: ["login.microsoftonline.com"],
    },
    cache: {
      cacheLocation: "localStorage",
      storeAuthStateInCookie: true,
    },
  });

  if (typeof msalInstance.initialize === "function") {
    await msalInstance.initialize();
  }

  // ── สำคัญ: ต้องเรียกก่อนอ่าน getAllAccounts() เพื่อให้ session ใหม่จาก redirect ถูกบันทึกก่อน ──
  let redirectResponse = null;
  try {
    redirectResponse = await msalInstance.handleRedirectPromise();
  } catch (error) {
    console.warn("handleRedirectPromise failed (non-critical):", error.message);
  }

  if (redirectResponse?.account) {
    if (!isAllowedAccount(redirectResponse.account)) {
      await signOutAccount(redirectResponse.account);
      showToast(`ใช้ได้เฉพาะบัญชี @${appConfig.azure.allowedDomain}`, "error");
      return msalInstance;
    }
    setActiveAccount(redirectResponse.account);
    setState({ accessToken: redirectResponse.accessToken || null });
    return msalInstance;
  }

  const account = msalInstance.getAllAccounts()[0];
  if (!account) return msalInstance;

  if (!isAllowedAccount(account)) {
    await signOutAccount(account);
    showToast(`ใช้ได้เฉพาะบัญชี @${appConfig.azure.allowedDomain}`, "error");
    return msalInstance;
  }

  setActiveAccount(account);
  try {
    await acquireToken();
  } catch {
    // Keep the remembered account; interactive token consent happens when needed.
  }
  return msalInstance;
}

export async function login() {
  if (signingIn) return null;
  if (!msalInstance) await initAuth();
  if (!msalInstance) throw new Error("ระบบ Microsoft 365 ยังไม่พร้อมใช้งาน");

  signingIn = true;
  const request = {
    scopes: appConfig.azure.scopes,
    prompt: "select_account",
  };

  try {
    // ลอง popup ก่อน — ถ้า browser บล็อก (COOP/popup blocker) ค่อย fallback เป็น redirect
    try {
      const response = await msalInstance.loginPopup(request);
      if (!isAllowedAccount(response.account)) {
        await signOutAccount(response.account);
        throw new Error(`ใช้ได้เฉพาะบัญชี @${appConfig.azure.allowedDomain}`);
      }
      setActiveAccount(response.account);
      setState({ accessToken: response.accessToken || null });
      return response.account;
    } catch (popupError) {
      // popup ถูกบล็อกหรือ COOP error → ใช้ redirect แทน
      const isBlocked = popupError.errorCode === "popup_window_error"
        || popupError.errorCode === "empty_window_error"
        || popupError.message?.includes("popup")
        || popupError.message?.includes("window");
      if (!isBlocked) throw popupError; // error อื่น (เช่น user cancel) throw ต่อ
      await msalInstance.loginRedirect(request);
      return null;
    }
  } finally {
    signingIn = false;
  }
}

export async function logout() {
  const account = state.account;
  setState({ account: null, user: null, accessToken: null, siteId: null, requests: [] });
  if (!account || !msalInstance) return;
  await msalInstance.logoutRedirect({ account, postLogoutRedirectUri: appConfig.azure.redirectUri });
}

export async function acquireToken() {
  if (!msalInstance || !state.account) return null;
  try {
    const response = await msalInstance.acquireTokenSilent({
      account: state.account,
      scopes: appConfig.azure.scopes,
    });
    setState({ accessToken: response.accessToken });
    return response.accessToken;
  } catch (error) {
    // หมายเหตุ: ไม่เรียก acquireTokenPopup() แบบ auto-fallback ที่นี่ เพราะถ้าฟังก์ชันนี้ถูกเรียก
    // ทันทีหลัง loginPopup() ปิดไปหมาดๆ (เช่นใน boot()/afterSignedIn()) MSAL จะตรวจพบว่ากำลัง
    // เปิด popup ซ้อนแล้ว throw "block_nested_popups" — ปล่อยให้ caller ตัดสินใจเองว่าจะขอ
    // interactive popup ใหม่หรือไม่ (ดู ensureInteractiveToken ด้านล่าง)
    console.warn("acquireTokenSilent failed:", error.message);
    setState({ accessToken: null });
    return null;
  }
}

/**
 * ใช้ตอนผู้ใช้กดปุ่มเอง (ไม่ใช่ตอน boot อัตโนมัติ) — ถ้า silent ล้มเหลวค่อยขอ token ใหม่แบบ interactive
 * ปลอดภัยเพราะถูกเรียกจาก user gesture ตรงๆ ไม่ใช่ตามหลัง popup login ที่เพิ่งปิด
 */
export async function ensureInteractiveToken() {
  const silent = await acquireToken();
  if (silent) return silent;
  if (!msalInstance || !state.account) return null;
  await msalInstance.acquireTokenRedirect({ account: state.account, scopes: appConfig.azure.scopes });
  return null;
}

function setActiveAccount(account) {
  msalInstance.setActiveAccount(account);
  const email = account.username;
  setState({
    account,
    user: {
      name: account.name || account.username?.split("@")[0] || "Microsoft 365 User",
      email,
      // หมายเหตุ: ตอน login DrawingTeam list ยังไม่โหลด — role นี้เป็นค่าประมาณ
      // (Lv.2 ตรวจถูกต้องทันทีเพราะมาจาก config, แต่ designer ต้องรอ refreshUserRole() เรียกซ้ำหลังโหลด masterData)
      role: computeRole(email),
      roleLabel: roleLabel(computeRole(email), email),
    },
  });
}

/**
 * เรียกซ้ำหลัง loadMasterData() เสร็จ เพื่ออัปเดต role ให้ถูกต้อง
 * (designer role ต้องเช็คกับ DrawingTeam list ซึ่งโหลดทีหลัง MSAL login)
 */
export function refreshUserRole() {
  if (!state.user?.email) return;
  const role = computeRole(state.user.email);
  setState({
    user: { ...state.user, role, roleLabel: roleLabel(role, state.user.email) },
  });
}

function isAllowedAccount(account) {
  const email = String(account?.username || "").toLowerCase();
  return email.endsWith(`@${appConfig.azure.allowedDomain.toLowerCase()}`);
}

async function signOutAccount(account) {
  if (!msalInstance || !account) return;
  try {
    await msalInstance.logoutRedirect({ account, postLogoutRedirectUri: appConfig.azure.redirectUri });
  } catch {
    // The local account is cleared even if logout redirect fails.
  }
}

async function ensureMsal() {
  if (window.msal) return true;
  const cdns = [
    "./assets/vendor/msal-browser.min.js",
    "https://alcdn.msauth.net/browser/2.38.2/js/msal-browser.min.js",
    "https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.38.2/lib/msal-browser.min.js",
    "https://unpkg.com/@azure/msal-browser@2.38.2/lib/msal-browser.min.js",
  ];

  for (const src of cdns) {
    try {
      await loadScript(src);
      if (window.msal) return true;
    } catch {
      // Try the next CDN, matching the production web fallback behavior.
    }
  }
  return false;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      script.remove();
      reject(new Error(`MSAL load timeout: ${src}`));
    }, 3500);
    script.src = src;
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error(`MSAL load failed: ${src}`));
    };
    document.head.appendChild(script);
  });
}
