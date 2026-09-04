---
name: write-blog
description: >
  Create, edit, publish, unpublish, or delete bilingual blog posts on cabral.sanz
  via the CRDT document API (markdown, find/replace, ops). Use when the user asks
  to escrever um post, editar o blog, publicar, patch de markdown, CRDT, /write-blog,
  or to change bodyPt/bodyEn of a post.
---

# write-blog

Corpo do post é **markdown** num CRDT de spans. Não escreva HTML. Sempre pt-BR **e** en.

## Auth e base

```
Authorization: Bearer $ADMIN_PASSWORD
Content-Type: application/json
```

Base: `$BLOG_URL` (default `https://cabral.sanz.com.br`) ou `http://127.0.0.1:3000` se o servidor local estiver no ar.

Descoberta: `GET /admin/api/llm`

## Fluxo

1. `GET /admin/api/posts` — listar slugs.
2. Novo: `POST /admin/api/posts` com `{ slug, date, titlePt, titleEn, draft: true, bodyPt, bodyEn }` (markdown).
3. Ler corpo: `GET /admin/api/posts/:slug/doc/pt` e `/doc/en` → `{ markdown, bytes, clock }`.
4. Editar trecho: `POST .../doc/:lang/patch` `{ "find": "…", "replace": "…", "all": false }`.
5. Substituir o doc: `PUT .../doc/:lang` `{ "markdown": "# …" }` — só quando o GET acabou de acontecer; o servidor faz diff CRDT (prefixo/sufixo).
6. Preferir **patch find/replace** a PUT inteiro se o humano puder estar digitando.
7. Meta (título/data/draft): `PUT /admin/api/posts/:slug`.
8. **Nunca publicar sozinho.** Grava como `draft: true` e manda o link de preview. `POST .../publish` só se o humano disser explicitamente “publica” / “publish”.
9. Despublicar / apagar: `.../unpublish` e `DELETE /admin/api/posts/:slug`.

Ops cruas (editor): `POST .../doc/:lang/ops` `{ "replica": "lxxxx", "ops": [["i", replica, clock, id, pos, text], ["d", replica, clock, id], ["x", replica, clock, itemId, inner, rightId, rightPos]] }`.

## Regras

- Slug: `^[a-z0-9]+(-[a-z0-9]+)*$`.
- Data: `YYYY-MM-DD`.
- Rascunho não aparece em `/blog` até publicar.
- Depois de PUT/patch, o `markdown` devolvido é a fonte da verdade (CRDT compactado).
- Se `find` não existir: 404. Não invente o trecho — GET de novo.
- Escreva na voz do Paulo (direto, técnico, sem marketing).
- Script: `.grok/skills/write-blog/scripts/blog.sh`.
