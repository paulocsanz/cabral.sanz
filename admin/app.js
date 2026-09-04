(function () {
  "use strict";

  var state = {
    authenticated: false,
    editingSlug: null,
    isNew: false,
    draft: true,
    slugTouched: false,
    saveTimer: null,
    replica: "e" + Math.random().toString(36).slice(2, 6),
  };
  var editors = { pt: null, en: null };
  var reauthWait = null;
  var creating = null;
  var BACKUP_KEY = "cabral.sanz.editor";
  var $ = function (id) {
    return document.getElementById(id);
  };

  function show(view) {
    ["login", "list", "edit"].forEach(function (v) {
      $("view-" + v).hidden = v !== view;
    });
  }

  function writeBackup() {
    try {
      localStorage.setItem(
        BACKUP_KEY,
        JSON.stringify({
          slug: $("f-slug").value,
          date: $("f-date").value,
          titlePt: $("f-title-pt").value,
          titleEn: $("f-title-en").value,
          bodyPt: markdownOf("pt"),
          bodyEn: markdownOf("en"),
          isNew: state.isNew,
          editingSlug: state.editingSlug,
          ts: Date.now(),
        }),
      );
    } catch (err) {}
  }

  function readBackup() {
    try {
      var raw = localStorage.getItem(BACKUP_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.ts) return null;
      if (Date.now() - data.ts > 7 * 24 * 60 * 60 * 1000) return null;
      if (!(data.bodyPt || data.bodyEn || data.titlePt)) return null;
      return data;
    } catch (err) {
      return null;
    }
  }

  function clearBackup() {
    try {
      localStorage.removeItem(BACKUP_KEY);
    } catch (err) {}
  }

  function askReauth() {
    if (reauthWait) return reauthWait;
    var box = $("reauth");
    var form = $("reauth-form");
    var pass = $("reauth-password");
    var errEl = $("reauth-error");
    box.hidden = false;
    errEl.hidden = true;
    errEl.textContent = "";
    pass.value = "";
    setTimeout(function () {
      pass.focus();
    }, 0);
    reauthWait = new Promise(function (resolve, reject) {
      function onSubmit(event) {
        event.preventDefault();
        errEl.hidden = true;
        api("POST", "/admin/api/login", { password: pass.value })
          .then(function () {
            form.removeEventListener("submit", onSubmit);
            pass.value = "";
            box.hidden = true;
            reauthWait = null;
            resolve();
          })
          .catch(function (err) {
            errEl.textContent = err.message;
            errEl.hidden = false;
          });
      }
      form.addEventListener("submit", onSubmit);
    });
    return reauthWait;
  }

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (res.status === 401 && path !== "/admin/api/login") {
            return askReauth().then(function () {
              return api(method, path, body);
            });
          }
          if (!res.ok) throw new Error(data.error || "Erro " + res.status);
          return data;
        });
    });
  }

  function alert_(id, message) {
    var el = $(id);
    el.textContent = message;
    el.hidden = !message;
  }

  function slugify(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  function markdownOf(lang) {
    return editors[lang] ? editors[lang].toMarkdown() : "";
  }

  function setEditorStatus(draft) {
    state.draft = draft;
    $("editor-status").textContent = draft
      ? "Status: rascunho — não aparece no blog público."
      : "Status: publicado — visível em /blog.";
    $("btn-publish").hidden = !draft;
    $("btn-unpublish").hidden = draft;
    $("btn-delete").hidden = state.isNew;
    $("editor-title").textContent = state.isNew ? "Novo post" : draft ? "Editar rascunho" : "Editar post";
  }

  function setLangTab(lang) {
    $("tab-pt").classList.toggle("is-on", lang === "pt");
    $("tab-en").classList.toggle("is-on", lang === "en");
    $("pane-pt").hidden = lang !== "pt";
    $("pane-en").hidden = lang !== "en";
  }

  function mountEditors(mdPt, mdEn) {
    ["pt", "en"].forEach(function (lang) {
      var host = $("ink-" + lang);
      host.innerHTML = "";
      editors[lang] = new InkEditor(host, {
        markdown: mdPt && lang === "pt" ? mdPt : lang === "en" ? mdEn : "",
        placeholder: lang === "pt" ? "Escreva, ou / para comandos" : "Write, or / for commands",
        onChange: function () {
          scheduleDocSave(lang);
        },
      });
    });
  }

  function scheduleDocSave(lang) {
    writeBackup();
    $("sync-pill").textContent = "a gravar…";
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () {
      persistEditor(lang).catch(function (err) {
        alert_("editor-error", err.message);
      });
    }, 400);
  }

  function persistEditor(lang) {
    if (state.isNew) {
      var slug = $("f-slug").value;
      var titlePt = $("f-title-pt").value;
      var titleEn = $("f-title-en").value;
      if (!slug || !titlePt || !titleEn) {
        $("sync-pill").textContent = "rascunho local";
        return Promise.resolve();
      }
      if (creating) {
        return creating.then(function () {
          return state.editingSlug ? saveDoc(lang) : Promise.resolve();
        });
      }
      creating = saveMeta(true)
        .then(function (post) {
          afterSave(post, "");
          $("sync-pill").textContent = "gravado · rascunho";
          return post;
        })
        .finally(function () {
          creating = null;
        });
      return creating;
    }
    if (!state.editingSlug) return Promise.resolve();
    return saveDoc(lang);
  }

  function saveDoc(lang) {
    var slug = state.editingSlug;
    var markdown = markdownOf(lang);
    return api("PUT", "/admin/api/posts/" + encodeURIComponent(slug) + "/doc/" + lang, {
      markdown: markdown,
      replica: state.replica,
    }).then(function (data) {
      $("sync-pill").textContent = "gravado · " + (data.bytes || 0) + " B";
      clearBackup();
      return data;
    });
  }

  $("login-form").addEventListener("submit", function (event) {
    event.preventDefault();
    alert_("login-error", "");
    api("POST", "/admin/api/login", { password: $("login-password").value })
      .then(function () {
        state.authenticated = true;
        $("login-password").value = "";
        openList();
      })
      .catch(function (err) {
        alert_("login-error", err.message);
      });
  });

  $("btn-logout").addEventListener("click", function () {
    api("POST", "/admin/api/logout").catch(function () {});
    state.authenticated = false;
    show("login");
  });

  $("tab-pt").addEventListener("click", function () {
    setLangTab("pt");
  });
  $("tab-en").addEventListener("click", function () {
    setLangTab("en");
  });

  function openList() {
    show("list");
    alert_("list-error", "");
    api("GET", "/admin/api/posts")
      .then(function (data) {
        var list = $("post-list");
        list.innerHTML = "";
        var posts = data.posts || [];
        $("list-empty").hidden = posts.length > 0;
        posts.forEach(function (post) {
          var li = document.createElement("li");
          li.className = "admin-item";
          var left = document.createElement("span");
          left.className = "admin-item-title";
          left.textContent = post.titlePt || post.slug;
          var meta = document.createElement("span");
          meta.className = "admin-item-meta";
          var badge = document.createElement("span");
          badge.className = "admin-badge " + (post.draft ? "admin-badge-draft" : "admin-badge-live");
          badge.textContent = post.draft ? "rascunho" : "publicado";
          meta.appendChild(document.createTextNode(post.date + " · "));
          meta.appendChild(badge);
          var actions = document.createElement("span");
          actions.className = "admin-actions";
          var edit = document.createElement("button");
          edit.type = "button";
          edit.className = "admin-btn";
          edit.textContent = "Editar";
          edit.addEventListener("click", function () {
            openEditor(post, false);
          });
          actions.appendChild(edit);
          var link = document.createElement("a");
          link.className = "admin-btn admin-btn-ghost";
          link.href = "/blog/" + post.slug;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.textContent = "Ver";
          actions.appendChild(link);
          if (post.draft) {
            var pub = document.createElement("button");
            pub.type = "button";
            pub.className = "admin-btn admin-btn-publish";
            pub.textContent = "Publicar";
            pub.addEventListener("click", function () {
              alert_("list-error", "");
              api("POST", "/admin/api/posts/" + encodeURIComponent(post.slug) + "/publish")
                .then(openList)
                .catch(function (err) {
                  alert_("list-error", err.message);
                });
            });
            actions.appendChild(pub);
          } else {
            var unpub = document.createElement("button");
            unpub.type = "button";
            unpub.className = "admin-btn admin-btn-ghost";
            unpub.textContent = "Despublicar";
            unpub.addEventListener("click", function () {
              if (!confirm("Despublicar “" + post.titlePt + "”? Some do blog público.")) return;
              api("POST", "/admin/api/posts/" + encodeURIComponent(post.slug) + "/unpublish")
                .then(openList)
                .catch(function (err) {
                  alert_("list-error", err.message);
                });
            });
            actions.appendChild(unpub);
          }
          var del = document.createElement("button");
          del.type = "button";
          del.className = "admin-btn admin-btn-danger";
          del.textContent = "Excluir";
          del.addEventListener("click", function () {
            if (!confirm("Excluir “" + post.titlePt + "”? Não dá para desfazer.")) return;
            api("DELETE", "/admin/api/posts/" + encodeURIComponent(post.slug))
              .then(openList)
              .catch(function (err) {
                alert_("list-error", err.message);
              });
          });
          actions.appendChild(del);
          li.appendChild(left);
          li.appendChild(meta);
          li.appendChild(actions);
          list.appendChild(li);
        });
      })
      .catch(function (err) {
        alert_("list-error", err.message);
      });
  }

  $("btn-new").addEventListener("click", function () {
    openEditor(null, true);
  });

  function openEditor(post, isNew) {
    state.isNew = isNew;
    state.editingSlug = isNew ? null : post.slug;
    state.slugTouched = !isNew;
    $("f-slug").value = isNew ? "" : post.slug;
    $("f-slug").disabled = !isNew;
    $("f-date").value = isNew ? new Date().toISOString().slice(0, 10) : post.date;
    $("f-title-pt").value = isNew ? "" : post.titlePt;
    $("f-title-en").value = isNew ? "" : post.titleEn;
    setEditorStatus(isNew ? true : post.draft);
    alert_("editor-error", "");
    alert_("editor-ok", "");
    $("sync-pill").textContent = isNew ? "novo" : "…";
    setLangTab("pt");
    show("edit");
    if (isNew) {
      var backup = readBackup();
      if (backup && backup.isNew) {
        $("f-slug").value = backup.slug || "";
        $("f-date").value = backup.date || $("f-date").value;
        $("f-title-pt").value = backup.titlePt || "";
        $("f-title-en").value = backup.titleEn || "";
        if (backup.slug) state.slugTouched = true;
        mountEditors(backup.bodyPt || "", backup.bodyEn || "");
        $("sync-pill").textContent = "recuperado";
        scheduleDocSave("pt");
        return;
      }
      mountEditors("", "");
      return;
    }
    Promise.all([
      api("GET", "/admin/api/posts/" + encodeURIComponent(post.slug) + "/doc/pt"),
      api("GET", "/admin/api/posts/" + encodeURIComponent(post.slug) + "/doc/en"),
    ])
      .then(function (docs) {
        mountEditors(docs[0].markdown || "", docs[1].markdown || "");
        $("sync-pill").textContent = "gravado · " + ((docs[0].bytes || 0) + (docs[1].bytes || 0)) + " B";
      })
      .catch(function (err) {
        mountEditors(post.bodyPt || "", post.bodyEn || "");
        alert_("editor-error", err.message);
      });
  }

  $("f-slug").addEventListener("input", function () {
    state.slugTouched = true;
    writeBackup();
  });
  $("f-title-pt").addEventListener("input", function () {
    if (state.isNew && !state.slugTouched) {
      $("f-slug").value = slugify($("f-title-pt").value);
    }
    writeBackup();
  });
  $("f-title-en").addEventListener("input", writeBackup);
  $("f-date").addEventListener("input", writeBackup);
  $("back-link").addEventListener("click", function (event) {
    event.preventDefault();
    openList();
  });

  function afterSave(post, message) {
    state.isNew = false;
    state.editingSlug = post.slug;
    $("f-slug").value = post.slug;
    $("f-slug").disabled = true;
    setEditorStatus(post.draft);
    if (message) alert_("editor-ok", message);
    else alert_("editor-ok", "");
    clearBackup();
  }

  function saveMeta(draft) {
    alert_("editor-error", "");
    alert_("editor-ok", "");
    var payload = {
      date: $("f-date").value,
      titlePt: $("f-title-pt").value,
      titleEn: $("f-title-en").value,
      draft: draft,
    };
    var promise;
    if (state.isNew) {
      payload.slug = $("f-slug").value;
      payload.bodyPt = markdownOf("pt");
      payload.bodyEn = markdownOf("en");
      promise = api("POST", "/admin/api/posts", payload).then(function (post) {
        state.editingSlug = post.slug;
        state.isNew = false;
        $("f-slug").disabled = true;
        return Promise.all([saveDoc("pt"), saveDoc("en")]).then(function () {
          return post;
        });
      });
    } else {
      promise = api("PUT", "/admin/api/posts/" + encodeURIComponent(state.editingSlug), payload).then(function (post) {
        return Promise.all([saveDoc("pt"), saveDoc("en")]).then(function () {
          return post;
        });
      });
    }
    return promise;
  }

  $("editor-form").addEventListener("submit", function (event) {
    event.preventDefault();
    saveMeta(state.draft)
      .then(function (post) {
        afterSave(post, state.draft ? "Rascunho salvo." : "Post salvo.");
      })
      .catch(function (err) {
        alert_("editor-error", err.message);
      });
  });

  $("btn-publish").addEventListener("click", function () {
    saveMeta(false)
      .then(function (post) {
        afterSave(post, "Publicado. Está no blog.");
      })
      .catch(function (err) {
        alert_("editor-error", err.message);
      });
  });

  $("btn-unpublish").addEventListener("click", function () {
    if (!confirm("Despublicar este post? Ele some do blog público.")) return;
    saveMeta(true)
      .then(function (post) {
        afterSave(post, "Despublicado. Voltou a rascunho.");
      })
      .catch(function (err) {
        alert_("editor-error", err.message);
      });
  });

  $("btn-delete").addEventListener("click", function () {
    if (!state.editingSlug) return;
    if (!confirm("Excluir este post? Não dá para desfazer.")) return;
    api("DELETE", "/admin/api/posts/" + encodeURIComponent(state.editingSlug))
      .then(openList)
      .catch(function (err) {
        alert_("editor-error", err.message);
      });
  });

  api("GET", "/admin/api/session")
    .then(function (data) {
      if (data.authenticated) openList();
      else show("login");
    })
    .catch(function () {
      show("login");
    });
})();
