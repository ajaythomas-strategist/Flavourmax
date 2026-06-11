#!/bin/bash
# ── Flavourmax Local Server Launcher ──────────────────────────
# Double-click this file to start the app at localhost:8000

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=8000

# Kill any process already using port 8000
lsof -ti tcp:$PORT | xargs kill -9 2>/dev/null

cd "$DIR"
echo "────────────────────────────────────────"
echo "  🍃 Flavourmax — Starting server..."
echo "  URL: http://localhost:$PORT"
echo "  Press Ctrl+C to stop"
echo "────────────────────────────────────────"

# Open browser after 1 second
(sleep 1 && open "http://localhost:$PORT") &

# Start server
python3 -m http.server $PORT
