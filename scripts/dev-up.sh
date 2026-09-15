#!/usr/bin/env bash
# Brings up the whole local dev stack: Supabase (DB/Auth/Storage), edge
# functions with real secrets loaded, and Stripe webhook forwarding —
# so `npm run dev` never has to touch prod data or live Stripe.
#
# Usage:
#   scripts/dev-up.sh          start/refresh everything
#   scripts/dev-up.sh stop     stop the background processes started here
#                               (leaves the Supabase Docker stack running —
#                               use `supabase stop` for that)
#
# Safe to re-run: kills and restarts its own background processes each
# time, so it also works as a "my webhook secret expired, refresh it" command.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DEV_DIR=".dev"
FUNCTIONS_LOG="$DEV_DIR/functions-serve.log"
FUNCTIONS_PID="$DEV_DIR/functions-serve.pid"
STRIPE_LOG="$DEV_DIR/stripe-listen.log"
STRIPE_PID="$DEV_DIR/stripe-listen.pid"
WEBHOOK_PATH="127.0.0.1:54321/functions/v1/stripe-webhook"

stop_pid_file() {
  local pid_file="$1"
  if [ -f "$pid_file" ]; then
    local pid
    pid=$(cat "$pid_file")
    kill "$pid" 2>/dev/null || true
    rm -f "$pid_file"
  fi
}

if [ "${1:-}" = "stop" ]; then
  echo "Stopping functions serve and stripe listen..."
  stop_pid_file "$FUNCTIONS_PID"
  stop_pid_file "$STRIPE_PID"
  echo "Done. (Supabase Docker stack still running - use 'supabase stop' to stop that too.)"
  exit 0
fi

mkdir -p "$DEV_DIR"

if ! docker info >/dev/null 2>&1; then
  echo "Docker isn't running - start Docker Desktop first." >&2
  exit 1
fi

echo "==> Starting local Supabase stack..."
npx supabase start -x edge-runtime

echo "==> Applying any pending migrations..."
npx supabase migration up --local

echo "==> Syncing .env.local with this machine's local Supabase URL/keys..."
STATUS_ENV=$(npx supabase status -o env 2>/dev/null)
LOCAL_API_URL=$(echo "$STATUS_ENV" | grep '^API_URL=' | cut -d'"' -f2)
LOCAL_ANON_KEY=$(echo "$STATUS_ENV" | grep '^ANON_KEY=' | cut -d'"' -f2)

if [ ! -f .env.local ]; then
  cat > .env.local <<EOF
VITE_SUPABASE_URL=$LOCAL_API_URL
VITE_SUPABASE_ANON_KEY=$LOCAL_ANON_KEY

# Get this from the Stripe dashboard with "Test mode" toggled on:
# https://dashboard.stripe.com/test/apikeys
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_REPLACE_ME

VITE_TELEGRAM_BOT_USERNAME=mooochabot
EOF
  echo "    created .env.local - fill in VITE_STRIPE_PUBLISHABLE_KEY before testing checkout"
else
  sed -i '' "s|^VITE_SUPABASE_URL=.*|VITE_SUPABASE_URL=$LOCAL_API_URL|" .env.local
  sed -i '' "s|^VITE_SUPABASE_ANON_KEY=.*|VITE_SUPABASE_ANON_KEY=$LOCAL_ANON_KEY|" .env.local
fi

if [ ! -f supabase/.env ]; then
  cat > supabase/.env <<'EOF'
# Secrets for local edge functions (supabase functions serve).
# Gitignored - never commit.

# Stripe test secret key: https://dashboard.stripe.com/test/apikeys
STRIPE_SECRET_KEY=sk_test_REPLACE_ME

# Filled in automatically by scripts/dev-up.sh from `stripe listen`'s output.
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
EOF
  echo "    created supabase/.env - fill in STRIPE_SECRET_KEY before testing checkout"
fi

if grep -q "REPLACE_ME" supabase/.env; then
  echo ""
  echo "!! supabase/.env still has a placeholder STRIPE_SECRET_KEY - edge functions"
  echo "   that call Stripe (checkout, refund) will fail until you set a real"
  echo "   sk_test_... key from https://dashboard.stripe.com/test/apikeys"
  echo ""
fi

start_functions_serve() {
  stop_pid_file "$FUNCTIONS_PID"
  echo "==> Starting supabase functions serve..."
  nohup npx supabase functions serve --env-file supabase/.env \
    > "$FUNCTIONS_LOG" 2>&1 &
  echo $! > "$FUNCTIONS_PID"
  # Give it a moment to boot before anything hits it.
  sleep 3
}

start_functions_serve

echo "==> Starting stripe listen (forwarding to $WEBHOOK_PATH)..."
stop_pid_file "$STRIPE_PID"
STRIPE_KEY=$(grep '^STRIPE_SECRET_KEY=' supabase/.env | cut -d'=' -f2-)
: > "$STRIPE_LOG"
nohup stripe listen --api-key "$STRIPE_KEY" --forward-to "$WEBHOOK_PATH" \
  > "$STRIPE_LOG" 2>&1 &
echo $! > "$STRIPE_PID"

echo "    waiting for stripe listen to hand out a webhook signing secret..."
WEBHOOK_SECRET=""
for _ in $(seq 1 15); do
  # -a: stripe listen's spinner writes non-UTF8 bytes while "Getting
  # ready..." is showing, which makes grep treat the file as binary and
  # print "Binary file ... matches" instead of the secret without -a.
  WEBHOOK_SECRET=$(grep -aoE 'whsec_[A-Za-z0-9]+' "$STRIPE_LOG" | head -1 || true)
  [ -n "$WEBHOOK_SECRET" ] && break
  sleep 1
done

if [ -z "$WEBHOOK_SECRET" ]; then
  echo "!! stripe listen didn't print a webhook secret in time - check $STRIPE_LOG" >&2
  echo "   (STRIPE_SECRET_KEY in supabase/.env may still be a placeholder)" >&2
else
  echo "    got $WEBHOOK_SECRET - writing it to supabase/.env and reloading functions"
  sed -i '' "s|^STRIPE_WEBHOOK_SECRET=.*|STRIPE_WEBHOOK_SECRET=$WEBHOOK_SECRET|" supabase/.env
  start_functions_serve
fi

echo ""
echo "==> Ready."
echo "    App:      npm run dev   (reads .env.local)"
echo "    Studio:   $LOCAL_API_URL -> http://127.0.0.1:54323"
echo "    Functions log:      $FUNCTIONS_LOG"
echo "    Stripe listen log:  $STRIPE_LOG"
echo "    Stop background processes: scripts/dev-up.sh stop"
