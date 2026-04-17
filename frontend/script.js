/* ── Incidentiq — Frontend Logic ── */

const API = "http://localhost:5000";

// ── State ─────────────────────────────────────────────────────────────────────
let currentLogs   = [];
let activeScenario = null;
let incidentStart = null;
let detectedAt    = null;
let resolvedAt    = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const logOutput      = document.getElementById("log-output");
const logCount       = document.getElementById("log-count");
const hTotal         = document.getElementById("h-total");
const hInfo          = document.getElementById("h-info");
const hWarn          = document.getElementById("h-warn");
const hErrors        = document.getElementById("h-errors");
const incidentBody   = document.getElementById("incident-body");
const incidentBadge  = document.getElementById("incident-status-badge");
const aiBody         = document.getElementById("ai-body");
const aiThinking     = document.getElementById("ai-thinking");
const thinkingLabel  = document.getElementById("thinking-label");
const aiEngineLabel  = document.getElementById("ai-engine-label");
const aiSourceBadge  = document.getElementById("ai-source-badge");
const timelineSection = document.getElementById("timeline-section");
const timelineBody   = document.getElementById("timeline-body");
const statusDot      = document.getElementById("status-dot");
const statusLabel    = document.getElementById("status-label");
const btnAnalyze     = document.getElementById("btn-analyze");
const btnFix         = document.getElementById("btn-fix");

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

function setStatus(state) {
  statusDot.className = "status-dot";
  if (state === "incident") {
    statusDot.classList.add("alert");
    statusLabel.textContent = "Incident Active";
  } else if (state === "resolved") {
    statusDot.classList.add("resolved");
    statusLabel.textContent = "Resolved";
  } else {
    statusLabel.textContent = "Monitoring";
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
  aiBody.style.display  = "none";
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

    // Highlight active scenario
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
      incidentStart  = new Date();
      detectedAt     = null;
      resolvedAt     = null;

      renderLogs(currentLogs);

      const info  = currentLogs.filter(l => l.includes("[INFO]")).length;
      const warn  = currentLogs.filter(l => l.includes("[WARN]")).length;
      const error = currentLogs.filter(l => l.includes("[ERROR]")).length;

      hTotal.textContent  = currentLogs.length;
      hInfo.textContent   = info;
      hWarn.textContent   = warn;
      hErrors.textContent = error;
      logCount.textContent = `${currentLogs.length} lines`;

      // Reset panels
      btnAnalyze.disabled = false;
      btnFix.disabled     = true;
      setStatus("monitoring");

      incidentBadge.className   = "status-badge badge-idle";
      incidentBadge.textContent = "IDLE";
      incidentBody.innerHTML    = `<div class="empty-state"><div class="empty-icon">◎</div><div>Run "Analyze Logs" to detect incidents</div></div>`;
      aiBody.innerHTML          = `<div class="empty-state"><div class="empty-icon">✦</div><div>AI analysis will appear after detection</div></div>`;
      aiBody.style.display      = "flex";
      aiThinking.style.display  = "none";
      timelineSection.style.display = "none";

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

  // Show AI thinking state immediately
  startThinking();

  try {
    const res  = await fetch(`${API}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logs: currentLogs }),
    });
    const data = await res.json();
    detectedAt = new Date();

    // Minimum 1.5s thinking animation for UX effect
    await delay(1500);
    stopThinking();

    renderIncidents(data);
    renderAI(data.ai_response, data.primary, data.ai_source);
    renderTimeline();

    if (data.incidents && data.incidents.length > 0) {
      btnFix.disabled = false;
      setStatus("incident");
    }

  } catch {
    stopThinking();
    incidentBody.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠</div><div>Analysis failed — check backend</div></div>`;
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
    incidentBody.innerHTML    = `<div class="empty-state"><div class="empty-icon">✓</div><div>No incidents detected</div></div>`;
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

// ── Render AI Insights ────────────────────────────────────────────────────────

function renderAI(ai, incident, source) {
  // Update source badge
  if (source === "grok" || source === "groq") {
    aiSourceBadge.textContent = source === "groq" ? "AI · Groq" : "AI · Grok";
    aiSourceBadge.className   = "badge grok";
    aiEngineLabel.textContent = source === "groq" ? "Powered by Groq / Llama3" : "Powered by Grok";
  } else {
    aiSourceBadge.textContent = "AI · Simulation";
    aiSourceBadge.className   = "badge";
    aiEngineLabel.textContent = "Incidentiq Engine";
  }

  if (!ai) {
    aiBody.innerHTML = `<div class="empty-state"><div class="empty-icon">✦</div><div>No AI data available</div></div>`;
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

// ── Incident Timeline ─────────────────────────────────────────────────────────

function renderTimeline() {
  if (!incidentStart || !detectedAt) return;
  timelineSection.style.display = "block";

  const items = [
    { cls: "started",  label: "Logs Generated",    time: fmtTime(incidentStart) },
    { cls: "detected", label: "Incident Detected",  time: fmtTime(detectedAt) },
  ];

  if (resolvedAt) {
    items.push({ cls: "resolved", label: "Incident Resolved", time: fmtTime(resolvedAt) });
  }

  timelineBody.innerHTML = items.map(item => `
    <div class="timeline-item">
      <div class="tl-dot ${item.cls}"></div>
      <div class="tl-content">
        <div class="tl-label">${item.label}</div>
        <div class="tl-time">${item.time}</div>
      </div>
    </div>
  `).join("");
}

// ── Apply Fix ─────────────────────────────────────────────────────────────────

btnFix.addEventListener("click", async () => {
  const origHTML = btnFix.innerHTML;
  btnFix.innerHTML = `<span class="spinner"></span> Applying…`;
  btnFix.disabled  = true;

  try {
    const res  = await fetch(`${API}/fix`, { method: "POST" });
    const data = await res.json();
    resolvedAt = new Date();

    appendLogLine("── Auto-Remediation ─────────────────────────────────────", "sep");

    for (const line of data.fix_logs) {
      await delay(260);
      appendLogLine(line, "fix");
    }

    logCount.textContent = `${logOutput.children.length} lines`;

    incidentBadge.className   = "status-badge badge-resolved";
    incidentBadge.textContent = "RESOLVED";
    incidentBody.innerHTML    = `
      <div class="empty-state">
        <div style="font-size:30px">✓</div>
        <div style="color:var(--green);font-weight:700;font-size:12.5px">Incident Resolved</div>
        <div style="color:var(--muted);font-size:10.5px">All systems operational</div>
      </div>`;

    setStatus("resolved");
    renderTimeline();

  } catch (e) {
    console.error(e);
  } finally {
    btnFix.innerHTML = origHTML;
    // keep disabled — incident is resolved
  }
});
