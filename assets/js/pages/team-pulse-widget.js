// ══════════════════════════════════════════════════════════════
// TEAM PULSE WIDGET — เช็คอินความรู้สึก/แผนงานประจำวันของฝ่ายเขียนแบบ
// แสดงบนสุดของหน้า "01 ภาพรวม" — ทุกคนเห็น เฉพาะฝ่ายเขียนแบบ/ผู้จัดการโพสต์ได้
// ══════════════════════════════════════════════════════════════

import { STATUS } from "../../../config/schema.js";
import { openModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import {
  MOODS,
  REACTIONS,
  canPostTeamPulse,
  createTeamPulsePost,
  deleteTeamPulsePost,
  hasCheckedInToday,
  isTeamPulseManager,
  loadTeamPulsePosts,
  moodMeta,
  reactionMeta,
  splitTeamPulsePosts,
  summarizeTodayMoods,
  toggleTeamPulseReaction,
  updateTeamPulsePost,
} from "../services/team-pulse-service.js";
import { escapeHtml } from "../utils.js";

const AVATAR_COLORS = ["#0db14b", "#005dac", "#f59e0b", "#8b5cf6", "#ec4899", "#0891b2"];
const avatarColor = (name) => AVATAR_COLORS[[...String(name)].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
const initials = (name) => String(name).trim().split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

function timeAgo(ts) {
  const diffMin = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (diffMin < 1) return "เมื่อสักครู่";
  if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `${h} ชม.ที่แล้ว`;
  return `${Math.round(h / 24)} วันที่แล้ว`;
}

// ── สถานะภายในโมดูล (คงอยู่ตลอด session จนกว่าจะรีเฟรชหน้า) ──
let cachedPosts = null;
let showOlderPosts = false;
let selectedMood = null;
let editingId = null;
let confirmingDeleteId = null;
let reactionPickerOpenFor = null;
let hasSeenPopupThisSession = false;

/** งานที่รับผิดชอบอยู่ของคนคนหนึ่ง ณ วันนี้ — ใช้โชว์บริบทในป็อปอัพ/แถบโพสต์ (ตรงกับตาราง Workload รายวันในหน้ารายงาน) */
function myTodayWorkload(email, requests) {
  const NO_WORKLOAD = [STATUS.MGR_REVIEW, STATUS.DELIVERED, STATUS.DONE, STATUS.CANCELLED, STATUS.REJECTED];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const mine = (requests || []).filter((r) => String(r.assignedToEmail || "").toLowerCase() === email.toLowerCase());
  const active = mine.filter((r) => !NO_WORKLOAD.includes(r.status));
  let dueToday = 0, overdue = 0;
  active.forEach((r) => {
    if (!r.dueDate) return;
    const d = new Date(r.dueDate); d.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) dueToday++;
    else if (d.getTime() < today.getTime()) overdue++;
  });
  return { active: active.length, dueToday, overdue };
}

function linkifyRefs(escapedText, allRequests) {
  return escapedText.replace(/#([A-Za-z0-9][A-Za-z0-9-]{3,})/g, (m, ref) => {
    const found = allRequests.find((r) => r.requestNo && r.requestNo.toUpperCase() === ref.toUpperCase());
    if (!found) return m;
    return `<a href="javascript:void(0)" class="tp-ref-link" data-tp-ref="${escapeHtml(found.requestNo)}">#${escapeHtml(ref)}</a>`;
  });
}

function moodChipsHtml(selected) {
  return MOODS.map((m) => `
    <button type="button" class="tp-mood-chip tp-m-${m.key} ${selected === m.key ? "selected" : ""}" data-tp-mood="${m.key}">
      <span>${m.emoji}</span><span class="tp-lbl">${escapeHtml(m.label)}</span>
    </button>
  `).join("");
}

function workloadBoxHtml(wl) {
  if (!wl.active) return "";
  return `
    <div class="tp-wl-box">
      📊 วันนี้คุณมีงาน <b>${wl.active}</b> ชิ้น
      ${wl.dueToday ? `• ครบกำหนดวันนี้ <b>${wl.dueToday}</b>` : ""}
      ${wl.overdue ? `• <span class="tp-warn">⚠️ เกินกำหนด ${wl.overdue}</span>` : ""}
    </div>`;
}

// ══ MAIN ENTRY ══
export async function renderTeamPulse(container, state) {
  container.id = "team-pulse-root";
  container.style.cssText = "margin-bottom:2rem;";
  container.innerHTML = `<div class="tp-skeleton">📣 กำลังโหลดฟีดทีม...</div>`;

  if (cachedPosts === null) {
    cachedPosts = await loadTeamPulsePosts();
  }
  paint(container, state);
}

function paint(container, state) {
  const user = state.user || {};
  const canPost = canPostTeamPulse(user);
  const iAmManager = isTeamPulseManager(user.email);
  const { recent, older } = splitTeamPulsePosts(cachedPosts);
  const total = cachedPosts.length;
  const checkedIn = canPost && hasCheckedInToday(cachedPosts, user.email);
  const wl = canPost ? myTodayWorkload(user.email, state.requests) : { active: 0, dueToday: 0, overdue: 0 };
  const moodSummary = summarizeTodayMoods(cachedPosts);

  container.innerHTML = `
    <div class="tp-card-shell">
      ${canPost && checkedIn ? `<div class="tp-checked-in">✅ คุณเช็คอินวันนี้ไปแล้ว — โพสต์เพิ่มได้ทุกเมื่อจากช่องด้านล่าง</div>` : ""}

      <div class="section-header" style="margin-bottom:10px;">
        <div>
          <h2 style="margin:0;">📣 ทีมเขียนแบบวันนี้</h2>
          <p style="margin:0;color:var(--muted,#64748b);font-size:12.5px;">${total} โพสต์ทั้งหมด</p>
        </div>
      </div>

      ${moodSummary.total ? `
        <div class="tp-mood-summary">
          <span class="tp-title">📊 วันนี้ทีม:</span>
          ${MOODS.filter((m) => moodSummary.counts[m.key]).map((m) => `<span class="tp-mood-pill">${m.emoji} × ${moodSummary.counts[m.key]}</span>`).join("")}
          <span style="margin-left:auto;color:#94a3b8;font-size:11.5px;">จาก ${moodSummary.total} คนที่เช็คอินแล้ว</span>
        </div>
      ` : ""}

      ${canPost ? `
        <div class="tp-composer">
          <div class="tp-composer-title">✍️ อัปเดตสถานะของคุณวันนี้</div>
          ${workloadBoxHtml(wl)}
          <div class="tp-mood-row" data-tp-mood-group="composer">${moodChipsHtml(selectedMood)}</div>
          <textarea id="tp-composer-ta" placeholder="วันนี้คุณรู้สึกอย่างไร แล้วจะทำอะไรบ้าง... (พิมพ์ #เลขคำร้อง เพื่อลิงก์ไปหน้ารายละเอียดได้)"></textarea>
          <div class="tp-composer-footer">
            <span class="tp-char-hint">โพสต์ได้ไม่จำกัด · แก้ไข/ลบโพสต์ของตัวเองได้ภายหลัง</span>
            <button class="primary-button small-button" type="button" id="tp-submit-btn">📣 โพสต์</button>
          </div>
        </div>
      ` : ""}

      <div class="tp-feed-wrap">
        <div class="tp-feed" id="tp-feed"></div>
      </div>
    </div>
  `;

  renderFeedInto(container.querySelector("#tp-feed"), recent, older, state, iAmManager);
  bindComposer(container, state);
  bindFeedEvents(container, state, iAmManager);
  const raf = window.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
  raf(() => adjustFeedHeight(container));

  if (canPost && !checkedIn && !hasSeenPopupThisSession) {
    openCheckinModal(container, state, wl);
  }
}

function postCardHtml(p, state, iAmManager, isOlder) {
  const mood = moodMeta(p.mood);
  const me = (state.user?.email || "").toLowerCase();
  const mine = p.authorEmail.toLowerCase() === me;
  const moderator = iAmManager && !mine;
  const isEditing = editingId === p.id;
  const isConfirming = confirmingDeleteId === p.id;
  const pickerOpen = reactionPickerOpenFor === p.id;
  const activeReactions = Object.entries(p.reactions || {}).filter(([, list]) => list.length > 0);

  return `
    <div class="tp-post tp-mood-${p.mood} ${isOlder ? "tp-older" : ""}" data-tp-post="${p.id}">
      <div class="tp-avatar" style="background:${avatarColor(p.authorName)};">${escapeHtml(initials(p.authorName))}</div>
      <div class="tp-post-body">
        <div class="tp-post-head">
          <span class="tp-post-name">${escapeHtml(p.authorName)}</span>
          ${isTeamPulseManager(p.authorEmail) ? `<span class="tp-badge-mgr">ผู้จัดการ</span>` : ""}
          <span class="tp-post-mood-emoji" title="${escapeHtml(mood.label)}">${mood.emoji}</span>
          <span class="tp-post-time">· ${timeAgo(p.postedAt)}${p.editedAt ? " (แก้ไขแล้ว)" : ""}</span>
        </div>

        ${isEditing ? `
          <div class="tp-edit-box">
            <textarea id="tp-edit-ta-${p.id}">${escapeHtml(p.text)}</textarea>
            <div class="tp-edit-actions">
              <button class="small-button" type="button" data-tp-cancel-edit>ยกเลิก</button>
              <button class="primary-button small-button" type="button" data-tp-save-edit="${p.id}">บันทึก</button>
            </div>
          </div>
        ` : `<div class="tp-post-text">${linkifyRefs(escapeHtml(p.text), state.requests || [])}</div>`}

        ${!isEditing ? `
          <div class="tp-reaction-row">
            ${activeReactions.map(([key, list]) => {
              const meta = reactionMeta(key);
              const mineReacted = list.map((e) => e.toLowerCase()).includes(me);
              return `<button class="tp-reaction-pill ${mineReacted ? "mine" : ""}" type="button" title="${escapeHtml(meta.label)}" data-tp-react="${p.id}" data-tp-react-key="${key}">${meta.emoji} <span class="tp-cnt">${list.length}</span></button>`;
            }).join("")}
            <button class="tp-reaction-add" type="button" title="เพิ่ม Reaction" data-tp-toggle-picker="${p.id}">+</button>
          </div>
          ${pickerOpen ? `
            <div class="tp-reaction-picker">
              ${REACTIONS.map((r) => `<button type="button" title="${escapeHtml(r.label)}" data-tp-react="${p.id}" data-tp-react-key="${r.key}">${r.emoji}</button>`).join("")}
            </div>
          ` : ""}
          <div class="tp-post-actions">
            ${(mine || moderator) ? `
              <div class="tp-own-actions">
                ${mine ? `<button class="tp-icon-link" type="button" data-tp-edit="${p.id}">✏️ แก้ไข</button>` : ""}
                <button class="tp-icon-link tp-del" type="button" data-tp-ask-delete="${p.id}">🗑️ ลบ${moderator ? " (ผู้จัดการ)" : ""}</button>
              </div>
            ` : ""}
          </div>
        ` : ""}

        ${isConfirming ? `
          <div class="tp-confirm-del">
            <span>ลบโพสต์นี้ใช่ไหม?${moderator ? " จะถูกบันทึกลง Audit Log" : ""} ย้อนกลับไม่ได้</span>
            <button class="small-button" type="button" data-tp-cancel-delete>ยกเลิก</button>
            <button class="small-button danger" type="button" data-tp-confirm-delete="${p.id}">ลบเลย</button>
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

function renderFeedInto(feedEl, recent, older, state, iAmManager) {
  const total = recent.length + older.length;
  if (!total) {
    feedEl.innerHTML = `<div class="tp-empty">ยังไม่มีใครโพสต์ — เป็นคนแรกที่อัปเดตสถานะสิ! 🎉</div>`;
    return;
  }
  let html = recent.map((p) => postCardHtml(p, state, iAmManager, false)).join("");
  if (older.length) {
    if (showOlderPosts) {
      html += `<div class="tp-older-divider">— เก่ากว่า 30 วัน —</div>`;
      html += older.map((p) => postCardHtml(p, state, iAmManager, true)).join("");
    } else {
      html += `<div class="tp-load-more"><button type="button" data-tp-load-older>📜 ดูโพสต์เก่ากว่า 30 วัน (${older.length} รายการ)</button></div>`;
    }
  }
  feedEl.innerHTML = html;
}

/** วัดตำแหน่งจริงของโพสต์ตัวที่ 10 แล้วตั้งความสูงฟีดให้พอดี — เห็นครบ 10 โพสต์โดยไม่ต้องเลื่อน โพสต์ที่ 11 ขึ้นไปถึงเลื่อนดู */
function adjustFeedHeight(container) {
  const feed = container.querySelector("#tp-feed");
  if (!feed) return;
  const postEls = feed.querySelectorAll(".tp-post");
  if (postEls.length <= 10) { feed.style.maxHeight = "none"; return; }
  const tenth = postEls[9];
  const feedTop = feed.getBoundingClientRect().top;
  const postBottom = tenth.getBoundingClientRect().bottom;
  feed.style.maxHeight = Math.ceil((postBottom - feedTop) + feed.scrollTop + 1) + "px";
}

function bindComposer(container, state) {
  container.querySelectorAll('[data-tp-mood-group="composer"] [data-tp-mood]').forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedMood = selectedMood === btn.dataset.tpMood ? null : btn.dataset.tpMood;
      paint(container, state);
    });
  });
  container.querySelector("#tp-submit-btn")?.addEventListener("click", async () => {
    const ta = container.querySelector("#tp-composer-ta");
    const text = (ta?.value || "").trim();
    if (!text) { showToast("กรุณาพิมพ์ข้อความก่อนโพสต์", "warning"); ta?.focus(); return; }
    const btn = container.querySelector("#tp-submit-btn");
    btn.disabled = true;
    try {
      const post = await createTeamPulsePost({ mood: selectedMood || "ok", text });
      cachedPosts.unshift(post);
      selectedMood = null;
      hasSeenPopupThisSession = true;
      showToast("📣 โพสต์สำเร็จ", "success");
      paint(container, state);
    } catch (err) {
      showToast(`โพสต์ไม่สำเร็จ: ${err.message}`, "error");
      btn.disabled = false;
    }
  });
}

// หมายเหตุสำคัญ: post.id ที่มาจาก SharePoint เป็น "string" เสมอ (Graph API คืนแบบนั้น)
// และ dataset.* ก็คืน string เสมอเช่นกัน — จึงเปรียบเทียบตรงๆ ได้เลย
// ห้ามแปลงเป็น Number() เด็ดขาด ไม่งั้น find()/filter() จะไม่เจอ ทำให้ปุ่มแก้ไข/ลบ/react ไม่ทำงาน
function bindFeedEvents(container, state, iAmManager) {
  container.querySelector("#tp-feed")?.addEventListener("click", async (event) => {
    const el = event.target;

    const refBtn = el.closest("[data-tp-ref]");
    if (refBtn) {
      const req = (state.requests || []).find((r) => r.requestNo === refBtn.dataset.tpRef);
      if (req) {
        const { openRequestDetail } = await import("./track.js");
        openRequestDetail(req);
      }
      return;
    }

    const editBtn = el.closest("[data-tp-edit]");
    if (editBtn) { editingId = editBtn.dataset.tpEdit; confirmingDeleteId = null; paint(container, state); return; }

    const cancelEditBtn = el.closest("[data-tp-cancel-edit]");
    if (cancelEditBtn) { editingId = null; paint(container, state); return; }

    const saveEditBtn = el.closest("[data-tp-save-edit]");
    if (saveEditBtn) {
      const id = saveEditBtn.dataset.tpSaveEdit;
      const ta = container.querySelector(`#tp-edit-ta-${id}`);
      const val = (ta?.value || "").trim();
      if (!val) { showToast("ข้อความห้ามว่าง", "warning"); return; }
      try {
        await updateTeamPulsePost(id, val);
        const post = cachedPosts.find((p) => p.id === id);
        if (post) { post.text = val; post.editedAt = new Date().toISOString(); }
        editingId = null;
        paint(container, state);
      } catch (err) { showToast(`บันทึกไม่สำเร็จ: ${err.message}`, "error"); }
      return;
    }

    const askDelBtn = el.closest("[data-tp-ask-delete]");
    if (askDelBtn) { confirmingDeleteId = askDelBtn.dataset.tpAskDelete; paint(container, state); return; }

    const cancelDelBtn = el.closest("[data-tp-cancel-delete]");
    if (cancelDelBtn) { confirmingDeleteId = null; paint(container, state); return; }

    const confirmDelBtn = el.closest("[data-tp-confirm-delete]");
    if (confirmDelBtn) {
      const id = confirmDelBtn.dataset.tpConfirmDelete;
      const post = cachedPosts.find((p) => p.id === id);
      if (!post) return;
      try {
        await deleteTeamPulsePost(post);
        cachedPosts = cachedPosts.filter((p) => p.id !== id);
        confirmingDeleteId = null;
        showToast("ลบโพสต์แล้ว", "success");
        paint(container, state);
      } catch (err) { showToast(`ลบไม่สำเร็จ: ${err.message}`, "error"); }
      return;
    }

    const pickerToggleBtn = el.closest("[data-tp-toggle-picker]");
    if (pickerToggleBtn) {
      const id = pickerToggleBtn.dataset.tpTogglePicker;
      reactionPickerOpenFor = reactionPickerOpenFor === id ? null : id;
      paint(container, state);
      return;
    }

    const reactBtn = el.closest("[data-tp-react]");
    if (reactBtn) {
      const id = reactBtn.dataset.tpReact;
      const key = reactBtn.dataset.tpReactKey;
      const post = cachedPosts.find((p) => p.id === id);
      if (!post) return;
      reactionPickerOpenFor = null;
      try {
        post.reactions = await toggleTeamPulseReaction(post, key);
        paint(container, state);
      } catch (err) { showToast(`ทำรายการไม่สำเร็จ: ${err.message}`, "error"); }
      return;
    }

    const loadOlderBtn = el.closest("[data-tp-load-older]");
    if (loadOlderBtn) { showOlderPosts = true; paint(container, state); return; }
  });
}

function openCheckinModal(container, state, wl) {
  const user = state.user || {};
  let modalMood = null;

  const body = `
    <div class="tp-modal-body">
      ${workloadBoxHtml(wl)}
      <div class="tp-mood-row" data-tp-mood-group="modal" style="justify-content:center;margin-top:10px;">${moodChipsHtml(null)}</div>
      <textarea id="tp-modal-ta" placeholder="เช่น วันนี้พร้อมลุย! จะเคลียร์งาน #TPCA-EE-010 ให้เสร็จก่อนบ่าย" style="width:100%;margin-top:10px;border:1.5px solid var(--line);border-radius:10px;padding:11px 13px;font-family:inherit;font-size:13.5px;resize:vertical;min-height:70px;"></textarea>
    </div>
  `;

  const close = openModal({
    title: `👋 สวัสดีตอนเช้า ${String(user.name || "").split(" ")[0]} — วันนี้คุณรู้สึกอย่างไร แล้วจะทำอะไรบ้าง?`,
    body,
    actions: [
      { label: "ข้ามไปก่อน", className: "secondary-button", onClick: (closeFn) => { hasSeenPopupThisSession = true; closeFn(); } },
      {
        label: "📣 โพสต์เลย",
        className: "primary-button",
        onClick: async (closeFn) => {
          const ta = document.querySelector("#tp-modal-ta");
          const text = (ta?.value || "").trim();
          if (!text) { showToast("กรุณาพิมพ์ข้อความก่อนโพสต์", "warning"); return; }
          try {
            const post = await createTeamPulsePost({ mood: modalMood || "ok", text });
            cachedPosts.unshift(post);
            hasSeenPopupThisSession = true;
            closeFn();
            showToast("📣 โพสต์สำเร็จ", "success");
            paint(container, state);
          } catch (err) { showToast(`โพสต์ไม่สำเร็จ: ${err.message}`, "error"); }
        },
      },
    ],
    onClose: () => { hasSeenPopupThisSession = true; },
  });

  setTimeout(() => {
    document.querySelectorAll('[data-tp-mood-group="modal"] [data-tp-mood]').forEach((btn) => {
      btn.addEventListener("click", () => {
        modalMood = modalMood === btn.dataset.tpMood ? null : btn.dataset.tpMood;
        document.querySelectorAll('[data-tp-mood-group="modal"] .tp-mood-chip').forEach((c) => c.classList.remove("selected"));
        if (modalMood) btn.classList.add("selected");
      });
    });
  }, 0);
}
