import fs from "node:fs";
import path from "node:path";

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf-8");
}

export function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const MONTHS = {
  it: ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
  de: ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"],
};

export function formatDate(isoDate, lang) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const months = MONTHS[lang] || MONTHS.en;
  const day = String(d).padStart(2, "0");
  if (lang === "en") return `${months[m - 1]} ${day}, ${y}`;
  return `${day} ${months[m - 1]} ${y}`;
}

// Short "day month" form (no year — used in the Articles timeline, where
// entries are already grouped under a year heading).
export function formatDateShort(isoDate, lang) {
  const [, m, d] = isoDate.split("-").map(Number);
  const months = MONTHS[lang] || MONTHS.en;
  const day = String(d).padStart(2, "0");
  if (lang === "en") return `${months[m - 1]} ${day}`;
  return `${day} ${months[m - 1]}`;
}

export function readingTimeMinutes(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
