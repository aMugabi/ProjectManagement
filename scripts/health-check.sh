#!/bin/bash
# The health alert (.github/workflows/health.yml): calls Ledger's public /api/health and exits 1,
# so the scheduled run fails and GitHub emails the owner, when Ledger is not healthy.
#   LEDGER_URL     the deploy (default https://mugabi-ledger.vercel.app)
#   REFERENCE_URL  a page that is up whenever the internet is (default https://api.github.com/zen)
#   RETRY_SECONDS  wait before the one retry (default 60: a waking database, or a blip)
# A failure is retried once. If Ledger can't be reached at all and the reference page can't either,
# the fault is this runner's network: it says so and exits 0 (Ledger is not blamed). The output
# names only the HTTP status and which part failed, never the answer's other fields: this
# repository is public, and so are its Actions logs.
set -u
LEDGER_URL=${LEDGER_URL:-https://mugabi-ledger.vercel.app}
REFERENCE_URL=${REFERENCE_URL:-https://api.github.com/zen}
RETRY_SECONDS=${RETRY_SECONDS:-60}
body=$(mktemp)
trap 'rm -f "$body"' EXIT

probe() {
  curl --silent --max-time 30 -A 'ledger-health-check (GitHub Actions)' -o "$body" -w '%{http_code}' "$LEDGER_URL/api/health" 2>/dev/null || true
}

status=$(probe)
if [ "$status" != "200" ]; then
  echo "First try: HTTP $status. Trying once more in ${RETRY_SECONDS}s."
  sleep "$RETRY_SECONDS"
  status=$(probe)
fi
echo "Ledger's health check answered HTTP $status"
[ "$status" = "200" ] && exit 0

if [ "$status" = "000" ]; then
  ref=$(curl --silent --max-time 15 -o /dev/null -w '%{http_code}' "$REFERENCE_URL" 2>/dev/null || true)
  if [ "$ref" != "200" ]; then
    echo "::warning::This check's own network failed: Ledger and the reference page ($REFERENCE_URL, HTTP $ref) both went unanswered. Ledger is not blamed; the next run checks again."
    exit 0
  fi
fi

# Which part failed, from the answer's own fields (only these two are read).
field() { python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], ''))" "$body" "$1" 2>/dev/null; }
database=$(field database)
push=$(field push)

reasons=()
if [ "$status" = "503" ] && [ "$database" = "failing" ]; then
  reasons+=("The database isn't answering, or the app's role sees workspaces with no one signed in. Likely: Neon is down or the database URL in Vercel changed; less likely, a migration or grant problem. To confirm: open $LEDGER_URL/api/health, check status.neon.tech, and read the Vercel log for 'Health check: the store failed'.")
fi
if [ "$status" = "503" ] && [ "$push" = "invalid" ]; then
  reasons+=("The push keys in Vercel are unusable, so no reminder can be pushed. To confirm: the Vercel log line 'the push keys are unusable', and the VAPID settings in Vercel.")
fi
if [ ${#reasons[@]} -eq 0 ]; then
  case "$status" in
    000) reasons+=("Ledger didn't answer at all within 30 seconds, while this check's own network worked. Likely: Vercel or DNS trouble. To confirm: open the site, and check vercel-status.com.") ;;
    404) reasons+=("The health route is missing: perhaps an older build was deployed or rolled back. To confirm: the latest production deployment in Vercel.") ;;
    5*) reasons+=("Ledger's server failed (HTTP $status) before it could judge its own health. To confirm: the Vercel log for /api/health.") ;;
    *) reasons+=("An unexpected answer (HTTP $status). To confirm: open $LEDGER_URL/api/health.") ;;
  esac
fi
for r in "${reasons[@]}"; do echo "::error::Ledger is not healthy (HTTP $status). $r"; done
exit 1
