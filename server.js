// Servidor do site: estático + blog renderizado de posts.json + CMS de admin.
// Sem dependências — Node puro.
//
// ADMIN_PASSWORD — senha do /admin. Sem ela, o login fica desligado.
// DATA_DIR — pasta persistente (ex.: volume). Sem ela, grava em ./data.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { markdownToHtml, toMarkdown } = require("./lib/markdown");
const docs = require("./lib/docs");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const SEED_FILE = path.join(ROOT, "data", "posts.json");
const DATA_FILE = path.join(DATA_DIR, "posts.json");
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY = 2 * 1024 * 1024;
const LANGS = new Set(["pt", "en"]);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;

const sessions = new Map(); // token -> expires (ms)
const attempts = new Map(); // ip -> { count, resetAt }

let writeChain = Promise.resolve();

function withStore(fn) {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function bearerPassword(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return String(req.headers["x-admin-password"] || "").trim();
}

function isAuthed(req) {
  if (currentSession(req)) return true;
  if (!ADMIN_PASSWORD) return false;
  const token = bearerPassword(req);
  return token ? timingSafeEqualStr(token, ADMIN_PASSWORD) : false;
}

function currentSession(req) {
  const token = parseCookies(req).admin_session;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const expires = sessions.get(token);
  if (!expires || expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) return false;
  return entry.count >= 5;
}

function recordFailure(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
  } else {
    entry.count += 1;
  }
}

function clearFailures(ip) {
  attempts.delete(ip);
}

function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function cookieHeader(req, token, maxAge) {
  const proto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const secure = proto === "https";
  const value = token ? `admin_session=${token}` : "admin_session=";
  return `${value}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function ensureStore() {
  const dir = path.dirname(DATA_FILE);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(DATA_FILE)) return;
  if (SEED_FILE !== DATA_FILE && fs.existsSync(SEED_FILE)) {
    fs.copyFileSync(SEED_FILE, DATA_FILE);
    return;
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify({ posts: [] }, null, 2) + "\n");
}

function loadPosts() {
  ensureStore();
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  if (!raw || !Array.isArray(raw.posts)) throw new Error("posts.json inválido");
  return raw.posts;
}

function savePosts(posts) {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ posts }, null, 2) + "\n");
  fs.renameSync(tmp, DATA_FILE);
}

function findPost(posts, slug) {
  return posts.find((p) => p.slug === slug) || null;
}

function sortedPosts(posts) {
  return [...posts].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug),
  );
}

function publicPosts(posts) {
  return sortedPosts(posts.filter((p) => !p.draft));
}

function bodyMarkdown(post, lang) {
  const fallback = lang === "en" ? post.bodyEn : post.bodyPt;
  return docs.load(DATA_DIR, post.slug, lang, fallback).text();
}

function isPublishable(post) {
  return (
    typeof post.titlePt === "string" &&
    post.titlePt.trim() !== "" &&
    typeof post.titleEn === "string" &&
    post.titleEn.trim() !== "" &&
    bodyMarkdown(post, "pt").trim() !== "" &&
    bodyMarkdown(post, "en").trim() !== ""
  );
}

function renderBody(src) {
  return markdownToHtml(toMarkdown(src || ""));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ "Content-Type": "text/html; charset=utf-8" }, headers));
  res.end(body);
}

function sendHtml(res, status, body) {
  send(res, status, body, { "Cache-Control": "no-store" });
}

function sendJson(res, status, obj, headers) {
  send(
    res,
    status,
    JSON.stringify(obj),
    Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, headers),
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const LANG_BOOT = `(function(){try{var saved=localStorage.getItem("lang");var lang=saved==="en"||saved==="pt"?saved:null;if(!lang){var list=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];for(var i=0;i<list.length;i++){var code=String(list[i]||"").toLowerCase();if(code.indexOf("pt")===0){lang="pt";break;}if(code.indexOf("en")===0){lang="en";break;}}}document.documentElement.lang=lang==="en"?"en":"pt-BR";}catch(e){}})();`;

function headerHtml() {
  return `<header class="top">
      <p class="mark"><a class="home-link" href="/">cabral.sanz</a></p>
      <div class="top-end">
        <p class="place">Rio de Janeiro</p>
        <div class="langs" role="group" aria-label="Idioma">
          <button type="button" data-lang="pt" aria-pressed="true" aria-label="Português" title="Português">
            <svg viewBox="0 0 28 20" aria-hidden="true"><rect width="28" height="20" fill="#009b3a"/><polygon points="14,2.2 25.5,10 14,17.8 2.5,10" fill="#fedf00"/><circle cx="14" cy="10" r="3.6" fill="#002776"/></svg>
          </button>
          <button type="button" data-lang="en" aria-pressed="false" aria-label="English" title="English">
            <svg viewBox="0 0 28 20" aria-hidden="true"><rect width="28" height="20" fill="#3d7ec4"/><circle cx="14" cy="10" r="6.7" fill="#163e73"/><g fill="none" stroke="#f3eee4" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"><circle cx="14" cy="10" r="6.7"/><ellipse cx="14" cy="10" rx="2.6" ry="6.7"/><path d="M7.3 10h13.4M8.1 6.6h11.8M8.1 13.4h11.8"/></g></svg>
          </button>
        </div>
      </div>
    </header>`;
}

function layout({ title, main, mainClass, ogType, ogTitle }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="Paulo Cabral Sanz — engenheiro na Railway." />
    <meta name="theme-color" content="#11100e" />
    <meta name="color-scheme" content="dark" />
    <meta property="og:title" content="${escapeHtml(ogTitle || title)}" />
    <meta property="og:description" content="Engenheiro na Railway." />
    <meta property="og:type" content="${ogType}" />
    <meta property="og:locale" content="pt_BR" />
    <meta property="og:locale:alternate" content="en" />
    <meta name="twitter:card" content="summary" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/styles.css" />
    <script>${LANG_BOOT}</script>
  </head>
  <body>
    <div class="noise" aria-hidden="true"></div>
    <div class="rails" aria-hidden="true"></div>

    <a class="skip" href="#conteudo">
      <span class="t-pt">Pular para o conteúdo</span>
      <span class="t-en">Skip to content</span>
    </a>

    ${headerHtml()}

    <main id="conteudo" class="${mainClass || "blog-main"}">
${main}
    </main>

    <nav class="links" aria-labelledby="links-label">
      <span id="links-label" class="visually-hidden">
        <span class="t-pt">Contato</span>
        <span class="t-en">Contact</span>
      </span>
      <a href="/blog/">Blog</a>
      <a href="https://github.com/paulocsanz" rel="noreferrer">GitHub</a>
      <a href="https://www.linkedin.com/in/paulo-cabral-sanz/" rel="noreferrer">LinkedIn</a>
    </nav>
    <script src="/lang.js"></script>
  </body>
</html>`;
}

function renderBlogIndex(posts) {
  const published = publicPosts(posts);
  const list = published.length
    ? `<ul class="post-list">
${published
  .map(
    (p) => `        <li>
          <a class="post-card" href="/blog/${encodeURIComponent(p.slug)}">
            <span class="post-card-title">
              <span class="t-pt">${escapeHtml(p.titlePt)}</span>
              <span class="t-en">${escapeHtml(p.titleEn)}</span>
            </span>
            <span class="post-card-meta">
              <time datetime="${escapeHtml(p.date)}">${escapeHtml(p.date)}</time>
            </span>
          </a>
        </li>`,
  )
  .join("\n")}
      </ul>`
    : `<p class="post-empty">
        <span class="t-pt">Nenhum escrito publicado ainda.</span>
        <span class="t-en">No writing published yet.</span>
      </p>`;

  const main = `      <p class="kicker">
        <span class="t-pt">Blog</span>
        <span class="t-en">Blog</span>
      </p>
      <h1 class="blog-title">
        <span class="t-pt">Escritos</span>
        <span class="t-en">Writing</span>
      </h1>

      ${list}`;

  return layout({ title: "Blog — Paulo Cabral Sanz", main, ogType: "website" });
}

function renderPost(post) {
  const main = `      <p class="kicker">
        <a href="/blog/">
          <span class="t-pt">Blog</span>
          <span class="t-en">Blog</span>
        </a>
      </p>
      <h1 class="post-title">
        <span class="t-pt">${escapeHtml(post.titlePt)}</span>
        <span class="t-en">${escapeHtml(post.titleEn)}</span>
      </h1>
      <p class="post-meta">
        <time datetime="${escapeHtml(post.date)}">${escapeHtml(post.date)}</time>${
          post.draft
            ? `
        <span class="draft">
          <span class="t-pt">rascunho — não publicado</span>
          <span class="t-en">draft — unpublished</span>
        </span>`
            : ""
        }
      </p>

      <div class="post-body">
        <div class="t-pt">
${renderBody(bodyMarkdown(post, "pt") || post.bodyPt)}
        </div>
        <div class="t-en">
${renderBody(bodyMarkdown(post, "en") || post.bodyEn)}
        </div>
      </div>`;

  return layout({
    title: `${post.titlePt} — Paulo Cabral Sanz`,
    ogTitle: post.titlePt,
    main,
    mainClass: "post-main",
    ogType: "article",
  });
}

function renderNotFound() {
  return layout({
    title: "Não encontrado — Paulo Cabral Sanz",
    ogType: "website",
    main: `      <p class="kicker">404</p>
      <h1 class="blog-title">
        <span class="t-pt">Não encontrado</span>
        <span class="t-en">Not found</span>
      </h1>
      <p class="role">
        <span class="t-pt">Essa página não existe. Voltar ao <a class="railway" href="/">início</a> ou ao <a class="railway" href="/blog/">blog</a>.</span>
        <span class="t-en">This page does not exist. Back to the <a class="railway" href="/">home</a> or the <a class="railway" href="/blog/">blog</a>.</span>
      </p>`,
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const PRIVATE_DIRS = new Set(["data", ".git", ".railway", ".verify", "node_modules"]);
const PRIVATE_FILES = new Set([
  "server.js",
  "package.json",
  "package-lock.json",
  "railpack.json",
  ".gitignore",
  ".dockerignore",
  "Staticfile",
]);

function serveStatic(req, res, pathname) {
  let resolved = path.normalize(path.join(ROOT, pathname));
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) return sendHtml(res, 403, renderNotFound());
  const rel = path.relative(ROOT, resolved);
  if (PRIVATE_DIRS.has(rel.split(path.sep)[0]) || PRIVATE_FILES.has(path.basename(resolved))) {
    return sendHtml(res, 404, renderNotFound());
  }
  let stat = fs.statSync(resolved, { throwIfNoEntry: false });
  if (stat && stat.isDirectory()) {
    resolved = path.join(resolved, "index.html");
    stat = fs.statSync(resolved, { throwIfNoEntry: false });
  }
  if (!stat || !stat.isFile()) return sendHtml(res, 404, renderNotFound());
  const ext = path.extname(resolved);
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Content-Length": stat.size,
    "Last-Modified": stat.mtime.toUTCString(),
    "Cache-Control": ext === ".html" || ext === ".css" ? "no-cache" : "public, max-age=86400",
  });
  fs.createReadStream(resolved).pipe(res);
}

function validPost(payload, { partial, publishing }) {
  const errors = [];
  const check = (cond, msg) => {
    if (!cond) errors.push(msg);
  };
  if (!partial || payload.slug !== undefined) {
    check(typeof payload.slug === "string" && SLUG_RE.test(payload.slug), "slug inválido");
  }
  const required = ["date", "titlePt", "titleEn"];
  if (publishing) required.push("bodyPt", "bodyEn");
  for (const field of required) {
    if (!partial || payload[field] !== undefined) {
      check(typeof payload[field] === "string" && payload[field].trim() !== "", `${field} vazio`);
    }
  }
  if (!publishing && payload.bodyPt !== undefined) {
    check(typeof payload.bodyPt === "string", "bodyPt inválido");
  }
  if (!publishing && payload.bodyEn !== undefined) {
    check(typeof payload.bodyEn === "string", "bodyEn inválido");
  }
  if (!partial || payload.date !== undefined) {
    check(/^\d{4}-\d{2}-\d{2}$/.test(payload.date || ""), "date deve ser AAAA-MM-DD");
  }
  if (payload.draft !== undefined) {
    check(typeof payload.draft === "boolean", "draft deve ser boolean");
  }
  return errors;
}

function applyFields(post, payload) {
  for (const field of ["date", "titlePt", "titleEn", "bodyPt", "bodyEn"]) {
    if (payload[field] !== undefined) post[field] = payload[field];
  }
  if (typeof payload.draft === "boolean") post.draft = payload.draft;
  return post;
}

async function readJson(req) {
  return JSON.parse(await readBody(req));
}

async function handleApi(req, res, pathname) {
  const ip = req.socket.remoteAddress || "?";
  const sub = pathname.slice("/admin/api".length);

  if (req.method === "POST" && sub === "/login") {
    if (tooManyAttempts(ip)) return sendJson(res, 429, { error: "Muitas tentativas. Tente novamente em 15 minutos." });
    if (!ADMIN_PASSWORD) return sendJson(res, 503, { error: "ADMIN_PASSWORD não configurada no servidor." });
    let payload;
    try {
      payload = await readJson(req);
    } catch {
      return sendJson(res, 400, { error: "JSON inválido" });
    }
    if (!timingSafeEqualStr(payload.password || "", ADMIN_PASSWORD)) {
      recordFailure(ip);
      return sendJson(res, 401, { error: "Senha incorreta." });
    }
    clearFailures(ip);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    return sendJson(res, 200, { ok: true }, {
      "Set-Cookie": cookieHeader(req, token, SESSION_TTL_MS / 1000),
    });
  }

  if (req.method === "POST" && sub === "/logout") {
    const token = currentSession(req);
    if (token) sessions.delete(token);
    return sendJson(res, 200, { ok: true }, {
      "Set-Cookie": cookieHeader(req, "", 0),
    });
  }

  if (req.method === "GET" && sub === "/session") {
    return sendJson(res, 200, { authenticated: Boolean(currentSession(req)) });
  }

  if (req.method === "GET" && (sub === "" || sub === "/" || sub === "/llm")) {
    if (!isAuthed(req)) return sendJson(res, 401, { error: "Não autenticado." });
    return sendJson(res, 200, {
      auth: "Cookie admin_session ou Authorization: Bearer $ADMIN_PASSWORD",
      list: "GET /admin/api/posts",
      create: "POST /admin/api/posts { slug, date, titlePt, titleEn, bodyPt?, bodyEn?, draft? }",
      meta: "PUT /admin/api/posts/:slug { date?, titlePt?, titleEn?, draft? }",
      publish: "POST /admin/api/posts/:slug/publish",
      unpublish: "POST /admin/api/posts/:slug/unpublish",
      delete: "DELETE /admin/api/posts/:slug",
      doc: "GET/PUT /admin/api/posts/:slug/doc/:lang  lang=pt|en  PUT { markdown }",
      ops: "POST /admin/api/posts/:slug/doc/:lang/ops  { replica, ops }",
      patch: "POST /admin/api/posts/:slug/doc/:lang/patch  { find, replace, all? } | { markdown } | { start, end, text }",
    });
  }

  if (!isAuthed(req)) {
    if (bearerPassword(req)) recordFailure(ip);
    return sendJson(res, 401, { error: "Não autenticado." });
  }

  if (req.method === "GET" && sub === "/posts") {
    return sendJson(res, 200, { posts: sortedPosts(loadPosts()) });
  }

  let match = sub.match(/^\/posts\/([a-z0-9-]+)\/doc\/(pt|en)(?:\/(ops|patch))?$/);
  if (match) {
    const slug = match[1];
    const lang = match[2];
    const action = match[3] || "";
    return withStore(async () => {
      const posts = loadPosts();
      const post = findPost(posts, slug);
      if (!post) return sendJson(res, 404, { error: "Post não encontrado." });
      const fallback = lang === "en" ? post.bodyEn : post.bodyPt;
      const doc = docs.load(DATA_DIR, slug, lang, fallback);

      if (req.method === "GET" && !action) {
        return sendJson(res, 200, docs.payload(doc));
      }

      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch {
        return sendJson(res, 400, { error: "JSON inválido" });
      }

      if (req.method === "PUT" && !action) {
        if (typeof payload.markdown !== "string") return sendJson(res, 400, { error: "markdown ausente" });
        doc.setText(payload.markdown);
        docs.save(DATA_DIR, slug, lang, doc);
        if (lang === "pt") post.bodyPt = doc.text();
        else post.bodyEn = doc.text();
        savePosts(posts);
        return sendJson(res, 200, docs.payload(doc));
      }

      if (req.method === "POST" && action === "ops") {
        if (!Array.isArray(payload.ops)) return sendJson(res, 400, { error: "ops deve ser array" });
        doc.apply(payload.ops);
        docs.save(DATA_DIR, slug, lang, doc);
        if (lang === "pt") post.bodyPt = doc.text();
        else post.bodyEn = doc.text();
        savePosts(posts);
        return sendJson(res, 200, docs.payload(doc));
      }

      if (req.method === "POST" && action === "patch") {
        let next = doc.text();
        if (typeof payload.markdown === "string") next = payload.markdown;
        else if (typeof payload.find === "string") {
          if (!payload.find) return sendJson(res, 400, { error: "find vazio" });
          const repl = payload.replace == null ? "" : String(payload.replace);
          next = payload.all ? next.split(payload.find).join(repl) : next.replace(payload.find, repl);
          if (next === doc.text() && !payload.allowMissing) {
            return sendJson(res, 404, { error: "trecho não encontrado" });
          }
        } else if (typeof payload.start === "number" && typeof payload.end === "number") {
          next = next.slice(0, payload.start) + String(payload.text || "") + next.slice(payload.end);
        } else {
          return sendJson(res, 400, { error: "informe markdown, find/replace ou start/end/text" });
        }
        doc.setText(next);
        docs.save(DATA_DIR, slug, lang, doc);
        if (lang === "pt") post.bodyPt = doc.text();
        else post.bodyEn = doc.text();
        savePosts(posts);
        return sendJson(res, 200, docs.payload(doc));
      }

      return sendJson(res, 405, { error: "Método não permitido." });
    });
  }

  match = sub.match(/^\/posts\/([a-z0-9-]+)\/(publish|unpublish)$/);
  if (match && req.method === "POST") {
    const slug = match[1];
    const action = match[2];
    return withStore(() => {
      const posts = loadPosts();
      const post = findPost(posts, slug);
      if (!post) return sendJson(res, 404, { error: "Post não encontrado." });
      if (action === "publish") {
        if (!isPublishable(post)) {
          return sendJson(res, 400, {
            error: "Preencha título e corpo em português e inglês antes de publicar.",
          });
        }
        post.draft = false;
      } else {
        post.draft = true;
      }
      savePosts(posts);
      return sendJson(res, 200, post);
    });
  }

  match = sub.match(/^\/posts\/([a-z0-9-]+)$/);
  if (match) {
    const slug = match[1];
    return withStore(async () => {
      const posts = loadPosts();
      const post = findPost(posts, slug);

      if (req.method === "GET") {
        if (!post) return sendJson(res, 404, { error: "Post não encontrado." });
        return sendJson(res, 200, post);
      }

      if (req.method === "PUT") {
        if (!post) return sendJson(res, 404, { error: "Post não encontrado." });
        let payload;
        try {
          payload = JSON.parse(await readBody(req));
        } catch {
          return sendJson(res, 400, { error: "JSON inválido" });
        }
        const publishing = payload.draft === false || (!post.draft && payload.draft !== true);
        const errors = validPost(payload, { partial: true, publishing });
        if (errors.length) return sendJson(res, 400, { error: errors.join("; ") });
        applyFields(post, payload);
        if (!post.draft && !isPublishable(post)) {
          return sendJson(res, 400, {
            error: "Post publicado precisa de título e corpo em português e inglês.",
          });
        }
        savePosts(posts);
        return sendJson(res, 200, post);
      }

      if (req.method === "DELETE") {
        if (!post) return sendJson(res, 404, { error: "Post não encontrado." });
        docs.remove(DATA_DIR, slug);
        savePosts(posts.filter((p) => p.slug !== slug));
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 405, { error: "Método não permitido." });
    });
  }

  if (req.method === "POST" && sub === "/posts") {
    let payload;
    try {
      payload = await readJson(req);
    } catch {
      return sendJson(res, 400, { error: "JSON inválido" });
    }
    const draft = payload.draft !== false;
    const errors = validPost(payload, { partial: false, publishing: !draft });
    if (errors.length) return sendJson(res, 400, { error: errors.join("; ") });
    return withStore(() => {
      const posts = loadPosts();
      if (findPost(posts, payload.slug)) return sendJson(res, 409, { error: "Já existe um post com esse slug." });
      const post = {
        slug: payload.slug,
        date: payload.date,
        draft,
        titlePt: payload.titlePt,
        titleEn: payload.titleEn,
        bodyPt: payload.bodyPt || "",
        bodyEn: payload.bodyEn || "",
      };
      posts.push(post);
      const pt = docs.load(DATA_DIR, post.slug, "pt", post.bodyPt);
      const en = docs.load(DATA_DIR, post.slug, "en", post.bodyEn);
      if (post.bodyPt) pt.setText(toMarkdown(post.bodyPt));
      if (post.bodyEn) en.setText(toMarkdown(post.bodyEn));
      docs.save(DATA_DIR, post.slug, "pt", pt);
      docs.save(DATA_DIR, post.slug, "en", en);
      post.bodyPt = pt.text();
      post.bodyEn = en.text();
      savePosts(posts);
      return sendJson(res, 201, post);
    });
  }

  return sendJson(res, 404, { error: "Rota desconhecida." });
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch {
    return sendHtml(res, 400, renderNotFound());
  }

  Promise.resolve()
    .then(async () => {
      if (pathname.startsWith("/admin/api/")) return handleApi(req, res, pathname);
      if (pathname === "/admin" || pathname === "/admin/") {
        return serveStatic(req, res, "/admin/index.html");
      }
      if (pathname === "/blog" || pathname === "/blog/") {
        return sendHtml(res, 200, renderBlogIndex(loadPosts()));
      }
      const postMatch = pathname.match(/^\/blog\/([a-z0-9-]+)\/?$/);
      if (postMatch) {
        const post = findPost(loadPosts(), postMatch[1]);
        if (!post) return sendHtml(res, 404, renderNotFound());
        if (post.draft && !currentSession(req)) return sendHtml(res, 404, renderNotFound());
        return sendHtml(res, 200, renderPost(post));
      }
      if (pathname === "/data/posts.json" || pathname.startsWith("/data/")) {
        return sendHtml(res, 404, renderNotFound());
      }
      return serveStatic(req, res, pathname);
    })
    .catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 500, "Internal server error");
    });
});

ensureStore();

server.listen(PORT, () => {
  console.log(`cabral.sanz servindo na porta ${PORT}`);
  if (!ADMIN_PASSWORD) console.warn("AVISO: ADMIN_PASSWORD não definida — login de admin desabilitado.");
});
