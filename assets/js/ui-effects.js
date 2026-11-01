// ── เอฟเฟกต์ตกแต่งล้วนๆ (ไม่ยุ่งกับ state / workflow ของระบบ) ──
// บัตรล็อกอินแบบห้อยสายคล้อง: ลากได้ ปล่อยแล้วเด้งกลับแบบสปริง (เลียนแบบ dragElastic + bounce)
(function () {
  const badge = document.getElementById("auth-badge");
  if (!badge) return;
  const card = badge.querySelector(".auth-card");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!card || reduceMotion) return;

  const ELASTIC = 0.2;      // ลากได้ 20% ของระยะนิ้ว เหมือนของห้อยที่มีแรงดึงกลับ
  const STIFFNESS = 600;
  const DAMPING = 20;

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  let raf = 0;

  const apply = () => {
    card.style.transform = `translate(${x}px, ${y}px) rotate(${x * 0.06}deg)`;
  };

  function spring() {
    let last = performance.now();
    badge.classList.add("is-returning");
    const step = (now) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      vx += (-STIFFNESS * x - DAMPING * vx) * dt;
      vy += (-STIFFNESS * y - DAMPING * vy) * dt;
      x += vx * dt;
      y += vy * dt;
      apply();
      if (Math.abs(x) + Math.abs(y) + Math.abs(vx) + Math.abs(vy) > 0.2) {
        raf = requestAnimationFrame(step);
      } else {
        x = y = vx = vy = 0;
        card.style.transform = "";
        badge.classList.remove("is-returning");
      }
    };
    raf = requestAnimationFrame(step);
  }

  card.addEventListener("pointerdown", (event) => {
    // ปุ่มล็อกอินต้องกดได้ตามปกติ — ไม่เริ่มลากถ้ากดบนปุ่ม
    if (event.target.closest("button, a, input")) return;
    cancelAnimationFrame(raf);
    dragging = true;
    startX = event.clientX - x / ELASTIC;
    startY = event.clientY - y / ELASTIC;
    badge.classList.add("is-dragging");
    card.setPointerCapture(event.pointerId);
  });

  card.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    x = (event.clientX - startX) * ELASTIC;
    y = (event.clientY - startY) * ELASTIC;
    apply();
  });

  const release = () => {
    if (!dragging) return;
    dragging = false;
    badge.classList.remove("is-dragging");
    vx = vy = 0;
    spring();
  };

  card.addEventListener("pointerup", release);
  card.addEventListener("pointercancel", release);
})();

// ── reveal animation เล่นเฉพาะตอน "เปลี่ยนหน้า" + เอฟเฟกต์หน้าภาพรวม ──
// router re-render ทั้งหน้าทุกครั้งที่ polling เจอข้อมูลใหม่ — ถ้าอยู่หน้าเดิมให้ข้าม animation ไม่ให้หน้ากระพริบ
// (MutationObserver ทำงานก่อน browser paint จึงไม่เห็นเฟรมที่ fade ค้าง)
(function () {
  const view = document.getElementById("app-view");
  if (!view) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const isDashboard = () => (location.hash || "#/dashboard").startsWith("#/dashboard");
  let lastRoute = null;
  let pending = false;
  let animateNext = true;

  const syncRouteClass = () => document.body.classList.toggle("route-dashboard", isDashboard() && !view.hidden);
  window.addEventListener("hashchange", syncRouteClass);

  let refreshNext = false;
  new MutationObserver((mutations) => {
    // สไลด์ทีมงานเปลี่ยนเนื้อหาเองทุกไม่กี่วินาที — ไม่ใช่การวาดหน้าใหม่ ไม่ต้องประมวลผลเอฟเฟกต์
    const relevant = mutations.filter((m) => m.target === view || !m.target.closest?.(".team-showcase"));
    if (!relevant.length) return;
    const pageRendered = relevant.some((m) => m.target === view);
    if (pageRendered) {
      const route = location.hash || "#/dashboard";
      const refresh = route === lastRoute;
      view.classList.toggle("is-refresh", refresh);
      lastRoute = route;
      refreshNext = refresh;
    } else {
      refreshNext = false; // เปลี่ยนแค่บางส่วนในหน้า (เช่นเปลี่ยนตัวกรอง KPI) = ผู้ใช้กดเอง → เล่นเอฟเฟกต์เต็ม
    }
    animateNext = true;
    syncRouteClass();
    if (!pending && isDashboard()) {
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        enhanceDashboard(animateNext && !reduceMotion, refreshNext);
      });
    }
  }).observe(view, { childList: true, subtree: true });

  // ══════════════ หน้าภาพรวม: การ์ดกระจก / blur-in / ตัวเลขนับขึ้น / แท่งโต / กราฟวาดเส้น ══════════════
  let revealObserver = null;

  // อยู่ในจอตอนนี้ไหม (ใช้ตอนข้อมูลอัปเดตแล้วหน้าวาดใหม่: ส่วนที่เห็นอยู่ไม่เล่นซ้ำ กันกระพริบ
  // ส่วนที่ยังไม่ได้เลื่อนลงไปดู ยังเล่นเอฟเฟกต์ตอนเลื่อนมาถึงตามปกติ)
  const onScreen = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight && r.height > 0;
  };

  function enhanceDashboard(animate, refresh = false) {
    if (!isDashboard()) return;
    const fresh = new Set([...view.querySelectorAll("*")].filter((el) => !el.dataset.fx && !el.closest(".team-showcase")));
    if (!fresh.size) return;
    fresh.forEach((el) => { el.dataset.fx = "1"; });

    // การ์ด = กล่องพื้นทึบมุมโค้ง ขนาดพอสมควร (ส่วนใหญ่เป็น inline style จาก report.js จึงต้องดูจาก computed style)
    const cards = [...fresh].filter(isCardLike);
    cards.forEach((el) => {
      const outer = !el.parentElement.closest(".fx-glass");
      el.classList.add(outer ? "fx-glass" : "fx-glass-inner");
      if (outer && finePointer) bindSpotlight(el);
    });

    if (!animate) return;
    const outerCards = cards.filter((el) => el.classList.contains("fx-glass"));
    let revealTargets = [...view.querySelectorAll(".dash-hero-head, .dash-hero-tile"), ...outerCards]
      .filter((el) => fresh.has(el));
    const skipNow = refresh ? new Set([...revealTargets, ...view.querySelectorAll(".dash-hero")].filter(onScreen)) : new Set();
    revealTargets = revealTargets.filter((el) => !skipNow.has(el));
    reveal(revealTargets);

    // ตัวเลขนับขึ้น + แท่ง/กราฟ — เล่น "ทีละชิ้น" เมื่อชิ้นนั้นเลื่อนมาเห็น
    // (เดิมผูกกับทั้งการ์ด: การ์ดใหญ่ที่โผล่ขอบบนในจอตอนข้อมูลอัปเดต ทำให้ตัวเลขทั้งการ์ดไม่วิ่งเลย)
    const candidates = [...fresh].filter(isAnimatable);
    candidates.forEach((el) => {
      if (refresh && onScreen(el)) { el.dataset.fxPlayed = "1"; return; } // เห็นอยู่แล้ว → ไม่นับใหม่ กันกระพริบ
      playObserver.observe(el);
    });
  }

  // ชิ้นที่เล่นเอฟเฟกต์ได้: ตัวเลขล้วน / แถบ progress (inline width:%) / กราฟ SVG
  function isAnimatable(el) {
    if (el.dataset.fxPlayed) return false;
    if (el.closest(".team-showcase, button, select, option, th")) return false;
    if (el.tagName === "svg") return true;
    if (el.closest("svg")) return false;
    if (!el.children.length && NUMBER_RE.test(el.textContent.trim())) return true;
    const style = el.getAttribute("style") || "";
    return /(?:^|;)\s*width:\s*[\d.]+%/.test(style) && /background/.test(style);
  }

  const playObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      playObserver.unobserve(entry.target);
      const el = entry.target;
      if (el.dataset.fxPlayed) return;
      if (el.tagName === "svg") drawSvg(el);
      else if (!el.children.length && countUp(el)) { /* นับขึ้นแล้ว */ }
      else growBar(el);
    });
  }, { threshold: 0.2, rootMargin: "0px 0px -30px 0px" });

  function isCardLike(el) {
    if (el.closest(".dash-hero, .team-column-chart") || el.matches("button, a, input, select, textarea, option, svg *, table *, .badge, i, b, em, strong, span, small")) return false;
    if (el.offsetWidth < 140 || el.offsetHeight < 56) return false;
    const cs = getComputedStyle(el);
    if (parseFloat(cs.borderTopLeftRadius) < 8) return false;
    const rgba = cs.backgroundColor.match(/[\d.]+/g);
    const alpha = rgba ? (rgba[3] === undefined ? 1 : Number(rgba[3])) : 0;
    return alpha > 0.85 || cs.backgroundImage.includes("gradient");
  }

  function reveal(targets) {
    if (!targets.length) return;
    revealObserver ||= new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      visible.forEach((entry, i) => {
        entry.target.style.transitionDelay = `${Math.min(i, 8) * 70}ms`;
        entry.target.classList.add("fx-in");
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });
    targets.forEach((el) => {
      el.classList.add("fx-reveal");
      el.addEventListener("transitionend", () => { el.style.transitionDelay = ""; }, { once: true });
      revealObserver.observe(el);
    });
  }



  // ── ตัวเลขนับขึ้นจาก 0 (คงรูปแบบเดิม: คอมมา ทศนิยม %) ──
  const NUMBER_RE = /^([+-]?)(\d[\d,]*)(\.\d+)?(%?)$/;
  function countUp(el) {
    const text = el.textContent.trim();
    const m = text.match(NUMBER_RE);
    if (!m || el.closest("select, option, th, button")) return false;
    const target = Number((m[2] + (m[3] || "")).replace(/,/g, ""));
    if (!Number.isFinite(target) || target === 0) return false;
    el.dataset.fxPlayed = "1";
    const decimals = m[3] ? m[3].length - 1 : 0;
    const useComma = m[2].includes(",");
    const format = (n) => {
      const fixed = n.toFixed(decimals);
      const [int, dec] = fixed.split(".");
      return m[1] + (useComma ? Number(int).toLocaleString("en-US") : int) + (dec ? `.${dec}` : "") + m[4];
    };
    const duration = 900 + Math.min(target, 400) * 1.2;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(2, -10 * t); // easeOutExpo
      el.textContent = format(target * (t >= 1 ? 1 : eased));
      if (t < 1) requestAnimationFrame(step);
    };
    el.textContent = format(0);
    requestAnimationFrame(step);
    return true;
  }

  // ── แถบ progress (inline width:%) โตจาก 0 ──
  function growBar(el) {
    const style = el.getAttribute("style") || "";
    const m = style.match(/(?:^|;)\s*width:\s*([\d.]+%)/);
    if (!m || el.offsetHeight > 20 || el.offsetHeight === 0 || parseFloat(m[1]) === 0) return false;
    if (!/background/.test(style)) return false;
    el.dataset.fxPlayed = "1";
    el.animate([{ width: "0%" }, { width: m[1] }], { duration: 1100, easing: "cubic-bezier(0.32, 0.72, 0, 1)", delay: 120 });
    return true;
  }

  // ── กราฟ SVG: เส้นวาดตัวเอง, แท่งโตจากล่าง, จุดค่อยๆ โผล่ ──
  function drawSvg(svg) {
    if (svg.dataset.fxPlayed || svg.closest("button")) return;
    svg.dataset.fxPlayed = "1";
    svg.querySelectorAll("path, polyline").forEach((path) => {
      const fill = getComputedStyle(path).fill;
      if (fill && fill !== "none" && !fill.includes("rgba(0, 0, 0, 0)")) {
        path.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 900, delay: 500, easing: "ease-out", fill: "backwards" });
        return;
      }
      const len = path.getTotalLength?.() || 0;
      if (!len) return;
      path.animate(
        [{ strokeDasharray: `${len}`, strokeDashoffset: `${len}` }, { strokeDasharray: `${len}`, strokeDashoffset: "0" }],
        { duration: 1400, easing: "cubic-bezier(0.65, 0, 0.35, 1)" }
      );
    });
    svg.querySelectorAll("rect").forEach((rect, i) => {
      if (Number(rect.getAttribute("height")) <= 2) return;
      rect.style.transformBox = "fill-box";
      rect.style.transformOrigin = "50% 100%";
      rect.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }],
        { duration: 800, delay: 150 + i * 30, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "backwards" });
    });
    svg.querySelectorAll("circle").forEach((circle, i) => {
      circle.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 700 + i * 12, fill: "backwards" });
    });
  }

  // ── แสงตามเมาส์บนการ์ด ──
  function bindSpotlight(el) {
    el.addEventListener("pointermove", (event) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${event.clientX - r.left}px`);
      el.style.setProperty("--my", `${event.clientY - r.top}px`);
    });
  }
})();

// ── เคอร์เซอร์เรืองแสง (ทุกหน้า): แสงนวลสีนีออนตามเมาส์ (ไม่มีวงกลม) ──
// ตกแต่งล้วนๆ: pointer-events: none ไม่บังการคลิก, ไม่ซ่อนเคอร์เซอร์จริง
// ปิดอัตโนมัติบนจอสัมผัส (มือถือ/แท็บเล็ต) และเมื่อผู้ใช้ตั้งค่า "ลดการเคลื่อนไหว"
(function () {
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!finePointer || reduceMotion) return;

  const glow = document.createElement("div");
  glow.className = "cursor-glow";
  glow.setAttribute("aria-hidden", "true");
  document.body.append(glow);

  let tx = -999, ty = -999;     // ตำแหน่งเมาส์จริง
  let gx = tx, gy = ty;         // แสง (ตามช้าๆ ให้ดูนุ่ม)
  let raf = 0;

  const loop = () => {
    gx += (tx - gx) * 0.16;
    gy += (ty - gy) * 0.16;
    glow.style.transform = `translate3d(${gx}px, ${gy}px, 0)`;
    // หยุดวาดเมื่อแสงตามทันแล้ว — ไม่กิน CPU ตอนเมาส์นิ่ง
    raf = Math.abs(tx - gx) + Math.abs(ty - gy) > 0.5 ? requestAnimationFrame(loop) : 0;
  };

  document.addEventListener("pointermove", (event) => {
    if (event.pointerType && event.pointerType !== "mouse") return;
    tx = event.clientX;
    ty = event.clientY;
    if (!document.body.classList.contains("cursor-fx-on")) {
      gx = tx; gy = ty; // เข้าหน้าจอครั้งแรก: วางตรงเมาส์เลย ไม่ลอยมาจากมุมจอ
      document.body.classList.add("cursor-fx-on");
    }
    if (!raf) raf = requestAnimationFrame(loop);
  }, { passive: true });

  document.documentElement.addEventListener("mouseleave", () => document.body.classList.remove("cursor-fx-on"));
  window.addEventListener("blur", () => document.body.classList.remove("cursor-fx-on"));
})();
