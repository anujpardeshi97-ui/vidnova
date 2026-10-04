#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# NexStream - one-click launcher (macOS / Linux)
# Double-click this file, or run:  ./start.sh
# ---------------------------------------------------------------------------
set -e
cd "$(dirname "$0")"

echo "==========================================="
echo "  NexStream - starting up"
echo "==========================================="
echo

# 1. Node present?
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found."
  echo "Install the LTS version from https://nodejs.org and run this file again."
  echo
  read -r -p "Press Enter to close..." _ || true
  exit 1
fi
echo "Node $(node -v) detected."

# 2. Dependencies installed?
if [ ! -d node_modules ]; then
  echo "First run - installing dependencies (about 20 seconds)..."
  npm install
  echo
fi

# 3. Free port 3000 if something else is using it
if command -v lsof >/dev/null 2>&1 && lsof -i :3000 >/dev/null 2>&1; then
  echo "Port 3000 is in use - starting on port 3001 instead."
  PORT=3001
else
  PORT=3000
fi

echo
echo "Starting the dev server..."
echo "Open http://localhost:${PORT} in your browser."
echo "Press Ctrl + C in this window to stop the server."
echo

if [ "$PORT" = "3001" ]; then
  npm run dev -- --port=3001
else
  npm run dev
fi
