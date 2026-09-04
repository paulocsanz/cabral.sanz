/* Um contenteditable só — seleção nativa, placeholder só com o doc vazio. */
(function (global) {
  "use strict";

  var SLASH = [
    { k: "texto", type: "p", label: "Texto", hint: "parágrafo" },
    { k: "titulo 1", type: "h1", label: "Título 1", hint: "# " },
    { k: "titulo 2", type: "h2", label: "Título 2", hint: "## " },
    { k: "titulo 3", type: "h3", label: "Título 3", hint: "### " },
    { k: "lista", type: "ul", label: "Lista", hint: "- " },
    { k: "numerada", type: "ol", label: "Lista numerada", hint: "1. " },
    { k: "tarefa", type: "todo", label: "Tarefa", hint: "[ ]" },
    { k: "citacao", type: "quote", label: "Citação", hint: "> " },
    { k: "codigo", type: "code", label: "Código", hint: "```" },
    { k: "divisor", type: "hr", label: "Divisor", hint: "---" },
  ];

  function placeCaret(el, atEnd) {
    if (!el) return;
    el.focus();
    var sel = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(!atEnd);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function textOf(el) {
    return String((el && el.innerText) || "")
      .replace(/\u00a0/g, " ")
      .replace(/\n$/, "");
  }

  function InkEditor(root, opts) {
    this.root = root;
    this.onChange = (opts && opts.onChange) || function () {};
    this.placeholder = (opts && opts.placeholder) || "Escreva, ou / para comandos";
    this.slash = null;
    this.slashIndex = 0;
    this.slashBlock = null;
    this.mode = "wysiwyg";
    this.source = null;
    this._building = false;
    this.renderShell();
    this.setMarkdown((opts && opts.markdown) || "");
  }

  InkEditor.prototype.renderShell = function () {
    var self = this;
    this.root.classList.add("ink-root");
    this.root.innerHTML =
      '<div class="ink-bar">' +
      '<button type="button" class="ink-bar-btn" data-act="bold" title="Negrito (⌘B)">B</button>' +
      '<button type="button" class="ink-bar-btn" data-act="italic" title="Itálico (⌘I)"><i>I</i></button>' +
      '<button type="button" class="ink-bar-btn" data-act="code" title="Código">`</button>' +
      '<button type="button" class="ink-bar-btn" data-act="link" title="Link (⌘K)">↗</button>' +
      '<span class="ink-bar-gap"></span>' +
      '<button type="button" class="ink-bar-btn" data-act="source" title="Markdown fonte">MD</button>' +
      "</div>" +
      '<div class="ink-surface" contenteditable="true" spellcheck="true"></div>' +
      '<textarea class="ink-source" hidden spellcheck="false"></textarea>' +
      '<div class="ink-slash" hidden></div>';
    this.surface = this.root.querySelector(".ink-surface");
    this.source = this.root.querySelector(".ink-source");
    this.slashEl = this.root.querySelector(".ink-slash");
    this.surface.dataset.placeholder = this.placeholder;
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch (err) {}
    this.root.querySelector(".ink-bar").addEventListener("mousedown", function (e) {
      var btn = e.target.closest("[data-act]");
      if (!btn) return;
      e.preventDefault();
      self.toolbar(btn.getAttribute("data-act"));
    });
    this.surface.addEventListener("keydown", function (e) {
      self.onKey(e);
    });
    this.surface.addEventListener("input", function () {
      self.onInput();
    });
    this.surface.addEventListener("paste", function (e) {
      self.onPaste(e);
    });
    this.source.addEventListener("input", function () {
      self.emit();
    });
  };

  InkEditor.prototype.toolbar = function (act) {
    if (act === "source") {
      this.toggleSource();
      return;
    }
    if (this.mode === "source") return;
    this.surface.focus();
    if (act === "link") {
      var url = window.prompt("URL");
      if (!url) return;
      document.execCommand("createLink", false, url);
      this.emit();
      return;
    }
    if (act === "code") {
      var t = window.getSelection().toString();
      document.execCommand("insertText", false, "`" + t + "`");
    } else if (act === "bold") document.execCommand("bold", false, null);
    else if (act === "italic") document.execCommand("italic", false, null);
    this.emit();
  };

  InkEditor.prototype.toggleSource = function () {
    if (this.mode === "wysiwyg") {
      this.source.value = this.toMarkdown();
      this.mode = "source";
      this.surface.hidden = true;
      this.source.hidden = false;
      this.source.focus();
    } else {
      this.setMarkdown(this.source.value);
      this.mode = "wysiwyg";
      this.source.hidden = true;
      this.surface.hidden = false;
    }
    this.root.classList.toggle("ink-mode-source", this.mode === "source");
  };

  InkEditor.prototype.appendEl = function (tag, text, after) {
    var el = document.createElement(tag);
    if (tag === "hr") {
      el.contentEditable = "false";
    } else if (tag === "pre") {
      el.textContent = text || "";
    } else if (text) {
      el.textContent = text;
    } else {
      el.appendChild(document.createElement("br"));
    }
    if (after && after.nextSibling) this.surface.insertBefore(el, after.nextSibling);
    else if (after) this.surface.appendChild(el);
    else this.surface.appendChild(el);
    return el;
  };

  InkEditor.prototype.setMarkdown = function (md) {
    this._building = true;
    this.surface.innerHTML = "";
    var text = String(md || "").replace(/\r\n/g, "\n");
    if (!text.trim()) {
      this.appendEl("p", "");
      this.syncEmpty();
      this._building = false;
      return;
    }
    var lines = text.split("\n");
    var i = 0;
    var ul = null;
    var ol = null;
    function closeLists() {
      ul = null;
      ol = null;
    }
    while (i < lines.length) {
      var line = lines[i];
      if (/^```/.test(line)) {
        closeLists();
        var buf = [];
        i += 1;
        while (i < lines.length && !/^```/.test(lines[i])) {
          buf.push(lines[i]);
          i += 1;
        }
        this.appendEl("pre", buf.join("\n"));
        i += 1;
        continue;
      }
      if (/^---\s*$/.test(line)) {
        closeLists();
        this.appendEl("hr", "");
        i += 1;
        continue;
      }
      var h = /^(#{1,3})\s+(.*)$/.exec(line);
      if (h) {
        closeLists();
        this.appendEl("h" + h[1].length, h[2]);
        i += 1;
        continue;
      }
      if (/^>\s?/.test(line)) {
        closeLists();
        this.appendEl("blockquote", line.replace(/^>\s?/, ""));
        i += 1;
        continue;
      }
      var todo = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
      if (todo) {
        closeLists();
        var tlist = document.createElement("ul");
        tlist.dataset.todo = "1";
        var tli = document.createElement("li");
        var ck = document.createElement("input");
        ck.type = "checkbox";
        ck.disabled = true;
        ck.checked = todo[1] !== " ";
        ck.contentEditable = "false";
        tli.appendChild(ck);
        tli.appendChild(document.createTextNode(" " + todo[2]));
        tlist.appendChild(tli);
        this.surface.appendChild(tlist);
        i += 1;
        continue;
      }
      if (/^\s*[-*+]\s+/.test(line)) {
        ol = null;
        if (!ul) {
          ul = document.createElement("ul");
          this.surface.appendChild(ul);
        }
        var li = document.createElement("li");
        li.textContent = line.replace(/^\s*[-*+]\s+/, "");
        ul.appendChild(li);
        i += 1;
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        ul = null;
        if (!ol) {
          ol = document.createElement("ol");
          this.surface.appendChild(ol);
        }
        var oli = document.createElement("li");
        oli.textContent = line.replace(/^\s*\d+\.\s+/, "");
        ol.appendChild(oli);
        i += 1;
        continue;
      }
      if (!line.trim()) {
        i += 1;
        continue;
      }
      closeLists();
      this.appendEl("p", line);
      i += 1;
    }
    if (!this.surface.firstElementChild) this.appendEl("p", "");
    this.syncEmpty();
    this._building = false;
  };

  InkEditor.prototype.toMarkdown = function () {
    if (this.mode === "source") return this.source.value;
    var parts = [];
    var kids = this.surface.children;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      var tag = el.tagName.toLowerCase();
      var t = textOf(el);
      if (tag === "h1") parts.push("# " + t, "");
      else if (tag === "h2") parts.push("## " + t, "");
      else if (tag === "h3") parts.push("### " + t, "");
      else if (tag === "blockquote") parts.push("> " + t, "");
      else if (tag === "pre") parts.push("```", t, "```", "");
      else if (tag === "hr") parts.push("---", "");
      else if (tag === "ul") {
        var items = el.querySelectorAll("li");
        for (var u = 0; u < items.length; u++) {
          var box = items[u].querySelector("input[type=checkbox]");
          var lt = textOf(items[u]).replace(/^\s+/, "");
          if (box) parts.push("- [" + (box.checked ? "x" : " ") + "] " + lt);
          else parts.push("- " + lt);
        }
      } else if (tag === "ol") {
        var oitems = el.querySelectorAll("li");
        for (var o = 0; o < oitems.length; o++) {
          parts.push(o + 1 + ". " + textOf(oitems[o]));
        }
      } else if (!t.trim()) {
        parts.push("");
      } else {
        parts.push(t, "");
      }
    }
    return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  };

  InkEditor.prototype.syncEmpty = function () {
    var t = (this.surface.innerText || "").replace(/\u00a0/g, " ").replace(/\n/g, "").trim();
    this.surface.classList.toggle("is-empty", !t);
  };

  InkEditor.prototype.normalize = function () {
    var nodes = Array.from(this.surface.childNodes);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3) {
        if (!n.textContent.trim()) {
          n.remove();
          continue;
        }
        var wrap = document.createElement("p");
        wrap.textContent = n.textContent;
        n.replaceWith(wrap);
      } else if (n.nodeType === 1 && n.tagName === "DIV") {
        var p = document.createElement("p");
        p.innerHTML = n.innerHTML || "<br>";
        n.replaceWith(p);
      }
    }
    if (!this.surface.firstElementChild) this.appendEl("p", "");
    this.syncEmpty();
  };

  InkEditor.prototype.emit = function () {
    if (this._building) return;
    this.onChange(this.toMarkdown());
  };

  InkEditor.prototype.currentBlock = function () {
    var sel = window.getSelection();
    if (!sel || !sel.anchorNode) return this.surface.firstElementChild;
    var n = sel.anchorNode;
    if (n === this.surface) return this.surface.firstElementChild;
    if (n.nodeType !== 1) n = n.parentElement;
    while (n && n.parentElement !== this.surface) n = n.parentElement;
    return n && n.parentElement === this.surface ? n : this.surface.firstElementChild;
  };

  InkEditor.prototype.convert = function (block, tag) {
    if (!block) return null;
    if (tag === "hr") {
      var hr = this.appendEl("hr", "", block);
      var next = this.appendEl("p", "", hr);
      block.remove();
      placeCaret(next, false);
      return next;
    }
    if (tag === "ul" || tag === "ol" || tag === "todo") {
      var list = document.createElement(tag === "ol" ? "ol" : "ul");
      if (tag === "todo") list.dataset.todo = "1";
      var li = document.createElement("li");
      if (tag === "todo") {
        var ck = document.createElement("input");
        ck.type = "checkbox";
        ck.disabled = true;
        ck.contentEditable = "false";
        li.appendChild(ck);
        li.appendChild(document.createTextNode(" "));
      }
      var inner = textOf(block);
      li.appendChild(document.createTextNode(inner));
      list.appendChild(li);
      block.replaceWith(list);
      placeCaret(li, true);
      return list;
    }
    if (tag === "code") tag = "pre";
    if (tag === "quote") tag = "blockquote";
    var el = document.createElement(tag);
    el.innerHTML = block.innerHTML || "<br>";
    block.replaceWith(el);
    placeCaret(el, true);
    return el;
  };

  InkEditor.prototype.onKey = function (e) {
    if (this.slash && !this.slashEl.hidden) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this.moveSlash(e.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        this.pickSlash();
        return;
      }
      if (e.key === "Escape") {
        this.hideSlash();
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      this.toolbar("bold");
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
      e.preventDefault();
      this.toolbar("italic");
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      this.toolbar("link");
    }
  };

  InkEditor.prototype.onInput = function () {
    this.normalize();
    var block = this.currentBlock();
    var raw = block ? textOf(block) : "";
    if (raw.charAt(0) === "/") this.showSlash(block, raw.slice(1));
    else this.hideSlash();
    if (!this.shortcut(block, raw)) this.emit();
  };

  InkEditor.prototype.shortcut = function (block, raw) {
    if (!block) return false;
    var map = [
      [/^#\s$/, "h1"],
      [/^##\s$/, "h2"],
      [/^###\s$/, "h3"],
      [/^[-*]\s$/, "ul"],
      [/^1\.\s$/, "ol"],
      [/^>\s$/, "quote"],
      [/^```$/, "code"],
      [/^---$/, "hr"],
    ];
    for (var i = 0; i < map.length; i++) {
      if (map[i][0].test(raw)) {
        var el = this.convert(block, map[i][1]);
        if (el && el.tagName !== "HR") {
          el.innerHTML = "<br>";
          placeCaret(el, false);
        }
        this.emit();
        return true;
      }
    }
    return false;
  };

  InkEditor.prototype.showSlash = function (block, q) {
    q = (q || "").toLowerCase();
    var items = SLASH.filter(function (s) {
      return !q || s.k.indexOf(q) >= 0 || s.label.toLowerCase().indexOf(q) >= 0;
    });
    this.slash = items;
    this.slashBlock = block;
    this.slashIndex = 0;
    if (!items.length) {
      this.hideSlash();
      return;
    }
    this.slashEl.innerHTML = items
      .map(function (s, i) {
        return (
          '<button type="button" class="ink-slash-item' +
          (i === 0 ? " is-active" : "") +
          '" data-i="' +
          i +
          '"><span>' +
          s.label +
          "</span><kbd>" +
          s.hint +
          "</kbd></button>"
        );
      })
      .join("");
    var rootBox = this.root.getBoundingClientRect();
    var blockBox = (block || this.surface).getBoundingClientRect();
    this.slashEl.style.top = Math.max(40, blockBox.bottom - rootBox.top + 6) + "px";
    this.slashEl.hidden = false;
    var self = this;
    this.slashEl.querySelectorAll(".ink-slash-item").forEach(function (btn) {
      btn.addEventListener("mousedown", function (e) {
        e.preventDefault();
        self.slashIndex = Number(btn.getAttribute("data-i"));
        self.pickSlash();
      });
    });
  };

  InkEditor.prototype.moveSlash = function (dir) {
    if (!this.slash || !this.slash.length) return;
    this.slashIndex = (this.slashIndex + dir + this.slash.length) % this.slash.length;
    var items = this.slashEl.querySelectorAll(".ink-slash-item");
    items.forEach(function (el, i) {
      el.classList.toggle("is-active", i === this.slashIndex);
    }, this);
  };

  InkEditor.prototype.pickSlash = function () {
    if (!this.slash || !this.slashBlock) return;
    var item = this.slash[this.slashIndex];
    this.convert(this.slashBlock, item.type);
    this.hideSlash();
    this.emit();
  };

  InkEditor.prototype.hideSlash = function () {
    this.slashEl.hidden = true;
    this.slash = null;
    this.slashBlock = null;
  };

  InkEditor.prototype.onPaste = function (e) {
    var text = e.clipboardData && e.clipboardData.getData("text/plain");
    if (text == null) return;
    e.preventDefault();
    if (text.indexOf("\n") >= 0) {
      var md = this.toMarkdown();
      this.setMarkdown((md ? md + "\n\n" : "") + text);
      this.emit();
      return;
    }
    document.execCommand("insertText", false, text);
    this.emit();
  };

  global.InkEditor = InkEditor;
})(typeof window !== "undefined" ? window : this);
