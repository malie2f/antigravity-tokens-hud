(() => {
  // Antigravity Tokens HUD Client Widget
  // Designed to match Antigravity native Onyx UI theme & Google Sans aesthetics

  let isPopoverOpen = false;
  let activeActivityTab = "daily"; // "daily" | "weekly" | "total"
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
        return txt.includes("5.5") || txt.includes("opus 5") ? 1000000 : 200000;
      }
      if (txt.includes("gpt")) return 128000;
    } catch (_) {}
    return 1000000;
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

  function getContextColor(pct) {
    if (pct >= 85) return "#f87171";
    if (pct >= 60) return "#fbbf24";
    return "#4ade80";
  }

  function renderCircleRing(pct, size = 14, radius = 5.2, strokeWidth = 1.9) {
    const safePct = Number.isFinite(pct) ? pct : 0;
    const visualPct = safePct <= 0 ? 0 : Math.min(100, Math.max(3, safePct));
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (visualPct / 100) * circumference;
    const strokeColor = getContextColor(safePct);
    return `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform: rotate(-90deg); flex-shrink: 0; display: block;">
        <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="rgba(255, 255, 255, 0.14)" stroke-width="${strokeWidth}" />
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

  function getHeatmapColor(tokens) {
    if (!tokens || tokens <= 0) return "#26262a";
    if (tokens < 500000) return "#174ea6";
    if (tokens < 5000000) return "#1a73e8";
    if (tokens < 20000000) return "#8ab4f8";
    return "#c2e7ff";
  }

  // Generate Activity Section HTML (Compact, dense, Antigravity native look)
  function renderActivityContent(data) {
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
            return `
              <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end;"
                   title="${w.range}: ${tokStr} Token (${w.requests || 0}次)">
                <div style="width: 100%; max-width: 18px; height: ${h}px; background: ${w.tokens > 0 ? '#1a73e8' : '#26262a'}; border-radius: 2px 2px 0 0; transition: background 0.15s ease;"
                     onmouseenter="this.style.background='#8ab4f8'" onmouseleave="this.style.background='${w.tokens > 0 ? '#1a73e8' : '#26262a'}'"></div>
                <span style="font-size: 9.5px; color: #80868b; white-space: nowrap;">${w.label}</span>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }

    if (activeActivityTab === "total") {
      return `
        <div style="padding: 6px 2px; font-size: 12px; color: #bcbdc6;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px;">
            <div style="display: flex; justify-content: space-between;">
              <span>提示词输入</span>
              <span style="color: #e3e3e3; font-weight: 500;">${fmtTok(uHist.input_tokens || 0)}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>生成输出</span>
              <span style="color: #e3e3e3; font-weight: 500;">${fmtTok(uHist.output_tokens || 0)}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>深度思考</span>
              <span style="color: #e3e3e3; font-weight: 500;">${fmtTok(uHist.thinking_tokens || 0)}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>上下文缓存</span>
              <span style="color: #e3e3e3; font-weight: 500;">${fmtTok(uHist.cached_tokens || 0)}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>历史总会话</span>
              <span style="color: #e3e3e3; font-weight: 500;">${uHist.total_sessions || 0} 个</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>缓存总命中率</span>
              <span style="color: #4ade80; font-weight: 500;">${(uHist.cache_hit_percent || 0).toFixed(1)}%</span>
            </div>
          </div>
          <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed rgba(255, 255, 255, 0.08); display: flex; justify-content: space-between; font-weight: 600;">
            <span style="color: #ffffff;">累计总吞吐量</span>
            <span style="color: #8ab4f8; font-size: 13px;">${fmtTok(uHist.total_tokens || 0)} Token</span>
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
          ${cellsByCol.map((colCells, colIdx) => `
            <div style="display: flex; flex-direction: column; gap: 2.5px;">
              ${colCells.map(cell => {
                if (!cell) return `<div style="aspect-ratio: 1;"></div>`;
                const bg = cell.future ? "rgba(255, 255, 255, 0.03)" : getHeatmapColor(cell.tokens);
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
        <div style="display: flex; margin-top: 6px; font-size: 9.5px; color: #80868b; position: relative; height: 14px;">
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
    let tipEl = document.getElementById("agy-heatmap-tooltip");
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.id = "agy-heatmap-tooltip";
      tipEl.style.cssText = [
        "position: fixed",
        "pointer-events: none",
        "z-index: 1000000",
        "background: #2b2b2f",
        "color: #ffffff",
        "border: 1px solid rgba(255, 255, 255, 0.12)",
        "padding: 5px 8px",
        "border-radius: 6px",
        "font-size: 11px",
        "font-family: inherit",
        "white-space: pre-line",
        "text-align: center",
        "box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5)",
        "line-height: 1.35",
        "transform: translate(-50%, -100%)",
        "margin-top: -6px"
      ].join("; ");
      document.body.appendChild(tipEl);
    }
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
    const container = document.getElementById("agy-activity-tab-content");
    if (container && currentMetrics) {
      container.innerHTML = renderActivityContent(currentMetrics);
    }
    const tabDaily = document.getElementById("agy-tab-daily");
    const tabWeekly = document.getElementById("agy-tab-weekly");
    const tabTotal = document.getElementById("agy-tab-total");
    if (tabDaily && tabWeekly && tabTotal) {
      tabDaily.style.color = tab === "daily" ? "#ffffff" : "#80868b";
      tabDaily.style.fontWeight = tab === "daily" ? "600" : "normal";
      tabWeekly.style.color = tab === "weekly" ? "#ffffff" : "#80868b";
      tabWeekly.style.fontWeight = tab === "weekly" ? "600" : "normal";
      tabTotal.style.color = tab === "total" ? "#ffffff" : "#80868b";
      tabTotal.style.fontWeight = tab === "total" ? "600" : "normal";
    }
  };

  window.__AGY_CLOSE_POPOVER__ = () => {
    isPopoverOpen = false;
    window.__AGY_HIDE_TOOLTIP__();
    const popover = document.getElementById("antigravity-token-popover");
    if (popover) popover.style.display = "none";
    const btn = document.getElementById("antigravity-token-btn");
    if (btn) {
      btn.style.background = "transparent";
      btn.style.color = "rgb(188, 189, 198)";
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

    // Session Metrics
    const session = getEffectiveSession(data);
    const pct = (session.context_percent != null) ? session.context_percent : 0.0;
    const ctxColor = getContextColor(pct);
    const ctxK = fmtContextNum(session.context_size || 0);
    const maxK = ((session.max_context || 256000) >= 1000000)
      ? "1M"
      : fmtContextNum(session.max_context || 256000);
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

    const u5h = data.usage_5h || {};
    const uWeekly = data.usage_weekly || {};
    const uHist = data.usage_historical || {};

    // Native Toolbar Button (Flush ghost button, no soft-edge bubble)
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
        "color: rgb(188, 189, 198)",
        "font-family: 'Google Sans Flex', 'Google Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        "font-size: 12px",
        "line-height: 1",
        "cursor: pointer",
        "transition: background-color 0.15s ease, color 0.15s ease",
        "user-select: none",
        "white-space: nowrap"
      ].join("; ");

      btn.onmouseenter = () => {
        if (!isPopoverOpen) {
          btn.style.background = "rgba(255, 255, 255, 0.08)";
          btn.style.color = "#ffffff";
        }
      };
      btn.onmouseleave = () => {
        if (!isPopoverOpen) {
          btn.style.background = "transparent";
          btn.style.color = "rgb(188, 189, 198)";
        }
      };

      modelWrapper.insertAdjacentElement("afterend", btn);
    } else if (btn.parentElement !== modelWrapper.parentElement || btn.previousElementSibling !== modelWrapper) {
      modelWrapper.insertAdjacentElement("afterend", btn);
    }

    btn.onclick = (e) => {
      e.stopPropagation();
      isPopoverOpen = !isPopoverOpen;
      renderPopover();
    };

    // Display primary speed: recent real speed, session avg speed, or 0.0 tok/s on new/empty session
    const displaySpeed = tps > 0 ? `${tps} tok/s` : (avgTps > 0 ? `${avgTps} tok/s` : "0.0 tok/s");

    btn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="color: #8ab4f8; flex-shrink: 0;">
        <path d="M7 2v11h3v9l7-12h-4l4-8z"/>
      </svg>
      <span id="agy-btn-speed" style="font-weight: 500; color: #8ab4f8; letter-spacing: -0.1px;">${displaySpeed}</span>
      <span id="agy-btn-ctx" style="display: inline-flex; align-items: center; gap: 4px; color: #e3e3e3; font-weight: 500; margin-left: 3px;">
        <span id="agy-btn-ctx-num">${ctxK}/${maxK}</span>
        <span id="agy-btn-ctx-pct" style="color: ${ctxColor}; font-weight: 600;">${pct.toFixed(1)}%</span>
        <span id="agy-btn-ring" style="display: inline-flex; align-items: center; margin-left: 1px;">${renderCircleRing(pct, 14, 5.2, 1.9)}</span>
      </span>
      <svg id="agy-btn-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color: #9aa0a6; margin-left: 1px; transition: transform 0.2s ease; transform: ${isPopoverOpen ? 'rotate(180deg)' : 'rotate(0deg)'};">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
      <div id="antigravity-token-popover"></div>
    `;

    renderPopover();

    function renderPopover() {
      const popover = document.getElementById("antigravity-token-popover");
      if (!popover) return;

      const chev = document.getElementById("agy-btn-chevron");
      if (chev) chev.style.transform = isPopoverOpen ? "rotate(180deg)" : "rotate(0deg)";

      if (!isPopoverOpen) {
        popover.style.display = "none";
        btn.style.background = "transparent";
        btn.style.color = "rgb(188, 189, 198)";
        window.__AGY_HIDE_TOOLTIP__();
        return;
      }

      btn.style.background = "rgba(255, 255, 255, 0.1)";
      btn.style.color = "#ffffff";

      popover.style.cssText = [
        "display: block",
        "position: absolute",
        "bottom: 34px",
        "left: 0",
        "width: 360px",
        "padding: 16px",
        "background: #19191d",
        "border: 1px solid rgba(255, 255, 255, 0.1)",
        "border-radius: 12px",
        "box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7), 0 2px 8px rgba(0, 0, 0, 0.4)",
        "color: #e3e3e3",
        "font-family: 'Google Sans Flex', 'Google Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        "z-index: 99999",
        "cursor: default",
        "backdrop-filter: blur(20px)"
      ].join("; ");

      popover.onclick = (e) => e.stopPropagation();

      popover.innerHTML = `
        <!-- Header -->
        <div style="font-size: 11.5px; color: #9aa0a6; margin-bottom: 12px; font-weight: 500; display: flex; justify-content: space-between; align-items: center;">
          <span>用量与性能</span>
          <span style="font-size: 10.5px; color: #80868b; cursor: pointer; padding: 2px 5px; border-radius: 4px; transition: color 0.15s ease;"
                onmouseenter="this.style.color='#ffffff'" onmouseleave="this.style.color='#80868b'"
                onclick="window.__AGY_CLOSE_POPOVER__()">✕ 关闭</span>
        </div>

        <!-- Section 1: 实时性能 (Accurate Speed, Context Ring & Cache Hit Rate) -->
        <div style="margin-bottom: 14px;">
          <div style="font-size: 13.5px; font-weight: 600; color: #ffffff; margin-bottom: 9px; letter-spacing: -0.2px;">实时性能</div>
          
          <!-- Recent Turn Speed -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 7px;">
            <div>
              <div style="font-size: 12.5px; color: #bcbdc6;">生成速度</div>
              <div id="agy-pop-dur" style="font-size: 10.5px; color: #80868b; margin-top: 1px;">
                ${dur > 0 ? `最近: ${outTok} tok · ${dur}s (首字 ${ttft}s · 流式 ${sdur}s)` : "暂无生成记录"}
              </div>
            </div>
            <div style="text-align: right;">
              <span id="agy-pop-speed" style="font-size: 13px; font-weight: 600; color: #8ab4f8;">${tps > 0 ? `${tps} tok/s` : "0.0 tok/s"}</span>
            </div>
          </div>

          <!-- Session Average Speed -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 7px;">
            <span style="font-size: 12px; color: #9aa0a6;">会话平均速度</span>
            <div style="text-align: right;">
              <span id="agy-pop-avg-speed" style="font-size: 12.5px; font-weight: 500; color: #e3e3e3;">${avgTps > 0 ? `${avgTps} tok/s` : "0.0 tok/s"}</span>
              <span id="agy-pop-avg-sub" style="font-size: 10px; color: #80868b; margin-left: 4px;">(${totalTurns}轮 · 峰值 ${peakTps > 0 ? peakTps : "0.0"})</span>
            </div>
          </div>

          <!-- Context Window Usage: 已用/总共 百分之 + 进度圆圈 -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 7px;">
            <span style="font-size: 12.5px; color: #bcbdc6;">当前会话上下文</span>
            <div style="display: flex; align-items: center; gap: 6px; font-size: 12.5px;">
              <span id="agy-pop-ctx-num" style="color: #e3e3e3; font-weight: 500;">${ctxK}/${maxK}</span>
              <span id="agy-pop-ctx-pct" style="color: ${ctxColor}; font-weight: 600;">${pct.toFixed(1)}%</span>
              <span id="agy-pop-ctx-ring" style="display: inline-flex; align-items: center;">${renderCircleRing(pct, 15, 5.5, 2.0)}</span>
            </div>
          </div>

          <!-- Cache Hit Rate -->
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="font-size: 12px; color: #bcbdc6;">上下文缓存命中率</span>
              <span style="font-size: 9.5px; background: rgba(74, 222, 128, 0.12); color: #4ade80; padding: 1px 4px; border-radius: 3px;">Cache</span>
            </div>
            <div style="text-align: right;">
              <span id="agy-pop-cache-hit" style="font-size: 12.5px; font-weight: 600; color: #4ade80;">${cacheHitPct.toFixed(1)}%</span>
              <span id="agy-pop-cache-sub" style="font-size: 10px; color: #80868b; margin-left: 4px;">(会话总计 ${sessCacheHitPct.toFixed(1)}%)</span>
            </div>
          </div>
        </div>

        <div style="height: 1px; background: rgba(255, 255, 255, 0.08); margin: 12px 0;"></div>

        <!-- Section 2: Token 活动 (Native Antigravity Heatmap - Compact & Dense) -->
        <div style="margin-bottom: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <div style="font-size: 13.5px; font-weight: 600; color: #ffffff; letter-spacing: -0.2px;">Token 活动</div>
            <div style="display: flex; gap: 8px; font-size: 11px; cursor: pointer;">
              <span id="agy-tab-daily" style="color: ${activeActivityTab === 'daily' ? '#ffffff' : '#80868b'}; font-weight: ${activeActivityTab === 'daily' ? '600' : 'normal'}; transition: color 0.15s ease;"
                    onclick="window.__AGY_SWITCH_TAB__('daily')">每天</span>
              <span id="agy-tab-weekly" style="color: ${activeActivityTab === 'weekly' ? '#ffffff' : '#80868b'}; font-weight: ${activeActivityTab === 'weekly' ? '600' : 'normal'}; transition: color 0.15s ease;"
                    onclick="window.__AGY_SWITCH_TAB__('weekly')">每周</span>
              <span id="agy-tab-total" style="color: ${activeActivityTab === 'total' ? '#ffffff' : '#80868b'}; font-weight: ${activeActivityTab === 'total' ? '600' : 'normal'}; transition: color 0.15s ease;"
                    onclick="window.__AGY_SWITCH_TAB__('total')">累计总量</span>
            </div>
          </div>

          <div id="agy-activity-tab-content">
            ${renderActivityContent(data)}
          </div>
        </div>

        <div style="height: 1px; background: rgba(255, 255, 255, 0.08); margin: 12px 0;"></div>

        <!-- Section 3: 消耗统计 (新增消耗 / 含缓存总吞吐) -->
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 9px;">
            <span style="font-size: 13.5px; font-weight: 600; color: #ffffff; letter-spacing: -0.2px;">近期消耗</span>
            <span style="font-size: 10px; color: #80868b;">新增 / 总吞吐 (命中率)</span>
          </div>
          
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 12px;">
            <span style="color: #bcbdc6;">5小时已消耗</span>
            <span style="color: #e3e3e3; font-weight: 500;">
              <span id="agy-pop-u5h-new" style="color: #8ab4f8;">${fmtTok(u5h.new_tokens || 0)}</span>
              <span style="color: #5f6368; margin: 0 3px;">/</span>
              <span id="agy-pop-u5h">${fmtTok(u5h.total_tokens || 0)}</span>
              <span id="agy-pop-u5h-hit" style="color: #4ade80; font-size: 10.5px; margin-left: 3px;">(${(u5h.cache_hit_percent || 0).toFixed(0)}%)</span>
              <span id="agy-pop-u5h-req" style="color: #9aa0a6; font-size: 10.5px; margin-left: 2px;">(${u5h.total_requests || 0}次)</span>
            </span>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 12px;">
            <span style="color: #bcbdc6;">本周已消耗</span>
            <span style="color: #e3e3e3; font-weight: 500;">
              <span id="agy-pop-uw-new" style="color: #8ab4f8;">${fmtTok(uWeekly.new_tokens || 0)}</span>
              <span style="color: #5f6368; margin: 0 3px;">/</span>
              <span id="agy-pop-uw">${fmtTok(uWeekly.total_tokens || 0)}</span>
              <span id="agy-pop-uw-hit" style="color: #4ade80; font-size: 10.5px; margin-left: 3px;">(${(uWeekly.cache_hit_percent || 0).toFixed(0)}%)</span>
              <span id="agy-pop-uw-req" style="color: #9aa0a6; font-size: 10.5px; margin-left: 2px;">(${uWeekly.total_requests || 0}次)</span>
            </span>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px;">
            <span style="color: #bcbdc6;">历史累计总耗</span>
            <span style="color: #e3e3e3; font-weight: 500;">
              <span id="agy-pop-uh-new" style="color: #8ab4f8;">${fmtTok(uHist.new_tokens || 0)}</span>
              <span style="color: #5f6368; margin: 0 3px;">/</span>
              <span id="agy-pop-uh">${fmtTok(uHist.total_tokens || 0)}</span>
              <span id="agy-pop-uh-hit" style="color: #4ade80; font-size: 10.5px; margin-left: 3px;">(${(uHist.cache_hit_percent || 0).toFixed(0)}%)</span>
              <span id="agy-pop-uh-sess" style="color: #9aa0a6; font-size: 10.5px; margin-left: 2px;">(${uHist.total_sessions || 0}会话)</span>
            </span>
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

    // Check if the button is still in DOM; if not, re-render
    const btn = document.getElementById("antigravity-token-btn");
    if (!btn || !document.body.contains(btn)) {
      if (window.__AGY_RENDER__) window.__AGY_RENDER__();
      return true;
    }

    const session = getEffectiveSession(newData);
    const pct = (session.context_percent != null) ? session.context_percent : 0.0;
    const ctxColor = getContextColor(pct);
    const ctxK = fmtContextNum(session.context_size || 0);
    const maxK = ((session.max_context || 256000) >= 1000000)
      ? "1M"
      : fmtContextNum(session.max_context || 256000);
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
    if (ringEl) ringEl.innerHTML = renderCircleRing(pct, 14, 5.2, 1.9);

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
      if (popCtxRing) popCtxRing.innerHTML = renderCircleRing(pct, 15, 5.5, 2.0);

      const popCacheHit = document.getElementById("agy-pop-cache-hit");
      if (popCacheHit) popCacheHit.textContent = `${cacheHitPct.toFixed(1)}%`;

      const popCacheSub = document.getElementById("agy-pop-cache-sub");
      if (popCacheSub) popCacheSub.textContent = `(会话总计 ${sessCacheHitPct.toFixed(1)}%)`;

      const actContainer = document.getElementById("agy-activity-tab-content");
      if (actContainer) actContainer.innerHTML = renderActivityContent(newData);

      const popU5hNew = document.getElementById("agy-pop-u5h-new");
      if (popU5hNew) popU5hNew.textContent = fmtTok(newData.usage_5h?.new_tokens || 0);
      const popU5h = document.getElementById("agy-pop-u5h");
      if (popU5h) popU5h.textContent = fmtTok(newData.usage_5h?.total_tokens || 0);
      const popU5hHit = document.getElementById("agy-pop-u5h-hit");
      if (popU5hHit) popU5hHit.textContent = `(${(newData.usage_5h?.cache_hit_percent || 0).toFixed(0)}%)`;
      const popU5hReq = document.getElementById("agy-pop-u5h-req");
      if (popU5hReq) popU5hReq.textContent = `(${newData.usage_5h?.total_requests || 0}次)`;

      const popUWNew = document.getElementById("agy-pop-uw-new");
      if (popUWNew) popUWNew.textContent = fmtTok(newData.usage_weekly?.new_tokens || 0);
      const popUW = document.getElementById("agy-pop-uw");
      if (popUW) popUW.textContent = fmtTok(newData.usage_weekly?.total_tokens || 0);
      const popUWHit = document.getElementById("agy-pop-uw-hit");
      if (popUWHit) popUWHit.textContent = `(${(newData.usage_weekly?.cache_hit_percent || 0).toFixed(0)}%)`;
      const popUWReq = document.getElementById("agy-pop-uw-req");
      if (popUWReq) popUWReq.textContent = `(${newData.usage_weekly?.total_requests || 0}次)`;

      const popUHNew = document.getElementById("agy-pop-uh-new");
      if (popUHNew) popUHNew.textContent = fmtTok(newData.usage_historical?.new_tokens || 0);
      const popUH = document.getElementById("agy-pop-uh");
      if (popUH) popUH.textContent = fmtTok(newData.usage_historical?.total_tokens || 0);
      const popUHHit = document.getElementById("agy-pop-uh-hit");
      if (popUHHit) popUHHit.textContent = `(${(newData.usage_historical?.cache_hit_percent || 0).toFixed(0)}%)`;
      const popUHSess = document.getElementById("agy-pop-uh-sess");
      if (popUHSess) popUHSess.textContent = `(${newData.usage_historical?.total_sessions || 0}会话)`;
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

  // Hot-reloadable router & navigation watcher (always uses latest getActiveConvId!)
  try {
    if (typeof window.__AGY_UNSUB_ROUTER__ === "function") {
      window.__AGY_UNSUB_ROUTER__();
      window.__AGY_UNSUB_ROUTER__ = null;
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
      const sig = `${cid}|${rPath}|${mMax}`;
      if (sig !== lastNavSig) {
        lastNavSig = sig;
        if (window.__AGY_RENDER__) window.__AGY_RENDER__();
      }
    };

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
