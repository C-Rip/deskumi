#!/usr/bin/env bash
# Crea una rama de tarea y un git worktree aislado para un agente.
# Uso: start-task.sh <TASK_ID> <tipo> <slug>
#   ej: start-task.sh T-202 feat vrm-loader
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Uso: $0 <TASK_ID> <tipo> <slug>   (tipo: feat|fix|spike|docs|chore|refactor)" >&2
  exit 1
fi

task_id="$1"; type="$2"; slug="$3"

[[ "$task_id" =~ ^T-[0-9]{3}$ ]] || { echo "TASK_ID inválido: $task_id (esperado T-123)" >&2; exit 1; }
[[ "$type" =~ ^(feat|fix|spike|docs|chore|refactor)$ ]] || { echo "tipo inválido: $type" >&2; exit 1; }
[[ "$slug" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo "slug debe ser kebab-case: $slug" >&2; exit 1; }

repo_root="$(git rev-parse --show-toplevel)"
repo_name="$(basename "$repo_root")"
branch="${type}/${task_id}-${slug}"
worktree="$(dirname "$repo_root")/${repo_name}-${task_id}"

cd "$repo_root"

base="dev"
if git remote get-url origin >/dev/null 2>&1; then
  git fetch origin dev --quiet 2>/dev/null || git fetch origin main --quiet
  if git show-ref --verify --quiet "refs/remotes/origin/dev"; then
    base="origin/dev"
  else
    base="origin/main"
  fi
fi

if git show-ref --verify --quiet "refs/heads/${branch}"; then
  echo "La rama ${branch} ya existe. Reutilizando." >&2
  git worktree add "$worktree" "$branch"
else
  git worktree add -b "$branch" "$worktree" "$base"
fi

echo "✔ Rama:     $branch"
echo "✔ Worktree: $worktree"
echo "Siguiente:  cd \"$worktree\" && marca la tarjeta docs/tasks/${task_id}-*.md como 'en progreso'"
