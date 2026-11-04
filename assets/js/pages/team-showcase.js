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
import { COVER_KEY, listTeamPhotos, photoUrlSync, preloadPhoto } from "../services/team-photo-service.js";
import { escapeHtml } from "../utils.js";
import { legacyRequests, loadLegacy, onLegacyChange } from "../services/legacy-service.js";
import { leaveActiveNow } from "../services/owner-service.js";
import { openRequestDetail } from "./track.js";
import { openModal } from "../components/modal.js";

const NO_WORKLOAD = [STATUS.MGR_REVIEW, STATUS.DELIVERED, STATUS.DONE, STATUS.CANCELLED, STATUS.REJECTED];
const DELIVERED = [STATUS.DELIVERED, STATUS.DONE];
const AUTOPLAY_MS = 9000;

const PERIODS = {
  legacy: "ก่อนเริ่มระบบ",
  today: "วันนี้",
  week: "สัปดาห์นี้",
  month: "เดือนนี้",
  year: "ปีนี้",
  all: "ทั้งหมด",
  custom: "📅 เลือกช่วง",
};

// ประเภทงานสำหรับตารางแยกประเภท (ตามลำดับในหน้าส่งคำขอ)
const TYPE_ROWS = [
  { key: "Proposal", icon: "📋", label: "Proposal" },
  { key: "ขออนุญาต", icon: "🏛️", label: "ขออนุญาตก่อสร้าง" },
  { key: "เขียนแบบก่อสร้าง", icon: "🏗️", label: "เขียนแบบก่อสร้าง" },
  { key: "As-Built", icon: "🏁", label: "As-Built" },
  { key: "", icon: "📁", label: "อื่นๆ" },
];
const typeRowOf = (type) => {
  const t = String(type || "");
  return TYPE_ROWS.find((row) => row.key && t.includes(row.key)) || TYPE_ROWS[TYPE_ROWS.length - 1];
};

// คงค่าไว้ข้ามการวาดใหม่ (polling วาดหน้าภาพรวมใหม่เมื่อข้อมูลเปลี่ยน)
const ui = { index: 0, period: "all", timer: null, from: "", to: "" };

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);
const norm = (v) => String(v || "").trim().toLowerCase();

const parseDay = (key) => {
  const [y, m, d] = String(key || "").split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};

/** ช่วงที่เลือกเอง (YYYY-MM-DD) — ไม่ได้กรอกใช้ค่าเริ่มต้น: ต้นเดือนนี้ → วันนี้ */
function customRange() {
  const now = new Date();
  if (!ui.from) ui.from = dayKey(new Date(now.getFullYear(), now.getMonth(), 1));
  if (!ui.to) ui.to = dayKey(now);
  if (ui.from > ui.to) [ui.from, ui.to] = [ui.to, ui.from];
  const to = parseDay(ui.to);
  return { from: parseDay(ui.from), to: to ? new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1) : null };
}

/** ขอบเขตช่วงเวลา { from, to } (to = ไม่รวม) — null = ไม่จำกัด */
function periodBounds(key) {
  if (key === "custom") return customRange();
  return { from: periodStart(key), to: null };
}

function periodStart(key) {
  const now = new Date();
  if (key === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (key === "week") {
    const monday = (now.getDay() + 6) % 7; // สัปดาห์เริ่มวันจันทร์
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - monday);
  }
  if (key === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (key === "year") return new Date(now.getFullYear(), 0, 1);
  return null;
}

/** ตัวชี้วัดของชุดคำร้อง (คนเดียว หรือทั้งฝ่าย) — นิยามเดียวกับรายงาน/บทสรุปผู้บริหาร
 *  รวมข้อมูลคำขอก่อนเริ่มระบบ (legacy) ในสถิติย้อนหลัง แต่ไม่นับเป็นภาระงานปัจจุบัน */
function metricsFor(rows, periodKey, teamActive) {
  const { from, to } = periodBounds(periodKey);
  const inPeriod = (v) => {
    if (!from && !to) return true;
    const d = new Date(v);
    return !Number.isNaN(d.getTime()) && (!from || d >= from) && (!to || d < to);
  };
  const today = dayKey(new Date());
  const live = rows.filter((r) => !r.legacy);
  const legacy = rows.filter((r) => r.legacy);

  const active = live.filter((r) => !NO_WORKLOAD.includes(r.status));
  const dueToday = active.filter((r) => r.dueDate && dayKey(r.dueDate) === today).length;
  const isOverdueNow = (r) => r.dueDate && dayKey(r.dueDate) < today;
  const overdueNow = active.filter(isOverdueNow).length;

  const deliveredLive = live.filter((r) => DELIVERED.includes(r.status) && inPeriod(r.deliveredAt || r.doneAt));
  const deliveredLegacy = legacy.filter((r) => r.status === STATUS.DONE && inPeriod(r.submittedAt));
  const withDue = deliveredLive.filter((r) => r.dueDate && (r.deliveredAt || r.doneAt));
  const isLate = (r) => dayKey(r.deliveredAt || r.doneAt) > dayKey(r.dueDate);
  const lateDelivered = withDue.filter(isLate).length;
  const onTime = withDue.length - lateDelivered;
  const ftr = deliveredLive.filter((r) => !r.isRevision && !r.revisionReason).length;
  const cyc = deliveredLive.filter((r) => r.submittedAt && r.deliveredAt);
  const avgCycle = cyc.length
    ? Math.round((cyc.reduce((s, r) => s + (new Date(r.deliveredAt) - new Date(r.submittedAt)) / 86400000, 0) / cyc.length) * 10) / 10
    : null;
  const isCancelled = (r) => r.status === STATUS.CANCELLED && inPeriod(r.cancelledAt || r.submittedAt);
  const cancelled = rows.filter(isCancelled).length;
  const legacyOverdue = legacy.filter((r) => r.legacyOverdue > 0 && inPeriod(r.submittedAt));

  // Drawing Quality Score — เฉพาะงานแก้ไขสาเหตุ 1.1 (ฝ่ายเขียนแบบ): แก้ < 4 ครั้ง = 100, ≥ 4 = 20 · ไม่มีเลย = 100
  const q = live.filter((r) => inPeriod(r.submittedAt) && r.revisionSource === "1.1")
    .map((r) => ((parseInt(r.revisionCount || "1", 10) || 1) >= 4 ? 20 : 100));
  const quality = q.length ? Math.round(q.reduce((s, v) => s + v, 0) / q.length) : 100;

  // โครงการ (จากงานในช่วงเวลา + งานที่ถืออยู่) เรียงตามจำนวนงาน
  const projectCounts = new Map();
  const periodRows = rows.filter((r) => inPeriod(r.submittedAt));
  [...active, ...periodRows].forEach((r) => {
    if (!r.projectName) return;
    projectCounts.set(r.projectName, (projectCounts.get(r.projectName) || 0) + 1);
  });
  const projects = [...projectCounts.entries()].sort((a, b) => b[1] - a[1]);

  const drawings = [...active].sort((a, b) => String(a.dueDate || "9").localeCompare(String(b.dueDate || "9")));

  // แยกตามประเภทงาน: ทั้งหมด / ส่งช้า / ยกเลิก / เกินกำหนด
  const byType = TYPE_ROWS.map((row) => ({ ...row, total: 0, late: 0, cancelled: 0, overdue: 0 }));
  const bucket = (r) => byType[TYPE_ROWS.indexOf(typeRowOf(r.requestType))];
  periodRows.forEach((r) => { bucket(r).total += 1; });
  withDue.filter(isLate).forEach((r) => { bucket(r).late += 1; });
  rows.filter(isCancelled).forEach((r) => { bucket(r).cancelled += 1; });
  active.filter(isOverdueNow).forEach((r) => { bucket(r).overdue += 1; });
  legacyOverdue.forEach((r) => { bucket(r).overdue += 1; });

  return {
    active: active.length,
    total: periodRows.length,
    dueToday,
    overdueNow,
    delivered: deliveredLive.length + deliveredLegacy.length,
    onTimeRate: pct(onTime, withDue.length),
    ftrRate: pct(ftr, deliveredLive.length),
    avgCycle,
    cancelled,
    lateTotal: lateDelivered + overdueNow + legacyOverdue.length,
    quality,
    share: teamActive ? Math.round((active.length / teamActive) * 100) : 0,
    projects,
    drawings,
    byType,
  };
}

function buildSlides(liveRequests, periodKey) {
  const team = getDrawingTeamMembers();
  const legacy = legacyRequests();
  // ก่อนเริ่มระบบ = เฉพาะข้อมูลเดิม · ช่วงอื่น = ข้อมูลในระบบ + ข้อมูลเดิม (กรองตามวันที่)
  const requests = periodKey === "legacy" ? legacy : [...liveRequests, ...legacy];
  const ownedBy = (r, email) => (r.assignees ? r.assignees.includes(email) : norm(r.assignedToEmail) === email);
  const teamEmails = new Set(team.map((m) => norm(m.email)));
  const teamRows = liveRequests.filter((r) => teamEmails.has(norm(r.assignedToEmail)));
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
    const rows = requests.filter((r) => ownedBy(r, norm(member.email)));
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
    <p class="ts-sub">${escapeHtml(slide.sub)}${leaveBadge(slide, "is-inline")}</p>
    <div class="ts-kpis">
      ${kpi("งานทั้งหมด", m.total.toLocaleString("th-TH"), m.total ? "is-neon" : "")}
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
    ${typeTable(m)}
    <div class="ts-lists">
      <div class="ts-list">
        <h3>📁 โครงการ <small>${m.projects.length}</small></h3>
        <div class="ts-chips">
          ${m.projects.slice(0, 8).map(([name, n]) => `<span class="ts-chip">${escapeHtml(name)} <b>${n}</b></span>`).join("") || `<span class="ts-empty">—</span>`}
          ${m.projects.length > 8 ? `<button type="button" class="ts-chip is-more" data-ts-more="projects" title="ดูโครงการทั้งหมด">+${m.projects.length - 8} ดูทั้งหมด</button>` : ""}
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
          ${m.drawings.length > 4 ? `<li><button type="button" class="ts-more" data-ts-more="drawings">และอีก ${m.drawings.length - 4} งาน · ดูทั้งหมด ›</button></li>` : ""}
        </ul>
      </div>
    </div>`;
}

function typeTable(m) {
  const rows = m.byType.filter((r) => r.total || r.late || r.cancelled || r.overdue);
  const num = (n, tone) => `<td class="${n && tone ? tone : ""}">${n ? n.toLocaleString("th-TH") : "–"}</td>`;
  return `
    <div class="ts-types">
      <table>
        <thead><tr><th>ประเภทงาน</th><th>ทั้งหมด</th><th>ส่งช้า</th><th>ยกเลิก</th><th>เกินกำหนด</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><th><span aria-hidden="true">${r.icon}</span> ${escapeHtml(r.label)}</th>${num(r.total, "is-neon")}${num(r.late, "is-amber")}${num(r.cancelled, "")}${num(r.overdue, "is-red")}</tr>`).join("")
            || `<tr><td colspan="5" class="ts-empty">ไม่มีงานในช่วงนี้</td></tr>`}
        </tbody>
      </table>
    </div>`;
}

const photoStyle = (key) => {
  const url = photoUrlSync(key);
  return url ? ` style="background-image:url(&quot;${url.replace(/"/g, "%22")}&quot;)"` : "";
};

/** ป้ายวันลาของวันนี้ (StaffLeave) — "ลาเต็มวัน" / "ลาครึ่งวันเช้า" / "ลา 13:00–15:00" */
function leaveLabel(slide) {
  if (slide.isTeam) return "";
  const leave = leaveActiveNow(slide.key); // ลาครึ่งวันเช้าหายหลัง 12:00 · ระบุเวลาเองหายหลังเวลาสิ้นสุด
  if (!leave) return "";
  const period = String(leave.Period || "เต็มวัน").trim();
  return /^ครึ่งวัน|^เต็มวัน/.test(period) ? `ลา${period}` : `ลา ${period}`;
}

function leaveBadge(slide, extraClass = "") {
  const text = leaveLabel(slide);
  if (!text) return "";
  const note = leaveActiveNow(slide.key)?.Note;
  return `<span class="ts-leave ${extraClass}" title="${escapeHtml(note ? `${text} · ${note}` : text)}">🏖️ ${escapeHtml(text)}</span>`;
}

function cardHtml(slide, index) {
  const has = Boolean(photoUrlSync(slide.key));
  return `
    <button type="button" class="ts-card" data-ts-go="${index}" aria-label="ดู ${escapeHtml(slide.title)}">
      <span class="ts-card-photo ${has ? "has-photo" : ""}" data-photo-key="${escapeHtml(slide.key)}"${photoStyle(slide.key)}><b>${escapeHtml(slide.isTeam ? "DWG" : initials(slide.title))}</b></span>
      ${leaveBadge(slide)}
      <span class="ts-card-text">
        <small>${escapeHtml(slide.kicker)}</small>
        <strong>${escapeHtml(slide.title)}</strong>
        <em>${slide.m.active} งาน</em>
      </span>
    </button>`;
}

/** รายการทั้งหมด (โครงการ / งานที่กำลังทำ) ของสไลด์ปัจจุบัน — เปิดเป็นหน้าต่าง ค้นหาได้ */
function openMoreList(slide, kind, requests) {
  const { m } = slide;
  const today = dayKey(new Date());
  const isProjects = kind === "projects";
  const rows = isProjects
    ? m.projects.map(([name, n]) => `
        <li class="ts-more-row" data-search="${escapeHtml(name.toLowerCase())}">
          <span class="ts-more-main">${escapeHtml(name)}</span><b>${n} งาน</b>
        </li>`).join("")
    : m.drawings.map((r) => {
        const due = dayKey(r.dueDate);
        const cls = due && due < today ? "is-late" : due === today ? "is-today" : "";
        const search = `${r.requestNo} ${r.drawingNo || ""} ${r.drawingName || ""} ${r.projectName || ""}`.toLowerCase();
        return `
        <li class="ts-more-row" data-search="${escapeHtml(search)}">
          <button type="button" class="ts-more-link" data-more-detail="${escapeHtml(r.requestNo)}">
            <span class="ts-more-main"><b>${escapeHtml(r.drawingNo || r.requestNo)}</b> ${escapeHtml(r.drawingName || "")}<small>${escapeHtml(r.projectName || "")} · ${escapeHtml(r.requestNo)}${slide.isTeam && r.assignedToName ? ` · ${escapeHtml(r.assignedToName)}` : ""}</small></span>
            <em class="${cls}">${r.dueDate ? new Date(r.dueDate).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }) : "—"}</em>
          </button>
        </li>`;
      }).join("");
  const count = isProjects ? m.projects.length : m.drawings.length;
  const close = openModal({
    title: `${isProjects ? "📁 โครงการ" : "📐 Drawing ที่กำลังทำ"} — ${slide.title} (${count.toLocaleString("th-TH")})`,
    body: `
      <div class="ts-more-panel">
        <input type="search" class="manage-search" placeholder="ค้นหา${isProjects ? "โครงการ" : "เลข Drawing / ชื่อ / โครงการ"}..." data-more-search />
        <ul class="ts-more-list">${rows}</ul>
      </div>`,
    actions: [{ label: "ปิด" }],
  });
  const panel = document.querySelector(".ts-more-panel");
  if (!panel) return;
  panel.querySelector("[data-more-search]").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    panel.querySelectorAll(".ts-more-row").forEach((row) => { row.hidden = Boolean(q) && !row.dataset.search.includes(q); });
  });
  panel.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-more-detail]");
    if (!btn) return;
    const request = requests.find((r) => r.requestNo === btn.dataset.moreDetail);
    close();
    if (request) openRequestDetail(request);
  });
}

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function renderTeamShowcase(state) {
  const section = document.createElement("section");
  section.className = "team-showcase";
  section.setAttribute("aria-label", "ทีมงานฝ่ายเขียนแบบ");
  const requests = state.requests || [];
  // เข้าหน้าภาพรวมจากหน้าอื่น → เริ่มที่สไลด์ "ฝ่ายเขียนแบบ" เสมอ
  // (ถ้าแค่ข้อมูลอัปเดตแล้วหน้าวาดใหม่ระหว่างดูอยู่ คงสไลด์เดิมไว้ ไม่เด้งกลับ)
  // และช่วงเวลากลับเป็น "ทั้งหมด" (คงช่วงที่เลือกไว้เฉพาะตอนอยู่หน้าภาพรวมต่อเนื่อง)
  if (state.previousRoute !== "/dashboard") { ui.index = 0; ui.period = "all"; ui.from = ""; ui.to = ""; }
  let slides = buildSlides(requests, ui.period);
  ui.index = ((ui.index % slides.length) + slides.length) % slides.length;

  // โครงสร้างคงที่ — สลับสไลด์แค่เปลี่ยนเนื้อหาข้างใน (ไม่สร้างใหม่ทั้งกล่อง รูปจึงไม่กระพริบ)
  section.innerHTML = `
    <div class="ts-bg" data-layer="0"><span class="ts-bg-initials" aria-hidden="true"></span></div>
    <div class="ts-bg" data-layer="1"><span class="ts-bg-initials" aria-hidden="true"></span></div>
    <div class="ts-shade" aria-hidden="true"></div>
    <div class="ts-top">
      <span class="ts-brand">👥 ทีมงานฝ่ายเขียนแบบ</span>
      <div class="ts-periods" role="tablist">
        ${Object.entries(PERIODS).map(([k, label]) => `<button type="button" class="ts-period ${ui.period === k ? "is-active" : ""}" data-ts-period="${k}">${label}</button>`).join("")}
      </div>
      <div class="ts-range" ${ui.period === "custom" ? "" : "hidden"}>
        <label><span>ตั้งแต่</span><input type="date" data-ts-range="from" /></label>
        <span aria-hidden="true">–</span>
        <label><span>ถึง</span><input type="date" data-ts-range="to" /></label>
      </div>
    </div>
    <div class="ts-body"></div>
    <div class="ts-cards"></div>
    <div class="ts-nav">
      <button type="button" class="ts-arrow" data-ts-step="-1" aria-label="ก่อนหน้า">‹</button>
      <button type="button" class="ts-arrow" data-ts-step="1" aria-label="ถัดไป">›</button>
      <div class="ts-progress"><i></i></div>
      <span class="ts-number"></span>
    </div>`;
  const layers = [...section.querySelectorAll(".ts-bg")];
  const body = section.querySelector(".ts-body");
  const cards = section.querySelector(".ts-cards");
  let activeLayer = 0;
  let busy = false;

  const paintLayer = (layer, slide) => {
    const url = photoUrlSync(slide.key);
    layer.style.backgroundImage = url ? `url("${url.replace(/"/g, "%22")}")` : "";
    layer.classList.toggle("has-photo", Boolean(url));
    layer.querySelector(".ts-bg-initials").textContent = slide.isTeam ? "DWG" : initials(slide.title);
  };
  const restartKenBurns = (layer) => {
    layer.classList.remove("is-zooming");
    void layer.offsetWidth; // รีสตาร์ทแอนิเมชันซูมช้า
    layer.classList.add("is-zooming");
  };
  const renderCards = () => {
    const order = [];
    for (let i = 1; i < slides.length; i++) order.push((ui.index + i) % slides.length);
    cards.innerHTML = order.map((i) => cardHtml(slides[i], i)).join("");
    // จัดคอลัมน์ให้การ์ดทุกใบพอดีกรอบ (ไม่มีแถบเลื่อนในกรอบ — ล้อเมาส์เลื่อนหน้าได้ลื่นเสมอ)
    const n = order.length;
    const cols = Math.min(7, Math.max(4, Math.ceil(n / 2)));
    const rows = Math.max(1, Math.ceil(n / cols));
    cards.style.setProperty("--ts-cols", cols);
    cards.style.setProperty("--ts-row-h", rows <= 2 ? "120px" : `${Math.floor((246 - (rows - 1) * 10) / rows)}px`);
  };
  const renderNav = () => {
    section.querySelector(".ts-progress i").style.width = `${((ui.index + 1) / slides.length) * 100}%`;
    section.querySelector(".ts-number").textContent = pad(ui.index + 1);
  };
  const renderAll = () => {
    const slide = slides[ui.index];
    paintLayer(layers[activeLayer], slide);
    layers[activeLayer].classList.add("is-active");
    restartKenBurns(layers[activeLayer]);
    body.innerHTML = slideBody(slide);
    renderCards();
    renderNav();
  };

  /** เปลี่ยนสไลด์: เนื้อหาเลื่อนออก-เข้า + รูปพื้นหลังค่อยๆ ซ้อนทับ (crossfade) — รูปถูกโหลดไว้ล่วงหน้าแล้ว */
  const go = async (index, fromCard = null) => {
    if (busy) return;
    const next = ((index % slides.length) + slides.length) % slides.length;
    if (next === ui.index && !fromCard) return;
    busy = true;
    const slide = slides[next];
    const url = photoUrlSync(slide.key);
    const loading = preloadPhoto(url);
    const incoming = layers[1 - activeLayer];
    const outgoing = layers[activeLayer];

    if (reduceMotion()) {
      ui.index = next;
      await loading;
      outgoing.classList.remove("is-active");
      activeLayer = 1 - activeLayer;
      renderAll();
      busy = false;
      return;
    }

    body.classList.add("is-leaving");
    cards.classList.add("is-leaving");

    if (fromCard) {
      // การ์ดที่คลิกขยายเต็มกรอบด้วย clip-path (ลื่นบน GPU ไม่บิดรูป) แล้วกลายเป็นพื้นหลัง
      const box = section.getBoundingClientRect();
      const r = fromCard.getBoundingClientRect();
      const ghost = document.createElement("div");
      ghost.className = "ts-ghost";
      if (url) ghost.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
      else ghost.classList.add("is-blank");
      const inset = `inset(${r.top - box.top}px ${box.right - r.right}px ${box.bottom - r.bottom}px ${r.left - box.left}px round 18px)`;
      ghost.style.clipPath = inset;
      section.appendChild(ghost);
      await loading;
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      ghost.classList.add("is-expanding");
      ghost.style.clipPath = "inset(0px 0px 0px 0px round 28px)";
      await wait(620);
      ui.index = next;
      paintLayer(incoming, slide);
      incoming.classList.add("is-instant", "is-active");
      restartKenBurns(incoming);
      outgoing.classList.remove("is-active");
      activeLayer = 1 - activeLayer;
      requestAnimationFrame(() => incoming.classList.remove("is-instant"));
      ghost.classList.add("is-done");
      setTimeout(() => ghost.remove(), 350);
    } else {
      await Promise.all([loading, wait(220)]);
      ui.index = next;
      paintLayer(incoming, slide);
      restartKenBurns(incoming);
      incoming.classList.add("is-active");   // ค่อยๆ ปรากฏทับรูปเดิม
      outgoing.classList.remove("is-active");
      activeLayer = 1 - activeLayer;
    }

    body.innerHTML = slideBody(slide);
    renderCards();
    renderNav();
    body.classList.remove("is-leaving");
    cards.classList.remove("is-leaving");
    body.classList.add("is-entering");
    cards.classList.add("is-entering");
    setTimeout(() => { body.classList.remove("is-entering"); cards.classList.remove("is-entering"); }, 600);
    await wait(250);
    busy = false;
  };

  section.addEventListener("click", (event) => {
    const detail = event.target.closest("[data-request-detail]");
    if (detail) {
      const request = requests.find((r) => r.requestNo === detail.dataset.requestDetail);
      if (request) openRequestDetail(request);
      return;
    }
    const more = event.target.closest("[data-ts-more]");
    if (more) { openMoreList(slides[ui.index], more.dataset.tsMore, requests); return; }
    const step = event.target.closest("[data-ts-step]");
    if (step) { go(ui.index + Number(step.dataset.tsStep)); restart(); return; }
    const card = event.target.closest("[data-ts-go]");
    if (card) { go(Number(card.dataset.tsGo), card); restart(); return; }
    const period = event.target.closest("[data-ts-period]");
    if (period) {
      ui.period = period.dataset.tsPeriod;
      section.querySelectorAll("[data-ts-period]").forEach((b) => b.classList.toggle("is-active", b === period));
      syncRange();
      recompute();
    }
  });

  // ── เลือกช่วงวันที่เอง ──
  const rangeBox = section.querySelector(".ts-range");
  const syncRange = () => {
    rangeBox.hidden = ui.period !== "custom";
    if (ui.period !== "custom") return;
    customRange();
    rangeBox.querySelector('[data-ts-range="from"]').value = ui.from;
    rangeBox.querySelector('[data-ts-range="to"]').value = ui.to;
  };
  const recompute = () => {
    slides = buildSlides(requests, ui.period);
    body.innerHTML = slideBody(slides[ui.index]);
    renderCards();
  };
  rangeBox.addEventListener("change", (event) => {
    const input = event.target.closest("[data-ts-range]");
    if (!input || !input.value) return;
    ui[input.dataset.tsRange] = input.value;
    syncRange(); // สลับให้ถ้าเลือกวันเริ่มหลังวันสิ้นสุด
    recompute();
  });
  syncRange();

  // เลื่อนอัตโนมัติ — timer เดียวทั้งหน้า (หน้าถูกวาดใหม่บ่อยจาก polling)
  let hovering = false;
  section.addEventListener("pointerenter", () => { hovering = true; });
  section.addEventListener("pointerleave", () => { hovering = false; });
  const restart = () => {
    clearInterval(ui.timer);
    if (reduceMotion()) return;
    ui.timer = setInterval(() => {
      if (!section.isConnected) { clearInterval(ui.timer); return; }
      if (hovering || document.hidden || document.querySelector("#modal-root")?.children.length) return;
      go(ui.index + 1);
    }, AUTOPLAY_MS);
  };

  renderAll();
  restart();

  // ป้ายวันลาเปลี่ยนตามเวลา (เช่น ลาครึ่งวันเช้าหายหลังเที่ยง) — ตรวจทุกนาที วาดใหม่เฉพาะเมื่อป้ายเปลี่ยน
  const leaveSig = () => slides.map((sl) => leaveLabel(sl)).join("|");
  let lastLeave = leaveSig();
  const leaveTimer = setInterval(() => {
    if (!section.isConnected) { clearInterval(leaveTimer); return; }
    const sig = leaveSig();
    if (sig === lastLeave || busy) return;
    lastLeave = sig;
    body.innerHTML = slideBody(slides[ui.index]);
    renderCards();
  }, 60 * 1000);

  // ข้อมูลสถิติย้อนหลังโหลดเสร็จ/อัปเดต → คำนวณใหม่ (ไม่เปลี่ยนสไลด์ที่ดูอยู่)
  const offLegacy = onLegacyChange(() => {
    if (!section.isConnected) { offLegacy(); return; }
    slides = buildSlides(requests, ui.period);
    ui.index = Math.min(ui.index, slides.length - 1);
    if (!busy) { body.innerHTML = slideBody(slides[ui.index]); renderCards(); renderNav(); }
  });
  loadLegacy();

  // รูปมาถึงทีหลัง (ครั้งแรกที่เปิดหน้า) → ใส่รูปแบบค่อยๆ ปรากฏ แล้วโหลดรูปทุกคนไว้ล่วงหน้า
  listTeamPhotos().then(async (map) => {
    if (!section.isConnected) return;
    const slide = slides[ui.index];
    const url = photoUrlSync(slide.key);
    if (url && !layers[activeLayer].classList.contains("has-photo")) {
      await preloadPhoto(url);
      if (busy || slides[ui.index] !== slide) return;
      // ค่อยๆ เฟดรูปเข้ามาแทนพื้นสี (ไม่โผล่ทันที)
      const incoming = layers[1 - activeLayer];
      paintLayer(incoming, slide);
      restartKenBurns(incoming);
      incoming.classList.add("is-active");
      layers[activeLayer].classList.remove("is-active");
      activeLayer = 1 - activeLayer;
    }
    cards.querySelectorAll("[data-photo-key]").forEach((el) => {
      const u = photoUrlSync(el.dataset.photoKey);
      if (!u || el.classList.contains("has-photo")) return;
      preloadPhoto(u).then(() => { el.style.backgroundImage = `url("${u.replace(/"/g, "%22")}")`; el.classList.add("has-photo"); });
    });
    [...map.values()].forEach((entry) => preloadPhoto(entry.url));
  });

  return section;
}
