#!/usr/bin/env bash
# Antigravity Tokens HUD - macOS / Linux Installer
set -e

echo ""
echo "=========================================================="
echo "       🚀 Antigravity Tokens & Performance HUD [Installer]"
echo "=========================================================="
echo ""

# Check Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "❌ Error: Node.js is required but not found in PATH."
    echo "   Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

# Check Python
PYTHON_BIN=""
if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
else
    echo "❌ Error: Python 3 is required but not found in PATH."
    echo "   Please install Python 3.9+."
    exit 1
fi

echo "✅ Node.js: $(command -v node) ($(node -v))"
echo "✅ Python:  $(command -v $PYTHON_BIN) ($($PYTHON_BIN --version))"

TARGET_DIR="$HOME/.antigravity-tokens-hud"
mkdir -p "$TARGET_DIR"

SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
fi
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/index.js" ] && [ "$SCRIPT_DIR" != "$TARGET_DIR" ]; then
    echo "📦 Installing files from local repository to $TARGET_DIR..."
    cp -R "$SCRIPT_DIR"/* "$TARGET_DIR/" 2>/dev/null || true
elif [ "$SCRIPT_DIR" != "$TARGET_DIR" ]; then
    echo "🌐 Downloading latest release from GitHub..."
    REPO_RAW="https://raw.githubusercontent.com/malie2f/antigravity-tokens-hud/main"
    for file in index.js client_widget.js token_stats.py package.json config.json uninstall.sh; do
        curl -fsSL "$REPO_RAW/$file" -o "$TARGET_DIR/$file"
    done
fi

chmod +x "$TARGET_DIR/index.js" 2>/dev/null || true

# Stop existing daemon
pkill -f "antigravity-tokens-hud.*index.js" 2>/dev/null || true

# Configure Auto-start
OS_TYPE="$(uname -s)"
if [ "$OS_TYPE" = "Darwin" ]; then
    PLIST_DIR="$HOME/Library/LaunchAgents"
    PLIST_FILE="$PLIST_DIR/com.antigravity.tokens-hud.plist"
    mkdir -p "$PLIST_DIR"
    cat <<EOF > "$PLIST_FILE"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.antigravity.tokens-hud</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(command -v node)</string>
        <string>$TARGET_DIR/index.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/dev/null</string>
    <key>StandardErrorPath</key>
    <string>/dev/null</string>
</dict>
</plist>
EOF
    launchctl unload "$PLIST_FILE" 2>/dev/null || true
    launchctl load -w "$PLIST_FILE" 2>/dev/null || true
    echo "✅ Configured macOS LaunchAgent: $PLIST_FILE"
elif [ "$OS_TYPE" = "Linux" ]; then
    SYSTEMD_DIR="$HOME/.config/systemd/user"
    SERVICE_FILE="$SYSTEMD_DIR/antigravity-tokens-hud.service"
    mkdir -p "$SYSTEMD_DIR"
    cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=Antigravity Tokens HUD Daemon
After=network.target

[Service]
Type=simple
ExecStart=$(command -v node) $TARGET_DIR/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
    if command -v systemctl >/dev/null 2>&1; then
        systemctl --user daemon-reload 2>/dev/null || true
        systemctl --user enable --now antigravity-tokens-hud 2>/dev/null || true
        echo "✅ Configured Linux systemd service: $SERVICE_FILE"
    else
        nohup node "$TARGET_DIR/index.js" >/dev/null 2>&1 &
        echo "✅ Started background daemon via nohup."
    fi
fi

echo ""
echo "=========================================================="
echo "✨ Antigravity Tokens HUD successfully installed!"
echo "=========================================================="
echo "📌 Next Steps:"
echo "   1. Open Google Antigravity."
echo "   2. Check the bottom toolbar beside the model selector."
echo "   3. Click the widget to inspect real-time metrics & heatmap!"
echo ""
echo "🗑️ To uninstall anytime: bash $TARGET_DIR/uninstall.sh"
echo ""
