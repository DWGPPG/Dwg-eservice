// ══════════════════════════════════════════════════════════════
// รูปโปรไฟล์ Microsoft 365 ของผู้ใช้ที่ล็อกอิน (ใช้สิทธิ์ User.Read ที่มีอยู่แล้ว)
// - ขอรูปขนาดเล็ก 96×96 ครั้งเดียว แล้วจำไว้ในเครื่อง 1 วัน (ไม่ต้องโหลดทุกครั้งที่เปิดเว็บ)
// - ไม่มีรูป / โหลดไม่ได้ → ใช้อักษรย่อชื่อเหมือนเดิม
// ══════════════════════════════════════════════════════════════

import { acquireToken } from "../auth.js";

const CACHE_PREFIX = "ppg-photo::";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const NO_PHOTO = "none";

function readCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry?.at || Date.now() - entry.at > MAX_AGE_MS) return null;
    return entry.data; // dataURL หรือ "none"
  } catch {
    return null;
  }
}

function writeCache(key, data) {
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data })); } catch { /* เต็ม/ปิดอยู่ */ }
}

export function clearPhotoCache() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

let inflight = null;

/** คืน dataURL ของรูป หรือ null ถ้าไม่มีรูป */
export function getMyPhoto(account) {
  const key = String(account?.homeAccountId || account?.username || "").toLowerCase();
  if (!key) return Promise.resolve(null);
  const cached = readCache(key);
  if (cached) return Promise.resolve(cached === NO_PHOTO ? null : cached);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const token = await acquireToken();
      if (!token) return null;
      let res = await fetch("https://graph.microsoft.com/v1.0/me/photos/96x96/$value", { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 404) {
        // บางบัญชีไม่มีขนาด 96×96 แยก — ลองรูปหลัก
        res = await fetch("https://graph.microsoft.com/v1.0/me/photo/$value", { headers: { Authorization: `Bearer ${token}` } });
      }
      if (!res.ok) {
        if (res.status === 404) writeCache(key, NO_PHOTO); // ไม่มีรูปจริง — ไม่ต้องถามซ้ำทั้งวัน
        return null;
      }
      const blob = await res.blob();
      if (!blob.type.startsWith("image/") || blob.size > 400 * 1024) return null;
      const dataUrl = await blobToDataUrl(blob);
      writeCache(key, dataUrl);
      return dataUrl;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
