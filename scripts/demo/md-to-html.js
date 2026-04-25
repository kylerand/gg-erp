#!/usr/bin/env node
/**
 * Render each docs/operations/*.md to a self-contained HTML file under the
 * same directory. Uses `marked` for parsing; styling mirrors docs/prd.html.
 *
 * Usage: node md-to-html.js
 */

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const DOCS = [
  { md: 'README.md', html: 'index.html', title: 'Golfin Garage — Operator Manuals' },
  { md: 'erp-manual.md', html: 'erp-manual.html', title: 'ERP Operator Manual — Golfin Garage' },
  { md: 'floor-tech-manual.md', html: 'floor-tech-manual.html', title: 'Floor Tech App Operator Manual — Golfin Garage' },
  { md: 'training-manual.md', html: 'training-manual.html', title: 'Training Manual — Golfin Garage' },
];

const DIR = path.resolve(__dirname, '..', '..', 'docs', 'operations');

const styles = `
<style>
  :root {
    --bg: #ffffff;
    --fg: #211F1E;
    --accent: #E37125;
    --accent-light: #FEE9DC;
    --border: #E5DCCF;
    --muted: #6B625B;
    --surface: #FAF7F2;
    --green: #16a34a;
    --green-bg: #dcfce7;
    --amber: #d97706;
    --amber-bg: #fef3c7;
    --red: #dc2626;
    --red-bg: #fee2e2;
    --code-bg: #F3EEE5;
    --radius: 8px;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: var(--fg);
    background: var(--bg);
    line-height: 1.6;
    font-size: 15px;
  }
  .container { max-width: 960px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
  nav.topbar {
    position: sticky; top: 0; z-index: 10;
    background: var(--bg); border-bottom: 1px solid var(--border);
    padding: 0.75rem 1.5rem;
    display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;
    font-size: 0.875rem;
  }
  nav.topbar .brand { font-weight: 700; color: var(--accent); margin-right: auto; }
  nav.topbar a { color: var(--muted); text-decoration: none; padding: 0.25rem 0.5rem; border-radius: 4px; }
  nav.topbar a:hover { background: var(--surface); color: var(--fg); }
  nav.topbar a.current { color: var(--accent); background: var(--accent-light); font-weight: 600; }

  h1, h2, h3, h4 { color: var(--fg); font-weight: 700; line-height: 1.25; }
  h1 { font-size: 2rem; margin: 0.5rem 0 1rem; border-bottom: 3px solid var(--accent); padding-bottom: 0.75rem; }
  h2 { font-size: 1.4rem; margin: 2.25rem 0 0.75rem; padding-top: 0.5rem; border-top: 1px solid var(--border); }
  h2:first-of-type { border-top: none; padding-top: 0; margin-top: 1.5rem; }
  h3 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
  h4 { font-size: 0.975rem; margin: 1rem 0 0.4rem; }
  p { margin: 0.75rem 0; }
  ul, ol { margin: 0.75rem 0 0.75rem 1.5rem; }
  li { margin: 0.35rem 0; }
  li > ul, li > ol { margin-top: 0.35rem; }
  a { color: var(--accent); }
  a:hover { text-decoration-thickness: 2px; }
  code {
    background: var(--code-bg); color: var(--fg);
    padding: 0.125rem 0.375rem; border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', monospace;
    font-size: 0.9em;
  }
  pre {
    background: var(--code-bg); padding: 0.75rem 1rem;
    border-radius: var(--radius); border: 1px solid var(--border);
    overflow-x: auto; margin: 1rem 0; font-size: 0.875rem;
  }
  pre code { background: transparent; padding: 0; }
  blockquote {
    border-left: 4px solid var(--accent); background: var(--accent-light);
    padding: 0.75rem 1rem; margin: 1rem 0; border-radius: 0 var(--radius) var(--radius) 0;
    color: var(--fg);
  }
  blockquote p:first-child { margin-top: 0; }
  blockquote p:last-child { margin-bottom: 0; }
  table {
    border-collapse: collapse; width: 100%; margin: 1rem 0;
    font-size: 0.9rem;
  }
  th, td {
    border: 1px solid var(--border); padding: 0.5rem 0.75rem;
    text-align: left; vertical-align: top;
  }
  th { background: var(--surface); font-weight: 600; }
  tr:nth-child(even) td { background: #FDFBF7; }
  img { max-width: 100%; height: auto; border-radius: var(--radius); border: 1px solid var(--border); }
  figure.screenshot-placeholder {
    margin: 1.25rem 0; padding: 1.5rem; text-align: center;
    border: 2px dashed var(--border); border-radius: var(--radius);
    background: var(--surface); color: var(--muted);
  }
  figure.screenshot-placeholder .screenshot-placeholder__icon {
    font-size: 2rem; opacity: 0.55; margin-bottom: 0.5rem;
  }
  figure.screenshot-placeholder figcaption { font-size: 0.875rem; }
  figure.screenshot-placeholder em { color: var(--fg); font-style: normal; font-weight: 500; }
  hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }

  /* Role-badge inline callouts like [admin only], [shop_manager] */
  p code:only-child { display: inline; }

  @media print {
    nav.topbar { display: none; }
    .container { padding: 0; }
    a { color: var(--fg); text-decoration: underline; }
  }
</style>`;

function navBar(current) {
  const items = [
    { href: 'index.html', label: 'Index' },
    { href: 'erp-manual.html', label: 'ERP' },
    { href: 'floor-tech-manual.html', label: 'Floor Tech' },
    { href: 'training-manual.html', label: 'Training' },
  ];
  return `<nav class="topbar">
    <span class="brand">Golfin Garage — Operators</span>
    ${items
      .map((i) => `<a href="${i.href}" class="${i.href === current ? 'current' : ''}">${i.label}</a>`)
      .join('')}
  </nav>`;
}

// Rewrite .md links to .html so internal navigation works in the rendered set.
function rewriteMdLinks(mdText) {
  return mdText
    .replace(/\(\.\/([A-Za-z0-9._-]+)\.md\)/g, (m, name) => {
      if (name === 'README') return '(./index.html)';
      return `(./${name}.html)`;
    });
}

const renderer = new marked.Renderer();

// Render `![placeholder: ...](path)` as a styled placeholder card, NOT a
// broken image. Any image whose alt text starts with "placeholder:" means
// the screenshot is TBD — we don't want a broken-image icon in the doc.
renderer.image = ({ href, title, text }) => {
  const alt = text ?? '';
  if (/^\s*placeholder:/i.test(alt)) {
    const label = alt.replace(/^\s*placeholder:\s*/i, '');
    return `<figure class="screenshot-placeholder">
      <div class="screenshot-placeholder__icon">📷</div>
      <figcaption>Screenshot pending — <em>${label}</em></figcaption>
    </figure>`;
  }
  const t = title ? ` title="${title}"` : '';
  return `<img src="${href}" alt="${alt}"${t} />`;
};

marked.use({ renderer, gfm: true, breaks: false });

function render(md, title, current) {
  const body = marked.parse(rewriteMdLinks(md));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  ${styles}
</head>
<body>
  ${navBar(current)}
  <div class="container">
    ${body}
  </div>
</body>
</html>
`;
}

for (const d of DOCS) {
  const mdPath = path.join(DIR, d.md);
  if (!fs.existsSync(mdPath)) {
    console.warn(`skip: ${d.md} not found`);
    continue;
  }
  const md = fs.readFileSync(mdPath, 'utf8');
  const html = render(md, d.title, d.html);
  const outPath = path.join(DIR, d.html);
  fs.writeFileSync(outPath, html);
  console.log(`wrote ${path.relative(process.cwd(), outPath)} (${Math.round(html.length / 1024)} KB)`);
}
