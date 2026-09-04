// Markdown (GFM enxuto) ↔ HTML. Sem dependências.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CabralMarkdown = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function unescapeHtml(s) {
    return String(s)
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&rsquo;/g, "\u2019")
      .replace(/&lsquo;/g, "\u2018")
      .replace(/&rdquo;/g, "\u201d")
      .replace(/&ldquo;/g, "\u201c")
      .replace(/&mdash;/g, "\u2014")
      .replace(/&ndash;/g, "\u2013")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  function inline(src) {
    var out = "";
    var i = 0;
    src = String(src);
    while (i < src.length) {
      if (src[i] === "`") {
        var end = src.indexOf("`", i + 1);
        if (end > i) {
          out += "<code>" + escapeHtml(src.slice(i + 1, end)) + "</code>";
          i = end + 1;
          continue;
        }
      }
      if (src.slice(i, i + 2) === "**") {
        var endB = src.indexOf("**", i + 2);
        if (endB > i) {
          out += "<strong>" + inline(src.slice(i + 2, endB)) + "</strong>";
          i = endB + 2;
          continue;
        }
      }
      if (src.slice(i, i + 2) === "~~") {
        var endS = src.indexOf("~~", i + 2);
        if (endS > i) {
          out += "<del>" + inline(src.slice(i + 2, endS)) + "</del>";
          i = endS + 2;
          continue;
        }
      }
      if (src[i] === "*" || src[i] === "_") {
        var m = src[i];
        var endI = src.indexOf(m, i + 1);
        if (endI > i) {
          out += "<em>" + inline(src.slice(i + 1, endI)) + "</em>";
          i = endI + 1;
          continue;
        }
      }
      if (src[i] === "[") {
        var rb = src.indexOf("](", i);
        var rp = rb >= 0 ? src.indexOf(")", rb + 2) : -1;
        if (rb > i && rp > rb) {
          var label = src.slice(i + 1, rb);
          var href = src.slice(rb + 2, rp);
          out +=
            '<a href="' +
            escapeHtml(href) +
            '">' +
            inline(label) +
            "</a>";
          i = rp + 1;
          continue;
        }
      }
      if (src.slice(i, i + 8) === "https://" || src.slice(i, i + 7) === "http://") {
        var j = i;
        while (j < src.length && !/\s/.test(src[j]) && src[j] !== "<") j++;
        var url = src.slice(i, j).replace(/[),.;]+$/, "");
        out += '<a href="' + escapeHtml(url) + '">' + escapeHtml(url) + "</a>";
        i += url.length;
        continue;
      }
      var next = src.indexOf("*", i + 1);
      var next2 = src.indexOf("`", i + 1);
      var next3 = src.indexOf("[", i + 1);
      var next4 = src.indexOf("~", i + 1);
      var cut = src.length;
      [next, next2, next3, next4, src.indexOf("_", i + 1), src.indexOf("http", i + 1)].forEach(function (n) {
        if (n >= 0 && n < cut) cut = n;
      });
      if (cut === i) cut = i + 1;
      out += escapeHtml(src.slice(i, cut));
      i = cut;
    }
    return out;
  }

  function markdownToHtml(md) {
    md = String(md || "").replace(/\r\n/g, "\n");
    if (!md.trim()) return "";
    if (/^\s*</.test(md) && /<\/[a-z]+>/i.test(md)) return md;
    var lines = md.split("\n");
    var html = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (/^```/.test(line)) {
        var lang = line.replace(/^```/, "").trim();
        var buf = [];
        i += 1;
        while (i < lines.length && !/^```/.test(lines[i])) {
          buf.push(lines[i]);
          i += 1;
        }
        html.push(
          "<pre><code" +
            (lang ? ' class="language-' + escapeHtml(lang) + '"' : "") +
            ">" +
            escapeHtml(buf.join("\n")) +
            "</code></pre>",
        );
        i += 1;
        continue;
      }
      if (/^---\s*$/.test(line) || /^\*\*\*\s*$/.test(line)) {
        html.push("<hr />");
        i += 1;
        continue;
      }
      var h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        var n = h[1].length;
        html.push("<h" + n + ">" + inline(h[2]) + "</h" + n + ">");
        i += 1;
        continue;
      }
      if (/^>\s?/.test(line)) {
        var q = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          q.push(lines[i].replace(/^>\s?/, ""));
          i += 1;
        }
        html.push("<blockquote>" + inline(q.join(" ")) + "</blockquote>");
        continue;
      }
      if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
        var ordered = /^\s*\d+\.\s+/.test(line);
        var tag = ordered ? "ol" : "ul";
        html.push("<" + tag + ">");
        while (
          i < lines.length &&
          (ordered ? /^\s*\d+\.\s+/.test(lines[i]) : /^\s*[-*+]\s+/.test(lines[i]))
        ) {
          var item = lines[i].replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/, "");
          var task = /^\[([ xX])\]\s+(.*)$/.exec(item);
          if (task) {
            html.push(
              "<li><input type=\"checkbox\" disabled" +
                (task[1] !== " " ? " checked" : "") +
                " /> " +
                inline(task[2]) +
                "</li>",
            );
          } else html.push("<li>" + inline(item) + "</li>");
          i += 1;
        }
        html.push("</" + tag + ">");
        continue;
      }
      if (!line.trim()) {
        i += 1;
        continue;
      }
      var p = [line];
      i += 1;
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>\s|[-*+]\s|\d+\.\s|---)/.test(lines[i])) {
        p.push(lines[i]);
        i += 1;
      }
      html.push("<p>" + inline(p.join(" ")) + "</p>");
    }
    return html.join("");
  }

  function textOf(el) {
    if (!el) return "";
    if (el.nodeType === 3) return el.nodeValue || "";
    if (el.nodeType !== 1) return "";
    var tag = el.tagName.toLowerCase();
    if (tag === "br") return "\n";
    if (tag === "code" && el.parentNode && el.parentNode.tagName.toLowerCase() !== "pre") {
      return "`" + (el.textContent || "") + "`";
    }
    if (tag === "strong" || tag === "b") return "**" + inner(el) + "**";
    if (tag === "em" || tag === "i") return "*" + inner(el) + "*";
    if (tag === "del" || tag === "s") return "~~" + inner(el) + "~~";
    if (tag === "a") {
      var href = el.getAttribute("href") || "";
      return "[" + inner(el) + "](" + href + ")";
    }
    return inner(el);
  }

  function inner(el) {
    var s = "";
    for (var n = el.firstChild; n; n = n.nextSibling) s += textOf(n);
    return s;
  }

  function htmlToMarkdown(html) {
    html = String(html || "").trim();
    if (!html) return "";
    if (!/^\s*</.test(html)) return html;
    var wrap;
    if (typeof document !== "undefined") {
      wrap = document.createElement("div");
      wrap.innerHTML = html;
      return blocksToMarkdown(wrap).trim();
    }
    return htmlToMarkdownNode(html);
  }

  function blocksToMarkdown(root) {
    var parts = [];
    function walk(node) {
      if (node.nodeType !== 1) return;
      var tag = node.tagName.toLowerCase();
      if (tag === "p") parts.push(inner(node) + "\n");
      else if (/^h[1-6]$/.test(tag)) {
        var n = Number(tag[1]);
        parts.push("#".repeat(n) + " " + inner(node) + "\n");
      } else if (tag === "blockquote") parts.push("> " + inner(node).replace(/\n/g, "\n> ") + "\n");
      else if (tag === "pre") {
        var code = node.textContent || "";
        parts.push("```\n" + code.replace(/\n$/, "") + "\n```\n");
      } else if (tag === "ul" || tag === "ol") {
        var i = 1;
        for (var li = node.firstChild; li; li = li.nextSibling) {
          if (li.nodeType !== 1 || li.tagName.toLowerCase() !== "li") continue;
          var bullet = tag === "ol" ? i + ". " : "- ";
          parts.push(bullet + inner(li) + "\n");
          i += 1;
        }
        parts.push("");
      } else if (tag === "hr") parts.push("---\n");
      else if (tag === "div" || tag === "section") {
        for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
      } else parts.push(inner(node) + "\n");
    }
    for (var c = root.firstChild; c; c = c.nextSibling) walk(c);
    return parts.join("\n").replace(/\n{3,}/g, "\n\n");
  }

  function htmlToMarkdownNode(html) {
    return html
      .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, function (_, c) {
        return "\n```\n" + unescapeHtml(c) + "\n```\n";
      })
      .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, function (_, h, t) {
        return "[" + t + "](" + h + ")";
      })
      .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
      .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
      .replace(/<(del|s)[^>]*>([\s\S]*?)<\/\1>/gi, "~~$2~~")
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, function (_, t) {
        return "`" + unescapeHtml(t) + "`";
      })
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, function (_, n, t) {
        return "\n" + "#".repeat(Number(n)) + " " + strip(t) + "\n";
      })
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, function (_, t) {
        return "- " + strip(t) + "\n";
      })
      .replace(/<\/?ul[^>]*>/gi, "\n")
      .replace(/<\/?ol[^>]*>/gi, "\n")
      .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, function (_, t) {
        return "\n> " + strip(t) + "\n";
      })
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, function (_, t) {
        return "\n" + strip(t) + "\n";
      })
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<hr\s*\/?>/gi, "\n---\n")
      .replace(/<[^>]+>/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function strip(t) {
    return unescapeHtml(String(t).replace(/<[^>]+>/g, "")).trim();
  }

  function looksLikeHtml(s) {
    return /^\s*</.test(String(s || "")) && /<\/[a-z]+>/i.test(String(s || ""));
  }

  function toMarkdown(s) {
    s = String(s || "");
    return looksLikeHtml(s) ? htmlToMarkdown(s) : s;
  }

  return {
    markdownToHtml: markdownToHtml,
    htmlToMarkdown: htmlToMarkdown,
    toMarkdown: toMarkdown,
    looksLikeHtml: looksLikeHtml,
    inline: inline,
    escapeHtml: escapeHtml,
  };
});
