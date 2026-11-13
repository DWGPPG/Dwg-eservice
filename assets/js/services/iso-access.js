// ══════════════════════════════════════════════════════════════
// แชร์โฟลเดอร์เอกสาร ISO ให้ผู้ร้องขอ / บุคคล — "ดูได้ ดาวน์โหลดไม่ได้" หรือ "ดาวน์โหลดได้"
//  - ผู้จัดการเลือกโฟลเดอร์ + คน → ระบบสร้างลิงก์ SharePoint ของทุกไฟล์ในโฟลเดอร์
//      ดูอย่างเดียว = ลิงก์ชนิด blocksDownload (SharePoint ซ่อน/ปิดปุ่มดาวน์โหลด พิมพ์ และซิงก์)
//      ดาวน์โหลดได้ = ลิงก์ชนิด view
//  - เก็บรายการไฟล์ + ลิงก์ไว้ใน Documents/ISO-Share/iso-access.json (นอกโฟลเดอร์ ISO-DWG)
//      → ผู้ร้องขอเห็นเฉพาะโฟลเดอร์ที่แชร์ให้ แม้โฟลเดอร์ ISO-DWG จะปิดสิทธิ์ไว้เฉพาะฝ่ายเขียนแบบ
//  - ไฟล์ที่เพิ่มทีหลัง: กด "อัปเดตไฟล์ที่แชร์" (หรือบันทึกการแชร์ใหม่) ให้ระบบสร้างลิงก์เพิ่ม
// ══════════════════════════════════════════════════════════════

import { ensureDriveFolder, graphFetch, uploadDriveFile } from "../graph.js";
import { ensureSite } from "../sharepoint.js";
import { state } from "../state.js";
import { ISO_ROOT, joinPath } from "./iso-service.js";

export const ACCESS_FOLDER = "ISO-Share";
const ACCESS_FILE = "iso-access.json";
export const MAX_SHARE_FILES = 1500;
export const SHARE_MODES = {
  view: { label: "ดูได้อย่างเดียว — ดาวน์โหลดไม่ได้", short: "🔒 ดูอย่างเดียว", linkType: "blocksDownload" },
  download: { label: "ดูและดาวน์โหลดได้", short: "⬇️ ดาวน์โหลดได้", linkType: "view" },
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const emptyManifest = () => ({ version: 1, updatedAt: "", shares: {} });
let cache = null; // { at, promise }
const listeners = new Set();
export const onAccessChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** อ่านรายการแชร์ (ใช้ซ้ำ 2 นาที · force = อ่านใหม่) — ยังไม่มีไฟล์ = ว่าง */
export function loadAccess(force = false) {
  if (!force && cache && Date.now() - cache.at < 120000) return cache.promise;
  const promise = (async () => {
    const site = await ensureSite();
    const item = await graphFetch(`/sites/${site}/drive/root:/${ACCESS_FOLDER}/${ACCESS_FILE}`).catch((e) => {
      if (/404|itemNotFound/i.test(String(e.message))) return null;
      throw e;
    });
    const url = item?.["@microsoft.graph.downloadUrl"];
    if (!url) return emptyManifest();
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return data && typeof data.shares === "object" ? data : emptyManifest();
  })();
  cache = { at: Date.now(), promise };
  promise.catch(() => { cache = null; });
  return promise;
}

async function saveAccess(manifest) {
  manifest.updatedAt = new Date().toISOString();
  const site = await ensureSite();
  await ensureDriveFolder(site, ACCESS_FOLDER);
  const file = new File([JSON.stringify(manifest)], ACCESS_FILE, { type: "application/json" });
  for (let i = 0; ; i += 1) {
    try { await uploadDriveFile(site, ACCESS_FOLDER, file); break; } catch (error) {
      if (!/\b423\b|locked|\b409\b/i.test(String(error.message)) || i >= 3) throw error;
      await wait(1500 * (i + 1));
    }
  }
  cache = { at: Date.now(), promise: Promise.resolve(manifest) };
  [...listeners].forEach((fn) => { try { fn(manifest); } catch (_) { /* ignore */ } });
  return manifest;
}

const norm = (v) => String(v || "").trim().toLowerCase();

/** การแชร์ที่ผู้ใช้คนนี้เห็นได้ → [{ path, ...share }] */
export function sharesForUser(manifest, user = state.user) {
  const email = norm(user?.email);
  return Object.entries(manifest?.shares || {})
    .filter(([, s]) => s.everyone || (s.users || []).some((u) => norm(u.email) === email))
    .map(([path, s]) => ({ path, ...s }))
    .sort((a, b) => a.path.localeCompare(b.path, "th", { numeric: true }));
}

/** ลิงก์ SharePoint ของไฟล์ (เรียกซ้ำได้ — SharePoint คืนลิงก์เดิมถ้ามีอยู่แล้ว) */
async function createLink(driveId, itemId, linkType) {
  const body = JSON.stringify({ type: linkType, scope: "organization" });
  for (let i = 0; ; i += 1) {
    try {
      const res = await graphFetch(`/drives/${driveId}/items/${itemId}/createLink`, { method: "POST", body });
      return res?.link?.webUrl || "";
    } catch (error) {
      if (/\b(429|503|504)\b/.test(String(error.message)) && i < 3) { await wait(1500 * (i + 1)); continue; }
      throw error;
    }
  }
}

/** ไฟล์ + โฟลเดอร์ย่อยทั้งหมดในโฟลเดอร์ ISO (path นับจาก ISO_ROOT) */
async function snapshotFolder(path) {
  const site = await ensureSite();
  const out = [];
  const walk = async (rel) => {
    let next = `/sites/${site}/drive/root:/${joinPath(ISO_ROOT, path, rel).split("/").map(encodeURIComponent).join("/")}:/children?$top=200&$select=id,name,size,folder,file,lastModifiedDateTime,parentReference`;
    while (next) {
      const res = await graphFetch(next);
      for (const it of res?.value || []) {
        if (/^(thumbs\.db|desktop\.ini|\.ds_store)$/i.test(it.name)) continue;
        const p = rel ? `${rel}/${it.name}` : it.name;
        if (it.folder) {
          out.push({ p, isFolder: true });
          await walk(p);
        } else if (it.file) {
          out.push({ p, isFolder: false, id: it.id, driveId: it.parentReference?.driveId, size: it.size || 0, modified: it.lastModifiedDateTime || "" });
        }
        if (out.length > MAX_SHARE_FILES) throw new Error(`โฟลเดอร์นี้มีมากกว่า ${MAX_SHARE_FILES} รายการ — เลือกแชร์โฟลเดอร์ย่อยแทน`);
      }
      next = res?.["@odata.nextLink"] || null;
    }
  };
  await walk("");
  return out;
}

/** สร้าง/อัปเดตลิงก์ของทุกไฟล์ในโฟลเดอร์ที่แชร์ (ใช้ลิงก์เดิมถ้าไฟล์และชนิดลิงก์ไม่เปลี่ยน) */
async function buildItems(path, mode, oldItems = [], onProgress) {
  const linkType = SHARE_MODES[mode]?.linkType || "blocksDownload";
  const items = await snapshotFolder(path);
  const reuse = new Map(oldItems.filter((x) => x.link && x.mode === mode).map((x) => [x.id, x.link]));
  const files = items.filter((x) => !x.isFolder);
  let done = 0;
  const failures = [];
  const queue = [...files];
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift();
      try {
        f.link = reuse.get(f.id) || await createLink(f.driveId, f.id, linkType);
        f.mode = mode;
      } catch (error) {
        failures.push({ p: f.p, error: error.message });
      }
      delete f.driveId;
      done += 1;
      onProgress?.(done, files.length, f.p);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, files.length || 1) }, worker));
  return { items, failures };
}

/**
 * แชร์ / แก้การแชร์โฟลเดอร์
 * @param {string} path โฟลเดอร์ (นับจาก ISO_ROOT)
 * @param {{mode:"view"|"download", everyone:boolean, users:Array<{email,name}>}} opts
 */
export async function shareFolder(path, { mode = "view", everyone = false, users = [] }, onProgress) {
  const manifest = await loadAccess(true);
  const old = manifest.shares[path];
  const { items, failures } = await buildItems(path, mode, old?.items || [], onProgress);
  manifest.shares[path] = {
    mode,
    everyone: Boolean(everyone),
    users: users.map((u) => ({ email: String(u.email).trim(), name: u.name || u.email })),
    by: state.user?.name || "",
    at: new Date().toISOString(),
    items,
  };
  await saveAccess(manifest);
  return { files: items.filter((x) => !x.isFolder).length, failures };
}

export async function unshareFolder(path) {
  const manifest = await loadAccess(true);
  delete manifest.shares[path];
  await saveAccess(manifest);
}

/** อัปเดตรายการไฟล์ของทุกโฟลเดอร์ที่แชร์ (ไฟล์ใหม่ได้ลิงก์ · ไฟล์ที่ลบหายไปจากรายการ) */
export async function refreshAllShares(onProgress) {
  const manifest = await loadAccess(true);
  const paths = Object.keys(manifest.shares);
  const failures = [];
  for (let i = 0; i < paths.length; i += 1) {
    const path = paths[i];
    const s = manifest.shares[path];
    try {
      const res = await buildItems(path, s.mode, s.items || [], (n, total, name) => onProgress?.(i + 1, paths.length, path, n, total, name));
      s.items = res.items;
      failures.push(...res.failures.map((f) => ({ ...f, p: `${path}/${f.p}` })));
    } catch (error) {
      failures.push({ p: path, error: error.message });
    }
  }
  await saveAccess(manifest);
  return { folders: paths.length, failures };
}
