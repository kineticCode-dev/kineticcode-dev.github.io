import { ICONS } from "./icons.js";
import { renderDonut } from "./donut.js";
import { formatDateShort, stripHtml } from "./util.js";

const CHART_VARS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function categoryColor(config, categoryId) {
  const idx = config.categories.findIndex((c) => c.id === categoryId);
  return CHART_VARS[idx % CHART_VARS.length] || "var(--accent)";
}

export function categoryLabel(config, categoryId, lang) {
  const cat = config.categories.find((c) => c.id === categoryId);
  return cat ? cat.labels[lang] || cat.labels.en : categoryId;
}

/* -------------------------------------------------------------------------
   Analytics (Umami) — opt-in, wired from content/config.json
   ------------------------------------------------------------------------- */
function renderAnalyticsScript(config) {
  const a = config.analytics;
  if (!a || !a.scriptUrl || !a.websiteId) return "";
  return `<script async defer src="${a.scriptUrl}" data-website-id="${a.websiteId}"></script>`;
}

/* -------------------------------------------------------------------------
   PayPal "support" button — opt-in, wired from content/config.json.
   The SDK <script> (Part 1 from PayPal) is injected once per page, only on
   pages that actually render the button (via renderPaypalSdk -> extraHead).
   The button itself (Part 2: container + render call) comes from
   renderSupportBlock, used inside the post-nav on article/lesson pages.
   ------------------------------------------------------------------------- */
export function renderPaypalSdk(config) {
  const p = config.paypal;
  if (!p || !p.enabled || !p.clientId || !p.hostedButtonId) return "";
  return `<script src="https://www.paypal.com/sdk/js?client-id=${p.clientId}&components=${p.components || "hosted-buttons"}&disable-funding=${p.disableFunding || "venmo"}&currency=${p.currency || "EUR"}"></script>`;
}

export function renderSupportBlock(config, i18n) {
  const p = config.paypal;
  if (!p || !p.enabled || !p.clientId || !p.hostedButtonId) return "";
  const s = i18n.support || {};
  return `<div class="support-card">
        <div class="support-card__icon">${ICONS.coffee}</div>
        <div class="support-card__text">
          <h3>${s.title || ""}</h3>
          <p>${s.text || ""}</p>
        </div>
        <div class="support-card__paypal">
          <div id="paypal-container-${p.hostedButtonId}"></div>
          <script>
            paypal.HostedButtons({
              hostedButtonId: "${p.hostedButtonId}",
            }).render("#paypal-container-${p.hostedButtonId}");
          </script>
        </div>
      </div>`;
}

// Builds the prev/next post-nav row, optionally with a compact support card
// slotted between the two links (or standing alone when there is only one,
// or neither, of prev/next). When there is no support block to show, this
// falls back to the original two-column behavior untouched.
function buildPostNav({ prevLinkHtml, nextLinkHtml, supportHtml }) {
  if (!supportHtml) {
    return prevLinkHtml || nextLinkHtml ? `<div class="post-nav">${prevLinkHtml}${nextLinkHtml}</div>` : "";
  }
  const cols = [];
  if (prevLinkHtml) cols.push("1fr");
  cols.push("minmax(200px,300px)");
  let nextCol = null;
  if (nextLinkHtml) {
    cols.push("1fr");
    nextCol = cols.length;
  }
  const style = `--post-nav-cols:${cols.join(" ")};${nextCol ? `--post-nav-next-col:${nextCol};` : ""}`;
  return `<div class="post-nav" style="${style}">${prevLinkHtml}${supportHtml}${nextLinkHtml}</div>`;
}

/* -------------------------------------------------------------------------
   Base layout
   ------------------------------------------------------------------------- */
export function renderLayout({ lang, config, i18n, activeNav, title, description, path, translations, bodyHtml, jsonLd, extraHead }) {
  const langs = config.languages;
  const noFlashScript = `(function(){try{var t=localStorage.getItem('kc-theme');if(t){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

  const hreflangLinks = langs
    .filter((l) => translations[l.code])
    .map((l) => `<link rel="alternate" hreflang="${l.htmlLang}" href="${config.baseUrl}${translations[l.code]}">`)
    .join("\n    ");

  const canonical = `${config.baseUrl}${translations[lang]}`;

  const langMenuItems = langs
    .map((l) => {
      const url = translations[l.code];
      if (!url) {
        return `<span class="is-disabled"><span>${l.native}</span><span class="lang-switch__tag">${l.code.toUpperCase()}</span></span>`;
      }
      return `<a href="${url}"${l.code === lang ? ' aria-current="true"' : ""}><span>${l.native}</span><span class="lang-switch__tag">${l.code.toUpperCase()}</span></a>`;
    })
    .join("\n          ");

  const navItems = [
    ["home", i18n.nav.home, `/${lang}/`],
    ["articles", i18n.nav.articles, `/${lang}/articles/`],
    ["learningPaths", i18n.nav.learningPaths, `/${lang}/learning-paths/`],
    ["about", i18n.nav.about, `/${lang}/about/`],
    ["dashboard", i18n.nav.dashboard, `/${lang}/dashboard/`],
  ]
    .map(
      ([key, label, href]) =>
        `<a href="${href}"${key === activeNav ? ' aria-current="page"' : ""}>${label}</a>`
    )
    .join("\n        ");

  return `<!doctype html>
<html lang="${config.languages.find((l) => l.code === lang)?.htmlLang || lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${canonical}">
  ${hreflangLinks}
  <link rel="alternate" hreflang="x-default" href="${config.baseUrl}${translations[config.defaultLang] || translations[lang]}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${config.siteName}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${config.baseUrl}/assets/images/logo.png">
  <meta property="og:url" content="${canonical}">
  <meta name="twitter:card" content="summary">
  <link rel="icon" href="/assets/images/logo.png" type="image/png">
  <link rel="apple-touch-icon" href="/assets/images/logo.png">
  <link rel="alternate" type="application/rss+xml" title="${config.siteName} — RSS (${lang})" href="/${lang}/rss.xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/css/style.css">
  <script>${noFlashScript}</script>
  ${jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : ""}
  ${extraHead || ""}
  ${renderAnalyticsScript(config)}
</head>
<body>
  <a class="visually-hidden" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="container site-header__inner">
      <a class="brand" href="/${lang}/">
        <img src="/assets/images/logo.png" alt="${config.siteName} logo" width="32" height="32">
        <span>${config.siteName}</span>
      </a>
      <nav class="main-nav" aria-label="Main">
        ${navItems}
      </nav>
      <div class="header-tools">
        <button class="icon-btn" type="button" data-theme-toggle aria-label="Toggle color theme">
          ${ICONS.sun}${ICONS.moon}
        </button>
        <div class="lang-switch" data-lang-switch>
          <button class="lang-switch__trigger" type="button" data-lang-trigger aria-label="${i18n.langSwitcher.label}">
            ${lang.toUpperCase()} ${ICONS.chevron}
          </button>
          <div class="lang-switch__menu" role="menu">
          ${langMenuItems}
          </div>
        </div>
        <button class="icon-btn nav-toggle" type="button" data-nav-toggle aria-label="Menu">
          ${ICONS.menu}
        </button>
      </div>
    </div>
  </header>
  <main id="main">
${bodyHtml}
  </main>
  <footer class="site-footer">
    <div class="container site-footer__inner">
      <span>${config.siteName} — ${i18n.footer.rights}</span>
      <div class="footer-links">
        ${config.social?.github ? `<a href="${config.social.github}" target="_blank" rel="noopener" aria-label="${i18n.about.contactGithubLabel}">${ICONS.github}</a>` : ""}
        ${config.social?.email ? `<a href="mailto:${config.social.email}" aria-label="${i18n.about.contactEmailLabel}">${ICONS.mail}</a>` : ""}
        <a href="/${lang}/rss.xml">${ICONS.rss} ${i18n.footer.rss}</a>
        <a href="#main">${i18n.footer.backToTop}</a>
      </div>
    </div>
  </footer>
  <script src="/assets/js/theme.js" defer></script>
  <script src="/assets/js/nav.js" defer></script>
  <script src="/assets/js/view-toggle.js" defer></script>
  <script src="/assets/js/search.js" defer></script>
</body>
</html>`;
}

/* -------------------------------------------------------------------------
   Article preview card
   ------------------------------------------------------------------------- */
export function renderArticleCard(article, config, i18n, lang) {
  const color = categoryColor(config, article.category);
  const catLabel = categoryLabel(config, article.category, lang);
  return `<a class="article-card" href="/${lang}/articles/${article.slug}/" style="--card-accent:${color};--tag-color:${color}">
  <div class="article-card__media"><img src="/assets/images/logo.png" alt="" width="64" height="64" loading="lazy"></div>
  <div class="article-card__body">
    <span class="article-card__tag">${catLabel}</span>
    <h3 class="article-card__title">${article.title}</h3>
    <p class="article-card__excerpt">${article.description}</p>
    <div class="article-card__meta"><span>${article.dateDisplay}</span><span>${article.minutes} ${i18n.articles.minRead}</span></div>
  </div>
</a>`;
}

/* -------------------------------------------------------------------------
   Homepage
   ------------------------------------------------------------------------- */
export function renderHome({ lang, config, i18n, articles, stats }) {
  const h = i18n.home;

  const pillars = (h.pillars || [])
    .map((p) => {
      const color = categoryColor(config, p.category);
      const label = categoryLabel(config, p.category, lang);
      return `<a class="pillar-card" href="/${lang}/articles/#cat-${p.category}" style="--dot:${color}">
        <span class="pillar-card__dot"></span>
        <h3>${label}</h3>
        <p>${p.text}</p>
      </a>`;
    })
    .join("\n");

  const dashboardTeaser =
    stats.total > 0
      ? `<div class="dashboard-grid">
        <div class="donut-wrap">
          ${renderDonut(stats.segments, { total: stats.total, centerSubLabel: i18n.dashboard.totalArticles })}
        </div>
        <div class="stat-tiles">
          <div class="stat-tile"><div class="stat-tile__value">${stats.total}</div><div class="stat-tile__label">${i18n.dashboard.totalArticles}</div></div>
          <div class="stat-tile"><div class="stat-tile__value">${stats.categoriesActive}</div><div class="stat-tile__label">${i18n.dashboard.totalCategories}</div></div>
          <div class="stat-tile"><div class="stat-tile__value">${stats.totalWords.toLocaleString(lang)}</div><div class="stat-tile__label">${i18n.dashboard.totalWords}</div></div>
          <div class="stat-tile"><div class="stat-tile__value">${stats.avgMinutes} ${i18n.dashboard.minutes}</div><div class="stat-tile__label">${i18n.dashboard.avgReadingTime}</div></div>
        </div>
      </div>
      <div style="margin-top:22px"><a class="btn btn-ghost" href="/${lang}/dashboard/">${h.dashboardTeaserCta}</a></div>`
      : `<p class="text-muted">${i18n.articles.notYetTranslated}</p>`;

  const latest =
    articles.length > 0
      ? `<section class="section section--bordered">
      <div class="container">
        <div class="section__head">
          <div><span class="eyebrow">${i18n.nav.articles}</span><h2>${h.latestTitle}</h2></div>
          <a class="btn btn-ghost" href="/${lang}/articles/">${h.latestCta}</a>
        </div>
        <div class="card-grid">
          ${articles.slice(0, 3).map((a) => renderArticleCard(a, config, i18n, lang)).join("\n")}
        </div>
      </div>
    </section>`
      : "";

  return `
  <section class="hero">
    <div class="container hero__grid">
      <div>
        <span class="eyebrow">${h.eyebrow}</span>
        <h1>${h.title}</h1>
        <p class="hero__subtitle">${h.subtitle}</p>
        <div class="hero__body">${h.bodyHtml}</div>
        <div class="hero__actions">
          <a class="btn btn-primary" href="/${lang}/articles/">${h.ctaArticles}</a>
          <a class="btn btn-ghost" href="/${lang}/about/">${h.ctaAbout}</a>
        </div>
      </div>
      <div class="hero__mark"><img src="/assets/images/logo.png" alt="${config.siteName}" width="380" height="380"></div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="section__head">
        <div><span class="eyebrow">Kinetic Code</span><h2>${h.pillarsTitle}</h2><p class="text-muted" style="margin-top:8px">${h.pillarsSubtitle}</p></div>
      </div>
      <div class="pillars">
        ${pillars}
      </div>
    </div>
  </section>

  <section class="section section--bordered">
    <div class="container">
      <div class="section__head">
        <div><span class="eyebrow">${i18n.dashboard.eyebrow}</span><h2>${h.dashboardTeaserTitle}</h2><p class="text-muted" style="margin-top:8px">${h.dashboardTeaserSubtitle}</p></div>
      </div>
      <div class="dashboard-panel">
        ${dashboardTeaser}
      </div>
    </div>
  </section>

  ${latest}
`;
}

/* -------------------------------------------------------------------------
   About page
   ------------------------------------------------------------------------- */
export function renderAbout({ i18n, config }) {
  const a = i18n.about;
  const social = (config && config.social) || {};

  const contactLinks = [
    social.email
      ? `<a class="btn btn-primary" href="mailto:${social.email}">${ICONS.mail} ${a.contactEmailLabel}</a>`
      : "",
    social.github
      ? `<a class="btn btn-ghost" href="${social.github}" target="_blank" rel="noopener">${ICONS.github} ${a.contactGithubLabel}</a>`
      : "",
  ]
    .filter(Boolean)
    .join("\n        ");

  const contactSection =
    a.contactTitle && (social.email || social.github)
      ? `
  <section class="section section--bordered">
    <div class="container">
      <div class="contact-card">
        <h2>${a.contactTitle}</h2>
        <p>${a.contactText}</p>
        <div class="contact-actions">
        ${contactLinks}
        </div>
      </div>
    </div>
  </section>`
      : "";

  return `
  <section class="about-hero">
    <div class="container">
      <span class="eyebrow">${a.eyebrow}</span>
      <h1>${a.title}</h1>
    </div>
  </section>
  <section class="section">
    <div class="container">
      <div class="prose" style="margin-top:0">${a.bodyHtml}</div>
    </div>
  </section>
  ${contactSection}
`;
}

/* -------------------------------------------------------------------------
   Articles index — topic blocks + chronological + search
   ------------------------------------------------------------------------- */
export function renderArticlesIndex({ lang, config, i18n, articles, groupedByCategory }) {
  const t = i18n.articles;

  if (articles.length === 0) {
    return `
  <section class="section">
    <div class="container">
      <span class="eyebrow">${t.eyebrow}</span>
      <h1>${t.title}</h1>
      <p class="text-muted" style="margin-top:14px;max-width:60ch">${t.notYetTranslated}</p>
    </div>
  </section>`;
  }

  const topicBlocks = groupedByCategory
    .map(({ category, items }) => {
      const color = categoryColor(config, category);
      const label = categoryLabel(config, category, lang);
      return `<div class="topic-block" id="cat-${category}">
        <div class="topic-block__head" style="--dot:${color}">
          <span class="topic-block__dot"></span>
          <h3>${label}</h3>
          <span class="topic-block__count">${items.length}</span>
        </div>
        <div class="card-grid">
          ${items.map((a) => renderArticleCard(a, config, i18n, lang)).join("\n")}
        </div>
      </div>`;
    })
    .join("\n");

  const byYear = new Map();
  for (const a of articles) {
    const year = a.date.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(a);
  }
  const timelineHtml = [...byYear.entries()]
    .map(
      ([year, items]) => `<div class="timeline-year">${year}</div>
      ${items
        .map(
          (a) => `<div class="timeline-item">
        <span class="timeline-item__date">${formatDateShort(a.date, lang)}</span>
        <a class="timeline-item__title" href="/${lang}/articles/${a.slug}/">${a.title}</a>
        <span class="timeline-item__cat">${categoryLabel(config, a.category, lang)}</span>
      </div>`
        )
        .join("\n")}`
    )
    .join("\n");

  return `
  <section class="section">
    <div class="container">
      <span class="eyebrow">${t.eyebrow}</span>
      <h1 style="margin-top:10px">${t.title}</h1>
      <p class="text-muted" style="margin-top:12px;max-width:60ch">${t.subtitle}</p>

      <div style="margin-top:36px" data-search-root
        data-index-url="/assets/data/search-index.${lang}.json"
        data-no-results="${t.noResults}"
        data-results-found="${t.resultsFound}"
        data-min-read-label="${t.minRead}">
        <div class="search-box">
          ${ICONS.search}
          <input type="search" data-search-input placeholder="${t.searchPlaceholder}" aria-label="${t.searchLabel}">
        </div>
        <div class="search-status" data-search-status></div>
      </div>

      <div style="display:flex;justify-content:flex-end;margin-bottom:24px">
        <div class="view-toggle" data-view-toggle>
          <button type="button" data-view="topic" class="is-active">${t.browseByTopic}</button>
          <button type="button" data-view="date">${t.browseByDate}</button>
        </div>
      </div>

      <div data-browse-view="topic">
        ${topicBlocks}
      </div>
      <div data-browse-view="date" style="display:none">
        <div class="timeline">
          ${timelineHtml}
        </div>
      </div>
      <div data-view-search style="display:none">
        <div class="card-grid" data-search-results></div>
      </div>
    </div>
  </section>
`;
}

/* -------------------------------------------------------------------------
   Article page
   ------------------------------------------------------------------------- */
export function renderArticle({ lang, config, i18n, article, contentHtml, prevArticle, nextArticle }) {
  const color = categoryColor(config, article.category);
  const label = categoryLabel(config, article.category, lang);

  const prevLink = prevArticle
    ? `<a class="post-nav__link post-nav__link--prev" href="/${lang}/articles/${prevArticle.slug}/">
        <span class="post-nav__label">← ${i18n.articles.previousArticle}</span>
        <span class="post-nav__title">${prevArticle.title}</span>
      </a>`
    : "";
  const nextLink = nextArticle
    ? `<a class="post-nav__link post-nav__link--next" href="/${lang}/articles/${nextArticle.slug}/">
        <span class="post-nav__label">${i18n.articles.nextArticle} →</span>
        <span class="post-nav__title">${nextArticle.title}</span>
      </a>`
    : "";
  const supportHtml = renderSupportBlock(config, i18n);
  const postNav = buildPostNav({ prevLinkHtml: prevLink, nextLinkHtml: nextLink, supportHtml });

  return `
  <article>
    <div class="article-hero">
      <div class="container">
        <span class="eyebrow" style="--accent:${color};color:${color}">${label}</span>
        <h1>${article.title}</h1>
        <p class="article-hero__excerpt">${article.description}</p>
        <div class="article-hero__meta">
          <span>${article.dateDisplay}</span>
          <span>·</span>
          <span>${article.minutes} ${i18n.articles.minRead}</span>
        </div>
      </div>
    </div>
    <div class="container">
      <div class="prose">
        ${contentHtml}
      </div>
      ${postNav}
      <div class="article-footer">
        <a class="btn btn-ghost" href="/${lang}/articles/">${i18n.articles.backToAll}</a>
      </div>
    </div>
  </article>
`;
}

/* -------------------------------------------------------------------------
   Dashboard page
   ------------------------------------------------------------------------- */
export function renderDashboard({ lang, i18n, stats }) {
  const d = i18n.dashboard;

  if (stats.total === 0) {
    return `
  <section class="section">
    <div class="container">
      <span class="eyebrow">${d.eyebrow}</span>
      <h1>${d.title}</h1>
      <p class="text-muted" style="margin-top:14px;max-width:60ch">${i18n.articles.notYetTranslated}</p>
    </div>
  </section>`;
  }

  const legend = stats.segments
    .filter((s) => s.count > 0)
    .map(
      (s) => `<li><span class="swatch" style="background:${s.colorVar}"></span><span>${s.label}</span><span class="count">${s.count}</span></li>`
    )
    .join("\n");

  return `
  <section class="section">
    <div class="container">
      <span class="eyebrow">${d.eyebrow}</span>
      <h1 style="margin-top:10px">${d.title}</h1>
      <p class="text-muted" style="margin-top:12px;max-width:60ch">${d.subtitle}</p>

      <div class="dashboard-panel" style="margin-top:36px">
        <div class="dashboard-grid">
          <div class="donut-wrap">
            ${renderDonut(stats.segments, { total: stats.total, centerSubLabel: d.totalArticles })}
            <ul class="donut-legend">${legend}</ul>
          </div>
          <div class="stat-tiles">
            <div class="stat-tile"><div class="stat-tile__value">${stats.total}</div><div class="stat-tile__label">${d.totalArticles}</div></div>
            <div class="stat-tile"><div class="stat-tile__value">${stats.categoriesActive}</div><div class="stat-tile__label">${d.totalCategories}</div></div>
            <div class="stat-tile"><div class="stat-tile__value">${stats.totalWords.toLocaleString(lang)}</div><div class="stat-tile__label">${d.totalWords}</div></div>
            <div class="stat-tile"><div class="stat-tile__value">${stats.avgMinutes} ${d.minutes}</div><div class="stat-tile__label">${d.avgReadingTime}</div></div>
          </div>
        </div>
      </div>
    </div>
  </section>
`;
}

/* -------------------------------------------------------------------------
   Learning Paths — course preview card
   ------------------------------------------------------------------------- */
export function renderCourseCard(course, i18n, lang) {
  const t = i18n.learningPaths;
  const lessonCount = course.modules.reduce((n, m) => n + m.lessons.length, 0);
  return `<a class="course-card" href="/${lang}/learning-paths/${course.slug}/">
  <div class="course-card__media">${ICONS.course}</div>
  <div class="course-card__body">
    <span class="course-card__badge">${t.badgeLabel}</span>
    <h3 class="course-card__title">${course.title}</h3>
    <p class="course-card__excerpt">${stripHtml(course.introHtml)}</p>
    <div class="course-card__meta"><span>${course.durationLabel || ""}</span><span>${lessonCount} ${t.lessonsCount}</span></div>
  </div>
</a>`;
}

/* -------------------------------------------------------------------------
   Learning Paths — index page (cards + search)
   ------------------------------------------------------------------------- */
export function renderLearningPathsIndex({ lang, i18n, courses }) {
  const t = i18n.learningPaths;

  if (courses.length === 0) {
    return `
  <section class="section">
    <div class="container">
      <span class="eyebrow">${t.eyebrow}</span>
      <h1>${t.title}</h1>
      <p class="text-muted" style="margin-top:14px;max-width:60ch">${t.notYetTranslated}</p>
    </div>
  </section>`;
  }

  const cards = courses.map((c) => renderCourseCard(c, i18n, lang)).join("\n");

  return `
  <section class="section">
    <div class="container">
      <span class="eyebrow">${t.eyebrow}</span>
      <h1 style="margin-top:10px">${t.title}</h1>
      <p class="text-muted" style="margin-top:12px;max-width:64ch">${t.subtitle}</p>

      <div style="margin-top:36px" data-search-root
        data-index-url="/assets/data/search-index-learningpaths.${lang}.json"
        data-no-results="${t.noResults}"
        data-results-found="${t.resultsFound}">
        <div class="search-box">
          ${ICONS.search}
          <input type="search" data-search-input placeholder="${t.searchPlaceholder}" aria-label="${t.searchLabel}">
        </div>
        <div class="search-status" data-search-status></div>
      </div>

      <div class="card-grid" style="margin-top:28px" data-browse-view="courses">
        ${cards}
      </div>
      <div data-view-search style="display:none">
        <div class="card-grid" data-search-results></div>
      </div>
    </div>
  </section>
`;
}

/* -------------------------------------------------------------------------
   Learning Paths — course landing page
   ------------------------------------------------------------------------- */
export function renderCourseLanding({ lang, i18n, course }) {
  const t = i18n.learningPaths;
  const totalLessons = course.flatLessons.length;
  const firstLesson = course.flatLessons[0];

  const modulesHtml = course.modules
    .map((mod) => {
      const rows = mod.lessons
        .map((lesson) => {
          const isProject = lesson.type === "project";
          const typeLabel = isProject ? t.lessonTypeProject : t.lessonTypeTheory;
          const typeClass = isProject ? "lesson-row__type--project" : "lesson-row__type--theory";
          return `<a class="lesson-row" href="/${lang}/learning-paths/${course.slug}/${lesson.slug}/">
        <span class="lesson-row__index">${String(lesson.overallIndex).padStart(2, "0")}</span>
        <span class="lesson-row__title">${lesson.title}</span>
        <span class="lesson-row__type ${typeClass}">${typeLabel}</span>
      </a>`;
        })
        .join("\n");
      return `<div class="course-module">
      <h3 class="course-module__title">${mod.title}</h3>
      <div class="course-module__list">${rows}</div>
    </div>`;
    })
    .join("\n");

  return `
  <section class="article-hero">
    <div class="container">
      <span class="eyebrow">${course.eyebrow || t.eyebrow}</span>
      <h1>${course.title}</h1>
      <div class="course-hero__meta">
        ${course.level ? `<span>${course.level}</span>` : ""}
        ${course.durationLabel ? `<span>${course.durationLabel}</span>` : ""}
        <span>${totalLessons} ${t.lessonsCount}</span>
      </div>
    </div>
  </section>
  <div class="container">
    <div class="prose" style="margin-top:36px">${course.introHtml}</div>
    ${firstLesson ? `<div style="margin-top:26px"><a class="btn btn-primary" href="/${lang}/learning-paths/${course.slug}/${firstLesson.slug}/">${t.startCourse}</a></div>` : ""}
    <h2 style="margin-top:52px">${t.modulesTitle}</h2>
    <div class="course-modules">
      ${modulesHtml}
    </div>
    <div class="article-footer">
      <a class="btn btn-ghost" href="/${lang}/learning-paths/">${t.backToLearningPaths}</a>
    </div>
  </div>
`;
}

/* -------------------------------------------------------------------------
   Learning Paths — lesson page (theory or project)
   ------------------------------------------------------------------------- */
export function renderLessonPage({ lang, config, i18n, course, module, lesson, contentHtml, prevLesson, nextLesson }) {
  const t = i18n.learningPaths;
  const isProject = lesson.type === "project";
  const typeLabel = isProject ? t.lessonTypeProject : t.lessonTypeTheory;

  const prevLink = prevLesson
    ? `<a class="post-nav__link post-nav__link--prev" href="/${lang}/learning-paths/${course.slug}/${prevLesson.slug}/">
        <span class="post-nav__label">← ${t.previousLesson}</span>
        <span class="post-nav__title">${prevLesson.title}</span>
      </a>`
    : "";
  const nextLink = nextLesson
    ? `<a class="post-nav__link post-nav__link--next" href="/${lang}/learning-paths/${course.slug}/${nextLesson.slug}/">
        <span class="post-nav__label">${t.nextLesson} →</span>
        <span class="post-nav__title">${nextLesson.title}</span>
      </a>`
    : "";
  const supportHtml = renderSupportBlock(config, i18n);
  const postNav = buildPostNav({ prevLinkHtml: prevLink, nextLinkHtml: nextLink, supportHtml });

  return `
  <article>
    <div class="article-hero">
      <div class="container">
        <div class="lesson-breadcrumb">
          <a href="/${lang}/learning-paths/${course.slug}/">${course.title}</a> · ${module.title}
        </div>
        <span class="eyebrow">${typeLabel} · ${t.lessonOf} ${lesson.overallIndex} ${t.of} ${course.flatLessons.length}</span>
        <h1>${lesson.title}</h1>
        <p class="article-hero__excerpt">${lesson.description}</p>
        <div class="article-hero__meta"><span>${lesson.minutes} ${i18n.articles.minRead}</span></div>
      </div>
    </div>
    <div class="container">
      <div class="prose">
        ${contentHtml}
      </div>
      ${postNav}
      <div class="article-footer">
        <a class="btn btn-ghost" href="/${lang}/learning-paths/${course.slug}/">${t.backToCourse}</a>
      </div>
    </div>
  </article>
`;
}

/* -------------------------------------------------------------------------
   Root redirect page (/index.html)
   ------------------------------------------------------------------------- */
export function renderRootRedirect({ config }) {
  const def = config.defaultLang;
  return `<!doctype html>
<html lang="${def}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0; url=/${def}/">
  <link rel="canonical" href="${config.baseUrl}/${def}/">
  <script>
    (function () {
      try {
        var stored = localStorage.getItem("kc-lang");
        var supported = ${JSON.stringify(config.languages.map((l) => l.code))};
        var nav = (navigator.language || "${def}").slice(0, 2).toLowerCase();
        var target = stored && supported.indexOf(stored) !== -1 ? stored : (supported.indexOf(nav) !== -1 ? nav : "${def}");
        location.replace("/" + target + "/");
      } catch (e) {
        location.replace("/${def}/");
      }
    })();
  </script>
  <title>${config.siteName}</title>
</head>
<body>
  <p>Redirecting to <a href="/${def}/">${config.baseUrl}/${def}/</a>...</p>
</body>
</html>`;
}
