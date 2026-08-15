import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Marked } from "marked";

const root = new URL("..", import.meta.url).pathname;
const contentRoot = join(root, "Linux-Terminal-Mastery-FA", "Persian");
const sourceRoot = join(root, "site");
const outputRoot = join(root, "dist");

const STOP = new Set(["and", "the", "for", "from", "with", "into", "your", "this", "that", "zero"]);
const TECH = [
  "apt", "dpkg", "debian", "ubuntu", "bash", "ssh", "scp", "sftp", "systemd", "cron",
  "nginx", "grep", "awk", "sed", "tmux", "vim", "chmod", "chown", "sudo", "kernel",
  "shell", "terminal", "linux", "network", "firewall", "backup", "security", "storage",
  "lvm", "ext4", "xfs", "grub", "journal", "process", "service", "package", "repository"
];

const escapeHtml = (value) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const slugify = (value) => value
  .toString()
  .trim()
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, "-")
  .replace(/^-+|-+$/g, "") || "section";

const shortTitle = (title) => title
  .replace(/^فصل[^:]*:\s*/, "")
  .replace(/\s+در لینوکس$/, "")
  .trim() || title;

const chapterFileName = (num) => `chapter-${num}.md`;

const GENERIC = new Set(["linux", "shell", "terminal"]);

const extractTags = (folder, subtitle, markdown) => {
  const tags = [];
  const add = (value) => {
    const tag = value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (tag.length >= 3 && !STOP.has(tag) && !tags.includes(tag)) tags.push(tag);
  };
  add(folder.replace(/^\d+-/, ""));
  const hay = `${subtitle}\n${markdown}`.toLowerCase();
  for (const term of TECH) {
    if (GENERIC.has(term) && !folder.toLowerCase().includes(term)) continue;
    const count = hay.split(term).length - 1;
    if (count >= 2) add(term);
  }
  return tags.slice(0, 6);
};

const looksLikeCommand = (text) => {
  const first = text.trim().split("\n")[0].trim();
  return /^(sudo\s+)?(\.\/|#)?[a-z][\w./+-]*(\s|$)/.test(first);
};

const isDiagram = (text, lang) => {
  if (lang === "text") return true;
  if (/[│├└┤┬┴┼┌┐┘▄▀▓░▼↓]/.test(text)) return true;
  if (lang === "bash" || lang === "sh") return false;
  if (!looksLikeCommand(text)) return true;
  const lines = text.split("\n").filter(Boolean);
  if (lines.length >= 3 && lines.some((line) => /[|▼↓]/.test(line))) return true;
  return false;
};

const termMini = (text, ctx) => {
  const lang = (ctx.lang || "bash").toUpperCase();
  const path = ctx.lab ? `${ctx.path}/lab` : ctx.path;
  return `<div class="term-mini">
          <div class="tm-head"><span class="tm-title"><b>user@linux-tutorials</b>: ${escapeHtml(path)}</span><span class="tm-lang">${escapeHtml(lang)}</span><span class="tm-wb" aria-hidden="true">─□✕</span><button class="copy" type="button">copy</button></div>
          <pre><code class="cm">${escapeHtml(text.replace(/\n$/, ""))}</code></pre>
        </div>`;
};

const note = (kind, tag, html) =>
  `<div class="note ${kind}"><span class="note-tag">${tag}</span><span>${html}</span></div>`;

const rewriteAssetPath = (markdown, base) => markdown
  .replaceAll("](../../../Assets/", `](${base}Assets/`)
  .replaceAll('src="../../../Assets/', `src="${base}Assets/`);

const wrapSections = (html) => {
  const parts = html.split(/(?=<h2\b)/);
  let out = "";
  for (const part of parts) {
    const chunk = part.trim();
    if (!chunk) continue;
    if (chunk.startsWith("<h2")) out += `<section class="block rv" dir="rtl">\n${chunk}\n</section>\n`;
    else out += `<section class="block lead rv" dir="rtl">\n${chunk}\n</section>\n`;
  }
  return out;
};

const decorateNotes = (html) => html
  .replace(/<p>نکته مهم:?<\/p>\s*<p>([\s\S]*?)<\/p>/g, (_, body) => note("warn", "[!]", `<strong>نکته مهم:</strong> ${body}`))
  .replace(/<p>به زبان ساده:?<\/p>\s*<p>([\s\S]*?)<\/p>/g, (_, body) => note("info", "[i]", `<strong>به زبان ساده:</strong> ${body}`))
  .replace(/<p>(در این کتاب[\s\S]*?)<\/p>/g, (_, body) => note("info", "[i]", body))
  .replace(/<p>(در فصل بعد[\s\S]*?)<\/p>\s*(?:<p>([\s\S]*?)<\/p>)?/g, (_, body, extra) => note("info", "[→]", extra ? `${body} ${extra}` : body));

const decorateExercises = (html) => html.replace(
  /<h3>(تمرین\s+[^<]+)<\/h3>\s*(?:<p>([\s\S]*?)<\/p>\s*)?(<div class="term-mini">\s*<div class="tm-head">[\s\S]*?<\/div>\s*<pre>[\s\S]*?<\/pre>\s*<\/div>)?/g,
  (match, heading, title, mini, offset, full) => {
    const n = (full.slice(0, offset).match(/<h3>تمرین/g) || []).length + 1;
    const label = String(n).padStart(2, "0");
    const strong = (title || heading).replace(/:$/, "");
    return `<div class="exercise"><p class="ex-title"><span class="ex-no">[${label}]</span><strong>${strong}</strong></p>${mini || ""}</div>`;
  }
);

const renderMarkdown = (markdown, ctx) => {
  const renderer = {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      if (depth <= 1) return `<h2>${text}</h2>\n`;
      return `<h3>${text}</h3>\n`;
    },
    code({ text, lang }) {
      if (isDiagram(text, lang)) {
        const singleLine = !text.includes("\n");
        return `<pre class="diagram${singleLine ? " diagram-line" : ""}">${escapeHtml(text)}</pre>\n`;
      }
      return `${termMini(text, { ...ctx, lang: lang || "bash" })}\n`;
    },
    html({ text }) {
      return text;
    },
    hr() {
      return "";
    }
  };

  const parser = new Marked({ renderer, gfm: true });
  let html = parser.parse(markdown);
  html = html.replace(/<table>/g, '<div class="tbl-wrap"><table class="tbl">').replace(/<\/table>/g, "</table></div>");
  html = decorateNotes(html);
  html = decorateExercises(html);
  return wrapSections(html);
};

const entries = (await readdir(contentRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

const chapters = [];
for (const [index, entry] of entries.entries()) {
  const markdown = await readFile(join(contentRoot, entry.name, "README.md"), "utf8");
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || entry.name;
  const subtitle = markdown.match(/^##\s+([A-Za-z][^\n]+)$/m)?.[1]?.trim() || "";
  const num = entry.name.match(/^(\d+)/)?.[1] || String(index).padStart(2, "0");
  chapters.push({
    index,
    folder: entry.name,
    slug: slugify(entry.name),
    title,
    subtitle,
    short: shortTitle(title),
    num,
    file: chapterFileName(num),
    tags: extractTags(entry.name, subtitle, markdown),
    markdown
  });
}

const template = await readFile(join(sourceRoot, "template.html"), "utf8");
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(join(sourceRoot, "styles.css"), join(outputRoot, "styles.css"));
await cp(join(sourceRoot, "app.js"), join(outputRoot, "app.js"));
await cp(join(sourceRoot, "favicon.svg"), join(outputRoot, "favicon.svg"));
await cp(join(sourceRoot, "_headers"), join(outputRoot, "_headers"));
await cp(join(root, "Assets"), join(outputRoot, "Assets"), { recursive: true });
await cp(join(root, "README.md"), join(outputRoot, "README.md"));
await mkdir(join(outputRoot, "markdown"), { recursive: true });

const treeHtml = (current, base) => chapters.map((chapter, i) => {
  const last = i === chapters.length - 1;
  const currentPage = current?.slug === chapter.slug;
  const nextPage = current && chapters[current.index + 1]?.slug === chapter.slug;
  const cls = currentPage ? ' class="cur" aria-current="page"' : "";
  const next = nextPage ? ' <span class="nx">✦ next</span>' : "";
  const href = `${base}chapters/${chapter.slug}/`;
  return `<li><a href="${href}"${cls} data-chapter="${chapter.slug}" data-tags="${chapter.tags.join(",")}"><span class="br">${last ? "└──" : "├──"}</span> ${escapeHtml(chapter.file)}${next}</a><span class="fa">${escapeHtml(chapter.short)}</span></li>`;
}).join("\n        ");

const pagerHtml = (chapter, base) => {
  const prev = chapter ? chapters[chapter.index - 1] : null;
  const next = chapter ? chapters[chapter.index + 1] : chapters[0];
  const prevLink = prev
    ? `<a class="pager-link" href="${base}chapters/${prev.slug}/"><span class="pg-label">← فصل قبلی</span><span class="pg-title">${escapeHtml(prev.title)}</span></a>`
    : `<a class="pager-link" href="${base}" aria-disabled="true" tabindex="-1"><span class="pg-label">← فصل قبلی</span><span class="pg-title">فهرست دوره</span></a>`;
  const nextLink = next
    ? `<a class="pager-link" href="${base}chapters/${next.slug}/"><span class="pg-label">فصل بعدی →</span><span class="pg-title">${escapeHtml(next.title)}</span></a>`
    : `<a class="pager-link" href="${base}" aria-disabled="true" tabindex="-1"><span class="pg-label">فصل بعدی →</span><span class="pg-title">پایان دوره</span></a>`;
  return `${prevLink}\n        ${nextLink}`;
};

const renderPage = (chapter, content, base) => {
  const file = chapter ? chapter.file : "README.md";
  const title = chapter ? chapter.title : "Linux Terminal Mastery";
  const subtitle = chapter ? chapter.subtitle : "From Zero to Linux Power User";
  const tags = (chapter ? chapter.tags : ["linux", "terminal", "bash", "cli"])
    .map((tag) => `<span class="tag" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</span>`)
    .join("");
  const path = chapter ? `~/tutorials/${chapter.folder.toLowerCase()}` : "~/tutorials";
  const replacements = {
    "{{DOC_TITLE}}": escapeHtml(title),
    "{{CHAPTER_TITLE}}": escapeHtml(title),
    "{{SUBTITLE}}": escapeHtml(subtitle),
    "{{FILEPATH}}": chapter
      ? `tutorials / linux / ${file} · utf-8`
      : "tutorials / linux / README.md · utf-8",
    "{{CHAPTER_FILE}}": file,
    "{{TAB_LABEL}}": chapter ? `chapter-${chapter.num}` : "home",
    "{{TITLEBAR_PATH}}": path,
    "{{TAGS}}": tags,
    "{{TREE}}": treeHtml(chapter, base),
    "{{PAGER}}": pagerHtml(chapter, base),
    "{{BASE}}": base,
    "{{CHAPTER_SLUG}}": chapter?.slug || "home",
    "{{FIND_PLACEHOLDER}}": `grep ${file}…`,
    "{{TYPED_CMD}}": chapter ? `cat chapters/${file}` : "ls ~/tutorials",
    "{{DOWNLOAD_URL}}": chapter ? `${base}markdown/${file}` : `${base}README.md`
  };
  let html = template;
  for (const [key, value] of Object.entries(replacements)) html = html.replaceAll(key, value);
  return html.replace("{{CONTENT}}", content);
};

for (const chapter of chapters) {
  let body = chapter.markdown
    .replace(/^#\s+.+\n+/, "")
    .replace(/^##\s+[A-Za-z][^\n]+\n+/, "");
  body = rewriteAssetPath(body, "../../");
  const content = renderMarkdown(body, { path: `~/ch-${chapter.num}`, lab: false });
  const dir = join(outputRoot, "chapters", chapter.slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(outputRoot, "markdown", chapter.file), chapter.markdown);
  await writeFile(join(dir, "index.html"), renderPage(chapter, content, "../../"));
}

const homeBody = `# فصل‌ها

این دوره ${chapters.length} فصل دارد. از مقدمه شروع کنید و فصل‌به‌فصل پیش بروید.

${chapters.map((chapter) => `- [${chapter.title}](chapters/${chapter.slug}/)`).join("\n")}
`;
const homeContent = renderMarkdown(homeBody, { path: "~/tutorials", lab: false });
await writeFile(join(outputRoot, "index.html"), renderPage(null, homeContent, ""));
await mkdir(join(outputRoot, "chat"), { recursive: true });
await writeFile(join(outputRoot, "chat", "index.html"), renderPage(null, homeContent, "../"));
await mkdir(join(outputRoot, "chat", "history"), { recursive: true });
await writeFile(join(outputRoot, "chat", "history", "index.html"), renderPage(null, homeContent, "../../"));
await writeFile(join(outputRoot, "chapters.json"), JSON.stringify({
  home: {
    slug: "home",
    tab: "home",
    file: "README.md",
    title: "Linux Terminal Mastery",
    path: "~/tutorials",
    url: "",
    download: "README.md"
  },
  chapters: chapters.map((chapter) => ({
    slug: chapter.slug,
    tab: `chapter-${chapter.num}`,
    file: chapter.file,
    title: chapter.title,
    path: `~/tutorials/${chapter.folder.toLowerCase()}`,
    url: `chapters/${chapter.slug}/`,
    download: `markdown/${chapter.file}`
  }))
}, null, 2) + "\n");

console.log(`Built ${chapters.length} chapters in ${relative(root, outputRoot)}/`);
