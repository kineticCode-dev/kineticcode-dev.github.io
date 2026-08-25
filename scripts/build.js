#!/usr/bin/env node
/**
 * Kinetic Code — static site builder.
 *
 * Reads Markdown articles from content/articles/{lang}/*.md, renders them
 * through hand-written HTML templates (no framework), and writes a plain
 * HTML/CSS/JS site into dist/. Nothing here ships to the browser except
 * the generated static files — this script only runs at build time
 * (locally, or in the GitHub Actions workflow).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import hljs from "highlight.js";

import { readJson, writeFile, copyDir, formatDate, readingTimeMinutes, wordCount, escapeHtml } from "./lib/util.js";
import {
  renderLayout,
  renderHome,
  renderAbout,
  renderArticlesIndex,
  renderArticle,
  renderDashboard,
  renderRootRedirect,
  categoryColor,
  categoryLabel,
} from "./lib/templates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONTENT_DIR = path.join(ROOT, "content");
const DIST_DIR = path.join(ROOT, "dist");

marked.setOptions({ gfm: true, breaks: false });

// Math: $...$ / $$...$$ rendered to static HTML+MathML at build time via KaTeX
// (no client-side JS needed for formulas to show up).
marked.use(markedKatex({ throwOnError: false }));

// Code blocks: syntax-highlighted at build time via highlight.js — again, no
// client-side highlighting JS shipped, just static <span> classes + our CSS.
// Images: articles reference their images with a relative "img/..." path,
// colocated with the Italian source .md files (content/articles/it/img/).
// We rewrite that reference to the shared build output location and copy
// the folder there (see copyArticleImages below) — so the same images are
// reused automatically across all translated versions of an article.
marked.use({
  renderer: {
    code(code, infostring) {
      const lang = (infostring || "").trim().split(/\s+/)[0].toLowerCase();
      let html;
      let langClass = "plaintext";
      if (lang && hljs.getLanguage(lang)) {
        html = hljs.highlight(code, { language: lang }).value;
        langClass = lang;
      } else {
        const auto = hljs.highlightAuto(code);
        html = auto.value;
        langClass = auto.language || "plaintext";
      }
      return `<pre><code class="hljs language-${langClass}">${html}</code></pre>\n`;
    },
    image(href, title, text) {
      let src = href || "";
      const isAbsoluteOrExternal = /^([a-z]+:)?\/\//i.test(src) || src.startsWith("/") || src.startsWith("data:");
      if (!isAbsoluteOrExternal) {
        const filename = src.replace(/^\.?\/?img\//, "");
        src = `/assets/images/articles/${filename}`;
      }
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(text || "")}"${titleAttr} loading="lazy">`;
    },
  },
});

function log(msg) {
  console.log(`[build] ${msg}`);
}
function fail(msg) {
  console.error(`\n[build] ERROR: ${msg}\n`);
  process.exit(1);
}

/* -------------------------------------------------------------------------
   1. Load config + i18n
   ------------------------------------------------------------------------- */
const config = readJson(path.join(CONTENT_DIR, "config.json"));
const i18nByLang = {};
for (const lang of config.languages) {
  i18nByLang[lang.code] = readJson(path.join(CONTENT_DIR, "i18n", `${lang.code}.json`));
}
const validCategoryIds = new Set(config.categories.map((c) => c.id));

/* -------------------------------------------------------------------------
   2. Read + parse articles per language
   ------------------------------------------------------------------------- */
const REQUIRED_FIELDS = ["title", "description", "date", "category"];

function loadArticlesForLang(langCode) {
  const dir = path.join(CONTENT_DIR, "articles", langCode);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  const articles = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, content } = matter(raw);
    const slug = file.replace(/\.md$/, "");

    for (const field of REQUIRED_FIELDS) {
      if (!data[field]) {
        fail(`Missing required frontmatter field "${field}" in content/articles/${langCode}/${file}`);
      }
    }
    if (!validCategoryIds.has(data.category)) {
      fail(
        `Unknown category "${data.category}" in content/articles/${langCode}/${file}. Valid categories: ${[...validCategoryIds].join(", ")}`
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) {
      fail(`Invalid date "${data.date}" in content/articles/${langCode}/${file}. Use YYYY-MM-DD.`);
    }
    if (data.draft === true) continue;

    const contentHtml = marked.parse(content);
    const words = wordCount(content);

    articles.push({
      slug,
      lang: langCode,
      title: data.title,
      description: data.description,
      category: data.category,
      tags: data.tags || [],
      date: String(data.date),
      dateDisplay: formatDate(String(data.date), langCode),
      minutes: readingTimeMinutes(content),
      words,
      contentHtml,
    });
  }

  articles.sort((a, b) => (a.date < b.date ? 1 : -1));
  return articles;
}

const articlesByLang = {};
for (const lang of config.languages) {
  articlesByLang[lang.code] = loadArticlesForLang(lang.code);
}

/* -------------------------------------------------------------------------
   3. Translation map per slug (which languages have this article)
   ------------------------------------------------------------------------- */
const slugToLangs = new Map();
for (const lang of config.languages) {
  for (const article of articlesByLang[lang.code]) {
    if (!slugToLangs.has(article.slug)) slugToLangs.set(article.slug, new Set());
    slugToLangs.get(article.slug).add(lang.code);
  }
}
function articleTranslations(slug) {
  const langsWithSlug = slugToLangs.get(slug) || new Set();
  const map = {};
  for (const lang of config.languages) {
    map[lang.code] = langsWithSlug.has(lang.code) ? `/${lang.code}/articles/${slug}/` : null;
  }
  return map;
}

/* -------------------------------------------------------------------------
   4. Stats + grouping helpers
   ------------------------------------------------------------------------- */
function computeStats(langCode, articles) {
  const counts = new Map(config.categories.map((c) => [c.id, 0]));
  let totalWords = 0;
  let totalMinutes = 0;
  for (const a of articles) {
    counts.set(a.category, (counts.get(a.category) || 0) + 1);
    totalWords += a.words;
    totalMinutes += a.minutes;
  }
  const segments = config.categories.map((c) => ({
    label: c.labels[langCode] || c.labels.en,
    count: counts.get(c.id) || 0,
    colorVar: categoryColor(config, c.id),
  }));
  return {
    total: articles.length,
    categoriesActive: [...counts.values()].filter((n) => n > 0).length,
    totalWords,
    avgMinutes: articles.length ? Math.max(1, Math.round(totalMinutes / articles.length)) : 0,
    segments,
  };
}

function groupByCategory(langCode, articles) {
  return config.categories
    .map((c) => ({
      category: c.id,
      items: articles.filter((a) => a.category === c.id),
    }))
    .filter((g) => g.items.length > 0);
}

function staticPageTranslations(pathSuffix) {
  const map = {};
  for (const lang of config.languages) map[lang.code] = `/${lang.code}${pathSuffix}`;
  return map;
}

/* -------------------------------------------------------------------------
   5. Render + write pages
   ------------------------------------------------------------------------- */
const allUrls = [];

function writePage(urlPath, html) {
  writeFile(path.join(DIST_DIR, urlPath, "index.html"), html);
  allUrls.push(urlPath === "" ? "/" : `/${urlPath}/`.replace(/\/+/g, "/"));
}

for (const lang of config.languages) {
  const code = lang.code;
  const i18n = i18nByLang[code];
  const articles = articlesByLang[code];
  const stats = computeStats(code, articles);
  const grouped = groupByCategory(code, articles);

  // Home
  writePage(
    `${code}`,
    renderLayout({
      lang: code,
      config,
      i18n,
      activeNav: "home",
      title: i18n.meta.siteTitle,
      description: i18n.meta.siteDescription,
      translations: staticPageTranslations("/"),
      bodyHtml: renderHome({ lang: code, config, i18n, articles, stats }),
    })
  );

  // About
  writePage(
    `${code}/about`,
    renderLayout({
      lang: code,
      config,
      i18n,
      activeNav: "about",
      title: `${i18n.about.title} — ${config.siteName}`,
      description: i18n.meta.siteDescription,
      translations: staticPageTranslations("/about/"),
      bodyHtml: renderAbout({ i18n, config }),
    })
  );

  // Articles index
  writePage(
    `${code}/articles`,
    renderLayout({
      lang: code,
      config,
      i18n,
      activeNav: "articles",
      title: `${i18n.articles.title} — ${config.siteName}`,
      description: i18n.articles.subtitle,
      translations: staticPageTranslations("/articles/"),
      bodyHtml: renderArticlesIndex({ lang: code, config, i18n, articles, groupedByCategory: grouped }),
    })
  );

  // Dashboard
  writePage(
    `${code}/dashboard`,
    renderLayout({
      lang: code,
      config,
      i18n,
      activeNav: "dashboard",
      title: `${i18n.dashboard.title} — ${config.siteName}`,
      description: i18n.dashboard.subtitle,
      translations: staticPageTranslations("/dashboard/"),
      bodyHtml: renderDashboard({ lang: code, i18n, stats }),
    })
  );

  // Individual articles
  // `articles` is sorted newest-first, so the array position doubles as
  // chronological order: the item before this one in the list is newer
  // ("next"), the item after it is older ("previous").
  articles.forEach((article, i) => {
    const jsonLd = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: article.title,
      description: article.description,
      datePublished: article.date,
      inLanguage: lang.htmlLang,
      author: { "@type": "Person", name: config.siteName },
    });
    const extraHead = article.contentHtml.includes('class="katex')
      ? '<link rel="stylesheet" href="/assets/vendor/katex/katex.min.css">'
      : "";
    const prevArticle = i < articles.length - 1 ? articles[i + 1] : null;
    const nextArticle = i > 0 ? articles[i - 1] : null;
    writePage(
      `${code}/articles/${article.slug}`,
      renderLayout({
        lang: code,
        config,
        i18n,
        activeNav: "articles",
        title: `${article.title} — ${config.siteName}`,
        description: article.description,
        translations: articleTranslations(article.slug),
        bodyHtml: renderArticle({ lang: code, config, i18n, article, contentHtml: article.contentHtml, prevArticle, nextArticle }),
        jsonLd,
        extraHead,
      })
    );
  });

  // Search index
  const searchIndex = articles.map((a) => ({
    title: a.title,
    excerpt: a.description,
    url: `/${code}/articles/${a.slug}/`,
    category: a.category,
    categoryLabel: categoryLabel(config, a.category, code),
    categoryColor: categoryColor(config, a.category),
    tags: a.tags,
    dateDisplay: a.dateDisplay,
    dateISO: a.date,
    minutes: a.minutes,
    logo: "/assets/images/logo.png",
  }));
  writeFile(path.join(DIST_DIR, "assets", "data", `search-index.${code}.json`), JSON.stringify(searchIndex));

  // RSS
  const rssItems = articles
    .map(
      (a) => `  <item>
    <title>${escapeXml(a.title)}</title>
    <link>${config.baseUrl}/${code}/articles/${a.slug}/</link>
    <guid>${config.baseUrl}/${code}/articles/${a.slug}/</guid>
    <pubDate>${new Date(a.date).toUTCString()}</pubDate>
    <description>${escapeXml(a.description)}</description>
  </item>`
    )
    .join("\n");
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${escapeXml(i18n.meta.siteTitle)}</title>
  <link>${config.baseUrl}/${code}/</link>
  <description>${escapeXml(i18n.meta.siteDescription)}</description>
  <language>${lang.htmlLang}</language>
${rssItems}
</channel></rss>`;
  writeFile(path.join(DIST_DIR, code, "rss.xml"), rss);

  log(`${code}: ${articles.length} article(s), ${stats.categoriesActive} active categories`);
}

function escapeXml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Root redirect
writeFile(path.join(DIST_DIR, "index.html"), renderRootRedirect({ config }));

/* -------------------------------------------------------------------------
   6. Copy static assets
   ------------------------------------------------------------------------- */
copyDir(path.join(ROOT, "assets", "css"), path.join(DIST_DIR, "assets", "css"));
copyDir(path.join(ROOT, "assets", "js"), path.join(DIST_DIR, "assets", "js"));
copyDir(path.join(ROOT, "assets", "images"), path.join(DIST_DIR, "assets", "images"));

// KaTeX runtime CSS + fonts (only used by pages whose article actually has
// math in it — but cheap enough, and simplest, to always copy the files).
const katexDist = path.join(ROOT, "node_modules", "katex", "dist");
if (fs.existsSync(katexDist)) {
  writeFile(path.join(DIST_DIR, "assets", "vendor", "katex", "katex.min.css"), fs.readFileSync(path.join(katexDist, "katex.min.css"), "utf-8"));
  copyDir(path.join(katexDist, "fonts"), path.join(DIST_DIR, "assets", "vendor", "katex", "fonts"));
}

// Article images: authors keep an "img/" folder next to their .md source
// (content/articles/<lang>/img/...) and reference it as ![alt](img/foo.png).
// We copy every language's img/ folder into one shared output location —
// "it" first (the canonical source), then the others layered on top so a
// language-specific image can override the Italian one by using the same
// filename. This means a translated article automatically reuses the
// original images without you having to duplicate any files.
const imagesOutDir = path.join(DIST_DIR, "assets", "images", "articles");
for (const lang of config.languages) {
  const imgDir = path.join(CONTENT_DIR, "articles", lang.code, "img");
  if (fs.existsSync(imgDir)) {
    copyDir(imgDir, imagesOutDir);
  }
}

/* -------------------------------------------------------------------------
   7. sitemap.xml + robots.txt + .nojekyll
   ------------------------------------------------------------------------- */
const sitemapUrls = allUrls
  .map((u) => `  <url><loc>${config.baseUrl}${u}</loc></url>`)
  .join("\n");
writeFile(
  path.join(DIST_DIR, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls}\n</urlset>`
);
writeFile(path.join(DIST_DIR, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${config.baseUrl}/sitemap.xml\n`);
writeFile(path.join(DIST_DIR, ".nojekyll"), "");

log(`Done. ${allUrls.length} pages written to dist/.`);
