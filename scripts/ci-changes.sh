#!/usr/bin/env bash
# Prints code=false only if every file changed since $1 is documentation that
# no build, lint or packaging check depends on. Anything unsure prints
# code=true, so CI runs everything.
#
#   bash scripts/ci-changes.sh <base-sha>
set -euo pipefail

base="${1:-}"

all() {
  echo "ci-changes: $1, running everything" >&2
  echo code=true
  exit 0
}

if [ -z "$base" ] || [ "$base" = 0000000000000000000000000000000000000000 ]; then
  all "no base"
fi
git cat-file -e "$base^{commit}" 2>/dev/null || all "base $base not in clone"

changed=$(git diff --name-only "$base" HEAD)
[ -n "$changed" ] || all "empty diff"

while IFS= read -r f; do
  case "$f" in
    # The build copies these two into dist/, so they count as code.
    LICENSE | THIRD_PARTY_NOTICES.md) all "$f ships in the static site" ;;
    *.md) ;;
    *) all "$f is not docs" ;;
  esac
done <<< "$changed"

echo "ci-changes: docs only, skipping the build jobs" >&2
echo code=false
