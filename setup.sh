#!/bin/bash
# Surtaal Phase 1 — Mac Setup Script
# Run this from the surtaal/ root directory

set -e
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Surtaal — Setting up your audio studio  ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Check Homebrew ──────────────────────────────────────────────────────────
if ! command -v brew &> /dev/null; then
  echo "❌ Homebrew not found. Install it first:"
  echo "   /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
  exit 1
fi
echo "✓ Homebrew found"

# ── ffmpeg ──────────────────────────────────────────────────────────────────
if ! command -v ffmpeg &> /dev/null; then
  echo "→ Installing ffmpeg..."
  brew install ffmpeg
else
  echo "✓ ffmpeg found"
fi

# ── rubberband (for pyrubberband) ────────────────────────────────────────────
if ! brew list rubberband &> /dev/null; then
  echo "→ Installing rubberband..."
  brew install rubberband
else
  echo "✓ rubberband found"
fi

# ── Python venv ──────────────────────────────────────────────────────────────
echo ""
echo "→ Setting up Python virtual environment..."
cd backend
if [ ! -d "venv" ]; then
  python3 -m venv venv
fi
source venv/bin/activate

echo "→ Upgrading pip..."
pip install --upgrade pip --quiet

echo "→ Installing Python dependencies (this may take 3–5 minutes)..."
pip install -r requirements.txt --quiet

echo ""
echo "→ Demucs models download on first stem-separation use."
echo "  If macOS SSL certificates are broken, run:"
echo "  source backend/venv/bin/activate && python -m pip install --upgrade certifi"

echo ""
echo "✓ Backend dependencies installed"
deactivate
cd ..

# ── Node.js / frontend ────────────────────────────────────────────────────────
if ! command -v node &> /dev/null; then
  echo "→ Installing Node.js..."
  brew install node
else
  echo "✓ Node.js found"
fi

echo "→ Installing frontend dependencies..."
cd frontend
npm install --silent
cd ..

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║        ✓ Setup complete!                  ║"
echo "║                                           ║"
echo "║  Run: ./start.sh                          ║"
echo "╚══════════════════════════════════════════╝"
echo ""
