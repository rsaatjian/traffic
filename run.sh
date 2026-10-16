#!/usr/bin/env bash
# Live, unbuffered, tee'd to logs/server.log
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p logs
exec python3 -u server.py "$@" 2>&1 | tee -a logs/server.log
