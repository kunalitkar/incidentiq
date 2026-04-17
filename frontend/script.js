/* ── Incidentiq — Frontend Logic ── */

const API = "http://localhost:5000";

// ── State ────────────────────────────────────────────────────────────────────
let currentLogs    = [];
let incidentStart  = null;   // timestamp when logs were generated
let detectedAt     = null;   // timestamp when analysis ran
let resolvedAt     = null;   // timestamp when fix was applied

// ── DOM refs ─────────────────────────────────────────────────────────────────
const logOutput     = document.getElementById("log-output");
const logCount      = document.getElementById("log-count");
const sInfo         = document.getElementById("s-info");
const sWarn         = document.getElementById("s-warn");
const sError        = document.getElementById("s-error");
const hTotal        = document.getElementById("h-total");
const hErrors       = document.getElementById("h-errors");
const incidentBody  = document.getElementById("incident-body");
const incidentBadge = document.getElementById("incident-status-badge");
const aiBody        = document.getElementById("ai-body");
const timelineSection = document.getElementById("timeline-section");
const timelineBody  = document.getElementById("timeline-body");
const statusDot     = document.getElementById("status-dot");
const statusLabel   = document.getElementById("status-label");
const btnGenerate   = document.getElementById("btn-generate");
const btnAnalyze    = document.getElementById("btn-analyze");
const btnFix        = document.getElementById("btn-fix");

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Determine CSS class from a log line's level tag */
function logClass(line) {
  if (line.includes("[ERROR]")) return "error";
  if (line.includes("[WARN]"))  return "warn";
  if (line.includes("[INFO]"))  return "info";
  return "info";
}

/** Escape HTML special chars to prevent XSS */
function esc(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Append a single log line div to the log output */
function appendLogLine(text, cls) {
  const div = document.createElement("div");
  div.className = `log-line ${cls}`;
  div.textContent = text;
  logOutput.appendChild(div);
  logOutput.scrollTop = logOutput.scrollHeight;
}

/** Render a full array of log lines (clears first) */
function renderLogs(lines) {
  logOutput.innerHTML = "";
  lines.forEach(line => appendLogLine(line, logClass(line)));
}

/** Simple async delay */
const delay = ms => new Promise(r => setTimeout(r, ms));

/** Format a Date as HH:MM:SS */
function fmtTime(d) {
  return d.toTimeString().slice(0, 8);
}

/** Set a button into loading / normal state */
function setLoading(btn, loading, normalHTML) {
  if (loading) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Working…`;
  } else {
    btn.disabled = false;
    btn.innerHTML = normalHTML;
  }
}

// ── System status helpers ─────────────────────────────────────────────────────

function setStatus(state) {
  // state: 'monitoring' | 'incident' | 'resolved'
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

// ── Generate Logs ─────────────────────────────────────────────────────────────

btnGenerate.addEventListener("click", async () => {
  const origHTML = btnGenerate.innerHTML;
  setLoading(btnGenerate, true, origHTML);

  try {
    const res  = await fetch(`${API}/generate?count=35`);
    const data = await res.json();
    currentLogs   = data.logs;
    incidentStart = new Date();
    detectedAt    = null;
    resolvedAt    = null;

    renderLogs(currentLogs);

    // Update stats
    const info  = currentLogs.filter(l => l.includes("[INFO]")).length;
    const warn  = currentLogs.filter(l => l.includes("[WARN]")).length;
    const error = currentLogs.filter(l => l.includes("[ERROR]")).length;

    sInfo.textContent  = info;
    sWarn.textContent  = warn;
    sError.textContent = error;
    logCount.textContent = `${currentLogs.length} lines`;
    hTotal.textContent   = currentLogs.length;
    hErrors.textContent  = error;

    // Reset panels
    btnAnalyze.disabled = false;
    btnFix.disabled     = true;
    setStatus("monitoring");

    incidentBadge.className   = "status-badge badge-idle";
    incidentBadge.textContent = "IDLE";
    incidentBody.innerHTML    = `<div class="empty-state"><div class="empty-icon">◎</div><div>Run analysis to detect incidents</div></div>`;
    aiBody.innerHTML          = `<div class="empty-state"><div class="empty-icon">✦</div><div>AI analysis will appear after detection</div></div>`;
    timelineSection.style.display = "none";

  } catch {
    logOutput.innerHTML = "";
    appendLogLine("⚠  Cannot reach backend. Is Flask running on port 5000?", "error");
  } finally {
    setLoading(btnGenerate, false, origHTML);
  }
});

// ── Analyze Incident ──────────────────────────────────────────────────────────

btnAnalyze.addEventListener("click", async () => {
  if (!currentLogs.length) return;
  const origHTML = btnAnalyze.innerHTML;
  setLoading(btnAnalyze, true, origHTML);

  try {
    const res  = await fetch(`${API}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logs: currentLogs }),
    });
    const data = await res.json();
    detectedAt = new Date();

    renderIncidents(data);
    renderAI(data.ai_response, data.primary);
    renderTimeline();

    if (data.incidents && data.incidents.length > 0) {
      btnFix.disabled = false;
      setStatus("incident");
    }

  } catch {
    incidentBody.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠</div><div>Analysis failed — check backend</div></div>`;
  } finally {
    setLoading(btnAnalyze, false, origHTML);
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
        <div class="incident-type">${esc(inc.issue_type)}</div>
        <span class="sev-badge sev-${inc.severity}">${inc.severity}</span>
      </div>
      <div class="incident-pattern">${esc(inc.pattern)}</div>
      <div class="incident-samples">
        ${inc.errors.map(e => `<div>${esc(e)}</div>`).join("")}
      </div>
    </div>
  `).join("");
}

// ── Render AI Insights ────────────────────────────────────────────────────────

function renderAI(ai, incident) {
  if (!ai) {
    aiBody.innerHTML = `<div class="empty-state"><div class="empty-icon">✦</div><div>No AI data available</div></div>`;
    return;
  }

  const pct   = ai.confidence || 0;
  const label = pct >= 90 ? "Very High" : pct >= 75 ? "High" : pct >= 60 ? "Moderate" : "Low";

  aiBody.innerHTML = `
    <div class="ai-field">
      <div class="ai-label">Root Cause</div>
      <div class="ai-value">${esc(ai.root_cause)}</div>
    </div>
    <div class="ai-field">
      <div class="ai-label">Explanation</div>
      <div class="ai-value">${esc(ai.explanation)}</div>
    </div>
    <div class="ai-field">
      <div class="ai-label">Suggested Fix</div>
      <div class="ai-value">${esc(ai.suggested_fix)}</div>
    </div>
    <div class="ai-field confidence-wrap">
      <div class="ai-label">Confidence</div>
      <div class="confidence-bar"><div class="confidence-fill" id="conf-fill"></div></div>
      <div class="confidence-row">
        <span>${label} Confidence</span>
        <span class="confidence-pct">${pct}%</span>
      </div>
    </div>
  `;

  // Animate bar on next frame
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
    { cls: "started",  label: "Incident Started",  time: fmtTime(incidentStart) },
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
  setLoading(btnFix, true, origHTML);

  try {
    const res  = await fetch(`${API}/fix`, { method: "POST" });
    const data = await res.json();
    resolvedAt = new Date();

    // Separator line
    appendLogLine("── Auto-Remediation ─────────────────────────────────────", "sep");

    // Stream recovery steps with delay for effect
    for (const line of data.fix_logs) {
      await delay(280);
      appendLogLine(line, "fix");
    }

    logCount.textContent = `${logOutput.children.length} lines`;

    // Update incident panel → resolved
    incidentBadge.className   = "status-badge badge-resolved";
    incidentBadge.textContent = "RESOLVED";
    incidentBody.innerHTML    = `
      <div class="empty-state" style="gap:8px">
        <div style="font-size:32px">✓</div>
        <div style="color:var(--green);font-weight:700;font-size:13px">Incident Resolved</div>
        <div style="color:var(--muted);font-size:11px">All systems operational</div>
      </div>`;

    setStatus("resolved");
    renderTimeline();   // re-render with resolved timestamp
    btnFix.disabled = true;

  } catch (e) {
    console.error(e);
  } finally {
    setLoading(btnFix, false, origHTML);
  }
});
