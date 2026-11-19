(() => {
  // Antigravity Tokens HUD Client Widget
  // Designed to match Antigravity native Onyx UI theme & Google Sans aesthetics

  let isPopoverOpen = false;
  let activeActivityTab = "daily"; // "daily" | "weekly" | "total"
  let activeUsageTab = "5h"; // "5h" | "7d" | "hist"
  let currentMetrics = window.__AGY_DATA__ || null;

  // Clean up any legacy global quota state from older versions
  try {
    delete window.__AGY_QUOTA_STATE__;
  } catch (_) {}

  function getDefaultMaxContext() {
    try {
      const trigger = document.querySelector('button[data-testid="model-selector-trigger"]');
      const txt = (trigger?.textContent || "").toLowerCase();
      if (txt.includes("claude")) {
        return txt.includes("5.5") || txt.includes("opus 5") ? 840000 : 160000;
      }
      if (txt.includes("gpt")) return 80000;
      if (txt.includes("3.1") || txt.includes("lite")) return 128000;
      if (txt.includes("argon-d")) return 512000;
    } catch (_) {}
    return 256000;
  }

  function getActiveConvId() {
    try {
      if (window.__TSR_ROUTER__?.state) {
        const matches = window.__TSR_ROUTER__.state.matches || [];
        for (let i = matches.length - 1; i >= 0; i--) {
          const params = matches[i]?.params;
          if (params?.newCascadeId) return params.newCascadeId;
          if (params?.cascadeId) return params.cascadeId;
        }
        const rPath = window.__TSR_ROUTER__.state.location?.pathname || "";
        const rParts = rPath.split("/");
        const rIdx = rParts.indexOf("c");
        if (rIdx !== -1 && rParts[rIdx + 1]) return rParts[rIdx + 1];

        if (rPath.includes("/view/")) {
          const viewChat = document.querySelector('[data-testid="conversation-view"][data-cascade-id]');
          if (viewChat) return viewChat.getAttribute("data-cascade-id") || null;
        }

        // On New Chat ("/") or non-conversation routes, strictly return null (never sidebar rows!)
        return null;
      }

      const parts = window.location.pathname.split("/");
      const idx = parts.indexOf("c");
      if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];

      const mainChat = document.querySelector('[data-testid="conversation-view"][data-cascade-id]') ||
        document.querySelector('div:not([data-testid="conversation-row-sidebar"])[data-cascade-id]');
      if (mainChat) {
        return mainChat.getAttribute("data-cascade-id") || null;
      }

      const selRow = document.querySelector('[data-testid="conversation-row-sidebar"][data-selected="true"][data-cascade-id]');
      if (selRow) {
        return selRow.getAttribute("data-cascade-id") || null;
      }
    } catch (_) {}
    return null;
  }

  function fmtTok(n, isZh = true) {
    if (!n || n <= 0) return "0";
    if (isZh) {
      if (n >= 100000000) return (n / 100000000).toFixed(2).replace(/\.00$/, "").replace(/(\.[1-9])0$/, "$1") + "亿";
      if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + "万";
      if (n >= 1000) return (n / 1000).toFixed(1) + "k";
      return n + "";
    } else {
      if (n >= 1000000000) return (n / 1000000000).toFixed(2) + "B";
      if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
      if (n >= 1000) return Math.round(n / 1000) + "k";
      return n + "";
    }
  }

  function fmtContextNum(n) {
    if (!n || n <= 0) return "0";
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return n + "";
  }

  function fmtMaxContext(n) {
    if (!n || n <= 0) return "256k";
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return n + "";
  }

  function isLightTheme() {
    try {
      const body = document.body;
      const html = document.documentElement;
      if (
        body?.classList?.contains("theme-light") ||
        body?.classList?.contains("light-theme") ||
        body?.classList?.contains("vscode-light") ||
        html?.classList?.contains("theme-light") ||
        html?.classList?.contains("vscode-light")
      ) {
        return true;
      }
      if (
        body?.classList?.contains("dark") ||
        body?.classList?.contains("theme-dark") ||
        body?.classList?.contains("dark-theme") ||
        body?.classList?.contains("vscode-dark")
      ) {
        return false;
      }
      if (html?.style?.colorScheme === "light") return true;
      if (html?.style?.colorScheme === "dark") return false;
      const bg = getComputedStyle(body || html).backgroundColor || "";
      const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) {
        const lum = 0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3];
        return lum > 140;
      }
    } catch (_) {}
    return false;
  }

  function getThemePalette() {
    if (isLightTheme()) {
      return {
        isLight: true,
        key: "light",
        btnText: "#3f3f46",
        btnHoverBg: "rgba(10, 10, 12, 0.06)",
        btnOpenBg: "rgba(10, 10, 12, 0.09)",
        btnActiveText: "#0a0a0c",
        btnCtxText: "#3f3f46",
        chevron: "#71717a",
        accent: "#2f75c3",
        green: "#16a34a",
        greenBg: "rgba(22, 163, 74, 0.11)",
        amber: "#d97706",
        amberBg: "rgba(217, 119, 6, 0.12)",
        red: "#dc2626",
        ringTrack: "rgba(10, 10, 12, 0.13)",
        popBg: "rgba(255, 255, 255, 0.97)",
        popBorder: "rgba(10, 10, 12, 0.10)",
        popShadow: "0 14px 34px -8px rgba(10, 10, 12, 0.16), 0 2px 8px rgba(10, 10, 12, 0.06)",
        title: "#0a0a0c",
        text: "#18181b",
        textSub: "#3f3f46",
        textMuted: "#52525b",
        textDim: "#71717a",
        slash: "#a1a1aa",
        divider: "rgba(10, 10, 12, 0.08)",
        heatEmpty: "#ebedf0",
        heatFuture: "rgba(10, 10, 12, 0.03)",
        heatLevels: ["#d2e3fc", "#8ab4f8", "#1a73e8", "#174ea6"],
        barEmpty: "#ebedf0",
        barFill: "#2f75c3",
        barHover: "#1a73e8",
        tipBg: "#ffffff",
        tipColor: "#0a0a0c",
        tipBorder: "rgba(10, 10, 12, 0.12)",
        tipShadow: "0 4px 12px rgba(10, 10, 12, 0.14)",
      };
    }
    return {
      isLight: false,
      key: "dark",
      btnText: "rgb(188, 189, 198)",
      btnHoverBg: "rgba(255, 255, 255, 0.08)",
      btnOpenBg: "rgba(255, 255, 255, 0.1)",
      btnActiveText: "#ffffff",
      btnCtxText: "#e3e3e3",
      chevron: "#9aa0a6",
      accent: "#8ab4f8",
      green: "#4ade80",
      greenBg: "rgba(74, 222, 128, 0.12)",
      amber: "#fbbf24",
      amberBg: "rgba(251, 191, 36, 0.14)",
      red: "#f87171",
      ringTrack: "rgba(255, 255, 255, 0.14)",
      popBg: "#19191d",
      popBorder: "rgba(255, 255, 255, 0.1)",
      popShadow: "0 16px 40px rgba(0, 0, 0, 0.7), 0 2px 8px rgba(0, 0, 0, 0.4)",
      title: "#ffffff",
      text: "#e3e3e3",
      textSub: "#bcbdc6",
      textMuted: "#9aa0a6",
      textDim: "#80868b",
      slash: "#5f6368",
      divider: "rgba(255, 255, 255, 0.08)",
      heatEmpty: "#26262a",
      heatFuture: "rgba(255, 255, 255, 0.03)",
      heatLevels: ["#174ea6", "#1a73e8", "#8ab4f8", "#c2e7ff"],
      barEmpty: "#26262a",
      barFill: "#1a73e8",
      barHover: "#8ab4f8",
      tipBg: "#2b2b2f",
      tipColor: "#ffffff",
      tipBorder: "rgba(255, 255, 255, 0.12)",
      tipShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
    };
  }

  function getContextColor(pct, T = getThemePalette()) {
    if (pct >= 85) return T.red;
    if (pct >= 60) return T.amber;
    return T.green;
  }

  function renderCircleRing(pct, size = 14, radius = 5.2, strokeWidth = 1.9, T = getThemePalette()) {
    const safePct = Number.isFinite(pct) ? pct : 0;
    const visualPct = safePct <= 0 ? 0 : Math.min(100, Math.max(3, safePct));
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (visualPct / 100) * circumference;
    const strokeColor = getContextColor(safePct, T);
    return `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform: rotate(-90deg); flex-shrink: 0; display: block;">
        <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="${T.ringTrack}" stroke-width="${strokeWidth}" />
        ${visualPct > 0 ? `<circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}"
          stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round" />` : ""}
      </svg>
    `;
  }

  function getEffectiveSession(data) {
    const emptySession = {
      context_size: 0,
      max_context: getDefaultMaxContext(),
      context_percent: 0,
      cache_hit_percent: 0,
      session_cache_hit_percent: 0,
      speed_tps: 0,
      avg_tps: 0,
      peak_tps: 0,
      duration_s: 0,
      ttft_s: 0,
      stream_s: 0,
      output_tokens: 0,
      total_turns: 0,
      is_empty_active: true,
    };
    if (!data) return emptySession;
    const activeId = getActiveConvId();
    // Strict session isolation: New Chat (activeId === null) or 0-turn chat MUST reset to 0!
    if (!activeId) return emptySession;
    if (data.sessions && data.sessions[activeId] && (data.sessions[activeId].total_turns || 0) > 0) {
      return data.sessions[activeId];
    }
    return emptySession;
  }

  function getHeatmapColor(tokens, T = getThemePalette()) {
    if (!tokens || tokens <= 0) return T.heatEmpty;
    if (tokens < 500000) return T.heatLevels[0];
    if (tokens < 5000000) return T.heatLevels[1];
    if (tokens < 20000000) return T.heatLevels[2];
    return T.heatLevels[3];
  }

  // Generate Activity Section HTML (Compact, dense, Antigravity native look)
  function renderActivityContent(data, T = getThemePalette()) {
    const act = data?.activity || {};
    const daily = act.daily || [];
    const months = act.months || [];
    const weekly = act.weekly || [];
    const uHist = data?.usage_historical || {};

    if (activeActivityTab === "weekly") {
      const maxWeekly = Math.max(...weekly.map(w => w.tokens || 0), 1);
      return `
        <div style="display: flex; align-items: flex-end; justify-content: space-between; height: 95px; padding: 10px 4px 2px 4px; gap: 4px;">
          ${weekly.map(w => {
            const h = Math.max(4, Math.round(((w.tokens || 0) / maxWeekly) * 65));
            const tokStr = fmtTok(w.tokens || 0);
            const barColor = w.tokens > 0 ? T.barFill : T.barEmpty;
            return `
              <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end;"
                   title="${w.range}: ${tokStr} Token (${w.requests || 0}次)">
                <div style="width: 100%; max-width: 18px; height: ${h}px; background: ${barColor}; border-radius: 2px 2px 0 0; transition: background 0.15s ease;"
                     onmouseenter="this.style.background='${w.tokens > 0 ? T.barHover : T.barEmpty}'" onmouseleave="this.style.background='${barColor}'"></div>
                <span style="font-size: 9.5px; color: ${T.textDim}; white-space: nowrap;">${w.label}</span>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }

    if (activeActivityTab === "total") {
      return `
        <div style="padding: 6px 2px; font-size: 12px; color: ${T.textSub};">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px;">
            <div style="display: flex; justify-content: space-between;">
              <span>提示词输入</span>
              <span style="color: ${T.text}; font-weight: 500;">${fmtTok(uHist.input_tokens || 0)}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>生成输出</span>
              <span style="color: ${T.text}; font-weight: 500;">${fmtTok(uHist.output_tokens || 0)}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>深度思考</span>
              <span style="color: ${T.text}; font-weight: 500;">${fmtTok(uHist.thinking_tokens || 0)}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>上下文缓存</span>
              <span style="color: ${T.text}; font-weight: 500;">${fmtTok(uHist.cached_tokens || 0)}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>历史总会话</span>
              <span style="color: ${T.text}; font-weight: 500;">${uHist.total_sessions || 0} 个</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>缓存总命中率</span>
              <span style="color: ${T.green}; font-weight: 500;">${(uHist.cache_hit_percent || 0).toFixed(1)}%</span>
            </div>
          </div>
          <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed ${T.divider}; display: flex; justify-content: space-between; font-weight: 600;">
            <span style="color: ${T.title};">累计总吞吐量</span>
            <span style="color: ${T.accent}; font-size: 13px;">${fmtTok(uHist.total_tokens || 0)} Token</span>
          </div>
        </div>
      `;
    }

    // Default: Daily GitHub-Style Heat Matrix (High Density, Native Compact Spacing!)
    const numCols = act.num_weeks || 25;
    const cellsByCol = [];
    for (let c = 0; c < numCols; c++) {
      cellsByCol.push([]);
    }
    for (const cell of daily) {
      if (cell.col >= 0 && cell.col < numCols) {
        cellsByCol[cell.col][cell.row] = cell;
      }
    }

    return `
      <div style="position: relative; padding: 2px 0 0 0;">
        <!-- High-Density Heatmap Grid (Tight 2.5px Gap, Crisp Matrix) -->
        <div style="display: grid; grid-template-columns: repeat(${numCols}, 1fr); gap: 2.5px;">
          ${cellsByCol.map((colCells) => `
            <div style="display: flex; flex-direction: column; gap: 2.5px;">
              ${colCells.map(cell => {
                if (!cell) return `<div style="aspect-ratio: 1;"></div>`;
                const bg = cell.future ? T.heatFuture : getHeatmapColor(cell.tokens, T);
                const tip = cell.future
                  ? ""
                  : (cell.tokens > 0 ? `${cell.label}\\n${fmtTok(cell.tokens)} 个 Token` : `${cell.label}\\n无活动`);
                return `
                  <div class="agy-heat-cell"
                       data-tip="${tip}"
                       style="aspect-ratio: 1; border-radius: 2px; background: ${bg}; cursor: ${cell.future ? 'default' : 'pointer'}; transition: transform 0.1s ease;"
                       onmouseenter="window.__AGY_SHOW_TOOLTIP__(this, event)"
                       onmouseleave="window.__AGY_HIDE_TOOLTIP__()"></div>
                `;
              }).join("")}
            </div>
          `).join("")}
        </div>

        <!-- Month Labels -->
        <div style="display: flex; margin-top: 6px; font-size: 9.5px; color: ${T.textDim}; position: relative; height: 14px;">
          ${months.map(m => {
            const leftPct = ((m.col) / numCols) * 100;
            return `<span style="position: absolute; left: ${leftPct}%; transform: translateX(-2px);">${m.label}</span>`;
          }).join("")}
        </div>
      </div>
    `;
  }

  // Floating Tooltip for Heatmap
  window.__AGY_SHOW_TOOLTIP__ = (el, e) => {
    const tip = el.getAttribute("data-tip");
    if (!tip) return;
    const T = getThemePalette();
    let tipEl = document.getElementById("agy-heatmap-tooltip");
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.id = "agy-heatmap-tooltip";
      tipEl.style.cssText = [
        "position: fixed",
        "pointer-events: none",
        "z-index: 1000000",
        "padding: 5px 8px",
        "border-radius: 6px",
        "font-size: 11px",
        "font-family: inherit",
        "white-space: pre-line",
        "text-align: center",
        "line-height: 1.35",
        "transform: translate(-50%, -100%)",
        "margin-top: -6px"
      ].join("; ");
      document.body.appendChild(tipEl);
    }
    tipEl.style.background = T.tipBg;
    tipEl.style.color = T.tipColor;
    tipEl.style.border = `1px solid ${T.tipBorder}`;
    tipEl.style.boxShadow = T.tipShadow;
    tipEl.textContent = tip.replace(/\\n/g, "\n");
    const rect = el.getBoundingClientRect();
    tipEl.style.left = `${rect.left + rect.width / 2}px`;
    tipEl.style.top = `${rect.top}px`;
    tipEl.style.display = "block";
  };

  window.__AGY_HIDE_TOOLTIP__ = () => {
    const tipEl = document.getElementById("agy-heatmap-tooltip");
    if (tipEl) tipEl.style.display = "none";
  };

  window.__AGY_SWITCH_TAB__ = (tab) => {
    activeActivityTab = tab;
    const T = getThemePalette();
    const container = document.getElementById("agy-activity-tab-content");
    if (container && currentMetrics) {
      container.innerHTML = renderActivityContent(currentMetrics, T);
    }
    const tabDaily = document.getElementById("agy-tab-daily");
    const tabWeekly = document.getElementById("agy-tab-weekly");
    const tabTotal = document.getElementById("agy-tab-total");
    if (tabDaily && tabWeekly && tabTotal) {
      tabDaily.style.color = tab === "daily" ? T.title : T.textDim;
      tabDaily.style.fontWeight = tab === "daily" ? "600" : "normal";
      tabWeekly.style.color = tab === "weekly" ? T.title : T.textDim;
      tabWeekly.style.fontWeight = tab === "weekly" ? "600" : "normal";
      tabTotal.style.color = tab === "total" ? T.title : T.textDim;
      tabTotal.style.fontWeight = tab === "total" ? "600" : "normal";
    }
  };

  function getModelDotColor(family, T) {
    if (family === "pro") return T.accent;
    if (family === "flash") return T.green;
    if (family === "claude") return T.amber;
    return T.textMuted;
  }

  function renderUsageContent(data, T = getThemePalette()) {
    const win = activeUsageTab === "7d"
      ? (data?.usage_weekly || {})
      : (activeUsageTab === "hist" ? (data?.usage_historical || {}) : (data?.usage_5h || {}));
    const models = Array.isArray(win.by_model) ? win.by_model : [];

    if (!win.total_requests || models.length === 0) {
      return `
        <div style="padding: 10px 0; text-align: center; font-size: 11.5px; color: ${T.textDim};">
          该时间窗口内暂无模型调用记录
        </div>
      `;
    }

    const totalRightSuffix = activeUsageTab === "hist"
      ? `(${win.total_sessions || 0}会话)`
      : `(${win.total_requests || 0}次)`;

    return `
      <div style="display: flex; justify-content: flex-end; font-size: 10px; color: ${T.textDim}; margin-bottom: 6px;">
        <span>新增 / 总吞吐 (命中率)</span>
      </div>
      <div style="max-height: 175px; overflow-y: auto; padding-right: 2px; display: flex; flex-direction: column; gap: 5px;">
        ${models.map(m => {
          const dotColor = getModelDotColor(m.family, T);
          return `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11.5px;">
              <span style="display: inline-flex; align-items: center; gap: 5px; color: ${T.textSub}; min-width: 0; max-width: 146px;" title="${m.label}">
                <span style="width: 5.5px; height: 5.5px; border-radius: 50%; background: ${dotColor}; flex-shrink: 0;"></span>
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${m.label}</span>
              </span>
              <span style="color: ${T.text}; font-weight: 500; white-space: nowrap;">
                <span style="color: ${dotColor};">${fmtTok(m.new_tokens || 0)}</span>
                <span style="color: ${T.slash}; margin: 0 2px;">/</span>
                <span>${fmtTok(m.total_tokens || 0)}</span>
                <span style="color: ${T.green}; font-size: 10px; margin-left: 3px;">(${(m.cache_hit_percent || 0).toFixed(0)}%)</span>
                <span style="color: ${T.textMuted}; font-size: 10px; margin-left: 2px;">(${m.total_requests || 0}次)</span>
              </span>
            </div>
          `;
        }).join("")}
      </div>
      <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed ${T.divider}; display: flex; justify-content: space-between; align-items: center; font-size: 11.5px;">
        <span style="color: ${T.textMuted};">合计</span>
        <span style="color: ${T.text}; font-weight: 500;">
          <span style="color: ${T.accent};">${fmtTok(win.new_tokens || 0)}</span>
          <span style="color: ${T.slash}; margin: 0 2px;">/</span>
          <span>${fmtTok(win.total_tokens || 0)}</span>
          <span style="color: ${T.green}; font-size: 10px; margin-left: 3px;">(${(win.cache_hit_percent || 0).toFixed(0)}%)</span>
          <span style="color: ${T.textMuted}; font-size: 10px; margin-left: 2px;">${totalRightSuffix}</span>
        </span>
      </div>
    `;
  }

  window.__AGY_SWITCH_USAGE_TAB__ = (tab) => {
    activeUsageTab = tab;
    const T = getThemePalette();
    const container = document.getElementById("agy-usage-tab-content");
    if (container && currentMetrics) {
      container.innerHTML = renderUsageContent(currentMetrics, T);
    }
    const tab5h = document.getElementById("agy-utab-5h");
    const tab7d = document.getElementById("agy-utab-7d");
    const tabHist = document.getElementById("agy-utab-hist");
    if (tab5h && tab7d && tabHist) {
      tab5h.style.color = tab === "5h" ? T.title : T.textDim;
      tab5h.style.fontWeight = tab === "5h" ? "600" : "normal";
      tab7d.style.color = tab === "7d" ? T.title : T.textDim;
      tab7d.style.fontWeight = tab === "7d" ? "600" : "normal";
      tabHist.style.color = tab === "hist" ? T.title : T.textDim;
      tabHist.style.fontWeight = tab === "hist" ? "600" : "normal";
    }
  };

  window.__AGY_CLOSE_POPOVER__ = () => {
    isPopoverOpen = false;
    window.__AGY_HIDE_TOOLTIP__();
    const T = getThemePalette();
    const popover = document.getElementById("antigravity-token-popover");
    if (popover) popover.style.display = "none";
    const btn = document.getElementById("antigravity-token-btn");
    if (btn) {
      btn.style.background = "transparent";
      btn.style.color = T.btnText;
      const chev = document.getElementById("agy-btn-chevron");
      if (chev) chev.style.transform = "rotate(0deg)";
    }
  };

  // Main UI Renderer (100% pure local DOM rendering, zero internal RPCs)
  window.__AGY_RENDER__ = function() {
    const data = currentMetrics || window.__AGY_DATA__;
    if (!data) return;
    currentMetrics = data;

    // Clean up any legacy pills/widgets
    document.getElementById("antigravity-token-widget")?.remove();
    const oldPill = document.getElementById("antigravity-token-pill");
    if (oldPill) oldPill.remove();

    // Target the model selector trigger button in the bottom toolbar
    const modelTrigger = document.querySelector('button[data-testid="model-selector-trigger"]') ||
      Array.from(document.querySelectorAll("button")).find(b =>
        b.getAttribute("aria-label")?.includes("选择模型") ||
        b.getAttribute("aria-label")?.includes("Select model") ||
        (b.textContent && (b.textContent.includes("Gemini") || b.textContent.includes("Flash") || b.textContent.includes("Pro") || b.textContent.includes("Argon")))
      );
    if (!modelTrigger) return;

    const modelWrapper = modelTrigger.closest(".no-focus-agent-input") || modelTrigger.parentElement;
    if (!modelWrapper || !modelWrapper.parentElement) return;

    // Session Metrics & Active Theme Palette
    const T = getThemePalette();
    const session = getEffectiveSession(data);
    const pct = (session.context_percent != null) ? session.context_percent : 0.0;
    const ctxColor = getContextColor(pct, T);
    const ctxK = fmtContextNum(session.context_size || 0);
    const maxK = fmtMaxContext(session.max_context || 256000);
    const compactCount = session.compaction_count || 0;
    const cacheHitPct = (session.cache_hit_percent != null) ? session.cache_hit_percent : 0.0;
    const sessCacheHitPct = (session.session_cache_hit_percent != null) ? session.session_cache_hit_percent : cacheHitPct;

    // Speed metrics strictly scoped to this conversation ONLY (never leak another session's speed!)
    const tps = session.speed_tps || 0;
    const avgTps = session.avg_tps || 0;
    const peakTps = session.peak_tps || 0;
    const dur = session.duration_s || 0;
    const ttft = session.ttft_s || 0;
    const sdur = session.stream_s || 0;
    const outTok = session.output_tokens || 0;
    const totalTurns = session.total_turns || 0;

    // Native Toolbar Button (Flush ghost button, auto-adapts to Onyx Light & Dark)
    let btn = document.getElementById("antigravity-token-btn");
    if (!btn) {
      btn = document.createElement("div");
      btn.id = "antigravity-token-btn";
      btn.style.cssText = [
        "position: relative",
        "display: inline-flex",
        "align-items: center",
        "gap: 6px",
        "height: 28px",
        "padding: 0 8px",
        "margin-left: 2px",
        "border-radius: 6px",
        "background: transparent",
        "border: none",
        `color: ${T.btnText}`,
        "font-family: 'Google Sans Flex', 'Google Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        "font-size: 12px",
        "line-height: 1",
        "cursor: pointer",
        "transition: background-color 0.15s ease, color 0.15s ease",
        "user-select: none",
        "white-space: nowrap"
      ].join("; ");

      modelWrapper.insertAdjacentElement("afterend", btn);
    } else if (btn.parentElement !== modelWrapper.parentElement || btn.previousElementSibling !== modelWrapper) {
      modelWrapper.insertAdjacentElement("afterend", btn);
    }

    btn.dataset.agyTheme = T.key;
    btn.style.color = isPopoverOpen ? T.btnActiveText : T.btnText;
    btn.style.background = isPopoverOpen ? T.btnOpenBg : "transparent";

    btn.onmouseenter = () => {
      if (!isPopoverOpen) {
        const curT = getThemePalette();
        btn.style.background = curT.btnHoverBg;
        btn.style.color = curT.btnActiveText;
      }
    };
    btn.onmouseleave = () => {
      if (!isPopoverOpen) {
        const curT = getThemePalette();
        btn.style.background = "transparent";
        btn.style.color = curT.btnText;
      }
    };

    btn.onclick = (e) => {
      e.stopPropagation();
      isPopoverOpen = !isPopoverOpen;
      renderPopover();
    };

    // Display primary speed: recent real speed, session avg speed, or 0.0 tok/s on new/empty session
    const displaySpeed = tps > 0 ? `${tps} tok/s` : (avgTps > 0 ? `${avgTps} tok/s` : "0.0 tok/s");

    btn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="color: ${T.accent}; flex-shrink: 0;">
        <path d="M7 2v11h3v9l7-12h-4l4-8z"/>
      </svg>
      <span id="agy-btn-speed" style="font-weight: 500; color: ${T.accent}; letter-spacing: -0.1px;">${displaySpeed}</span>
      <span id="agy-btn-ctx" style="display: inline-flex; align-items: center; gap: 4px; color: ${T.btnCtxText}; font-weight: 500; margin-left: 3px;">
        <span id="agy-btn-ctx-num">${ctxK}/${maxK}</span>
        <span id="agy-btn-ctx-pct" style="color: ${ctxColor}; font-weight: 600;">${pct.toFixed(1)}%</span>
        <span id="agy-btn-ring" style="display: inline-flex; align-items: center; margin-left: 1px;">${renderCircleRing(pct, 14, 5.2, 1.9, T)}</span>
      </span>
      <svg id="agy-btn-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color: ${T.chevron}; margin-left: 1px; transition: transform 0.2s ease; transform: ${isPopoverOpen ? 'rotate(180deg)' : 'rotate(0deg)'};">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
      <div id="antigravity-token-popover"></div>
    `;

    renderPopover();

    function renderPopover() {
      const PT = getThemePalette();
      const popover = document.getElementById("antigravity-token-popover");
      if (!popover) return;

      const chev = document.getElementById("agy-btn-chevron");
      if (chev) chev.style.transform = isPopoverOpen ? "rotate(180deg)" : "rotate(0deg)";

      if (!isPopoverOpen) {
        popover.style.display = "none";
        btn.style.background = "transparent";
        btn.style.color = PT.btnText;
        window.__AGY_HIDE_TOOLTIP__();
        return;
      }

      btn.style.background = PT.btnOpenBg;
      btn.style.color = PT.btnActiveText;

      popover.style.cssText = [
        "display: block",
        "position: absolute",
        "bottom: 34px",
        "left: 0",
        "width: 360px",
        "padding: 16px",
        `background: ${PT.popBg}`,
        `border: 1px solid ${PT.popBorder}`,
        "border-radius: 12px",
        `box-shadow: ${PT.popShadow}`,
        `color: ${PT.text}`,
        "font-family: 'Google Sans Flex', 'Google Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        "z-index: 99999",
        "cursor: default",
        "backdrop-filter: blur(20px)"
      ].join("; ");

      popover.onclick = (e) => e.stopPropagation();

      popover.innerHTML = `
        <!-- Header -->
        <div style="font-size: 11.5px; color: ${PT.textMuted}; margin-bottom: 12px; font-weight: 500; display: flex; justify-content: space-between; align-items: center;">
          <span>用量与性能</span>
          <span style="font-size: 10.5px; color: ${PT.textDim}; cursor: pointer; padding: 2px 5px; border-radius: 4px; transition: color 0.15s ease;"
                onmouseenter="this.style.color='${PT.title}'" onmouseleave="this.style.color='${PT.textDim}'"
                onclick="window.__AGY_CLOSE_POPOVER__()">✕ 关闭</span>
        </div>

        <!-- Section 1: 实时性能 (Accurate Speed, Context Ring & Cache Hit Rate) -->
        <div style="margin-bottom: 14px;">
          <div style="font-size: 13.5px; font-weight: 600; color: ${PT.title}; margin-bottom: 9px; letter-spacing: -0.2px;">实时性能</div>
          
          <!-- Recent Turn Speed -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 7px;">
            <div>
              <div style="font-size: 12.5px; color: ${PT.textSub};">生成速度</div>
              <div id="agy-pop-dur" style="font-size: 10.5px; color: ${PT.textDim}; margin-top: 1px;">
                ${dur > 0 ? `最近: ${outTok} tok · ${dur}s (首字 ${ttft}s · 流式 ${sdur}s)` : "暂无生成记录"}
              </div>
            </div>
            <div style="text-align: right;">
              <span id="agy-pop-speed" style="font-size: 13px; font-weight: 600; color: ${PT.accent};">${tps > 0 ? `${tps} tok/s` : "0.0 tok/s"}</span>
            </div>
          </div>

          <!-- Session Average Speed -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 7px;">
            <span style="font-size: 12px; color: ${PT.textMuted};">会话平均速度</span>
            <div style="text-align: right;">
              <span id="agy-pop-avg-speed" style="font-size: 12.5px; font-weight: 500; color: ${PT.text};">${avgTps > 0 ? `${avgTps} tok/s` : "0.0 tok/s"}</span>
              <span id="agy-pop-avg-sub" style="font-size: 10px; color: ${PT.textDim}; margin-left: 4px;">(${totalTurns}轮 · 峰值 ${peakTps > 0 ? peakTps : "0.0"})</span>
            </div>
          </div>

          <!-- Context Window Usage (Auto-Compaction Threshold): 已用/压缩阈值 百分之 + 进度圆圈 -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 7px;">
            <div style="display: flex; align-items: center; gap: 5px;">
              <span style="font-size: 12.5px; color: ${PT.textSub};">当前上下文 (压缩阈值)</span>
              <span id="agy-pop-compact-badge" style="display: ${compactCount > 0 ? 'inline-block' : 'none'}; font-size: 9.5px; background: ${PT.amberBg}; color: ${PT.amber}; padding: 1px 4px; border-radius: 3px; font-weight: 500;">已压缩 ${compactCount}次</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; font-size: 12.5px;">
              <span id="agy-pop-ctx-num" style="color: ${PT.text}; font-weight: 500;">${ctxK}/${maxK}</span>
              <span id="agy-pop-ctx-pct" style="color: ${ctxColor}; font-weight: 600;">${pct.toFixed(1)}%</span>
              <span id="agy-pop-ctx-ring" style="display: inline-flex; align-items: center;">${renderCircleRing(pct, 15, 5.5, 2.0, PT)}</span>
            </div>
          </div>

          <!-- Cache Hit Rate -->
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="font-size: 12px; color: ${PT.textSub};">上下文缓存命中率</span>
              <span style="font-size: 9.5px; background: ${PT.greenBg}; color: ${PT.green}; padding: 1px 4px; border-radius: 3px; font-weight: 500;">Cache</span>
            </div>
            <div style="text-align: right;">
              <span id="agy-pop-cache-hit" style="font-size: 12.5px; font-weight: 600; color: ${PT.green};">${cacheHitPct.toFixed(1)}%</span>
              <span id="agy-pop-cache-sub" style="font-size: 10px; color: ${PT.textDim}; margin-left: 4px;">(会话总计 ${sessCacheHitPct.toFixed(1)}%)</span>
            </div>
          </div>
        </div>

        <div style="height: 1px; background: ${PT.divider}; margin: 12px 0;"></div>

        <!-- Section 2: Token 活动 (Native Antigravity Heatmap - Compact & Dense) -->
        <div style="margin-bottom: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <div style="font-size: 13.5px; font-weight: 600; color: ${PT.title}; letter-spacing: -0.2px;">Token 活动</div>
            <div style="display: flex; gap: 8px; font-size: 11px; cursor: pointer;">
              <span id="agy-tab-daily" style="color: ${activeActivityTab === 'daily' ? PT.title : PT.textDim}; font-weight: ${activeActivityTab === 'daily' ? '600' : 'normal'}; transition: color 0.15s ease;"
                    onclick="window.__AGY_SWITCH_TAB__('daily')">每天</span>
              <span id="agy-tab-weekly" style="color: ${activeActivityTab === 'weekly' ? PT.title : PT.textDim}; font-weight: ${activeActivityTab === 'weekly' ? '600' : 'normal'}; transition: color 0.15s ease;"
                    onclick="window.__AGY_SWITCH_TAB__('weekly')">每周</span>
              <span id="agy-tab-total" style="color: ${activeActivityTab === 'total' ? PT.title : PT.textDim}; font-weight: ${activeActivityTab === 'total' ? '600' : 'normal'}; transition: color 0.15s ease;"
                    onclick="window.__AGY_SWITCH_TAB__('total')">累计总量</span>
            </div>
          </div>

          <div id="agy-activity-tab-content">
            ${renderActivityContent(data, PT)}
          </div>
        </div>

        <div style="height: 1px; background: ${PT.divider}; margin: 12px 0;"></div>

        <!-- Section 3: 近期消耗 (按模型真实统计，不臆测配额) -->
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 13.5px; font-weight: 600; color: ${PT.title}; letter-spacing: -0.2px;">近期消耗</span>
            <div style="display: flex; gap: 8px; font-size: 11px; cursor: pointer;">
              <span id="agy-utab-5h" style="color: ${activeUsageTab === '5h' ? PT.title : PT.textDim}; font-weight: ${activeUsageTab === '5h' ? '600' : 'normal'}; transition: color 0.15s ease;"
                    onclick="window.__AGY_SWITCH_USAGE_TAB__('5h')">近5小时</span>
              <span id="agy-utab-7d" style="color: ${activeUsageTab === '7d' ? PT.title : PT.textDim}; font-weight: ${activeUsageTab === '7d' ? '600' : 'normal'}; transition: color 0.15s ease;"
                    onclick="window.__AGY_SWITCH_USAGE_TAB__('7d')">近7天</span>
              <span id="agy-utab-hist" style="color: ${activeUsageTab === 'hist' ? PT.title : PT.textDim}; font-weight: ${activeUsageTab === 'hist' ? '600' : 'normal'}; transition: color 0.15s ease;"
                    onclick="window.__AGY_SWITCH_USAGE_TAB__('hist')">历史</span>
            </div>
          </div>

          <div id="agy-usage-tab-content">
            ${renderUsageContent(data, PT)}
          </div>
        </div>
      `;
    }
  };

  // Lightweight in-place data push from daemon
  // Updates values live without re-rendering or resetting DOM/popover state!
  window.__AGY_HUD_PUSH__ = function(newData) {
    if (!newData) return false;
    currentMetrics = newData;

    const T = getThemePalette();

    // Check if the button is still in DOM or theme switched; if so, re-render cleanly
    const btn = document.getElementById("antigravity-token-btn");
    if (!btn || !document.body.contains(btn) || btn.dataset.agyTheme !== T.key) {
      if (window.__AGY_RENDER__) window.__AGY_RENDER__();
      return true;
    }

    const session = getEffectiveSession(newData);
    const pct = (session.context_percent != null) ? session.context_percent : 0.0;
    const ctxColor = getContextColor(pct, T);
    const ctxK = fmtContextNum(session.context_size || 0);
    const maxK = fmtMaxContext(session.max_context || 256000);
    const compactCount = session.compaction_count || 0;
    const cacheHitPct = (session.cache_hit_percent != null) ? session.cache_hit_percent : 0.0;
    const sessCacheHitPct = (session.session_cache_hit_percent != null) ? session.session_cache_hit_percent : cacheHitPct;

    const tps = session.speed_tps || 0;
    const avgTps = session.avg_tps || 0;
    const peakTps = session.peak_tps || 0;
    const dur = session.duration_s || 0;
    const ttft = session.ttft_s || 0;
    const sdur = session.stream_s || 0;
    const outTok = session.output_tokens || 0;
    const totalTurns = session.total_turns || 0;

    // Update Toolbar Button
    const speedEl = document.getElementById("agy-btn-speed");
    if (speedEl) speedEl.textContent = tps > 0 ? `${tps} tok/s` : (avgTps > 0 ? `${avgTps} tok/s` : "0.0 tok/s");

    const btnCtxNum = document.getElementById("agy-btn-ctx-num");
    if (btnCtxNum) btnCtxNum.textContent = `${ctxK}/${maxK}`;
    const btnCtxPct = document.getElementById("agy-btn-ctx-pct");
    if (btnCtxPct) {
      btnCtxPct.textContent = `${pct.toFixed(1)}%`;
      btnCtxPct.style.color = ctxColor;
    }

    const ringEl = document.getElementById("agy-btn-ring");
    if (ringEl) ringEl.innerHTML = renderCircleRing(pct, 14, 5.2, 1.9, T);

    // If popover is open, update elements in place without disturbing user interaction!
    if (isPopoverOpen) {
      const popSpeed = document.getElementById("agy-pop-speed");
      if (popSpeed) popSpeed.textContent = tps > 0 ? `${tps} tok/s` : "0.0 tok/s";

      const popDur = document.getElementById("agy-pop-dur");
      if (popDur) popDur.textContent = dur > 0 ? `最近: ${outTok} tok · ${dur}s (首字 ${ttft}s · 流式 ${sdur}s)` : "暂无生成记录";

      const popAvgSpeed = document.getElementById("agy-pop-avg-speed");
      if (popAvgSpeed) popAvgSpeed.textContent = avgTps > 0 ? `${avgTps} tok/s` : "0.0 tok/s";

      const popAvgSub = document.getElementById("agy-pop-avg-sub");
      if (popAvgSub) popAvgSub.textContent = `(${totalTurns}轮 · 峰值 ${peakTps > 0 ? peakTps : "0.0"})`;

      const popCtxNum = document.getElementById("agy-pop-ctx-num");
      if (popCtxNum) popCtxNum.textContent = `${ctxK}/${maxK}`;

      const popCtxPct = document.getElementById("agy-pop-ctx-pct");
      if (popCtxPct) {
        popCtxPct.textContent = `${pct.toFixed(1)}%`;
        popCtxPct.style.color = ctxColor;
      }

      const popCtxRing = document.getElementById("agy-pop-ctx-ring");
      if (popCtxRing) popCtxRing.innerHTML = renderCircleRing(pct, 15, 5.5, 2.0, T);

      const popCompactBadge = document.getElementById("agy-pop-compact-badge");
      if (popCompactBadge) {
        popCompactBadge.style.display = compactCount > 0 ? "inline-block" : "none";
        popCompactBadge.textContent = `已压缩 ${compactCount}次`;
      }

      const popCacheHit = document.getElementById("agy-pop-cache-hit");
      if (popCacheHit) popCacheHit.textContent = `${cacheHitPct.toFixed(1)}%`;

      const popCacheSub = document.getElementById("agy-pop-cache-sub");
      if (popCacheSub) popCacheSub.textContent = `(会话总计 ${sessCacheHitPct.toFixed(1)}%)`;

      const actContainer = document.getElementById("agy-activity-tab-content");
      if (actContainer) actContainer.innerHTML = renderActivityContent(newData, T);

      const usageContainer = document.getElementById("agy-usage-tab-content");
      if (usageContainer) usageContainer.innerHTML = renderUsageContent(newData, T);
    }

    return true;
  };

  // Document click/ESC listeners (registered only once)
  if (!window.__AGY_LISTENER_SET__) {
    window.__AGY_LISTENER_SET__ = true;

    document.addEventListener("click", (e) => {
      const btn = document.getElementById("antigravity-token-btn");
      if (btn && !btn.contains(e.target)) {
        window.__AGY_CLOSE_POPOVER__();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        window.__AGY_CLOSE_POPOVER__();
      }
    });
  }

  // Hot-reloadable router, navigation & theme watcher (always uses latest getActiveConvId & theme!)
  try {
    if (typeof window.__AGY_UNSUB_ROUTER__ === "function") {
      window.__AGY_UNSUB_ROUTER__();
      window.__AGY_UNSUB_ROUTER__ = null;
    }
    if (window.__AGY_THEME_OBSERVER__) {
      window.__AGY_THEME_OBSERVER__.disconnect();
      window.__AGY_THEME_OBSERVER__ = null;
    }
    if (window.__AGY_NAV_TIMER__) {
      clearInterval(window.__AGY_NAV_TIMER__);
      window.__AGY_NAV_TIMER__ = null;
    }

    let lastNavSig = "";
    const checkNavChange = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const cid = getActiveConvId() || "__NEW__";
      const rPath = window.__TSR_ROUTER__?.state?.location?.pathname || window.location.pathname;
      const mMax = getDefaultMaxContext();
      const themeKey = isLightTheme() ? "light" : "dark";
      const sig = `${cid}|${rPath}|${mMax}|${themeKey}`;
      if (sig !== lastNavSig) {
        lastNavSig = sig;
        if (window.__AGY_RENDER__) window.__AGY_RENDER__();
      }
    };

    if (typeof MutationObserver === "function") {
      const obs = new MutationObserver(checkNavChange);
      if (document.documentElement) {
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
      }
      if (document.body) {
        obs.observe(document.body, { attributes: true, attributeFilter: ["class", "style", "data-agy-theme"] });
      }
      window.__AGY_THEME_OBSERVER__ = obs;
    }

    if (window.__TSR_ROUTER__?.__store && typeof window.__TSR_ROUTER__.__store.subscribe === "function") {
      window.__AGY_UNSUB_ROUTER__ = window.__TSR_ROUTER__.__store.subscribe(checkNavChange);
    } else if (window.__TSR_ROUTER__ && typeof window.__TSR_ROUTER__.subscribe === "function") {
      window.__AGY_UNSUB_ROUTER__ = window.__TSR_ROUTER__.subscribe("onResolved", checkNavChange);
    }

    window.__AGY_NAV_TIMER__ = setInterval(checkNavChange, 400);
  } catch (_) {}

  if (window.__AGY_RENDER__) {
    window.__AGY_RENDER__();
  }
})();
