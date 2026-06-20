import { initAuth, login, logout, refreshUserRole } from "./auth.js";
import { initRouter, navigate } from "./router.js";
import { loadMasterData } from "./sharepoint.js";
import { hydrateRequests } from "./services/request-service.js";
import { state, subscribe } from "./state.js";
import { qs } from "./utils.js";
import { showToast } from "./components/toast.js";

document.addEventListener("DOMContentLoaded", boot);

async function boot() {
  document.documentElement.dataset.theme = state.theme;
  bindChrome();
  subscribe(updateShell);
  updateShell(state);

  const msal = await initAuth();
  if (state.account) {
    await afterSignedIn();
  } else {
    showAuthPanel(true);
    initRouter();
  }
}

async function afterSignedIn() {
  showAuthPanel(false);
  initRouter();
  try {
    await loadMasterData();
    refreshUserRole();
    await hydrateRequests();
    navigate();
  } catch (error) {
    console.error("Failed to load SharePoint data:", error);
    showToast("เชื่อมต่อ SharePoint ไม่สำเร็จ — กรุณา Refresh หน้าเว็บ", "error");
  }
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
}

function showAuthPanel(show) {
  const panel = qs("#auth-panel");
  if (panel) panel.hidden = !show;
  const view = qs("#app-view");
  if (view) view.hidden = show;
  const sidebar = document.querySelector(".sidebar");
  if (sidebar) sidebar.hidden = show;
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
