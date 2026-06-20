import { NAV_ITEMS, PAGE_TITLES } from "./constants.js";
import { state } from "./state.js";
import { qs, qsa } from "./utils.js";
import { renderDashboard } from "./pages/dashboard.js";
import { renderSubmit } from "./pages/submit.js";
import { renderTrack } from "./pages/track.js";
import { renderAdmin } from "./pages/admin.js";
import { renderReport } from "./pages/report.js";
import { renderGuide } from "./pages/guide.js";

const routes = {
  "/dashboard": renderDashboard,
  "/submit": renderSubmit,
  "/track": renderTrack,
  "/admin": renderAdmin,
  "/report": renderReport,
  "/guide": renderGuide,
};

export function initRouter() {
  renderNav();
  window.addEventListener("hashchange", navigate);
  navigate();
}

export function navigate() {
  renderNav();
  const requestedRoute = location.hash.replace("#", "");
  const route = normalizeRoute(requestedRoute);
  if (requestedRoute !== route) {
    history.replaceState(null, "", `${location.pathname}${location.search}#${route}`);
  }
  const view = qs("#app-view");
  const renderer = routes[route] || routes["/dashboard"];

  state.currentRoute = route;
  qs("#page-title").textContent = PAGE_TITLES[route] || "Dashboard";
  qsa(".nav-link").forEach((link) => link.classList.toggle("is-active", link.dataset.route === route));
  renderer(view, state);
  view.focus({ preventScroll: true });
}

function normalizeRoute(route) {
  const allowedRoutes = availableNavItems().map((item) => item.route);
  return routes[route] && allowedRoutes.includes(route) ? route : "/dashboard";
}

function renderNav() {
  qs("#main-nav").innerHTML = availableNavItems().map(
    (item) => `
      <a class="nav-link" href="#${item.route}" data-route="${item.route}">
        <span class="nav-icon" aria-hidden="true">${item.icon}</span>
        <span>${item.label}</span>
      </a>
    `
  ).join("");
}

function availableNavItems() {
  const role = state.user?.role || "viewer";
  return NAV_ITEMS.filter((item) => (item.roles || []).includes(role));
}
