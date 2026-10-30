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

// ── reveal animation เล่นเฉพาะตอน "เปลี่ยนหน้า" ──
// router re-render ทั้งหน้าทุกครั้งที่ polling เจอข้อมูลใหม่ — ถ้าอยู่หน้าเดิมให้ข้าม animation ไม่ให้หน้ากระพริบ
// (MutationObserver ทำงานก่อน browser paint จึงไม่เห็นเฟรมที่ fade ค้าง)
(function () {
  const view = document.getElementById("app-view");
  if (!view) return;
  let lastRoute = null;
  new MutationObserver(() => {
    const route = location.hash || "#/dashboard";
    view.classList.toggle("is-refresh", route === lastRoute);
    lastRoute = route;
  }).observe(view, { childList: true });
})();
