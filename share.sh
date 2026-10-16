#!/usr/bin/env bash
# Expose the running ring to the internet, so drivers do not need to be on your
# network. Uses a Cloudflare quick tunnel: no account, no signup, WebSockets work,
# and the URL dies when you Ctrl-C this.
#
#   ./run.sh --pin 1234     # terminal 1 -- a PIN is wise once this is public
#   ./share.sh              # terminal 2 -- prints the public URL
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8700}"
BIN=./.cloudflared

if [ ! -x "$BIN" ]; then
  echo "fetching cloudflared (one time, ~35 MB)..."
  curl -fsSL -o "$BIN" \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x "$BIN"
fi

if ! curl -fsS -o /dev/null "http://127.0.0.1:$PORT/"; then
  echo "nothing is serving on port $PORT -- start ./run.sh first" >&2
  exit 1
fi

mkdir -p logs
echo "opening a public tunnel to http://127.0.0.1:$PORT ..."
echo "(Ctrl-C closes it; the URL is single-use and changes every run)"
echo

# The URL only appears in cloudflared's own output, so tee it and watch for it.
"$BIN" tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" 2>&1 \
  | tee -a logs/tunnel.log \
  | while IFS= read -r line; do
      case "$line" in
        *trycloudflare.com*)
          url=$(printf '%s\n' "$line" | grep -oE 'https://[a-z0-9.-]+\.trycloudflare\.com' || true)
          if [ -n "$url" ] && [ -z "${SHOWN:-}" ]; then
            SHOWN=1
            echo
            echo "  ============================================================"
            echo "    drivers:    $url/drive"
            echo "    overview:   $url/"
            echo "  ============================================================"
            echo
            echo "  The QR code on the overview updates itself -- it follows"
            echo "  whatever host you opened the page on, so load the overview"
            echo "  at $url/ and the QR will point at the public address."
            echo
          fi
          ;;
      esac
      printf '%s\n' "$line"
    done
