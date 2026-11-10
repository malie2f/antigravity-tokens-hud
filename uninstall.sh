#!/usr/bin/env bash
# Antigravity Tokens HUD - macOS / Linux Uninstaller
set -e

echo "🛑 Uninstalling Antigravity Tokens HUD..."

pkill -f "antigravity-tokens-hud.*index.js" 2>/dev/null || true

OS_TYPE="$(uname -s)"
if [ "$OS_TYPE" = "Darwin" ]; then
    PLIST_FILE="$HOME/Library/LaunchAgents/com.antigravity.tokens-hud.plist"
    if [ -f "$PLIST_FILE" ]; then
        launchctl unload "$PLIST_FILE" 2>/dev/null || true
        rm -f "$PLIST_FILE"
        echo "✅ Removed macOS LaunchAgent."
    fi
elif [ "$OS_TYPE" = "Linux" ]; then
    SERVICE_FILE="$HOME/.config/systemd/user/antigravity-tokens-hud.service"
    if [ -f "$SERVICE_FILE" ]; then
        systemctl --user stop antigravity-tokens-hud 2>/dev/null || true
        systemctl --user disable antigravity-tokens-hud 2>/dev/null || true
        rm -f "$SERVICE_FILE"
        systemctl --user daemon-reload 2>/dev/null || true
        echo "✅ Removed Linux systemd service."
    fi
fi

TARGET_DIR="$HOME/.antigravity-tokens-hud"
if [ -d "$TARGET_DIR" ]; then
    rm -rf "$TARGET_DIR"
    echo "✅ Removed $TARGET_DIR."
fi

echo "✨ Antigravity Tokens HUD has been completely uninstalled."
