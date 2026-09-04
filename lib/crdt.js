// CRDT de texto em spans (RGA + chave fracionária).
// Snapshot compacto ≈ tamanho do documento. Ops são insert/delete de spans.
// Funciona no Node e no browser.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CabralCRDT = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

  function cmpStr(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function between(left, right) {
    left = left || "";
    if (right == null) {
      if (!left) return "V";
      var last = left.charAt(left.length - 1);
      var idx = DIGITS.indexOf(last);
      if (idx >= 0 && idx < DIGITS.length - 1) return left.slice(0, -1) + DIGITS[idx + 1];
      return left + "V";
    }
    var i = 0;
    var prefix = "";
    for (;;) {
      var lc = i < left.length ? DIGITS.indexOf(left.charAt(i)) : -1;
      var rc = i < right.length ? DIGITS.indexOf(right.charAt(i)) : DIGITS.length;
      if (lc < 0) lc = -1;
      if (lc + 1 < rc) {
        var mid = (lc + rc) >> 1;
        if (mid <= lc) mid = lc + 1;
        if (mid >= rc) mid = rc - 1;
        if (mid > lc && mid < rc) return prefix + DIGITS[mid];
      }
      prefix += i < left.length ? left.charAt(i) : "0";
      i += 1;
      if (i > 64) return prefix + "V";
    }
  }

  function makeId(replica, n) {
    return replica + ":" + n.toString(36);
  }

  function parseN(id) {
    var i = id.lastIndexOf(":");
    return parseInt(id.slice(i + 1), 36) || 0;
  }

  function cmpItem(a, b) {
    var c = cmpStr(a.pos, b.pos);
    if (c) return c;
    return cmpStr(a.id, b.id);
  }

  function Doc(replica) {
    this.replica = replica || "s";
    this.clock = 0;
    this.compactClock = 0;
    this.items = [];
  }

  Doc.prototype.nextId = function () {
    this.clock += 1;
    return makeId(this.replica, this.clock);
  };

  Doc.prototype.live = function () {
    return this.items.filter(function (it) {
      return !it.deleted && it.text;
    }).sort(cmpItem);
  };

  Doc.prototype.text = function () {
    return this.live()
      .map(function (it) {
        return it.text;
      })
      .join("");
  };

  Doc.prototype.locate = function (offset) {
    var n = 0;
    var live = this.live();
    if (offset <= 0) return { index: 0, item: null, inner: 0 };
    for (var i = 0; i < live.length; i++) {
      var len = live[i].text.length;
      if (offset <= n + len) return { index: i, item: live[i], inner: offset - n };
      n += len;
    }
    return { index: live.length, item: live[live.length - 1] || null, inner: live.length ? live[live.length - 1].text.length : 0 };
  };

  Doc.prototype.split = function (item, inner, rightId, rightPos) {
    if (!item || inner <= 0 || inner >= item.text.length) return null;
    var rightText = item.text.slice(inner);
    item.text = item.text.slice(0, inner);
    var right = {
      id: rightId || this.nextId(),
      pos: rightPos || between(item.pos, this.rightPos(item)),
      text: rightText,
      deleted: false,
    };
    this.items.push(right);
    return right;
  };

  Doc.prototype.rightPos = function (item) {
    var live = this.live();
    for (var i = 0; i < live.length; i++) {
      if (live[i].id === item.id) return live[i + 1] ? live[i + 1].pos : null;
    }
    return null;
  };

  Doc.prototype.leftPos = function (item) {
    var live = this.live();
    for (var i = 0; i < live.length; i++) {
      if (live[i].id === item.id) return i ? live[i - 1].pos : "";
    }
    return "";
  };

  Doc.prototype.noteClock = function (replica, clock, id) {
    if (replica === this.replica && clock > this.clock) this.clock = clock;
    if (id && id.indexOf(this.replica + ":") === 0) {
      var n = parseN(id);
      if (n > this.clock) this.clock = n;
    }
  };

  Doc.prototype.insert = function (offset, str) {
    if (!str) return [];
    var ops = [];
    var loc = this.locate(offset);
    if (loc.item && loc.inner > 0 && loc.inner < loc.item.text.length) {
      var rightId = this.nextId();
      var rightPos = between(loc.item.pos, this.rightPos(loc.item));
      var splitOp = ["x", this.replica, this.clock, loc.item.id, loc.inner, rightId, rightPos];
      this.apply([splitOp]);
      ops.push(splitOp);
    }
    loc = this.locate(offset);
    var live = this.live();
    var left =
      offset <= 0
        ? null
        : loc.item && loc.inner === loc.item.text.length
          ? loc.item
          : live[loc.index - 1] || null;
    var rightIdx = 0;
    if (left) {
      for (var i = 0; i < live.length; i++) if (live[i].id === left.id) rightIdx = i + 1;
    }
    var right = live[rightIdx] || null;
    var pos = between(left ? left.pos : "", right ? right.pos : null) + this.replica;
    var id = this.nextId();
    var ins = ["i", this.replica, this.clock, id, pos, str];
    this.apply([ins]);
    ops.push(ins);
    return ops;
  };

  Doc.prototype.deleteRange = function (offset, len) {
    if (len <= 0) return [];
    var ops = [];
    var end = offset + len;
    var locS = this.locate(offset);
    if (locS.item && locS.inner > 0 && locS.inner < locS.item.text.length) {
      var r1 = this.nextId();
      var p1 = between(locS.item.pos, this.rightPos(locS.item));
      var sx = ["x", this.replica, this.clock, locS.item.id, locS.inner, r1, p1];
      this.apply([sx]);
      ops.push(sx);
    }
    var locE = this.locate(end);
    if (locE.item && locE.inner > 0 && locE.inner < locE.item.text.length) {
      var r2 = this.nextId();
      var p2 = between(locE.item.pos, this.rightPos(locE.item));
      var sy = ["x", this.replica, this.clock, locE.item.id, locE.inner, r2, p2];
      this.apply([sy]);
      ops.push(sy);
    }
    var n = 0;
    var self = this;
    this.live().forEach(function (it) {
      var a = n;
      var b = n + it.text.length;
      n = b;
      if (b <= offset || a >= end) return;
      var del = ["d", self.replica, self.clock, it.id];
      self.apply([del]);
      ops.push(del);
    });
    return ops;
  };

  Doc.prototype.apply = function (ops) {
    if (!ops || !ops.length) return;
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      var kind = op[0];
      this.noteClock(op[1], op[2], op[3]);
      if (kind === "x") {
        var item = null;
        for (var j = 0; j < this.items.length; j++) if (this.items[j].id === op[3]) item = this.items[j];
        if (item) this.split(item, op[4], op[5], op[6]);
      } else if (kind === "i") {
        var id = op[3];
        if (this.items.some(function (it) { return it.id === id; })) continue;
        this.items.push({ id: id, pos: op[4], text: op[5], deleted: false });
      } else if (kind === "d") {
        var did = op[3];
        for (var k = 0; k < this.items.length; k++) {
          if (this.items[k].id === did) this.items[k].deleted = true;
        }
      }
    }
  };

  Doc.prototype.diff = function (next) {
    var prev = this.text();
    next = String(next == null ? "" : next);
    if (prev === next) return [];
    var i = 0;
    var max = Math.min(prev.length, next.length);
    while (i < max && prev.charAt(i) === next.charAt(i)) i += 1;
    var oEnd = prev.length;
    var nEnd = next.length;
    while (oEnd > i && nEnd > i && prev.charAt(oEnd - 1) === next.charAt(nEnd - 1)) {
      oEnd -= 1;
      nEnd -= 1;
    }
    var ops = [];
    if (oEnd > i) ops = ops.concat(this.deleteRange(i, oEnd - i));
    if (nEnd > i) ops = ops.concat(this.insert(i, next.slice(i, nEnd)));
    return ops;
  };

  Doc.prototype.setText = function (next) {
    return this.diff(next);
  };

  Doc.prototype.compact = function () {
    var live = this.live();
    if (!live.length) {
      this.items = [];
      this.compactClock += 1;
      return;
    }
    var merged = [];
    var cur = { id: live[0].id, pos: live[0].pos, text: live[0].text, deleted: false };
    for (var i = 1; i < live.length; i++) {
      cur.text += live[i].text;
    }
    cur.pos = "V";
    cur.id = this.nextId();
    this.items = [cur];
    this.compactClock += 1;
  };

  Doc.prototype.snapshot = function () {
    var live = this.live();
    return {
      v: 1,
      replica: this.replica,
      clock: this.clock,
      compactClock: this.compactClock,
      items: live.map(function (it) {
        return [it.id, it.pos, it.text];
      }),
    };
  };

  Doc.load = function (snap, replica) {
    var doc = new Doc(replica || (snap && snap.replica) || "s");
    if (!snap) return doc;
    doc.clock = snap.clock || 0;
    doc.compactClock = snap.compactClock || 0;
    doc.items = (snap.items || []).map(function (row) {
      return { id: row[0], pos: row[1], text: row[2], deleted: false };
    });
    var max = 0;
    doc.items.forEach(function (it) {
      if (it.id.indexOf(doc.replica + ":") === 0) {
        var n = parseN(it.id);
        if (n > max) max = n;
      }
    });
    if (max > doc.clock) doc.clock = max;
    return doc;
  };

  Doc.prototype.bytes = function () {
    return Buffer.byteLength ? Buffer.byteLength(JSON.stringify(this.snapshot()), "utf8") : JSON.stringify(this.snapshot()).length;
  };

  return { Doc: Doc, between: between };
});
