#!/usr/bin/env node
/**
 * Kinetic Code — automated article translation.
 *
 * For every Markdown article under content/articles/it/, checks whether a
 * translation exists for each of the other configured languages. If not,
 * calls the Claude API to generate one and writes it to
 * content/articles/{lang}/{same-filename}.md — same filename as the
 * Italian original, which is how the site links translations together.
 *
 * By default this SKIPS languages that already have a file for a given
 * article, so it never clobbers a translation you (or Claude, reviewed
 * by you) already touched by hand. Pass --force to regenerate everything.
 *
 * Requires the ANTHROPIC_API_KEY environment variable. Model can be
 * overridden with the CLAUDE_MODEL environment variable.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

import { readJson } from "./lib/util.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONTENT_DIR = path.join(ROOT, "content");

const FORCE = process.argv.includes("--force");
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error("[translate] ERROR: ANTHROPIC_API_KEY is not set.");
  process.exit(1);
}

const config = readJson(path.join(CONTENT_DIR, "config.json"));
const targetLangs = config.languages.map((l) => l.code).filter((c) => c !== "it");
const validCategoryIds = new Set(config.categories.map((c) => c.id));

const REGISTER_NOTES = {
  en: "Medium register: write the way a competent Italian engineer who reads and writes technical English well — but is not a native speaker — would write. Clear, plain sentences. Not overly colloquial, not academic or full of idioms.",
  es: "Natural and correct Spanish, technical but readable, standard professional register (Spain/neutral Latin American mix is fine, avoid strong regionalisms).",
  fr: "Natural and correct French, technical but readable, standard professional register.",
  de: "Natural and correct German, technical but readable, standard professional register.",
};

const LANG_NAMES = { en: "English", es: "Spanish", fr: "French", de: "German" };

function buildPrompt(lang, rawMarkdown) {
  return `You are translating a technical engineering blog article from Italian into ${LANG_NAMES[lang]} for the site "Kinetic Code" (a mechatronics engineer's technical journal — narrative, reasoning-out-loud tone, but technically precise).

Register for this language: ${REGISTER_NOTES[lang]}

Rules:
1. Output ONLY the complete translated file: YAML frontmatter between "---" lines, followed by the translated Markdown body. No commentary, no explanation, no wrapping code fences around the whole output.
2. Keep the frontmatter keys and structure identical.
3. Translate "title" and "description" naturally into ${LANG_NAMES[lang]}.
4. Keep "date" EXACTLY unchanged.
5. Keep "category" EXACTLY unchanged — it is an internal id, not display text, never translate it.
6. Translate each entry in "tags" into ${LANG_NAMES[lang]} EXCEPT proper nouns, protocol/product names and acronyms (e.g. PLC, Modbus, TCP/IP, C++, Qt, SPI, CAN) which stay as-is.
7. Translate the full body preserving Markdown structure (headings, paragraphs, lists, blockquotes, tables). Keep code block contents unchanged except translating comments that are in Italian. Keep inline code/identifiers unchanged.
8. Preserve the narrative, "explained out loud" storytelling tone — this is not a dry literal translation, adapt naturally while staying faithful to meaning and technical accuracy.

Here is the Italian source file:

${rawMarkdown}`;
}

async function translate(lang, rawMarkdown) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      messages: [{ role: "user", content: buildPrompt(lang, rawMarkdown) }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 500)}`);
  }

  const json = await res.json();
  let text = json.content.map((block) => block.text || "").join("").trim();

  // Defensive: strip an accidental wrapping ```markdown ... ``` fence.
  text = text.replace(/^```[a-z]*\n/i, "").replace(/\n```$/, "");
  return text;
}

function validateTranslatedFile(lang, slug, text) {
  const parsed = matter(text);
  const required = ["title", "description", "date", "category"];
  for (const field of required) {
    if (!parsed.data[field]) {
      throw new Error(`Translated file for "${slug}" (${lang}) is missing frontmatter field "${field}".`);
    }
  }
  if (!validCategoryIds.has(parsed.data.category)) {
    throw new Error(
      `Translated file for "${slug}" (${lang}) has category "${parsed.data.category}", which is not a valid category id — the model may have translated it by mistake.`
    );
  }
}

async function main() {
  const itDir = path.join(CONTENT_DIR, "articles", "it");
  const files = fs.readdirSync(itDir).filter((f) => f.endsWith(".md"));

  let written = 0;
  let skipped = 0;

  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const sourcePath = path.join(itDir, file);
    const rawMarkdown = fs.readFileSync(sourcePath, "utf-8");

    for (const lang of targetLangs) {
      const destPath = path.join(CONTENT_DIR, "articles", lang, file);
      if (fs.existsSync(destPath) && !FORCE) {
        skipped++;
        continue;
      }

      console.log(`[translate] ${slug} -> ${lang} ...`);
      try {
        const translated = await translate(lang, rawMarkdown);
        validateTranslatedFile(lang, slug, translated);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, translated, "utf-8");
        written++;
        console.log(`[translate] ${slug} -> ${lang}: written to ${path.relative(ROOT, destPath)}`);
      } catch (err) {
        console.error(`[translate] FAILED ${slug} -> ${lang}: ${err.message}`);
        process.exitCode = 1;
      }
    }
  }

  console.log(`[translate] Done. ${written} file(s) written, ${skipped} already existed and were skipped.`);
  if (written === 0 && process.exitCode !== 1) {
    console.log("[translate] Nothing new to translate.");
  }
}

main();
