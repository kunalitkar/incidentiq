/* ── Incidentiq — Frontend Logic ── */

const API = "http://localhost:5000";

// ── State ─────────────────────────────────────────────────────────────────────
let currentLogs    = [];
let activeScenario = null;
let systemState    = "idle";   // idle | failure | healthy
let stageTimestamps = {};      // { info, warn, error, fixed }

// ── DOM refs ──────────────────────────────────────────────────────────────────
const logOutput        = document.getElementById("log-output");
const logCount         = document.getElementById("log-count");
const hTotal           = document.getElementById("h-total");
const hInfo            = document.getElementById("h-info");
const hWarn            = document.getElementById("h-warn");
const hErrors          = document.getElementById("h-errors");
const incidentBody     = document.getElementById("incident-body");
const incidentBadge    = document.getElementById("incident-status-badge");
const aiBody           = document.getElementById("ai-body");
const aiThinking       = document.getElementById("ai-thinking");
const thinkingLabel    = document.getElementById("thinking-label");
const aiEngineLabel    = document.getElementById("ai-engine-label");
const aiSourceBadge    = document.getElementById("ai-source-badge");
const timelineSection  = document.getElementById("timeline-section");
const timelineBody     = document.getElementById("timeline-body");
const statusDot        = document.getElementById("status-dot");
const statusLabel      = document.getElementById("status-label");
const btnAnalyze       = document.getElementById("btn-analyze");
const btnFix           = document.getElementById("btn-fix");
const systemStateCard  = document.getElementById("system-state-card");
const stateIcon        = document.getElementById("state-icon");
const stateTitle       = document.getElementById("state-title");
const stateSub         = document.getElementById("state-sub");
const stateSev         = document.getElementById("state-sev");
const escalationSummary = document.getElementById("escalation-summary");
const escText          = document.getElementById("esc-text");

// ── Utilities ─────────────────────────────────────────────────────────────────

function logClass(line) {
  if (line.includes("[ERROR]")) return "error";
  if (line.includes("[WARN]"))  return "warn";
  if (line.includes("[INFO]"))  return "info";
  return "info";
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function appendLogLine(text, cls) {
  const div = document.createElement("div");
  div.className = `log-line ${cls}`;
  div.textContent = text;
  logOutput.appendChild(div);
  logOutput.scrollTop = logOutput.scrollHeight;
}

function renderLogs(lines) {
  logOutput.innerHTML = "";
  lines.forEach(l => appendLogLine(l, logClass(l)));
}

const delay = ms => new Promise(r => setTimeout(r, ms));
const fmtTime = d => d.toTimeString().slice(0, 8);
const now = () => new Date();

// ── System state helpers ──────────────────────────────────────────────────────

function setStatus(state) {
  statusDot.className = "status-dot";
  if (state === "failure") {
    statusDot.classList.add("alert");
    statusLabel.textContent = "System Unstable";
  } else if (state === "healthy") {
    statusDot.classList.add("resolved");
    statusLabel.textContent = "System Healthy ✅";
  } else {
    statusLabel.textContent = "Monitoring";
  }
}

function setSystemStateCard(state, incidentType, severity) {
  systemState = state;
  systemStateCard.className = `system-state-card state-${state}`;

  if (state === "failure") {
    stateIcon.textContent  = "🔴";
    stateTitle.textContent = incidentType || "System Failure Detected";
    stateSub.textContent   = "Active incident — errors escalating";
    stateSev.textContent   = severity || "HIGH";
    stateSev.className     = `state-sev ${severity || "HIGH"}`;
  } else if (state === "healthy") {
    stateIcon.textContent  = "✅";
    stateTitle.textContent = "System Healthy";
    stateSub.textContent   = "All services operational — no active incidents";
    stateSev.textContent   = "LOW";
    stateSev.className     = "state-sev LOW";
  } else {
    stateIcon.textContent  = "◎";
    stateTitle.textContent = "Awaiting Analysis";
    stateSub.textContent   = "Select a scenario and run analysis";
    stateSev.textContent   = "";
    stateSev.className     = "state-sev";
  }
}

// ── AI thinking animation ─────────────────────────────────────────────────────

const THINKING_STEPS = [
  "Analyzing logs...",
  "Detecting anomalies...",
  "Correlating patterns...",
  "Generating insights...",
];

let _thinkingTimer = null;

function startThinking() {
  aiBody.style.display     = "none";
  aiThinking.style.display = "flex";
  let i = 0;
  thinkingLabel.textContent = THINKING_STEPS[0];
  _thinkingTimer = setInterval(() => {
    i = (i + 1) % THINKING_STEPS.length;
    thinkingLabel.textContent = THINKING_STEPS[i];
  }, 900);
}

function stopThinking() {
  clearInterval(_thinkingTimer);
  aiThinking.style.display = "none";
  aiBody.style.display     = "flex";
}

// ── Scenario buttons ──────────────────────────────────────────────────────────

document.querySelectorAll(".btn-scene").forEach(btn => {
  btn.addEventListener("click", async () => {
    const scenario = btn.dataset.scenario;

    document.querySelectorAll(".btn-scene").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const origHTML = btn.innerHTML;
    btn.innerHTML  = `<span class="spinner"></span> Loading…`;
    btn.disabled   = true;

    try {
      const res  = await fetch(`${API}/generate?scenario=${scenario}&count=35`);
      const data = await res.json();

      currentLogs    = data.logs;
      activeScenario = scenario;
      stageTimestamps = { info: now() };

      // Stream logs with a small delay so the escalation is visible
      logOutput.innerHTML = "";
      logOutput.classList.remove("healthy-state", "flash-healthy");

      for (let i = 0; i < currentLogs.length; i++) {
        const line = currentLogs[i];
        const cls  = logClass(line);

        // Record first WARN and first ERROR timestamps
        if (cls === "warn" && !stageTimestamps.warn)   stageTimestamps.warn  = now();
        if (cls === "error" && !stageTimestamps.error) stageTimestamps.error = now();

        appendLogLine(line, cls);
        await delay(18);   // fast stream — visible but not slow
      }

      const info  = currentLogs.filter(l => l.includes("[INFO]")).length;
      const warn  = currentLogs.filter(l => l.includes("[WARN]")).length;
      const error = currentLogs.filter(l => l.includes("[ERROR]")).length;

      hTotal.textContent   = currentLogs.length;
      hInfo.textContent    = info;
      hWarn.textContent    = warn;
      hErrors.textContent  = error;
      logCount.textContent = `${currentLogs.length} lines`;

      // Reset all panels
      btnAnalyze.disabled = false;
      btnFix.disabled     = true;
      setStatus("monitoring");
      setSystemStateCard("idle");

      incidentBadge.className   = "status-badge badge-idle";
      incidentBadge.textContent = "IDLE";
      incidentBody.innerHTML    = `<div class="empty-state"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".25"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span>Run "Analyze Logs" to detect incidents</span></div>`;
      aiBody.innerHTML          = `<div class="empty-state"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".25"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>AI analysis will appear after detection</span></div>`;
      aiBody.style.display      = "flex";
      aiThinking.style.display  = "none";
      timelineSection.style.display    = "none";
      escalationSummary.style.display  = "none";

    } catch {
      logOutput.innerHTML = "";
      appendLogLine("⚠  Cannot reach backend. Is Flask running on port 5000?", "error");
    } finally {
      btn.innerHTML = origHTML;
      btn.disabled  = false;
    }
  });
});

// ── Analyze Logs ──────────────────────────────────────────────────────────────

btnAnalyze.addEventListener("click", async () => {
  if (!currentLogs.length) return;

  const origHTML = btnAnalyze.innerHTML;
  btnAnalyze.innerHTML = `<span class="spinner"></span> Analyzing…`;
  btnAnalyze.disabled  = true;

  startThinking();

  try {
    const res  = await fetch(`${API}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logs: currentLogs }),
    });
    const data = await res.json();

    await delay(1500);
    stopThinking();

    const hasIncidents = data.incidents && data.incidents.length > 0;

    if (hasIncidents) {
      setSystemStateCard("failure", data.primary?.issue_type, data.primary?.severity);
      setStatus("failure");
      btnFix.disabled = false;
      renderEscalationSummary(data);
    } else {
      setSystemStateCard("healthy");
      setStatus("healthy");
    }

    renderIncidents(data);
    renderAI(data.ai_response, data.primary, data.ai_source);
    renderStagedTimeline(data.primary);

  } catch {
    stopThinking();
    incidentBody.innerHTML = `<div class="empty-state"><span>Analysis failed — check backend</span></div>`;
  } finally {
    btnAnalyze.innerHTML = origHTML;
    btnAnalyze.disabled  = false;
  }
});

// ── Render Incidents ──────────────────────────────────────────────────────────

function renderIncidents(data) {
  const incidents = data.incidents || [];

  if (!incidents.length) {
    incidentBadge.className   = "status-badge badge-resolved";
    incidentBadge.textContent = "CLEAN";
    incidentBody.innerHTML    = `<div class="empty-state"><span style="font-size:22px">✓</span><span>No incidents detected</span></div>`;
    return;
  }

  incidentBadge.className   = "status-badge badge-active";
  incidentBadge.textContent = `${incidents.length} ACTIVE`;

  incidentBody.innerHTML = incidents.map(inc => `
    <div class="incident-card ${inc.severity}">
      <div class="incident-header">
        <div class="incident-type">🚨 ${esc(inc.issue_type)}</div>
        <span class="sev-badge sev-${inc.severity}">${inc.severity}</span>
      </div>
      <div class="incident-pattern">📊 ${esc(inc.pattern)}</div>
      <div class="incident-samples">
        ${inc.errors.map(e => `<div>${esc(e)}</div>`).join("")}
      </div>
    </div>
  `).join("");
}

// ── Escalation Summary ────────────────────────────────────────────────────────

function renderEscalationSummary(data) {
  const primary = data.primary;
  if (!primary) return;

  const info  = data.info_count  || 0;
  const warn  = data.warn_count  || 0;
  const error = data.error_count || 0;

  escText.textContent =
    `System degraded from normal operation (${info} INFO) → ` +
    `performance degradation (${warn} WARN) → ` +
    `failure state (${error} ERROR) due to ${primary.issue_type.toLowerCase()}.`;

  escalationSummary.style.display = "block";
}

// ── Staged Timeline ───────────────────────────────────────────────────────────

function renderStagedTimeline(primary) {
  timelineSection.style.display = "block";

  const stages = [];

  if (stageTimestamps.info) {
    stages.push({
      cls:   "info",
      label: "Normal Operation",
      desc:  "System running — all services healthy",
      time:  fmtTime(stageTimestamps.info),
    });
  }

  if (stageTimestamps.warn) {
    stages.push({
      cls:   "warn",
      label: "Degradation Detected",
      desc:  "Performance warnings — latency / resource pressure rising",
      time:  fmtTime(stageTimestamps.warn),
    });
  }

  if (stageTimestamps.error) {
    stages.push({
      cls:   "error",
      label: "System Failure",
      desc:  primary ? primary.issue_type : "Critical errors detected",
      time:  fmtTime(stageTimestamps.error),
    });
  }

  if (stageTimestamps.fixed) {
    stages.push({
      cls:   "fixed",
      label: "Incident Resolved",
      desc:  "Auto-remediation complete — system healthy",
      time:  fmtTime(stageTimestamps.fixed),
    });
  }

  timelineBody.innerHTML = `<div class="stage-timeline">${
    stages.map(s => `
      <div class="stage-item">
        <div class="stage-dot ${s.cls}">${stageDotIcon(s.cls)}</div>
        <div class="stage-content">
          <div class="stage-label ${s.cls}">${s.label}</div>
          <div class="stage-desc">${esc(s.desc)}</div>
          <div class="stage-time">${s.time}</div>
        </div>
      </div>
    `).join("")
  }</div>`;
}

function stageDotIcon(cls) {
  if (cls === "info")  return "✓";
  if (cls === "warn")  return "!";
  if (cls === "error") return "✕";
  if (cls === "fixed") return "✓";
  return "·";
}

// ── Render AI Insights ────────────────────────────────────────────────────────

function renderAI(ai, incident, source) {
  if (source === "grok" || source === "groq") {
    aiSourceBadge.textContent = source === "groq" ? "AI · Groq" : "AI · Grok";
    aiSourceBadge.className   = "ai-pill grok";
    aiEngineLabel.textContent = source === "groq" ? "Powered by Groq / Llama3" : "Powered by Grok";
  } else {
    aiSourceBadge.textContent = "AI · Simulation";
    aiSourceBadge.className   = "ai-pill";
    aiEngineLabel.textContent = "Incidentiq Engine";
  }

  if (!ai) {
    aiBody.innerHTML = `<div class="empty-state"><span>No AI data available</span></div>`;
    return;
  }

  const pct    = ai.confidence || 0;
  const sev    = incident?.severity || "MEDIUM";
  const label  = pct >= 90 ? "Very High" : pct >= 75 ? "High" : pct >= 60 ? "Moderate" : "Low";
  const impact = ai.impact || "—";

  aiBody.innerHTML = `
    <div class="ai-incident-row">
      <div class="ai-incident-name ${sev}">🚨 ${esc(incident?.issue_type || "Incident Detected")}</div>
      <div class="ai-impact-badge">⚠ ${esc(impact)}</div>
    </div>
    <div class="ai-field">
      <div class="ai-label">📊 Root Cause</div>
      <div class="ai-value">${esc(ai.root_cause)}</div>
    </div>
    <div class="ai-field">
      <div class="ai-label">💡 Explanation</div>
      <div class="ai-value">${esc(ai.explanation)}</div>
    </div>
    <div class="ai-field">
      <div class="ai-label">🛠 Suggested Fix</div>
      <div class="ai-value">${esc(ai.suggested_fix)}</div>
    </div>
    <div class="ai-field confidence-wrap">
      <div class="ai-label">🎯 Confidence</div>
      <div class="confidence-bar"><div class="confidence-fill" id="conf-fill"></div></div>
      <div class="confidence-row">
        <span>${label} Confidence</span>
        <span class="confidence-pct">${pct}%</span>
      </div>
    </div>
  `;

  requestAnimationFrame(() => {
    const fill = document.getElementById("conf-fill");
    if (fill) fill.style.width = pct + "%";
  });
}

// ── Apply Fix ─────────────────────────────────────────────────────────────────

btnFix.addEventListener("click", async () => {
  const origHTML = btnFix.innerHTML;
  btnFix.innerHTML = `<span class="spinner"></span> Applying…`;
  btnFix.disabled  = true;

  try {
    // Step 1 — stream remediation logs into terminal
    const fixRes  = await fetch(`${API}/fix`, { method: "POST" });
    const fixData = await fixRes.json();

    appendLogLine("── Auto-Remediation ─────────────────────────────────────", "sep");

    for (const line of fixData.fix_logs) {
      await delay(240);
      appendLogLine(line, "fix");
    }

    // Step 2 — fetch healthy logs and replace terminal content
    await delay(400);
    const healthRes  = await fetch(`${API}/healthy`);
    const healthData = await healthRes.json();

    // Flash transition
    logOutput.classList.add("flash-healthy");
    await delay(100);
    logOutput.innerHTML = "";
    logOutput.classList.add("healthy-state");

    for (const line of healthData.logs) {
      appendLogLine(line, "info");
      await delay(30);
    }

    // Update stats
    hInfo.textContent    = healthData.logs.length;
    hWarn.textContent    = 0;
    hErrors.textContent  = 0;
    hTotal.textContent   = healthData.logs.length;
    logCount.textContent = `${healthData.logs.length} lines`;

    // Step 3 — update system state
    stageTimestamps.fixed = now();
    setSystemStateCard("healthy");
    setStatus("healthy");

    // Step 4 — update incident panel
    incidentBadge.className   = "status-badge badge-resolved";
    incidentBadge.textContent = "RESOLVED";
    incidentBody.innerHTML    = `
      <div class="empty-state">
        <div style="font-size:32px;animation:fadeUp .3s ease">✅</div>
        <div style="color:var(--green);font-weight:700;font-size:13px">System Healthy</div>
        <div style="color:var(--muted-2);font-size:10px;margin-top:4px">All incidents resolved — monitoring resumed</div>
      </div>`;

    // Step 5 — update escalation summary
    escText.textContent = "System successfully recovered. Auto-remediation resolved all active incidents. All services operational.";

    // Step 6 — re-render timeline with resolved stage
    renderStagedTimeline(null);

  } catch (e) {
    console.error(e);
  } finally {
    btnFix.innerHTML = origHTML;
  }
});
