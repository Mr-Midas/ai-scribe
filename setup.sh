#!/bin/bash
# TherapyNote AI Scribe - Setup Script
# Checks for Ollama and the AI model, installs only what's missing.

set -e

OLLAMA_MODEL="phi3"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "==================================="
echo "  TherapyNote AI Scribe - Setup"
echo "==================================="
echo ""

# ── Step 1: Check for Ollama ─────────────────────────────────

echo "Checking for Ollama..."

if command -v ollama &> /dev/null; then
    echo -e "${GREEN}✓${NC} Ollama is installed ($(ollama --version 2>/dev/null || echo 'unknown version'))"
else
    echo -e "${YELLOW}!${NC} Ollama is not installed."

    # Detect OS and install
    OS="$(uname -s)"
    case "$OS" in
        Linux*)
            echo "  Installing Ollama for Linux..."
            curl -fsSL https://ollama.com/install.sh | sh
            ;;
        Darwin*)
            echo "  Installing Ollama for macOS..."
            if command -v brew &> /dev/null; then
                brew install ollama
            else
                echo -e "${RED}✗${NC} Homebrew not found. Please install Ollama manually:"
                echo "  https://ollama.com/download"
                echo ""
                echo "  Then re-run this script."
                exit 1
            fi
            ;;
        *)
            echo -e "${RED}✗${NC} Unsupported OS: $OS"
            echo "  Please install Ollama manually: https://ollama.com/download"
            exit 1
            ;;
    esac

    # Verify installation
    if command -v ollama &> /dev/null; then
        echo -e "${GREEN}✓${NC} Ollama installed successfully."
    else
        echo -e "${RED}✗${NC} Ollama installation failed. Please install manually:"
        echo "  https://ollama.com/download"
        exit 1
    fi
fi

echo ""

# ── Step 2: Check if Ollama server is running ────────────────

echo "Checking if Ollama server is running..."

if curl -s http://localhost:11434/api/tags &> /dev/null; then
    echo -e "${GREEN}✓${NC} Ollama server is running."
else
    echo -e "${YELLOW}!${NC} Ollama server is not running. Starting it..."
    ollama serve &> /dev/null &
    sleep 3

    if curl -s http://localhost:11434/api/tags &> /dev/null; then
        echo -e "${GREEN}✓${NC} Ollama server started."
    else
        echo -e "${YELLOW}!${NC} Could not auto-start Ollama server."
        echo "  You may need to run 'ollama serve' manually in another terminal."
    fi
fi

echo ""

# ── Step 3: Check for the AI model ───────────────────────────

echo "Checking for AI model ($OLLAMA_MODEL)..."

# Check if model is already pulled
if ollama list 2>/dev/null | grep -q "^$OLLAMA_MODEL"; then
    echo -e "${GREEN}✓${NC} Model '$OLLAMA_MODEL' is already downloaded."
else
    echo -e "${YELLOW}!${NC} Model '$OLLAMA_MODEL' is not downloaded."
    echo "  Downloading now (this may take a few minutes)..."
    echo ""

    if ollama pull "$OLLAMA_MODEL"; then
        echo ""
        echo -e "${GREEN}✓${NC} Model '$OLLAMA_MODEL' downloaded successfully."
    else
        echo ""
        echo -e "${RED}✗${NC} Failed to download model. Please run manually:"
        echo "  ollama pull $OLLAMA_MODEL"
        exit 1
    fi
fi

echo ""

# ── Step 4: Generate icons (if missing) ──────────────────────

echo "Checking extension icons..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$SCRIPT_DIR/icons/icon128.png" ]; then
    echo -e "${GREEN}✓${NC} Extension icons exist."
else
    echo -e "${YELLOW}!${NC} Extension icons missing. Generating..."
    if command -v python3 &> /dev/null; then
        (cd "$SCRIPT_DIR" && pip3 install Pillow -q 2>/dev/null && python3 generate_icons.py)
    elif command -v python &> /dev/null; then
        (cd "$SCRIPT_DIR" && pip install Pillow -q 2>/dev/null && python generate_icons.py)
    else
        echo -e "${RED}✗${NC} Python not found. Please install Python or run:"
        echo "  pip3 install Pillow && python3 generate_icons.py"
    fi
fi

echo ""

# ── Done ─────────────────────────────────────────────────────

echo "==================================="
echo -e "${GREEN}Setup complete!${NC}"
echo "==================================="
echo ""
echo "To use the extension:"
echo "  1. Open chrome://extensions in Chrome"
echo "  2. Enable Developer mode"
echo "  3. Click 'Load unpacked' and select this folder"
echo "  4. Pin the extension to your toolbar"
echo ""
echo "Tip: Use Ctrl+Enter (or Cmd+Enter on Mac) to generate notes."
echo ""
