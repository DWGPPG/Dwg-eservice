// ══════════════════════════════════════════════════════════════
// แชทสด Microsoft Teams (1:1) ข้างหน้าต่างรายละเอียดคำร้อง
//  - ฝ่ายเขียนแบบ/ผู้จัดการ ↔ ผู้ส่งคำร้อง · ผู้ส่งคำร้อง ↔ ผู้รับผิดชอบงาน
//  - ใช้แชท 1:1 เดิมใน Teams (ข้อความเห็นในแอป Teams ด้วย) · ข้อความที่ส่งจากที่นี่ติดเลขคำร้องอ้างอิงเสมอ
//  - ดึงข้อความใหม่ทุก 5 วินาทีขณะเปิดอยู่ · ปิดหน้าต่างคำร้อง = ปิดแชท
// ══════════════════════════════════════════════════════════════

import { getChatWith, graphBlobUrl, listChatMessages, postChatMessage, uploadChatFile } from "../graph.js";
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

/** หัวอ้างอิงคำร้อง (ก่อนเส้นคั่น) = สีขาว · ข้อความที่พิมพ์ = เขียวมิ้นต์สว่าง ให้แยกกันชัด */
const SEP = /\n?─{4,}\n?/;
function bubbleHtml(text) {
  const br = (t) => escapeHtml(t).replace(/\n/g, "<br>");
  const parts = String(text).split(SEP);
  if (parts.length < 2) return `<span class="req-chat-text">${br(text)}</span>`;
  const [head, ...rest] = parts;
  return `<span class="req-chat-refhead">${br(head.trim())}</span><span class="req-chat-text">${br(rest.join("\n").trim())}</span>`;
}

/** รูปฝัง (hostedContents) + ไฟล์แนบ (reference) ของข้อความ */
const INLINE_IMAGE_MAX = 3 * 1024 * 1024; // รูปใหญ่กว่านี้ส่งเป็นไฟล์แนบแทน
function extrasHtml(m) {
  const imgs = [];
  try {
    const doc = new DOMParser().parseFromString(String(m.body?.content || ""), "text/html");
    doc.querySelectorAll("img[src]").forEach((img) => {
      const src = img.getAttribute("src");
      if (/^https:\/\/graph\.microsoft\.com\/.*hostedContents/i.test(src)) imgs.push(src);
      else if (/hostedContents/i.test(src)) imgs.push(""); // เพิ่งส่ง — รอ URL จริงจากรอบดึงถัดไป
    });
  } catch (_) { /* ignore */ }
  const files = (m.attachments || []).filter((a) => a.contentType === "reference" && a.contentUrl);
  const icon = (n) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(n) ? "🖼️" : /\.pdf$/i.test(n) ? "📕" : /\.(dwg|dxf)$/i.test(n) ? "📐" : /\.(xlsx?|csv)$/i.test(n) ? "📗" : /\.(docx?)$/i.test(n) ? "📘" : "📄";
  return `${imgs.map((src) => src ? `<img class="req-chat-img" data-gsrc="${escapeHtml(src)}" alt="รูปภาพ" />` : `<span class="req-chat-file">🖼️ กำลังโหลดรูป...</span>`).join("")}
    ${files.map((a) => `<a class="req-chat-file" href="${escapeHtml(a.contentUrl)}" target="_blank" rel="noopener noreferrer">${icon(a.name || "")} ${escapeHtml(a.name || "ไฟล์แนบ")}</a>`).join("")}`;
}
function hydrateImages(root) {
  root.querySelectorAll("img[data-gsrc]:not([src])").forEach((img) => {
    graphBlobUrl(img.dataset.gsrc).then((url) => { img.src = url; }).catch(() => { img.replaceWith(Object.assign(document.createElement("span"), { className: "req-chat-file", textContent: "🖼️ เปิดรูปไม่ได้" })); });
  });
}
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
  fr.onerror = () => reject(fr.error);
  fr.readAsDataURL(file);
});
const sizeText = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

const timeText = (iso) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString("th-TH", today ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

/** ข้อมูลอ้างอิงของคำร้องที่แนบไปกับทุกข้อความ */
function refLines(request) {
  const type = String(request.requestType || "").trim();
  return [
    ["📋", "เลขคำขอ", request.requestNo],
    ["📂", "ประเภทแบบ", type],
    ["🏗️", "โครงการ", request.projectName],
    ["📐", "Drawing No.", request.drawingNo],
    ["📄", "Drawing Name", request.drawingName],
  ].filter(([, , v]) => String(v || "").trim());
}

let reopenTab = null; // ปุ่ม "เปิดแชทอีกครั้ง" ขอบขวาจอ (หลังกด × ซ่อนแชท)
function removeReopenTab() { reopenTab?.remove(); reopenTab = null; }

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
  removeReopenTab();
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
    <div class="req-chat-ref">${refLines(request).map(([ic, label, v]) => `<div>${ic} ${escapeHtml(label)}: <b>${escapeHtml(v)}</b></div>`).join("")}</div>
    <div class="req-chat-filter" role="tablist">
      <button type="button" class="is-active" data-chat-scope="ref">เฉพาะคำร้องนี้</button>
      <button type="button" data-chat-scope="all">ทั้งหมดในแชท</button>
    </div>
    <div class="req-chat-msgs" aria-live="polite"><p class="req-chat-empty">⏳ กำลังเปิดแชท...</p></div>
    <div class="req-chat-pending" hidden></div>
    <form class="req-chat-form">
      <button type="button" class="req-chat-attach" data-chat-attach title="แนบรูปภาพ / ไฟล์ (หรือวางรูปด้วย Ctrl+V / ลากไฟล์มาวาง)" disabled>📎</button>
      <input type="file" multiple hidden data-chat-file />
      <textarea rows="2" placeholder="พิมพ์ข้อความ... (Enter ส่ง · Shift+Enter ขึ้นบรรทัด · Ctrl+V วางรูป)" disabled></textarea>
      <button type="submit" class="primary-button" disabled>ส่ง</button>
    </form>
    <p class="req-chat-note">ข้อความส่งผ่าน Microsoft Teams (แชท 1:1) และแนบเลขคำร้องให้อัตโนมัติ</p>`;
  document.body.appendChild(panel);
  document.body.classList.add("has-req-chat");

  const msgsEl = panel.querySelector(".req-chat-msgs");
  const input = panel.querySelector("textarea");
  const sendBtn = panel.querySelector(".req-chat-form button[type=submit]");
  const attachBtn = panel.querySelector("[data-chat-attach]");
  const fileInput = panel.querySelector("[data-chat-file]");
  const pendingEl = panel.querySelector(".req-chat-pending");
  let pending = []; // ไฟล์/รูปที่รอส่ง

  function drawPending() {
    pendingEl.hidden = !pending.length;
    pendingEl.innerHTML = pending.map((f, i) => `
      <span class="req-chat-chip">${/^image\//.test(f.type) ? "🖼️" : "📎"} ${escapeHtml(f.name)} <small>${sizeText(f.size)}</small>
        <button type="button" data-chat-unpend="${i}" title="เอาออก">×</button></span>`).join("");
  }
  function addFiles(list) {
    const files = [...(list || [])].filter((f) => f && f.size > 0);
    files.forEach((f, i) => {
      // รูปที่วางจากคลิปบอร์ดมักชื่อ image.png — ตั้งชื่อใหม่กันซ้ำ
      if (/^image\.(png|jpe?g)$/i.test(f.name)) {
        const ext = f.name.split(".").pop();
        f = new File([f], `${ref}-${Date.now()}${i}.${ext}`, { type: f.type });
      }
      pending.push(f);
    });
    drawPending();
  }
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
    const sig = `${scope}|${shown.map((m) => m.id + (m.lastModifiedDateTime || "") + String(m.body?.content || "").length).join(",")}`;
    if (!force && sig === lastSig) return;
    lastSig = sig;
    const nearBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 60;
    msgsEl.innerHTML = shown.length ? shown.map((m) => {
      const mine = m.from?.user?.id === myId;
      const text = toText(m.body?.content);
      return `<div class="req-chat-msg ${mine ? "is-mine" : ""}">
        <div class="req-chat-bubble">${text ? bubbleHtml(text) : ""}${extrasHtml(m)}</div>
        <small>${mine ? "คุณ" : escapeHtml(m.from?.user?.displayName || partner.name)} · ${escapeHtml(timeText(m.createdDateTime))}</small>
      </div>`;
    }).join("") : `<p class="req-chat-empty">${scope === "ref" ? `ยังไม่มีข้อความเกี่ยวกับ ${escapeHtml(ref)} — เริ่มพิมพ์ด้านล่างได้เลย` : "ยังไม่มีข้อความในแชทนี้"}</p>`;
    hydrateImages(msgsEl);
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
    attachBtn.disabled = false;
    messages = await listChatMessages(chatId, 50).catch(() => []);
    render(true);
    current.timer = setTimeout(poll, POLL_MS);
  }).catch((error) => {
    msgsEl.innerHTML = `<p class="req-chat-empty">⚠️ เปิดแชท Teams ไม่สำเร็จ: ${escapeHtml(error.message)}</p>`;
  });

  async function send() {
    const text = input.value.trim();
    if ((!text && !pending.length) || !chatId) return;
    input.disabled = true;
    sendBtn.disabled = true;
    attachBtn.disabled = true;
    const files = pending;
    const head = refLines(request).map(([ic, label, v]) => `${ic} <b>${escapeHtml(label)}:</b> ${escapeHtml(v)}`).join("<br>");
    try {
      const hostedContents = [];
      const attachments = [];
      let media = "";
      for (let i = 0; i < files.length; i += 1) {
        const f = files[i];
        sendBtn.textContent = `${i + 1}/${files.length}`;
        if (/^image\/(png|jpe?g|gif)$/i.test(f.type) && f.size <= INLINE_IMAGE_MAX) {
          const id = String(hostedContents.length + 1);
          hostedContents.push({ "@microsoft.graph.temporaryId": id, contentBytes: await fileToBase64(f), contentType: f.type });
          media += `<br><img src="../hostedContents/${id}/$value" alt="${escapeHtml(f.name)}" style="max-width:360px" />`;
        } else {
          const up = await uploadChatFile(f, partner.email);
          attachments.push({ id: up.attachmentId, contentType: "reference", contentUrl: up.webUrl, name: up.name });
          media += `<attachment id="${up.attachmentId}"></attachment>`;
        }
      }
      const body = text ? escapeHtml(text).replace(/\n/g, "<br>") : `📎 แนบ ${files.length} ไฟล์`;
      const sent = await postChatMessage(chatId, `${head}<br>──────────<br>${body}${media}`, { attachments, hostedContents });
      if (sent) messages = [sent, ...messages];
      input.value = "";
      pending = [];
      drawPending();
      render(true);
    } catch (error) {
      alert(`ส่งข้อความไม่สำเร็จ: ${error.message}`);
    } finally {
      sendBtn.textContent = "ส่ง";
      input.disabled = false;
      sendBtn.disabled = false;
      attachBtn.disabled = false;
      input.focus();
    }
  }

  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });
  input.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  panel.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); panel.classList.add("is-drop"); } });
  panel.addEventListener("dragleave", (e) => { if (!panel.contains(e.relatedTarget)) panel.classList.remove("is-drop"); });
  panel.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    panel.classList.remove("is-drop");
    if (!attachBtn.disabled) addFiles(e.dataTransfer.files);
  });
  msgsEl.addEventListener("click", (e) => {
    const img = e.target.closest(".req-chat-img[src]");
    if (img) window.open(img.src, "_blank", "noopener");
  });
  pendingEl.addEventListener("click", (e) => {
    const i = e.target.closest("[data-chat-unpend]")?.dataset.chatUnpend;
    if (i === undefined) return;
    pending.splice(Number(i), 1);
    drawPending();
  });

  panel.querySelector(".req-chat-form").addEventListener("submit", (e) => { e.preventDefault(); send(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  panel.addEventListener("click", (e) => {
    if (e.target.closest("[data-chat-close]")) {
      const dialog = dialogEl;
      closeRequestChat();
      // ยังเปิดหน้าต่างคำร้องอยู่ → มีปุ่มเปิดแชทอีกครั้งที่ขอบขวา
      if (dialog?.isConnected) {
        removeReopenTab();
        reopenTab = document.createElement("button");
        reopenTab.type = "button";
        reopenTab.className = "req-chat-reopen";
        reopenTab.innerHTML = "💬 <span>แชท Teams</span>";
        reopenTab.title = `เปิดแชทกับ ${partner.name} อีกครั้ง`;
        reopenTab.addEventListener("click", () => { removeReopenTab(); openRequestChat(request, dialog); });
        document.body.appendChild(reopenTab);
        const watch = new MutationObserver(() => { if (!dialog.isConnected) { removeReopenTab(); watch.disconnect(); } });
        watch.observe(document.querySelector("#modal-root") || document.body, { childList: true, subtree: true });
      }
      return;
    }
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
