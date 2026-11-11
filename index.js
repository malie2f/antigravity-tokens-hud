#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");

process.on("uncaughtException", (err) => {
  try {
    fs.appendFileSync(path.join(__dirname, "error.log"), `[Uncaught] ${err.stack}\n`);
  } catch (_) {}
});
process.on("unhandledRejection", (err) => {
  try {
    fs.appendFileSync(path.join(__dirname, "error.log"), `[Unhandled] ${err?.stack || err}\n`);
  } catch (_) {}
});

function getDevToolsFilePath() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library/Application Support/Antigravity/DevToolsActivePort");
  } else if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData/Roaming");
    return path.join(appData, "Antigravity/DevToolsActivePort");
  } else {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
    return path.join(configHome, "Antigravity/DevToolsActivePort");
  }
}

const DEVTOOLS_FILE = getDevToolsFilePath();
const CONVERSATIONS_DIR = path.join(os.homedir(), ".gemini/antigravity/conversations");
const TOKEN_STATS_SCRIPT = path.join(__dirname, "token_stats.py");
const CLIENT_SCRIPT_PATH = fs.existsSync(path.join(__dirname, "client_widget.js"))
  ? path.join(__dirname, "client_widget.js")
  : path.join(__dirname, "client_widget_injector.js");
const CONFIG_FILE = path.join(__dirname, "config.json");

const WSImpl = globalThis.WebSocket || (() => {
  try {
    return require("ws");
  } catch (_) {
    return null;
  }
})();

let cdpMessageId = 1;
function nextCdpId() {
  cdpMessageId = (cdpMessageId + 1) & 0x7fffffff;
  return cdpMessageId;
}

// Map of pageId -> { ws, injectedVersion, lastPushedSig, lastPingAt, checkId, pageId, url }
const activePages = new Map();
let currentPort = null;
let isUpdating = false;

let cachedClientScript = "";
let cachedScriptVersion = "";
let cachedStatsPayload = "";
let lastConvSig = "";

function getConversationsSignature() {
  try {
    if (!fs.existsSync(CONVERSATIONS_DIR)) return "empty";
    const files = fs.readdirSync(CONVERSATIONS_DIR);
    let count = 0;
    let maxMtime = 0;
    let totalSize = 0;
    for (const f of files) {
      if (f.endsWith(".db") || f.endsWith(".db-wal")) {
        try {
          const st = fs.statSync(path.join(CONVERSATIONS_DIR, f));
          count++;
          totalSize += st.size;
          if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
        } catch (_) {}
      }
    }
    const dayKey = new Date().toISOString().slice(0, 10);
    return `${dayKey}:${count}:${totalSize}:${Math.floor(maxMtime)}`;
  } catch (_) {
    return "";
  }
}

function loadClientScriptIfNeeded() {
  try {
    const st = fs.statSync(CLIENT_SCRIPT_PATH);
    const ver = `${st.mtimeMs}:${st.size}`;
    if (ver !== cachedScriptVersion) {
      cachedClientScript = fs.readFileSync(CLIENT_SCRIPT_PATH, "utf8");
      cachedScriptVersion = ver;
    }
  } catch (_) {}
  return { script: cachedClientScript, version: cachedScriptVersion };
}

function getConfigLang() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      if (cfg && cfg.lang) return cfg.lang;
    }
  } catch (_) {}
  return "zh";
}

function getDevToolsInfo() {
  if (!fs.existsSync(DEVTOOLS_FILE)) return null;
  try {
    const content = fs.readFileSync(DEVTOOLS_FILE, "utf8").trim().split("\n");
    if (content.length >= 1 && content[0]) {
      return { port: parseInt(content[0].trim(), 10) };
    }
  } catch (_) {}
  return null;
}

async function listAntigravityPages(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1500) });
    const list = await res.json();
    return list.filter(
      (p) =>
        p.type === "page" &&
        p.url &&
        !p.url.startsWith("data:") &&
        (p.url.includes("127.0.0.1") || p.url.includes("localhost") || p.url.includes("antigravity"))
    );
  } catch (_) {
    return [];
  }
}

function fetchTokenStats() {
  return new Promise((resolve) => {
    const pythonBin = process.platform === "win32" ? "python" : "python3";
    const env = { ...process.env };
    if (process.platform !== "win32") {
      env.PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", process.env.PATH || ""].join(":");
    }
    execFile(pythonBin, [TOKEN_STATS_SCRIPT, "--json"], { timeout: 10000, maxBuffer: 4 * 1024 * 1024, env }, (err, stdout) => {
      if (err || !stdout) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (_) {
        resolve(null);
      }
    });
  });
}

function connectPageWebSocket(page) {
  return new Promise((resolve) => {
    if (!WSImpl) {
      resolve(null);
      return;
    }
    let resolved = false;
    let ws = null;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          if (ws) ws.close();
        } catch (_) {}
        resolve(null);
      }
    }, 2000);

    try {
      ws = new WSImpl(page.webSocketDebuggerUrl);
      const entry = {
        ws,
        injectedVersion: null,
        lastPushedSig: null,
        lastPingAt: 0,
        checkId: null,
        pageId: page.id,
        url: page.url,
      };

      ws.onopen = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          activePages.set(page.id, entry);
          resolve(entry);
        }
      };

      ws.onmessage = (rawEvt) => {
        try {
          const rawStr = typeof rawEvt === "string" ? rawEvt : (rawEvt?.data ?? rawEvt?.toString?.() ?? "");
          const data = JSON.parse(rawStr);
          if (data.error) {
            const msgText = data.error.message || "";
            if (msgText.includes("execution context") || msgText.includes("detached") || msgText.includes("Target closed")) {
              entry.injectedVersion = null;
              entry.lastPushedSig = null;
              try {
                ws.close();
              } catch (_) {}
              activePages.delete(page.id);
            }
          } else if (data.id && data.id === entry.checkId) {
            // If fast push or liveness ping returned false (page reloaded and lost widget), re-inject next tick
            if (data.result?.result?.value === false) {
              entry.injectedVersion = null;
              entry.lastPushedSig = null;
            }
          }
        } catch (_) {}
      };

      ws.onerror = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(null);
        }
        activePages.delete(page.id);
      };

      ws.onclose = () => {
        activePages.delete(page.id);
      };
    } catch (_) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(null);
      }
    }
  });
}

async function updateLoop() {
  if (isUpdating) return;
  isUpdating = true;

  try {
    const info = getDevToolsInfo();
    if (!info) {
      for (const [, entry] of activePages) {
        try {
          entry.ws.close();
        } catch (_) {}
      }
      activePages.clear();
      return;
    }

    if (currentPort !== info.port) {
      currentPort = info.port;
      for (const [, entry] of activePages) {
        try {
          entry.ws.close();
        } catch (_) {}
      }
      activePages.clear();
    }

    const pages = await listAntigravityPages(currentPort);
    const currentPageIds = new Set(pages.map((p) => p.id));

    for (const [id, entry] of activePages) {
      if (!currentPageIds.has(id)) {
        try {
          entry.ws.close();
        } catch (_) {}
        activePages.delete(id);
      }
    }

    const wsOpenConst = WSImpl?.OPEN ?? 1;
    for (const page of pages) {
      const existing = activePages.get(page.id);
      if (!existing || existing.ws.readyState !== wsOpenConst) {
        if (existing) {
          try {
            existing.ws.close();
          } catch (_) {}
          activePages.delete(page.id);
        }
        await connectPageWebSocket(page);
      }
    }

    if (activePages.size === 0) return;

    // Only spawn python token_stats.py when local SQLite/WAL files actually changed!
    const currentSig = getConversationsSignature();
    if (!cachedStatsPayload || (currentSig && currentSig !== lastConvSig)) {
      const stats = await fetchTokenStats();
      if (stats) {
        cachedStatsPayload = JSON.stringify(stats);
        lastConvSig = currentSig;
      }
    }
    if (!cachedStatsPayload) return;

    const { script: clientScript, version: scriptVersion } = loadClientScriptIfNeeded();
    if (!clientScript) return;

    const lang = getConfigLang();
    const now = Date.now();

    for (const [, entry] of activePages) {
      if (entry.ws.readyState !== wsOpenConst) continue;

      let expression = "";
      let isCheck = false;

      if (entry.injectedVersion !== scriptVersion) {
        // Full install / hot-upgrade of widget script
        expression = `
          window.__AGY_LANG__ = ${JSON.stringify(lang)};
          window.__AGY_DATA__ = ${cachedStatsPayload};
          window.__AGY_HUD_VERSION__ = ${JSON.stringify(scriptVersion)};
          ${clientScript}
          true;
        `;
        entry.injectedVersion = scriptVersion;
        entry.lastPushedSig = lastConvSig;
        entry.lastPingAt = now;
      } else if (entry.lastPushedSig !== lastConvSig) {
        // Data changed on disk -> lightweight in-place data push
        expression = `
          (window.__AGY_HUD_VERSION__ === ${JSON.stringify(scriptVersion)} && typeof window.__AGY_HUD_PUSH__ === "function")
            ? (window.__AGY_HUD_PUSH__(${cachedStatsPayload}), true)
            : false
        `;
        entry.lastPushedSig = lastConvSig;
        entry.lastPingAt = now;
        isCheck = true;
      } else if (now - entry.lastPingAt >= 10000) {
        // Idle liveness ping once every 10s (tiny 1-line check in case webview reloaded)
        expression = `
          window.__AGY_HUD_VERSION__ === ${JSON.stringify(scriptVersion)} &&
          typeof window.__AGY_HUD_PUSH__ === "function" &&
          (!!document.getElementById("antigravity-token-btn") || (window.__AGY_RENDER__ && (window.__AGY_RENDER__(), true)))
        `;
        entry.lastPingAt = now;
        isCheck = true;
      } else {
        continue;
      }

      const msgId = nextCdpId();
      entry.checkId = isCheck ? msgId : null;

      entry.ws.send(
        JSON.stringify({
          id: msgId,
          method: "Runtime.evaluate",
          params: {
            expression,
            returnByValue: true,
          },
        })
      );
    }
  } catch (_) {
    // Non-fatal, retry next tick
  } finally {
    isUpdating = false;
  }
}

console.log("[Antigravity Tokens HUD] Daemon running. Monitoring Antigravity DevTools...");
setInterval(updateLoop, 2000);
updateLoop();
