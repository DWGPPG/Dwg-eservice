// ══════════════════════════════════════════════════════════════
// แชทสด Microsoft Teams (1:1) ข้างหน้าต่างรายละเอียดคำร้อง
//  - ฝ่ายเขียนแบบ/ผู้จัดการ ↔ ผู้ส่งคำร้อง · ผู้ส่งคำร้อง ↔ ผู้รับผิดชอบงาน
//  - ใช้แชท 1:1 เดิมใน Teams (ข้อความเห็นในแอป Teams ด้วย) · ข้อความที่ส่งจากที่นี่ติดเลขคำร้องอ้างอิงเสมอ
//  - ดึงข้อความใหม่ทุก 5 วินาทีขณะเปิดอยู่ · ปิดหน้าต่างคำร้อง = ปิดแชท
// ══════════════════════════════════════════════════════════════

import { getChatWith, listChatMessages, postChatMessage } from "../graph.js";
import { state } from "../state.js";
import { escapeHtml } from "../utils.js";

const POLL_MS = 5000;
let current = null; // { panel, timer, observer }

const norm = (v) => String(v || "").trim().toLowerCase();

/** คู่สนทนาของผู้ใช้คนนี้ในคำร้องนี้ */
function partnerOf(request) {
  const me = norm(state.user?.email);
  const requester = { email: request.requesterEmail, name: request.requesterName || request.requesterEmail };
  const assignee = { email: request.assignedToEmail, name: request.assignedToName || request.assignedToEmail };
  if (me && me === norm(requester.email)) return assignee.email ? assignee : null;
  return requester.email && norm(requester.email) !== me ? requester : null;
}

/** HTML ของ Teams → ข้อความล้วน (เก็บการขึ้นบรรทัด) */
function toText(html) {
  const prepared = String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n");
  const doc = new DOMParser().parseFromString(prepared, "text/html");
  return (doc.body.textContent || "").replace(/ /g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

const timeText = (iso) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString("th-TH", today ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

export function closeRequestChat() {
  if (!current) return;
  clearTimeout(current.timer);
  current.observer?.disconnect();
  current.panel.remove();
  document.body.classList.remove("has-req-chat");
  current = null;
}

/** เปิดแผงแชทของคำร้อง (เรียกหลังเปิดหน้าต่างรายละเอียดคำร้อง) */
export function openRequestChat(request, dialogEl = null) {
  closeRequestChat();
  const partner = partnerOf(request);
  if (!partner) return;
  const ref = request.requestNo;
  const panel = document.createElement("aside");
  panel.className = "req-chat";
  panel.innerHTML = `
    <header class="req-chat-head">
      <div><b>💬 แชท Teams</b><small>กับ ${escapeHtml(partner.name)}</small></div>
      <button type="button" class="req-chat-x" data-chat-close title="ซ่อนแชท">×</button>
    </header>
    <div class="req-chat-ref">📋 อ้างอิงคำร้อง <b>${escapeHtml(ref)}</b>${request.drawingNo ? ` · ${escapeHtml(request.drawingNo)}` : ""}</div>
    <div class="req-chat-filter" role="tablist">
      <button type="button" class="is-active" data-chat-scope="ref">เฉพาะคำร้องนี้</button>
      <button type="button" data-chat-scope="all">ทั้งหมดในแชท</button>
    </div>
    <div class="req-chat-msgs" aria-live="polite"><p class="req-chat-empty">⏳ กำลังเปิดแชท...</p></div>
    <form class="req-chat-form">
      <textarea rows="2" placeholder="พิมพ์ข้อความ... (Enter ส่ง · Shift+Enter ขึ้นบรรทัด)" disabled></textarea>
      <button type="submit" class="primary-button" disabled>ส่ง</button>
    </form>
    <p class="req-chat-note">ข้อความส่งผ่าน Microsoft Teams (แชท 1:1) และแนบเลขคำร้องให้อัตโนมัติ</p>`;
  document.body.appendChild(panel);
  document.body.classList.add("has-req-chat");

  const msgsEl = panel.querySelector(".req-chat-msgs");
  const input = panel.querySelector("textarea");
  const sendBtn = panel.querySelector(".req-chat-form button");
  let chatId = null;
  let myId = null;
  let scope = "ref";
  let messages = [];
  let lastSig = "";
  const me = { current };
  current = { panel, timer: 0, observer: null };
  me.current = current;

  function render(force = false) {
    const shown = messages
      .filter((m) => scope === "all" || toText(m.body?.content).includes(ref))
      .slice()
      .sort((a, b) => new Date(a.createdDateTime) - new Date(b.createdDateTime));
    const sig = `${scope}|${shown.map((m) => m.id + (m.lastModifiedDateTime || "")).join(",")}`;
    if (!force && sig === lastSig) return;
    lastSig = sig;
    const nearBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 60;
    msgsEl.innerHTML = shown.length ? shown.map((m) => {
      const mine = m.from?.user?.id === myId;
      const text = toText(m.body?.content);
      return `<div class="req-chat-msg ${mine ? "is-mine" : ""}">
        <div class="req-chat-bubble">${escapeHtml(text).replace(/\n/g, "<br>")}</div>
        <small>${mine ? "คุณ" : escapeHtml(m.from?.user?.displayName || partner.name)} · ${escapeHtml(timeText(m.createdDateTime))}</small>
      </div>`;
    }).join("") : `<p class="req-chat-empty">${scope === "ref" ? `ยังไม่มีข้อความเกี่ยวกับ ${escapeHtml(ref)} — เริ่มพิมพ์ด้านล่างได้เลย` : "ยังไม่มีข้อความในแชทนี้"}</p>`;
    if (nearBottom || force) msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  async function poll() {
    if (current !== me.current) return;
    try {
      if (!document.hidden && chatId) {
        messages = await listChatMessages(chatId, 50);
        render();
      }
    } catch (error) {
      console.warn("โหลดแชทไม่สำเร็จ:", error.message);
    }
    if (current === me.current) current.timer = setTimeout(poll, POLL_MS);
  }

  getChatWith(partner.email).then(async (res) => {
    chatId = res.chatId;
    myId = res.myId;
    input.disabled = false;
    sendBtn.disabled = false;
    messages = await listChatMessages(chatId, 50).catch(() => []);
    render(true);
    current.timer = setTimeout(poll, POLL_MS);
  }).catch((error) => {
    msgsEl.innerHTML = `<p class="req-chat-empty">⚠️ เปิดแชท Teams ไม่สำเร็จ: ${escapeHtml(error.message)}</p>`;
  });

  async function send() {
    const text = input.value.trim();
    if (!text || !chatId) return;
    input.disabled = true;
    sendBtn.disabled = true;
    const html = `📋 <b>${escapeHtml(ref)}</b>${request.drawingNo ? ` · ${escapeHtml(request.drawingNo)}` : ""}<br>${escapeHtml(text).replace(/\n/g, "<br>")}`;
    try {
      const sent = await postChatMessage(chatId, html);
      if (sent) messages = [sent, ...messages];
      input.value = "";
      render(true);
    } catch (error) {
      alert(`ส่งข้อความไม่สำเร็จ: ${error.message}`);
    } finally {
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  panel.querySelector(".req-chat-form").addEventListener("submit", (e) => { e.preventDefault(); send(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  panel.addEventListener("click", (e) => {
    if (e.target.closest("[data-chat-close]")) { closeRequestChat(); return; }
    const sc = e.target.closest("[data-chat-scope]");
    if (sc) {
      scope = sc.dataset.chatScope;
      panel.querySelectorAll("[data-chat-scope]").forEach((b) => b.classList.toggle("is-active", b === sc));
      render(true);
    }
  });

  // ปิดหน้าต่างคำร้อง → ปิดแชท
  const root = document.querySelector("#modal-root");
  if (root) {
    const observer = new MutationObserver(() => {
      if (dialogEl ? !dialogEl.isConnected : !root.querySelector(".modal")) closeRequestChat();
    });
    observer.observe(root, { childList: true, subtree: true });
    current.observer = observer;
  }
}
