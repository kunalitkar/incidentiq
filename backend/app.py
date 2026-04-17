"""
Incidentiq — Flask Backend
Run: python app.py  →  open http://localhost:5000
"""

import random
import datetime
import os
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from detector import analyze_logs

# Serve the frontend/ folder as static files
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
CORS(app)

# ---------------------------------------------------------------------------
# Simulated log templates
# ---------------------------------------------------------------------------

_TEMPLATES = {
    "info": [
        "User authenticated — user_id={uid} session started",
        "Cache hit ratio 94% — key=session:{uid}",
        "Request completed in {ms}ms — GET /api/dashboard",
        "Health check OK — all downstream services nominal",
        "Background worker flushed email_queue ({n} messages)",
        "Config reload triggered — environment: production",
        "Deployment pipeline step 3/5 completed successfully",
    ],
    "warn": [
        "Response time {ms}ms exceeds 200ms SLA — GET /api/orders",
        "Slow response detected: latency={ms}ms on /api/search",
        "Retry attempt {n}/3 — downstream inventory service",
        "Memory usage at {pct}% — approaching container limit",
        "Rate limit threshold reached for client 192.168.1.{n}",
        "DB connection pool at 80% capacity — monitor closely",
    ],
    "error": [
        "Database timeout after 30s — connection refused on port 5432",
        "[ERROR] Unhandled exception in request handler: NullPointerException at OrderService.java:142",
        "DB error: too many connections (pool_max=100 reached)",
        "[ERROR] Failed to process payment — gateway timeout after 10s",
        "Auth failure: unauthorized access attempt — 401 Unauthorized",
        "[ERROR] Service /api/inventory returned 503 Service Unavailable",
        "High latency spike: response time=2847ms on /api/checkout",
        "[ERROR] Circuit breaker OPEN — downstream payments service",
        "JWT validation failed: token expired 3600s ago",
    ],
}


def _format_log(level: str, template: str) -> str:
    """Format a single log line with timestamp and substituted values."""
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    msg = template.format(
        uid=random.randint(1000, 9999),
        ms=random.randint(180, 3200),
        n=random.randint(1, 5),
        pct=random.randint(72, 96),
    )
    return f"[{level.upper()}] {ts} — {msg}"


def generate_log_batch(count: int = 35) -> list[str]:
    """
    Produce a weighted batch of log lines.
    Weights: 50% INFO, 30% WARN, 20% ERROR — realistic production ratio.
    """
    weights = {"info": 0.50, "warn": 0.30, "error": 0.20}
    levels  = list(weights.keys())
    wvals   = list(weights.values())
    logs = []
    for _ in range(count):
        level    = random.choices(levels, weights=wvals)[0]
        template = random.choice(_TEMPLATES[level])
        logs.append(_format_log(level, template))
    return logs


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    """Serve the frontend dashboard."""
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/generate", methods=["GET"])
def generate():
    """GET /generate?count=35 — returns a fresh simulated log batch."""
    count = min(int(request.args.get("count", 35)), 100)
    return jsonify({"logs": generate_log_batch(count)})


@app.route("/analyze", methods=["POST"])
def analyze():
    """
    POST /analyze
    Body : { "logs": ["...", ...] }
    Returns structured incident data + AI insights.
    """
    body = request.get_json(force=True)
    logs = body.get("logs", [])
    if not logs:
        return jsonify({"error": "No logs provided"}), 400

    result = analyze_logs(logs)
    return jsonify(result)


@app.route("/fix", methods=["POST"])
def apply_fix():
    """
    POST /fix
    Simulates step-by-step auto-remediation.
    Returns ordered recovery log lines + final status.
    """
    recovery_steps = [
        "[INFO] Incidentiq auto-remediation initiated...",
        "[INFO] Isolating affected service replicas",
        "[INFO] Draining active connections from degraded pool",
        "[INFO] Restarting service workers (0/3)...",
        "[INFO] Restarting service workers (1/3)...",
        "[INFO] Restarting service workers (2/3)...",
        "[INFO] Reconnecting to primary database — attempt 1/3",
        "[INFO] Database connection re-established ✓",
        "[INFO] Warming cache — pre-loading 1,240 hot keys",
        "[INFO] Connection pool resized: max_connections=25",
        "[INFO] Health check passed — latency 38ms (nominal)",
        "[INFO] All systems operational — incident resolved ✓",
    ]
    return jsonify({"fix_logs": recovery_steps, "status": "resolved"})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
