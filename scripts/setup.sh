#!/usr/bin/env bash
# UltraTrader 2026 — Local development setup
set -e

echo "=== UltraTrader 2026 Setup ==="

# Backend
echo ""
echo "--- Setting up Python backend ---"
cd backend

python3 -m venv .venv || python -m venv .venv
source .venv/bin/activate 2>/dev/null || . .venv/Scripts/activate 2>/dev/null

pip install --upgrade pip
pip install -r requirements.txt

echo "Backend dependencies installed."

# Copy env file
if [ ! -f ../.env ]; then
    cp ../.env.example ../.env
    echo "Created .env from .env.example"
fi

cd ..

# Frontend
echo ""
echo "--- Setting up Node frontend ---"
cd frontend
npm install
echo "Frontend dependencies installed."
cd ..

echo ""
echo "=== Setup complete! ==="
echo ""
echo "To start the platform:"
echo "  Terminal 1 (backend):  cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000"
echo "  Terminal 2 (frontend): cd frontend && npm run dev"
echo ""
echo "Or with Docker:"
echo "  docker-compose up --build"
echo ""
echo "Open http://localhost:5173 (dev) or http://localhost (Docker)"
