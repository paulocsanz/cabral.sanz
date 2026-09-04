/* editor bloco estilo Notion / Inkwell: markdown é o modelo, atalhos + slash. */
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
    el.focus();
    var sel = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(!atEnd);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function blockText(block) {
    if (block.dataset.type === "hr") return "";
    var ed = block.querySelector(".ink-edit");
    return ed ? ed.innerText.replace(/\u00a0/g, " ").replace(/\n$/, "") : "";
  }

  function setBlockText(block, text) {
    var ed = block.querySelector(".ink-edit");
    if (ed) ed.textContent = text;
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
      '<div class="ink-surface"></div>' +
      '<textarea class="ink-source" hidden spellcheck="false"></textarea>' +
      '<div class="ink-slash" hidden></div>';
    this.surface = this.root.querySelector(".ink-surface");
    this.source = this.root.querySelector(".ink-source");
    this.slashEl = this.root.querySelector(".ink-slash");
    this.root.querySelector(".ink-bar").addEventListener("mousedown", function (e) {
      var btn = e.target.closest("[data-act]");
      if (!btn) return;
      e.preventDefault();
      self.toolbar(btn.getAttribute("data-act"));
    });
    this.surface.addEventListener("keydown", function (e) { self.onKey(e); });
    this.surface.addEventListener("input", function (e) { self.onInput(e); });
    this.surface.addEventListener("paste", function (e) { self.onPaste(e); });
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
    if (act === "link") {
      var url = window.prompt("URL");
      if (!url) return;
      document.execCommand("createLink", false, url);
      this.emit();
      return;
    }
    var cmd = { bold: "bold", italic: "italic", code: "insertHTML" }[act];
    if (act === "code") {
      var sel = window.getSelection();
      var t = sel.toString();
      document.execCommand("insertText", false, "`" + t + "`");
    } else if (cmd) document.execCommand(cmd, false, null);
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

  InkEditor.prototype.addBlock = function (type, text, after) {
    var block = document.createElement("div");
    block.className = "ink-block";
    block.dataset.type = type || "p";
    if (type === "hr") {
      block.innerHTML = '<div class="ink-hr" contenteditable="false"></div>';
    } else if (type === "todo") {
      block.innerHTML =
        '<label class="ink-todo"><input type="checkbox" /><span class="ink-edit" contenteditable="true"></span></label>';
    } else {
      block.innerHTML = '<div class="ink-edit" contenteditable="true"></div>';
    }
    var ed = block.querySelector(".ink-edit");
    if (ed) {
      ed.dataset.placeholder = this.placeholder;
      if (text) ed.textContent = text;
    }
    if (after && after.nextSibling) this.surface.insertBefore(block, after.nextSibling);
    else if (after) this.surface.appendChild(block);
    else this.surface.appendChild(block);
    return block;
  };

  InkEditor.prototype.setMarkdown = function (md) {
    this._building = true;
    this.surface.innerHTML = "";
    var text = String(md || "").replace(/\r\n/g, "\n");
    if (!text.trim()) {
      this.addBlock("p", "");
      this._building = false;
      return;
    }
    var lines = text.split("\n");
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (/^```/.test(line)) {
        var buf = [];
        i += 1;
        while (i < lines.length && !/^```/.test(lines[i])) {
          buf.push(lines[i]);
          i += 1;
        }
        this.addBlock("code", buf.join("\n"));
        i += 1;
        continue;
      }
      if (/^---\s*$/.test(line)) {
        this.addBlock("hr", "");
        i += 1;
        continue;
      }
      var h = /^(#{1,3})\s+(.*)$/.exec(line);
      if (h) {
        this.addBlock("h" + h[1].length, h[2]);
        i += 1;
        continue;
      }
      if (/^>\s?/.test(line)) {
        this.addBlock("quote", line.replace(/^>\s?/, ""));
        i += 1;
        continue;
      }
      if (/^\s*[-*+]\s+\[ \]\s+/.test(line)) {
        this.addBlock("todo", line.replace(/^\s*[-*+]\s+\[ \]\s+/, ""));
        i += 1;
        continue;
      }
      if (/^\s*[-*+]\s+\[x\]\s+/i.test(line)) {
        var tb = this.addBlock("todo", line.replace(/^\s*[-*+]\s+\[[xX]\]\s+/, ""));
        var ck = tb.querySelector("input");
        if (ck) ck.checked = true;
        i += 1;
        continue;
      }
      if (/^\s*[-*+]\s+/.test(line)) {
        this.addBlock("ul", line.replace(/^\s*[-*+]\s+/, ""));
        i += 1;
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        this.addBlock("ol", line.replace(/^\s*\d+\.\s+/, ""));
        i += 1;
        continue;
      }
      if (!line.trim()) {
        i += 1;
        continue;
      }
      this.addBlock("p", line);
      i += 1;
    }
    if (!this.surface.firstChild) this.addBlock("p", "");
    this._building = false;
  };

  InkEditor.prototype.toMarkdown = function () {
    if (this.mode === "source") return this.source.value;
    var parts = [];
    var blocks = this.surface.querySelectorAll(".ink-block");
    var ol = 0;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var type = b.dataset.type;
      var t = blockText(b);
      if (type !== "ol") ol = 0;
      if (type === "h1") parts.push("# " + t);
      else if (type === "h2") parts.push("## " + t);
      else if (type === "h3") parts.push("### " + t);
      else if (type === "ul") parts.push("- " + t);
      else if (type === "ol") {
        ol += 1;
        parts.push(ol + ". " + t);
      } else if (type === "todo") {
        var on = b.querySelector("input") && b.querySelector("input").checked;
        parts.push("- [" + (on ? "x" : " ") + "] " + t);
      } else if (type === "quote") parts.push("> " + t);
      else if (type === "code") parts.push("```\n" + t + "\n```");
      else if (type === "hr") parts.push("---");
      else parts.push(t);
      if (type === "p" || type === "h1" || type === "h2" || type === "h3" || type === "quote" || type === "code" || type === "hr") {
        parts.push("");
      }
    }
    return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  };

  InkEditor.prototype.emit = function () {
    if (this._building) return;
    this.onChange(this.toMarkdown());
  };

  InkEditor.prototype.currentBlock = function () {
    var sel = window.getSelection();
    if (!sel.anchorNode) return null;
    var n = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    return n && n.closest ? n.closest(".ink-block") : null;
  };

  InkEditor.prototype.onKey = function (e) {
    var block = this.currentBlock();
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
      return;
    }
    if (!block) return;
    if (e.key === "Enter" && !e.shiftKey && block.dataset.type !== "code") {
      e.preventDefault();
      var next = this.addBlock(block.dataset.type === "h1" || block.dataset.type === "h2" || block.dataset.type === "h3" ? "p" : block.dataset.type, "", block);
      if (next.dataset.type === "hr") next = this.addBlock("p", "", next);
      var ed = next.querySelector(".ink-edit");
      if (ed) placeCaret(ed, false);
      this.emit();
      return;
    }
    if (e.key === "Backspace") {
      var ed = block.querySelector(".ink-edit");
      var empty = !ed || !blockText(block);
      if (empty && this.surface.children.length > 1 && block.dataset.type !== "p") {
        e.preventDefault();
        block.dataset.type = "p";
        this.emit();
        return;
      }
      if (empty && block.previousSibling && this.surface.children.length > 1) {
        e.preventDefault();
        var prev = block.previousSibling;
        block.remove();
        var ped = prev.querySelector(".ink-edit");
        if (ped) placeCaret(ped, true);
        this.emit();
      }
    }
  };

  InkEditor.prototype.onInput = function () {
    var block = this.currentBlock();
    if (!block) {
      this.emit();
      return;
    }
    var raw = blockText(block);
    if (raw.charAt(0) === "/") {
      this.showSlash(block, raw.slice(1));
    } else this.hideSlash();
    var converted = this.shortcut(block, raw);
    if (!converted) this.emit();
  };

  InkEditor.prototype.shortcut = function (block, raw) {
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
        block.dataset.type = map[i][1];
        setBlockText(block, "");
        if (map[i][1] === "hr") {
          var next = this.addBlock("p", "", block);
          placeCaret(next.querySelector(".ink-edit"), false);
        } else {
          var ed = block.querySelector(".ink-edit");
          if (ed) placeCaret(ed, false);
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
          '</span><kbd>' +
          s.hint +
          "</kbd></button>"
        );
      })
      .join("");
    var rootBox = this.root.getBoundingClientRect();
    var blockBox = block.getBoundingClientRect();
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
    var block = this.slashBlock;
    block.dataset.type = item.type;
    setBlockText(block, "");
    this.hideSlash();
    if (item.type === "hr") {
      var next = this.addBlock("p", "", block);
      var ed = next.querySelector(".ink-edit");
      if (ed) placeCaret(ed, false);
    } else {
      var ed2 = block.querySelector(".ink-edit");
      if (ed2) placeCaret(ed2, false);
    }
    this.emit();
  };

  InkEditor.prototype.hideSlash = function () {
    this.slashEl.hidden = true;
    this.slash = null;
    this.slashBlock = null;
  };

  InkEditor.prototype.onPaste = function (e) {
    var text = e.clipboardData && e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    var block = this.currentBlock();
    if (text.indexOf("\n") >= 0) {
      var md = this.toMarkdown();
      var extra = text;
      this.setMarkdown((md ? md + "\n\n" : "") + extra);
      this.emit();
      return;
    }
    document.execCommand("insertText", false, text);
    this.emit();
  };

  global.InkEditor = InkEditor;
})(typeof window !== "undefined" ? window : this);
