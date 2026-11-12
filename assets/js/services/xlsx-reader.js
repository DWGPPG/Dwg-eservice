// ══════════════════════════════════════════════════════════════
// ตัวอ่านไฟล์ Excel (.xlsx) แบบเบา — ไม่ใช้ไลบรารีภายนอก
//  .xlsx = ไฟล์ zip ของ XML → แตก zip ด้วย DecompressionStream ของเบราว์เซอร์ แล้วอ่าน XML ด้วย DOMParser
//  คืนค่าแผ่นงานแรกเป็นแถว (array ของ array) — ตัวเลขวันที่ของ Excel แปลงเองตามคอลัมน์ที่ต้องการ
// ══════════════════════════════════════════════════════════════

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** อ่านรายการไฟล์ใน zip → Map<ชื่อไฟล์, () => Promise<Uint8Array>> */
function readZip(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ไฟล์ไม่ใช่ .xlsx ที่ถูกต้อง");
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const entries = new Map();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n += 1) {
    if (u32(bytes, p) !== 0x02014b50) break;
    const method = u16(bytes, p + 10);
    const size = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, async () => {
      const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return data;
      if (method !== 8) throw new Error(`รูปแบบการบีบอัดไม่รองรับ (${method})`);
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readXml(entries, name) {
  const get = entries.get(name);
  if (!get) return null;
  const text = new TextDecoder().decode(await get());
  return new DOMParser().parseFromString(text, "application/xml");
}

const byTag = (node, tag) => [...node.getElementsByTagName(tag)];

function colIndex(ref) {
  const letters = String(ref || "").match(/^[A-Z]+/i)?.[0].toUpperCase() || "A";
  return [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
}

/** แผ่นงานแรกของไฟล์ → array ของแถว (ค่าเป็น string หรือ number) */
export async function readFirstSheet(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = readZip(bytes);

  // หาไฟล์ของแผ่นงานแรกจาก workbook + rels (เผื่อชื่อไม่ใช่ sheet1.xml)
  let sheetPath = "xl/worksheets/sheet1.xml";
  const wb = await readXml(entries, "xl/workbook.xml");
  const rels = await readXml(entries, "xl/_rels/workbook.xml.rels");
  const firstSheet = wb && byTag(wb, "sheet")[0];
  if (firstSheet && rels) {
    const rid = firstSheet.getAttribute("r:id") || firstSheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const rel = byTag(rels, "Relationship").find((r) => r.getAttribute("Id") === rid);
    const target = rel?.getAttribute("Target");
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }

  const sst = await readXml(entries, "xl/sharedStrings.xml");
  const strings = sst ? byTag(sst, "si").map((si) => byTag(si, "t").map((t) => t.textContent).join("")) : [];

  const sheet = await readXml(entries, sheetPath);
  if (!sheet) throw new Error("ไม่พบแผ่นงานในไฟล์");
  const rows = [];
  byTag(sheet, "row").forEach((row) => {
    const out = [];
    byTag(row, "c").forEach((c) => {
      const type = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent;
      let value = "";
      if (type === "s") value = strings[Number(v)] ?? "";
      else if (type === "inlineStr") value = byTag(c, "t").map((t) => t.textContent).join("");
      else if (type === "str" || type === "e") value = v ?? "";
      else if (type === "b") value = v === "1";
      else if (v !== undefined && v !== "") value = Number(v);
      out[colIndex(c.getAttribute("r"))] = value;
    });
    const index = Number(row.getAttribute("r")) - 1;
    rows[Number.isFinite(index) && index >= 0 ? index : rows.length] = out;
  });
  return Array.from(rows, (r) => Array.from(r || [], (v) => (v === undefined ? "" : v)));
}

/** เลขวันที่ของ Excel (หรือข้อความวันที่) → "YYYY-MM-DDTHH:mm:ss" เวลาท้องถิ่น · "" ถ้าแปลงไม่ได้ */
export function excelDate(value) {
  const pad = (n) => String(n).padStart(2, "0");
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const d = new Date(Math.round((value - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }
  const text = String(value || "").trim();
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const year = Number(m[3]) > 2400 ? Number(m[3]) - 543 : Number(m[3]);
    return `${year}-${pad(m[2])}-${pad(m[1])}T${pad(m[4] || 0)}:${pad(m[5] || 0)}:${pad(m[6] || 0)}`;
  }
  const d = new Date(text);
  return text && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00` : "";
}

/**
 * อ่านไฟล์ ZIP ทั่วไป → [{ name, isDir, size, read: () => Promise<Uint8Array> }]
 * ชื่อไฟล์ภาษาไทย: ZIP ที่บีบอัดด้วย Windows เดิมเก็บชื่อเป็น windows-874 (ไม่ได้ตั้งธง UTF-8) → แปลงให้อัตโนมัติ
 */
export async function readZipEntries(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ไฟล์ไม่ใช่ ZIP ที่ถูกต้อง (รองรับเฉพาะ .zip — ไฟล์ .rar ให้แปลงเป็น .zip ก่อน)");
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  let thai;
  try { thai = new TextDecoder("windows-874"); } catch (_) { thai = new TextDecoder(); }
  const out = [];
  for (let n = 0; n < count; n += 1) {
    if (u32(bytes, p) !== 0x02014b50) break;
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const csize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const raw = bytes.subarray(p + 46, p + 46 + nameLen);
    let name;
    if (flags & 0x800) name = new TextDecoder().decode(raw);
    else { try { name = utf8.decode(raw); } catch (_) { name = thai.decode(raw); } }
    name = name.replace(/\\/g, "/").replace(/^\/+/, "");
    if (flags & 0x1) throw new Error("ไม่รองรับ ZIP ที่ตั้งรหัสผ่าน");
    out.push({
      name,
      isDir: name.endsWith("/"),
      size,
      read: async () => {
        const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
        const data = bytes.subarray(start, start + csize);
        if (method === 0) return data;
        if (method !== 8) throw new Error(`รูปแบบการบีบอัดไม่รองรับ (${method}) — ${name}`);
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      },
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!out.length) throw new Error("ไม่พบไฟล์ใน ZIP");
  return out;
}

// ── สร้างไฟล์ ZIP (แบบไม่บีบอัด — ไฟล์ PDF/DWG บีบอัดเพิ่มได้น้อยอยู่แล้ว) · ชื่อไฟล์ UTF-8 (ภาษาไทยเปิดใน Windows ได้) ──
let crcTable = null;
function crc32(data) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** files: [{ name: "โฟลเดอร์/ไฟล์.pdf", data: Uint8Array, date?: Date }] → Blob (application/zip) */
export function buildZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xffff;
  const dosDate = (d) => (((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  files.forEach((f) => {
    const name = enc.encode(f.name);
    const data = f.data || new Uint8Array(0);
    const crc = crc32(data);
    const d = f.date instanceof Date && !Number.isNaN(f.date.getTime()) ? f.date : new Date();
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x800, true); head.setUint16(8, 0, true);
    head.setUint16(10, dosTime(d), true); head.setUint16(12, dosDate(d), true); head.setUint32(14, crc, true);
    head.setUint32(18, data.length, true); head.setUint32(22, data.length, true); head.setUint16(26, name.length, true); head.setUint16(28, 0, true);
    parts.push(head, name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime(d), true); cd.setUint16(14, dosDate(d), true); cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd, name);
    offset += 30 + name.length + data.length;
  });
  const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
