#!/bin/bash
set -e

echo "=========================================="
echo "  Symbol Custom Network Manager"
echo "  Supports Catapult V2 / V3"
echo "=========================================="
echo ""

# Ensure shared directory exists
mkdir -p /app/shared

# Ensure DinD-safe target directory exists
# This path is bind-mounted at the same location on both
# the container and the Docker host VM, so symbol-bootstrap's
# internal "docker run -v <target>/…" commands work correctly.
mkdir -p "${TARGET_DIR:-/opt/symbol-target}"

# Note: Patched symbol-server images (OpenSSL fix) are now built
# dynamically by the backend API (server.ts → ensurePatchedImage)
# based on the catapult version selected in the UI.

# Install backend dependencies if needed
if [ ! -d /app/backend/node_modules ]; then
  echo "[Setup] Installing backend dependencies..."
  cd /app/backend && npm install
fi

# Install frontend dependencies if needed
if [ ! -d /app/frontend/node_modules ]; then
  echo "[Setup] Installing frontend dependencies..."
  cd /app/frontend && npm install
fi

# Start Backend API (background)
echo "[Start] Backend API on port 4000..."
cd /app/backend
npm run dev &
BACKEND_PID=$!

# Start Frontend Vite dev server (foreground)
echo "[Start] Frontend Vite on port 5173..."
cd /app/frontend
npm run dev &
FRONTEND_PID=$!

echo ""
echo "  Backend API:   http://localhost:4000"
echo "  Frontend:      http://localhost:5173"
echo "  WebSocket:     ws://localhost:4000"
echo ""

# Wait for either process to exit
wait -n $BACKEND_PID $FRONTEND_PID

# If one exits, kill the other
kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
wait
