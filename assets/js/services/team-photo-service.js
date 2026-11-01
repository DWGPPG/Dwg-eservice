// ══════════════════════════════════════════════════════════════
// รูปทีมงานฝ่ายเขียนแบบ (ใช้ในสไลด์ทีมงาน หน้าภาพรวม)
//  - เก็บเป็นไฟล์ใน SharePoint ฝ่ายเขียนแบบ: Documents/DrawingTeamPhotos/<อีเมล>.jpg
//    (ใช้สิทธิ์อัปโหลดไฟล์เดิมของระบบ ไม่ต้องสร้าง List/คอลัมน์ใหม่)
//  - ย่อรูปในเบราว์เซอร์ก่อนอัปโหลด (ด้านยาวสุด 1600px, JPEG) ไฟล์เล็ก โหลดเร็ว
//  - แสดงด้วยลิงก์ดาวน์โหลดชั่วคราวของ SharePoint (อายุ ~1 ชม.) — ขอรายการใหม่อัตโนมัติก่อนหมดอายุ
// ══════════════════════════════════════════════════════════════

import { ensureDriveFolder, graphFetch, uploadDriveFile } from "../graph.js";
import { ensureSite } from "../sharepoint.js";

export const PHOTO_FOLDER = "DrawingTeamPhotos";
export const COVER_KEY = "_team-cover";
const LIST_TTL_MS = 40 * 60 * 1000;
const MAX_SIDE = 1600;

let listing = null;       // Promise<Map<name, {id, url, ts}>>
let listedAt = 0;

export function photoFileName(key) {
  const base = String(key || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
  return `${base}.jpg`;
}

/** รายการรูปทั้งหมดในโฟลเดอร์ (cache 40 นาที) */
export function listTeamPhotos(force = false) {
  if (!force && listing && Date.now() - listedAt < LIST_TTL_MS) return listing;
  listedAt = Date.now();
  listing = (async () => {
    const map = new Map();
    try {
      const siteId = await ensureSite();
      let next = `/sites/${siteId}/drive/root:/${PHOTO_FOLDER}:/children?$top=200`;
      while (next) {
        const res = await graphFetch(next);
        (res?.value || []).forEach((item) => {
          if (!item.file) return;
          map.set(item.name.toLowerCase(), {
            id: item.id,
            url: item["@microsoft.graph.downloadUrl"] || "",
            ts: item.lastModifiedDateTime || "",
          });
        });
        next = res?.["@odata.nextLink"] || null;
      }
    } catch (error) {
      if (!String(error.message || "").includes("404")) console.warn("โหลดรูปทีมงานไม่สำเร็จ:", error.message);
    }
    return map;
  })();
  return listing;
}

/** ลิงก์รูปของคน (อีเมล) หรือรูปปก (COVER_KEY) — null ถ้ายังไม่มีรูป */
export async function teamPhotoUrl(key) {
  const map = await listTeamPhotos();
  return map.get(photoFileName(key))?.url || null;
}

/** ย่อรูปเป็น JPEG ก่อนอัปโหลด */
async function resizeImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("แปลงรูปไม่สำเร็จ"))), "image/jpeg", 0.86));
}

/** อัปโหลด/แทนที่รูป — key = อีเมลสมาชิก หรือ COVER_KEY */
export async function uploadTeamPhoto(key, file) {
  if (!file || !String(file.type || "").startsWith("image/")) throw new Error("กรุณาเลือกไฟล์รูปภาพ (JPG / PNG / WEBP)");
  const blob = await resizeImage(file);
  const siteId = await ensureSite();
  await ensureDriveFolder(siteId, PHOTO_FOLDER);
  const named = new File([blob], photoFileName(key), { type: "image/jpeg" });
  await uploadDriveFile(siteId, PHOTO_FOLDER, named);
  listing = null; // ให้โหลดรายการใหม่ (ลิงก์ใหม่)
}

export async function deleteTeamPhoto(key) {
  const map = await listTeamPhotos(true);
  const entry = map.get(photoFileName(key));
  if (!entry) return;
  const siteId = await ensureSite();
  await graphFetch(`/sites/${siteId}/drive/items/${entry.id}`, { method: "DELETE" });
  listing = null;
}

/** ใส่รูปให้ทุก element ที่มี data-team-photo="<อีเมล|COVER_KEY>" (img → src, อื่นๆ → background-image) */
export async function hydrateTeamPhotos(root = document) {
  const targets = [...root.querySelectorAll("[data-team-photo]")];
  if (!targets.length) return;
  const map = await listTeamPhotos();
  targets.forEach((el) => {
    const url = map.get(photoFileName(el.dataset.teamPhoto))?.url;
    if (!url || !el.isConnected) return;
    if (el.tagName === "IMG") {
      el.src = url;
      el.hidden = false;
    } else {
      el.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
    }
    el.classList.add("has-photo");
  });
}
