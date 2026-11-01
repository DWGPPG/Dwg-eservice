// ══════════════════════════════════════════════════════════════
// สไลด์ทีมงานฝ่ายเขียนแบบ (หน้าภาพรวม เหนือ "สรุปสถานการณ์งานเขียนแบบ")
// รูปแบบตามวิดีโอตัวอย่าง: ภาพเต็มพื้นหลัง + ชื่อตัวใหญ่ + การ์ดคนถัดไปเรียงขวา + ลูกศร/แถบความคืบหน้า/เลขสไลด์
//  - สไลด์แรก = ภาพรวมทั้งฝ่าย, สไลด์ต่อไป = สมาชิกแต่ละคน (รูปอัปโหลดได้ในหน้าจัดการข้อมูล → ทีม & สิทธิ์)
//  - แสดงโครงการ, รายการ Drawing ที่กำลังทำ, Workload/ภาระงานรายวัน, Quality Score, เกินกำหนด, ยกเลิก,
//    ส่งมอบแล้ว, ส่งตรงเวลา, FTR, เกินกำหนด(ตอนนี้), เวลาเฉลี่ย รับ→ส่งมอบ
//  - เลื่อนเองทุก 9 วินาที (หยุดเมื่อชี้เมาส์/ผู้ใช้ตั้งค่าลดการเคลื่อนไหว) · คลิกการ์ดเพื่อเปิดคนนั้น
// ══════════════════════════════════════════════════════════════

import { STATUS } from "../../../config/schema.js";
import { getDrawingTeamMembers } from "../services/team-service.js";
import { COVER_KEY, hydrateTeamPhotos } from "../services/team-photo-service.js";
import { escapeHtml } from "../utils.js";
import { openRequestDetail } from "./track.js";

const NO_WORKLOAD = [STATUS.MGR_REVIEW, STATUS.DELIVERED, STATUS.DONE, STATUS.CANCELLED, STATUS.REJECTED];
const DELIVERED = [STATUS.DELIVERED, STATUS.DONE];
const AUTOPLAY_MS = 9000;

const PERIODS = {
  month: "เดือนนี้",
  year: "ปีนี้",
  all: "ทั้งหมด",
};

// คงค่าไว้ข้ามการวาดใหม่ (polling วาดหน้าภาพรวมใหม่เมื่อข้อมูลเปลี่ยน)
const ui = { index: 0, period: "year", timer: null };

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);
const norm = (v) => String(v || "").trim().toLowerCase();

function periodStart(key) {
  const now = new Date();
  if (key === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (key === "year") return new Date(now.getFullYear(), 0, 1);
  return null;
}

/** ตัวชี้วัดของชุดคำร้อง (คนเดียว หรือทั้งฝ่าย) — นิยามเดียวกับรายงาน/บทสรุปผู้บริหาร */
function metricsFor(rows, periodKey, teamActive) {
  const from = periodStart(periodKey);
  const inPeriod = (v) => {
    if (!from) return true;
    const d = new Date(v);
    return !Number.isNaN(d.getTime()) && d >= from;
  };
  const today = dayKey(new Date());

  const active = rows.filter((r) => !NO_WORKLOAD.includes(r.status));
  const dueToday = active.filter((r) => r.dueDate && dayKey(r.dueDate) === today).length;
  const overdueNow = active.filter((r) => r.dueDate && dayKey(r.dueDate) < today).length;

  const delivered = rows.filter((r) => DELIVERED.includes(r.status) && inPeriod(r.deliveredAt || r.doneAt));
  const withDue = delivered.filter((r) => r.dueDate && (r.deliveredAt || r.doneAt));
  const onTime = withDue.filter((r) => dayKey(r.deliveredAt || r.doneAt) <= dayKey(r.dueDate)).length;
  const lateDelivered = withDue.length - onTime;
  const ftr = delivered.filter((r) => !r.isRevision && !r.revisionReason).length;
  const cyc = delivered.filter((r) => r.submittedAt && r.deliveredAt);
  const avgCycle = cyc.length
    ? Math.round((cyc.reduce((s, r) => s + (new Date(r.deliveredAt) - new Date(r.submittedAt)) / 86400000, 0) / cyc.length) * 10) / 10
    : null;
  const cancelled = rows.filter((r) => r.status === STATUS.CANCELLED && inPeriod(r.cancelledAt || r.submittedAt)).length;

  // Drawing Quality Score — เฉพาะงานแก้ไขสาเหตุ 1.1 (ฝ่ายเขียนแบบ): แก้ < 4 ครั้ง = 100, ≥ 4 = 20 · ไม่มีเลย = 100
  const q = rows.filter((r) => inPeriod(r.submittedAt) && r.revisionSource === "1.1")
    .map((r) => ((parseInt(r.revisionCount || "1", 10) || 1) >= 4 ? 20 : 100));
  const quality = q.length ? Math.round(q.reduce((s, v) => s + v, 0) / q.length) : 100;

  // โครงการ (จากงานในช่วงเวลา + งานที่ถืออยู่) เรียงตามจำนวนงาน
  const projectCounts = new Map();
  [...active, ...rows.filter((r) => inPeriod(r.submittedAt))].forEach((r) => {
    if (!r.projectName) return;
    projectCounts.set(r.projectName, (projectCounts.get(r.projectName) || 0) + 1);
  });
  const projects = [...projectCounts.entries()].sort((a, b) => b[1] - a[1]);

  const drawings = [...active].sort((a, b) => String(a.dueDate || "9").localeCompare(String(b.dueDate || "9")));

  return {
    active: active.length,
    dueToday,
    overdueNow,
    delivered: delivered.length,
    onTimeRate: pct(onTime, withDue.length),
    ftrRate: pct(ftr, delivered.length),
    avgCycle,
    cancelled,
    lateTotal: lateDelivered + overdueNow,
    quality,
    share: teamActive ? Math.round((active.length / teamActive) * 100) : 0,
    projects,
    drawings,
  };
}

function buildSlides(requests, periodKey) {
  const team = getDrawingTeamMembers();
  const teamEmails = new Set(team.map((m) => norm(m.email)));
  const teamRows = requests.filter((r) => teamEmails.has(norm(r.assignedToEmail)));
  const teamActive = teamRows.filter((r) => !NO_WORKLOAD.includes(r.status)).length;
  const slides = [{
    key: COVER_KEY,
    kicker: "Prime Power Group · Drawing Dept.",
    title: "ฝ่ายเขียนแบบ",
    sub: `${team.length} คนในทีม`,
    m: metricsFor(requests, periodKey, 0),
    isTeam: true,
  }];
  team.forEach((member) => {
    const rows = requests.filter((r) => norm(r.assignedToEmail) === norm(member.email));
    const m = metricsFor(rows, periodKey, teamActive);
    slides.push({
      key: norm(member.email),
      kicker: member.displayLabel || member.role || (member.isAdmin ? "ผู้จัดการ" : "ฝ่ายเขียนแบบ"),
      title: member.name || member.email,
      sub: m.active ? `ถืองานอยู่ ${m.active} งาน · ${m.share}% ของทีม` : "ไม่มีงานค้าง",
      m,
    });
  });
  // คนที่มีงานมากก่อน (คงสไลด์ทั้งฝ่ายไว้แรกสุด)
  const [first, ...rest] = slides;
  rest.sort((a, b) => b.m.active - a.m.active || b.m.delivered - a.m.delivered);
  return [first, ...rest];
}

const initials = (name) => String(name || "").replace(/^(?:นางสาว|นาง|นาย|mrs?\.?|ms\.?)\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join("").toUpperCase();

function kpi(label, value, tone = "") {
  return `<div class="ts-kpi ${tone}"><span>${label}</span><strong>${value}</strong></div>`;
}

function slideBody(slide) {
  const { m } = slide;
  const fmtPct = (v) => (v === null ? "—" : `${v}%`);
  const today = dayKey(new Date());
  return `
    <p class="ts-kicker"><i aria-hidden="true"></i>${escapeHtml(slide.kicker)}</p>
    <h2 class="ts-title">${escapeHtml(slide.title)}</h2>
    <p class="ts-sub">${escapeHtml(slide.sub)}</p>
    <div class="ts-kpis">
      ${kpi("Workload รายวัน", m.active, m.active ? "is-neon" : "")}
      ${kpi("ภาระงานวันนี้ (ครบกำหนด)", m.dueToday, m.dueToday ? "is-amber" : "")}
      ${kpi("Drawing Quality Score", `${m.quality}%`, m.quality >= 80 ? "is-neon" : "is-red")}
      ${kpi("งานเกินกำหนด", m.lateTotal, m.lateTotal ? "is-red" : "")}
      ${kpi("งานที่ถูกยกเลิก", m.cancelled)}
      ${kpi("ส่งมอบแล้ว", m.delivered)}
      ${kpi("ส่งตรงเวลา", fmtPct(m.onTimeRate), m.onTimeRate !== null && m.onTimeRate < 90 ? "is-amber" : "")}
      ${kpi("ผ่านครั้งแรก (FTR)", fmtPct(m.ftrRate), m.ftrRate !== null && m.ftrRate < 80 ? "is-amber" : "")}
      ${kpi("เกินกำหนด (ตอนนี้)", m.overdueNow, m.overdueNow ? "is-red" : "")}
      ${kpi("เวลาเฉลี่ย รับ→ส่งมอบ", m.avgCycle === null ? "—" : `${m.avgCycle} วัน`)}
    </div>
    <div class="ts-lists">
      <div class="ts-list">
        <h3>📁 โครงการ <small>${m.projects.length}</small></h3>
        <div class="ts-chips">
          ${m.projects.slice(0, 8).map(([name, n]) => `<span class="ts-chip">${escapeHtml(name)} <b>${n}</b></span>`).join("") || `<span class="ts-empty">—</span>`}
          ${m.projects.length > 8 ? `<span class="ts-chip is-more">+${m.projects.length - 8}</span>` : ""}
        </div>
      </div>
      <div class="ts-list">
        <h3>📐 Drawing ที่กำลังทำ <small>${m.drawings.length}</small></h3>
        <ul class="ts-drawings">
          ${m.drawings.slice(0, 4).map((r) => {
            const due = dayKey(r.dueDate);
            const cls = due && due < today ? "is-late" : due === today ? "is-today" : "";
            return `<li><button type="button" class="ts-drawing ${cls}" data-request-detail="${escapeHtml(r.requestNo)}">
              <b>${escapeHtml(r.drawingNo || r.requestNo)}</b><span>${escapeHtml(r.drawingName || r.projectName || "")}</span>
              <em>${r.dueDate ? new Date(r.dueDate).toLocaleDateString("th-TH", { day: "numeric", month: "short" }) : "—"}</em></button></li>`;
          }).join("") || `<li class="ts-empty">ไม่มีงานค้าง 🎉</li>`}
          ${m.drawings.length > 4 ? `<li class="ts-more">และอีก ${m.drawings.length - 4} งาน</li>` : ""}
        </ul>
      </div>
    </div>`;
}

function cardHtml(slide, index) {
  return `
    <button type="button" class="ts-card" data-ts-go="${index}" aria-label="ดู ${escapeHtml(slide.title)}">
      <span class="ts-card-photo" data-team-photo="${escapeHtml(slide.key)}"><b>${escapeHtml(slide.isTeam ? "DWG" : initials(slide.title))}</b></span>
      <span class="ts-card-text">
        <small>${escapeHtml(slide.kicker)}</small>
        <strong>${escapeHtml(slide.title)}</strong>
        <em>${slide.m.active} งาน</em>
      </span>
    </button>`;
}

export function renderTeamShowcase(state) {
  const section = document.createElement("section");
  section.className = "team-showcase";
  section.setAttribute("aria-label", "ทีมงานฝ่ายเขียนแบบ");
  const requests = state.requests || [];

  const draw = () => {
    const slides = buildSlides(requests, ui.period);
    ui.index = ((ui.index % slides.length) + slides.length) % slides.length;
    const current = slides[ui.index];
    const nextCards = [];
    // แสดงการ์ดของทุกคน (ไม่รวมสไลด์ที่เปิดอยู่) เรียงต่อจากคนปัจจุบัน
    for (let i = 1; i < slides.length; i++) nextCards.push((ui.index + i) % slides.length);

    section.innerHTML = `
      <div class="ts-bg" data-team-photo="${escapeHtml(current.key)}">
        <span class="ts-bg-initials" aria-hidden="true">${escapeHtml(current.isTeam ? "DWG" : initials(current.title))}</span>
      </div>
      <div class="ts-shade" aria-hidden="true"></div>
      <div class="ts-top">
        <span class="ts-brand">👥 ทีมงานฝ่ายเขียนแบบ</span>
        <div class="ts-periods" role="tablist">
          ${Object.entries(PERIODS).map(([k, label]) => `<button type="button" class="ts-period ${ui.period === k ? "is-active" : ""}" data-ts-period="${k}">${label}</button>`).join("")}
        </div>
      </div>
      <div class="ts-body">${slideBody(current)}</div>
      <div class="ts-cards">${nextCards.map((i) => cardHtml(slides[i], i)).join("")}</div>
      <div class="ts-nav">
        <button type="button" class="ts-arrow" data-ts-step="-1" aria-label="ก่อนหน้า">‹</button>
        <button type="button" class="ts-arrow" data-ts-step="1" aria-label="ถัดไป">›</button>
        <div class="ts-progress"><i style="width:${((ui.index + 1) / slides.length) * 100}%"></i></div>
        <span class="ts-number">${pad(ui.index + 1)}</span>
      </div>`;
    hydrateTeamPhotos(section);
  };

  const go = (index, fromCard = null) => {
    // การ์ดที่คลิกขยายเต็มกรอบก่อนเปลี่ยนสไลด์ (เหมือนในวิดีโอ)
    if (fromCard && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const box = section.getBoundingClientRect();
      const r = fromCard.getBoundingClientRect();
      const ghost = fromCard.querySelector(".ts-card-photo").cloneNode(true);
      ghost.className = "ts-ghost";
      Object.assign(ghost.style, { left: `${r.left - box.left}px`, top: `${r.top - box.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      section.appendChild(ghost);
      requestAnimationFrame(() => Object.assign(ghost.style, { left: "0px", top: "0px", width: `${box.width}px`, height: `${box.height}px`, borderRadius: "28px" }));
      setTimeout(() => { ui.index = index; draw(); }, 480);
      return;
    }
    ui.index = index;
    section.classList.add("is-switching");
    setTimeout(() => { draw(); section.classList.remove("is-switching"); }, 180);
  };

  section.addEventListener("click", (event) => {
    const detail = event.target.closest("[data-request-detail]");
    if (detail) {
      const request = requests.find((r) => r.requestNo === detail.dataset.requestDetail);
      if (request) openRequestDetail(request);
      return;
    }
    const step = event.target.closest("[data-ts-step]");
    if (step) { go(ui.index + Number(step.dataset.tsStep)); restart(); return; }
    const card = event.target.closest("[data-ts-go]");
    if (card) { go(Number(card.dataset.tsGo), card); restart(); return; }
    const period = event.target.closest("[data-ts-period]");
    if (period) { ui.period = period.dataset.tsPeriod; draw(); }
  });

  // เลื่อนอัตโนมัติ — timer เดียวทั้งหน้า (หน้าถูกวาดใหม่บ่อยจาก polling)
  let hovering = false;
  section.addEventListener("pointerenter", () => { hovering = true; });
  section.addEventListener("pointerleave", () => { hovering = false; });
  const restart = () => {
    clearInterval(ui.timer);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    ui.timer = setInterval(() => {
      if (!section.isConnected) { clearInterval(ui.timer); return; }
      if (hovering || document.hidden || document.querySelector("#modal-root")?.children.length) return;
      go(ui.index + 1);
    }, AUTOPLAY_MS);
  };

  draw();
  restart();
  return section;
}
