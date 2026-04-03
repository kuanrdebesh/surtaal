#!/bin/bash
# Surtaal — Start both backend and frontend
# Run from the surtaal/ root directory

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║        Starting Surtaal Studio            ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Kill any existing processes on our ports
echo "→ Clearing ports 8000 and 3000..."
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

# Start backend
echo "→ Starting FastAPI backend on port 8000..."
cd backend
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
cd ..

# Wait for backend to be ready
echo "→ Waiting for backend..."
for i in {1..15}; do
  if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "✓ Backend is ready"
    break
  fi
  sleep 1
done

# Start frontend
echo "→ Starting React frontend on port 3000..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║                                                  ║"
echo "║   ✓ Surtaal is running!                          ║"
echo "║                                                  ║"
echo "║   Open in browser: http://localhost:3000         ║"
echo "║   Backend API:     http://localhost:8000         ║"
echo "║                                                  ║"
echo "║   Press Ctrl+C to stop everything               ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Open browser automatically
sleep 2
open http://localhost:3000

# Wait and clean up on exit
trap "echo ''; echo 'Shutting down...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
