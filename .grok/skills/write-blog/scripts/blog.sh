#!/usr/bin/env bash
# Uso: ADMIN_PASSWORD=… BLOG_URL=https://cabral.sanz.com.br blog.sh <cmd> …
# cmds: llm | list | get SLUG | doc SLUG LANG | put SLUG LANG  (markdown no stdin)
#       patch SLUG LANG FIND REPLACE | publish SLUG | unpublish SLUG | delete SLUG
set -euo pipefail
BASE="${BLOG_URL:-http://127.0.0.1:3000}"
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  echo "ADMIN_PASSWORD ausente" >&2
  exit 1
fi
auth=(-H "Authorization: Bearer ${ADMIN_PASSWORD}" -H "Content-Type: application/json")
cmd="${1:-}"
shift || true
case "$cmd" in
  llm) curl -fsS "${auth[@]}" "$BASE/admin/api/llm" ;;
  list) curl -fsS "${auth[@]}" "$BASE/admin/api/posts" ;;
  get) curl -fsS "${auth[@]}" "$BASE/admin/api/posts/$1" ;;
  doc) curl -fsS "${auth[@]}" "$BASE/admin/api/posts/$1/doc/$2" ;;
  put)
    md=$(cat)
    curl -fsS "${auth[@]}" -X PUT "$BASE/admin/api/posts/$1/doc/$2" -d "$(jq -n --arg m "$md" '{markdown:$m}')" ;;
  patch)
    curl -fsS "${auth[@]}" -X POST "$BASE/admin/api/posts/$1/doc/$2/patch" \
      -d "$(jq -n --arg f "$3" --arg r "$4" '{find:$f, replace:$r}')" ;;
  publish) curl -fsS "${auth[@]}" -X POST "$BASE/admin/api/posts/$1/publish" ;;
  unpublish) curl -fsS "${auth[@]}" -X POST "$BASE/admin/api/posts/$1/unpublish" ;;
  delete) curl -fsS "${auth[@]}" -X DELETE "$BASE/admin/api/posts/$1" ;;
  *) echo "cmds: llm list get doc put patch publish unpublish delete" >&2; exit 2 ;;
esac
echo
