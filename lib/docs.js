"use strict";

const fs = require("fs");
const path = require("path");
const { Doc } = require("./crdt");
const { toMarkdown } = require("./markdown");

function docsDir(dataDir) {
  return path.join(dataDir, "docs");
}

function docFile(dataDir, slug, lang) {
  return path.join(docsDir(dataDir), slug + "." + lang + ".json");
}

function load(dataDir, slug, lang, fallback) {
  const file = docFile(dataDir, slug, lang);
  if (fs.existsSync(file)) {
    return Doc.load(JSON.parse(fs.readFileSync(file, "utf8")), "s");
  }
  const doc = new Doc("s");
  const seed = toMarkdown(fallback || "");
  if (seed) doc.setText(seed);
  return doc;
}

function save(dataDir, slug, lang, doc) {
  fs.mkdirSync(docsDir(dataDir), { recursive: true });
  const deleted = doc.items.filter((it) => it.deleted).length;
  if (deleted > 3 || doc.items.length > 20) doc.compact();
  const file = docFile(dataDir, slug, lang);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(doc.snapshot()) + "\n");
  fs.renameSync(tmp, file);
}

function remove(dataDir, slug) {
  for (const lang of ["pt", "en"]) {
    const file = docFile(dataDir, slug, lang);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

function payload(doc) {
  const markdown = doc.text();
  return {
    markdown,
    clock: doc.clock,
    compactClock: doc.compactClock,
    items: doc.live().length,
    bytes: Buffer.byteLength(JSON.stringify(doc.snapshot()), "utf8"),
  };
}

module.exports = { load, save, remove, payload, docFile };
