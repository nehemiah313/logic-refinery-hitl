#!/bin/bash
# Logic Refinery HITL — Startup Script
# Launches both the Flask backend (port 5001) and React frontend (port 3000)

echo "=============================================="
echo "  Logic Refinery HITL — Starting Up"
echo "=============================================="

# Install backend dependencies
echo "[1/3] Installing Flask backend dependencies..."
pip3 install -r backend/requirements.txt -q

# Start Flask backend
echo "[2/3] Starting Flask backend on port 5001..."
cd backend && python3 app.py &
FLASK_PID=$!
echo "  Flask PID: $FLASK_PID"
cd ..

# Wait for Flask to be ready
sleep 2

# Start React frontend
echo "[3/3] Starting React frontend on port 3000..."
pnpm dev &
VITE_PID=$!
echo "  Vite PID: $VITE_PID"

echo ""
echo "=============================================="
echo "  Services Running:"
echo "  → Flask API:    http://localhost:5001/api"
echo "  → React App:    http://localhost:3000"
echo "=============================================="
echo ""
echo "Press Ctrl+C to stop all services."

# Wait for both processes
wait $FLASK_PID $VITE_PID
