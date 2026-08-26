// ══════════════════════════════════════════════════════════════
// TEAM PULSE SERVICE — เช็คอินความรู้สึก/แผนงานประจำวันของฝ่ายเขียนแบบ
// แสดงในหน้า "01 ภาพรวม" — เฉพาะฝ่ายเขียนแบบ/ผู้จัดการโพสต์ได้ คนอื่นดู+ react ได้อย่างเดียว
// ══════════════════════════════════════════════════════════════

import { fields, lists } from "../../../config/schema.js";
import { addItem, deleteItem, getListItems, patchItem } from "../sharepoint.js";
import { state } from "../state.js";
import { writeAudit } from "./audit-service.js";
import { getAllManagerEmails, getDrawingTeamMembers } from "./team-service.js";

const RETENTION_DAYS = 30; // เก็บโพสต์ล่าสุด 30 วันไว้ในฟีดหลัก เก่ากว่านั้นต้องกด "ดูโพสต์เก่ากว่านี้"
const DAY_MS = 86400000;

export const MOODS = [
  { key: "good",  emoji: "😊", label: "สดใส" },
  { key: "ok",    emoji: "🙂", label: "ปกติ" },
  { key: "meh",   emoji: "😐", label: "เฉยๆ" },
  { key: "tired", emoji: "😓", label: "เหนื่อย" },
  { key: "fire",  emoji: "🔥", label: "ลุยเลย" },
];

export const REACTIONS = [
  { key: "like",      emoji: "👍", label: "ถูกใจ" },
  { key: "love",      emoji: "❤️", label: "ปลื้มใจ" },
  { key: "celebrate", emoji: "🎉", label: "ยินดีด้วย" },
  { key: "strong",    emoji: "💪", label: "สู้ๆ" },
  { key: "clap",      emoji: "👏", label: "เยี่ยมมาก" },
  { key: "fire",      emoji: "🔥", label: "มันส์" },
  { key: "laugh",     emoji: "😂", label: "ฮา" },
  { key: "wow",       emoji: "😮", label: "ว้าว" },
  { key: "thanks",    emoji: "🙏", label: "ขอบคุณ" },
  { key: "ack",       emoji: "✅", label: "รับทราบ" },
];

export function moodMeta(key) { return MOODS.find((m) => m.key === key) || MOODS[1]; }
export function reactionMeta(key) { return REACTIONS.find((r) => r.key === key); }

/** ใครโพสต์ได้บ้าง — ฝ่ายเขียนแบบ (DrawingTeam) หรือผู้จัดการเท่านั้น */
export function canPostTeamPulse(user) {
  if (!user?.email) return false;
  const email = user.email.toLowerCase();
  const isDesigner = getDrawingTeamMembers().some((m) => m.email.toLowerCase() === email);
  const isManager  = getAllManagerEmails().includes(email);
  return isDesigner || isManager;
}

export function isTeamPulseManager(email) {
  return getAllManagerEmails().includes(String(email || "").toLowerCase());
}

function dayKey(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function safeParseReactions(raw) {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function fromSharePoint(item) {
  const f = fields.teamPulse;
  return {
    id: item.id,
    authorEmail: item[f.authorEmail] || "",
    authorName: item[f.authorName] || "",
    mood: item[f.mood] || "ok",
    text: item[f.postText] || "",
    reactions: safeParseReactions(item[f.reactions]),
    postedAt: item[f.postedAt] || "",
    editedAt: item[f.editedAt] || "",
  };
}

/**
 * โหลดโพสต์ทั้งหมด เรียงใหม่สุดก่อน — แยก recent (30 วันล่าสุด) กับ older ให้ผู้เรียกใช้เอง
 */
export async function loadTeamPulsePosts() {
  try {
    const items = await getListItems(lists.teamPulse);
    return items.map(fromSharePoint).sort((a, b) => new Date(b.postedAt || 0) - new Date(a.postedAt || 0));
  } catch (error) {
    console.warn("loadTeamPulsePosts failed (non-critical):", error.message);
    return [];
  }
}

/** แบ่งโพสต์เป็น "30 วันล่าสุด" กับ "เก่ากว่านั้น" สำหรับปุ่มดูเพิ่มเติมในฟีด */
export function splitTeamPulsePosts(posts) {
  const cutoff = Date.now() - RETENTION_DAYS * DAY_MS;
  return {
    recent: posts.filter((p) => new Date(p.postedAt).getTime() >= cutoff),
    older:  posts.filter((p) => new Date(p.postedAt).getTime() < cutoff),
  };
}

/** เช็คว่าอีเมลนี้เช็คอิน (โพสต์) ไปแล้ววันนี้หรือยัง — ใช้ตัดสินใจว่าจะเด้งป็อปอัพไหม */
export function hasCheckedInToday(posts, email) {
  const today = dayKey(new Date());
  return posts.some((p) => p.authorEmail.toLowerCase() === String(email || "").toLowerCase() && dayKey(p.postedAt) === today);
}

/** สรุปจำนวนแต่ละ mood ของโพสต์ "วันนี้" — ใช้ทำแถบสรุปทีม */
export function summarizeTodayMoods(posts) {
  const today = dayKey(new Date());
  const todays = posts.filter((p) => dayKey(p.postedAt) === today);
  const counts = {};
  todays.forEach((p) => { counts[p.mood] = (counts[p.mood] || 0) + 1; });
  return { counts, total: todays.length };
}

export async function createTeamPulsePost({ mood, text }) {
  const user = state.user || {};
  const now = new Date().toISOString();
  const f = fields.teamPulse;
  const payload = {
    [f.title]: (text || "").slice(0, 80),
    [f.authorEmail]: user.email || "",
    [f.authorName]: user.name || "",
    [f.mood]: mood || "ok",
    [f.postText]: text || "",
    [f.reactions]: "{}",
    [f.postedAt]: now,
  };
  const result = await addItem(lists.teamPulse, payload);
  return fromSharePoint(result);
}

export async function updateTeamPulsePost(postId, newText) {
  const f = fields.teamPulse;
  await patchItem(lists.teamPulse, postId, {
    [f.postText]: newText,
    [f.title]: (newText || "").slice(0, 80),
    [f.editedAt]: new Date().toISOString(),
  });
}

/**
 * ลบโพสต์ — ถ้าผู้ลบไม่ใช่เจ้าของ (ผู้จัดการลบแทน) จะบันทึกลง Audit Log ด้วย
 * @param {object} post โพสต์ที่จะลบ (ต้องมี id, authorName, text)
 */
export async function deleteTeamPulsePost(post) {
  const user = state.user || {};
  const isOwner = String(post.authorEmail || "").toLowerCase() === String(user.email || "").toLowerCase();
  await deleteItem(lists.teamPulse, post.id);
  if (!isOwner) {
    await writeAudit({
      requestNo: "TEAMPULSE",
      action: `ลบโพสต์ Team Pulse ของ "${post.authorName}"`,
      detail: (post.text || "").slice(0, 120),
    });
  }
}

/**
 * สลับ reaction ของผู้ใช้ปัจจุบันบนโพสต์หนึ่ง — เพิ่ม/เอาออกอีเมลตัวเองในลิสต์ของ emoji นั้น
 * รองรับหลาย reaction พร้อมกันในโพสต์เดียว (ไม่ใช่เลือกได้แค่แบบเดียว)
 */
export async function toggleTeamPulseReaction(post, reactionKey) {
  const user = state.user || {};
  const email = (user.email || "").toLowerCase();
  if (!email) return post.reactions;

  const reactions = { ...post.reactions };
  const list = new Set(reactions[reactionKey] || []);
  if (list.has(email)) list.delete(email); else list.add(email);

  if (list.size) reactions[reactionKey] = [...list];
  else delete reactions[reactionKey];

  await patchItem(lists.teamPulse, post.id, {
    [fields.teamPulse.reactions]: JSON.stringify(reactions),
  });
  return reactions;
}
