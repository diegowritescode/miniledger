#!/bin/sh
set -eu

cd "$(dirname "$0")"

if ! grep -q '^DEMO_RESET_ENABLED=true$' .env; then
  echo "demo-reset: DEMO_RESET_ENABLED=true is not set in deploy/.env; refusing to wipe data" >&2
  exit 1
fi

set -a
. ./.env
set +a
: "${DEMO_EMAIL:?set DEMO_EMAIL in deploy/.env}"
: "${DEMO_PASSWORD:?set DEMO_PASSWORD in deploy/.env}"

docker compose down --volumes
docker compose up -d --wait --wait-timeout 180

subject=$(docker compose exec -T -e DEMO_EMAIL -e DEMO_PASSWORD api node -e '
fetch(`${process.env.ACCESSCORE_BASE_URL}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: process.env.DEMO_EMAIL, password: process.env.DEMO_PASSWORD }),
})
  .then((r) => { if (!r.ok) throw new Error(`AccessCore login returned ${r.status}`); return r.json(); })
  .then((b) => process.stdout.write(JSON.parse(Buffer.from(b.access_token.split(".")[1], "base64url")).sub))
  .catch((e) => { console.error(e.message); process.exit(1); });
')

docker compose exec -T -e DEMO_OWNER_SUBJECT="$subject" api node dist/seed.js
echo "demo-reset: $(date -u +%Y-%m-%dT%H:%M:%SZ) miniledger wiped and reseeded for $subject"
