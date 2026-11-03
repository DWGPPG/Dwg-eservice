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
