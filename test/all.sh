#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# test/all.sh -- run every suite.
#
#   bash test/all.sh
#
# Two of the suites drive the pages in a real DOM, which needs jsdom. That is a
# development-only dependency and the board never touches it, so rather than
# asking anyone to remember an install step, this fetches it on first run and
# carries on without it if there is no network.
#
# A forgotten setup step is a step that does not happen. The tests that use a
# real DOM are the ones that caught the defects a stub DOM waved through, so
# they are exactly the ones that must not be the easy ones to skip.
# ---------------------------------------------------------------------------
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "node is not installed; the test suite needs it (the board itself does not)"
  exit 1
fi

if ! node -e "require('jsdom')" >/dev/null 2>&1; then
  if command -v npm >/dev/null 2>&1; then
    echo "installing jsdom (development only, not needed to run the board)…"
    npm install --no-save --silent jsdom >/dev/null 2>&1 \
      && echo "  installed" \
      || echo "  could not install — the two real-DOM suites will skip"
  else
    echo "no npm; the two real-DOM suites will skip"
  fi
  echo
fi

SUITES="markdown macros hidden chrome pages modes typeface export interactive sizing link"
fails=0
skipped=0

for t in $SUITES; do
  printf '%-12s ' "$t"
  out="$(node "test/$t.js" 2>&1)"
  code=$?
  last="$(printf '%s' "$out" | tail -1)"
  if printf '%s' "$out" | grep -q '^skip'; then
    skipped=$((skipped + 1))
    echo "skipped ($(printf '%s' "$out" | head -1 | sed 's/^skip *//'))"
  elif [ $code -ne 0 ]; then
    fails=$((fails + 1))
    echo "FAILED"
    printf '%s\n' "$out" | grep '^FAIL' | sed 's/^/             /'
  else
    echo "$last"
  fi
done

printf '%-12s ' "transcript"
if out="$(python3 test/transcript.py 2>&1)"; then
  printf '%s\n' "$out" | tail -1
else
  fails=$((fails + 1))
  echo "FAILED"
  printf '%s\n' "$out" | grep '^FAIL' | sed 's/^/             /'
fi

printf '%-12s ' "begin"
if out="$(python3 test/begin.py 2>&1)"; then
  printf '%s\n' "$out" | tail -1
else
  fails=$((fails + 1))
  echo "FAILED"
  printf '%s\n' "$out" | grep '^FAIL' | sed 's/^/             /'
fi

printf '%-12s ' "homework"
if out="$(python3 test/homework.py 2>&1)"; then
  printf '%s\n' "$out" | tail -1
else
  fails=$((fails + 1))
  echo "FAILED"
  printf '%s\n' "$out" | grep '^FAIL' | sed 's/^/             /'
fi

printf '%-12s ' "agents"
if out="$(python3 test/agents.py 2>&1)"; then
  printf '%s\n' "$out" | tail -1
else
  fails=$((fails + 1))
  echo "FAILED"
  printf '%s\n' "$out" | grep '^FAIL' | sed 's/^/             /'
fi

printf '%-12s ' "macros/tex"
if python3 tools/sync-macros.py --check >/dev/null 2>&1; then
  echo "TeX and KaTeX know the same commands"
else
  fails=$((fails + 1))
  echo "FAILED — run: python3 tools/sync-macros.py"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "all suites passed${skipped:+ ($skipped skipped)}"
else
  echo "$fails suite(s) failed"
fi
exit "$fails"
