// สร้าง assets/css/theme-dark-auto.css อัตโนมัติจาก CSS เดิม
// หาทุก declaration ที่ hardcode สีไว้ แล้วแปลงเป็นสีสำหรับธีมมืด (พื้นสว่าง → พื้นมืด, ตัวอักษรเข้ม → สว่าง)
// รันใหม่ทุกครั้งที่แก้ CSS เดิม:  node tools/gen-dark-css.mjs
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";

const SOURCES = ["base.css", "layout.css", "components.css", "responsive.css", "mobile-fixes.css"];
const OUT = "assets/css/theme-dark-auto.css";
const PREFIX = '[data-theme="dark"]';

// ── color helpers ──
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1] };
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/g;

function parseColor(str) {
  if (NAMED[str]) return NAMED[str].slice();
  if (str[0] === "#") {
    let h = str.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const parts = str.match(/[\d.]+%?/g)?.map((p) => (p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p)));
  if (!parts || parts.length < 3) return null;
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

function toHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

const hsl = (h, s, l, a = 1) =>
  a < 1 ? `hsla(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%, ${+a.toFixed(3)})`
        : `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;

// kind: bg | text | border
function darkColor(str, kind) {
  const c = parseColor(str);
  if (!c) return str;
  const [h, s, l] = toHsl(c);
  const a = c[3];
  const tinted = s > 0.18;

  if (kind === "text") {
    if (l >= 0.62) return str;                         // สว่างอยู่แล้ว (เช่น #fff บนปุ่ม)
    if (!tinted) return l < 0.3 ? "var(--text)" : "var(--muted)";
    return hsl(h, Math.min(1, s * 0.9 + 0.1), 0.7, a);   // สีสถานะ → สว่างขึ้นให้อ่านได้บนพื้นมืด
  }

  if (kind === "border") {
    if (a < 1 && l < 0.5) return `rgba(255, 255, 255, ${+Math.min(0.2, a * 1.3 + 0.03).toFixed(3)})`;
    if (l > 0.75) return tinted ? hsl(h, Math.min(1, s), 0.6, 0.28) : "var(--line)";
    return str;
  }

  // bg
  if (a < 1) {
    if (l < 0.45 && !tinted) return `rgba(255, 255, 255, ${+Math.min(0.12, a * 1.2).toFixed(3)})`;
    if (l > 0.9 && !tinted) return `rgba(255, 255, 255, ${+Math.min(0.08, a * 0.12).toFixed(3)})`;
    return hsl(h, Math.max(s, 0.5), Math.max(l, 0.55), Math.min(0.22, a * 1.4 + 0.04));
  }
  if (l > 0.8) return tinted ? hsl(h, Math.min(1, s), 0.55, 0.12) : l > 0.975 ? "var(--surface-solid)" : "var(--surface-2)";
  if (l > 0.62 && tinted) return hsl(h, s, 0.55, 0.22);
  if (l > 0.62) return "var(--surface-3)";
  return str;                                          // สีเข้ม/สีสด (ปุ่ม, แถบ) คงไว้
}

function kindOf(prop) {
  if (prop === "color" || prop === "fill" || prop === "-webkit-text-fill-color" || prop === "caret-color") return "text";
  if (prop.startsWith("border") || prop === "outline" || prop === "outline-color" || prop === "stroke") return "border";
  if (prop === "background" || prop === "background-color" || prop === "background-image") return "bg";
  return null;
}

function transformValue(value, kind) {
  // ป้องกันสี fallback ใน var(--x, #fff) ไม่ให้ถูกแปลง
  const guarded = [];
  const masked = value.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, (m) => `\u0000${guarded.push(m) - 1}\u0000`);
  if (!COLOR_RE.test(masked)) return null;
  COLOR_RE.lastIndex = 0;
  const out = masked.replace(COLOR_RE, (m) => darkColor(m, kind));
  if (out === masked) return null;
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => guarded[i]);
}

// ── minimal CSS parser (rules + nested @media/@supports) ──
function parse(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  function block() {
    const nodes = [];
    while (i < css.length) {
      const open = css.indexOf("{", i), close = css.indexOf("}", i);
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return nodes; }
      if (open === -1) break;
      const head = css.slice(i, open).trim();
      i = open + 1;
      if (head.startsWith("@media") || head.startsWith("@supports")) {
        nodes.push({ at: head, children: block() });
      } else if (head.startsWith("@")) {
        let depth = 1;
        while (depth && i < css.length) { if (css[i] === "{") depth++; if (css[i] === "}") depth--; i++; }
      } else {
        const end = css.indexOf("}", i);
        nodes.push({ selector: head.replace(/^[^{]*;/, "").trim(), body: css.slice(i, end) });
        i = end + 1;
      }
    }
    return nodes;
  }
  return block();
}

function prefixSelector(sel) {
  return sel.split(",").map((s) => {
    s = s.trim();
    if (!s || s.startsWith(":root") || s.includes("data-theme")) return null;
    if (/^html\b/.test(s)) return s.replace(/^html/, `html${PREFIX}`);
    return `${PREFIX} ${s}`;
  }).filter(Boolean).join(",\n");
}

function emit(nodes, indent = "") {
  let out = "";
  for (const node of nodes) {
    if (node.at) {
      const inner = emit(node.children, indent + "  ");
      if (inner.trim()) out += `${indent}${node.at} {\n${inner}${indent}}\n`;
      continue;
    }
    const decls = [];
    for (const raw of node.body.split(/;(?![^(]*\))/)) {
      const idx = raw.indexOf(":");
      if (idx < 0) continue;
      const prop = raw.slice(0, idx).trim().toLowerCase();
      const value = raw.slice(idx + 1).trim();
      const kind = kindOf(prop);
      if (!kind || prop.startsWith("--")) continue;
      const next = transformValue(value, kind);
      if (next) decls.push(`${prop}: ${next}`);
    }
    const sel = prefixSelector(node.selector);
    if (decls.length && sel) out += `${indent}${sel.replace(/\n/g, "\n" + indent)} {\n${decls.map((d) => `${indent}  ${d};`).join("\n")}\n${indent}}\n`;
  }
  return out;
}

// ครอบทั้งไฟล์ด้วย @media screen — ตอนพิมพ์รายงาน/PDF ให้ใช้สีเดิม (พื้นขาว) เสมอ
let result = "/* ⚠️ ไฟล์นี้สร้างอัตโนมัติด้วย tools/gen-dark-css.mjs — ห้ามแก้ไขตรงนี้ ให้แก้ที่ CSS ต้นฉบับแล้วรันสคริปต์ใหม่ */\n\n@media screen {\n\n";
for (const file of SOURCES) {
  const body = emit(parse(readFileSync(`assets/css/${file}`, "utf8")));
  if (body) result += `/* ── from ${file} ── */\n${body}\n`;
}
// ── inline style="..." ที่ JS เขียนสีไว้ตรงๆ — override ด้วย attribute selector + !important ──
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".js") ? [path] : [];
  });
}
const inline = new Map();
for (const file of walk("assets/js")) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/(?<![-\w])(background|color|border(?:-[a-z]+)?):\s*((?:[\d.]+px\s+(?:solid|dashed|dotted)\s+)?)(#[0-9a-fA-F]{3,8}|white)\b/g)) {
    const prop = m[1], lead = m[2].replace(/\s+/g, " "), color = m[3].toLowerCase();
    const kind = kindOf(prop);
    const next = kind && transformValue(color, kind);
    const value = lead + color;
    if (next && !inline.has(`${prop}:${value}`)) inline.set(`${prop}:${value}`, { prop, value, next });
  }
}
// ค่าที่ยาวกว่าต้องมาทีหลัง (เช่น #fffbeb ต้องชนะ #fff เพราะ *= จับ prefix ได้ทั้งคู่)
const entries = [...inline.values()].sort((a, b) => a.value.length - b.value.length);
result += "/* ── inline styles from assets/js ── */\n";
for (const { prop, value, next } of entries) {
  const target = prop.startsWith("border") && !prop.endsWith("-color") ? `${prop}-color` : prop === "background" ? "background-color" : prop;
  const sels = [`${prop}:${value}`, `${prop}: ${value}`].map((v) => `${PREFIX} [style*="${v}" i]`);
  const val = next;
  result += `${sels.join(",\n")} {\n  ${target}: ${val} !important;\n}\n`;
}

result += "\n}\n";
writeFileSync(OUT, result);
console.log(`wrote ${OUT} (${result.split("\n").length} lines)`);
