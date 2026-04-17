"""
Incidentiq — Flask Backend
Run: python app.py  →  open http://localhost:5000

LLM Integration: Grok (xAI) via OpenAI-compatible SDK.
Set env var: GROK_API_KEY=your_key_here
Falls back to simulated responses if key is missing or call fails.
"""

import os
import re
import json
import time
import random
import datetime
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from detector import analyze_logs, simulate_ai_response, build_prompt

# Load .env from the same directory as this file
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
CORS(app)

# ---------------------------------------------------------------------------
# Grok LLM client — loaded only when API key is present
# ---------------------------------------------------------------------------

GROK_API_KEY = os.environ.get("GROK_API_KEY", "")
_llm_client  = None
_llm_model   = None

if GROK_API_KEY:
    try:
        from openai import OpenAI

        if GROK_API_KEY.startswith("gsk_"):
            # Groq (groq.com) — fast inference, free tier
            _llm_client = OpenAI(api_key=GROK_API_KEY, base_url="https://api.groq.com/openai/v1")
            _llm_model  = "llama-3.1-8b-instant"
            print("[Incidentiq] Groq LLM client initialised ✓ (llama-3.1-8b-instant)")
        else:
            # xAI Grok
            _llm_client = OpenAI(api_key=GROK_API_KEY, base_url="https://api.x.ai/v1")
            _llm_model  = "grok-3-mini"
            print("[Incidentiq] xAI Grok client initialised ✓")

    except ImportError:
        print("[Incidentiq] openai package not installed — falling back to simulation")


def call_llm(prompt: str) -> dict | None:
    """
    Send prompt to Grok and parse the strict JSON response.
    Returns dict with keys: issue, reason, fix, confidence, impact
    Returns None on any failure so the caller can fall back gracefully.
    """
    if not _llm_client:
        return None

    system = (
        "You are a senior SRE performing incident triage. "
        "Respond ONLY with a single valid JSON object — no markdown, no extra text. "
        "Schema: {\"issue\": str, \"reason\": str, \"fix\": str, \"confidence\": int between 0 and 100, "
        "\"impact\": str describing business/user impact in one sentence}"
    )

    try:
        resp = _llm_client.chat.completions.create(
            model=_llm_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": prompt},
            ],
            temperature=0.3,
            max_tokens=400,
        )
        raw = resp.choices[0].message.content.strip()

        # Strip accidental markdown fences if model adds them
        raw = re.sub(r"^```[a-z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)

        parsed = json.loads(raw)

        # Validate required keys
        required = {"issue", "reason", "fix", "confidence", "impact"}
        if not required.issubset(parsed.keys()):
            return None

        parsed["confidence"] = int(parsed["confidence"])
        # Normalise: if model returned 0-10 scale, convert to 0-100
        if parsed["confidence"] <= 10:
            parsed["confidence"] = parsed["confidence"] * 10
        return parsed

    except Exception as e:
        print(f"[Incidentiq] LLM call failed: {e}")
        return None


def llm_to_ai_response(llm: dict) -> dict:
    """Map Grok JSON schema → internal ai_response schema used by the frontend."""
    return {
        "root_cause":    llm["issue"],
        "explanation":   llm["reason"],
        "suggested_fix": llm["fix"],
        "confidence":    llm["confidence"],
        "impact":        llm["impact"],
        "source":        "grok",
    }


# ---------------------------------------------------------------------------
# Scenario log templates
# ---------------------------------------------------------------------------

_BASE_INFO = [
    "User authenticated — user_id={uid} session started",
    "Cache hit ratio 94% — key=session:{uid}",
    "Request completed in {ms}ms — GET /api/dashboard",
    "Health check OK — all downstream services nominal",
    "Background worker flushed email_queue ({n} messages)",
    "Config reload triggered — environment: production",
    "Deployment pipeline step 3/5 completed successfully",
]

_SCENARIOS = {
    "db": {
        "warn": [
            "DB connection pool at 78% capacity — monitor closely",
            "Slow query detected: SELECT * FROM orders took {ms}ms",
            "Retry attempt {n}/3 — primary database host",
        ],
        "error": [
            "Database timeout after 30s — connection refused on port 5432",
            "DB error: too many connections (pool_max=100 reached)",
            "[ERROR] FATAL: remaining connection slots reserved for replication",
            "[ERROR] pg_connect(): Unable to connect to PostgreSQL server",
            "DB error: deadlock detected on table orders — rolling back",
        ],
    },
    "latency": {
        "warn": [
            "Response time {ms}ms exceeds 200ms SLA — GET /api/orders",
            "Slow response detected: latency={ms}ms on /api/search",
            "P99 latency at 1800ms — threshold is 500ms",
            "Downstream payments API response: {ms}ms",
        ],
        "error": [
            "[ERROR] Request timeout after 10s — GET /api/checkout",
            "High latency spike: response time=2847ms on /api/checkout",
            "[ERROR] Circuit breaker OPEN — downstream payments service",
            "[ERROR] Gateway timeout 504 — /api/inventory",
        ],
    },
    "auth": {
        "warn": [
            "Rate limit threshold reached for client 192.168.1.{n}",
            "Multiple failed login attempts — user_id={uid}",
            "JWT token expiring soon — issued 3500s ago",
        ],
        "error": [
            "Auth failure: unauthorized access attempt — 401 Unauthorized",
            "[ERROR] JWT validation failed: token expired 3600s ago",
            "[ERROR] Invalid signature on token for user_id={uid}",
            "Auth failure: 403 Forbidden — insufficient permissions",
            "[ERROR] Session revoked — forced logout user_id={uid}",
        ],
    },
    "mixed": {
        "warn": [
            "Response time {ms}ms exceeds 200ms SLA — GET /api/orders",
            "Memory usage at {pct}% — approaching container limit",
            "Retry attempt {n}/3 — downstream inventory service",
            "DB connection pool at 80% capacity — monitor closely",
        ],
        "error": [
            "Database timeout after 30s — connection refused on port 5432",
            "[ERROR] Unhandled exception in request handler: NullPointerException",
            "DB error: too many connections (pool_max=100 reached)",
            "[ERROR] Failed to process payment — gateway timeout after 10s",
            "Auth failure: unauthorized access attempt — 401 Unauthorized",
            "[ERROR] Service /api/inventory returned 503 Service Unavailable",
        ],
    },
}


def _fmt(level: str, template: str) -> str:
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    msg = template.format(
        uid=random.randint(1000, 9999),
        ms=random.randint(800, 3500),
        n=random.randint(1, 5),
        pct=random.randint(72, 96),
    )
    return f"[{level.upper()}] {ts} — {msg}"


def build_scenario_logs(scenario: str, count: int = 35) -> list[str]:
    """
    Build a log batch biased toward a specific failure scenario.
    scenario: 'db' | 'latency' | 'auth' | 'mixed'
    Falls back to mixed if unknown.
    """
    tmpl = _SCENARIOS.get(scenario, _SCENARIOS["mixed"])
    logs = []

    # ~45% INFO, ~30% WARN, ~25% ERROR for scenario logs
    for _ in range(count):
        r = random.random()
        if r < 0.45:
            logs.append(_fmt("info", random.choice(_BASE_INFO)))
        elif r < 0.75:
            logs.append(_fmt("warn", random.choice(tmpl["warn"])))
        else:
            logs.append(_fmt("error", random.choice(tmpl["error"])))

    return logs


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/generate", methods=["GET"])
def generate():
    """
    GET /generate?scenario=db|latency|auth|mixed&count=35
    Returns a scenario-biased log batch.
    """
    scenario = request.args.get("scenario", "mixed")
    count    = min(int(request.args.get("count", 35)), 100)
    return jsonify({"logs": build_scenario_logs(scenario, count), "scenario": scenario})


@app.route("/analyze", methods=["POST"])
def analyze():
    """
    POST /analyze
    Body: { "logs": [...] }

    Flow:
      1. Run rule-based detector
      2. Try Grok LLM with structured prompt
      3. Fall back to simulate_ai_response() if LLM unavailable/fails
    """
    body = request.get_json(force=True)
    logs = body.get("logs", [])
    if not logs:
        return jsonify({"error": "No logs provided"}), 400

    # Step 1 — rule-based detection
    result  = analyze_logs(logs)
    primary = result.get("primary")

    # Step 2 — LLM or simulation
    ai_source = "simulation"
    if primary and _llm_client:
        prompt     = build_prompt(primary)
        llm_result = call_llm(prompt)
        if llm_result:
            result["ai_response"] = llm_to_ai_response(llm_result)
            ai_source = "groq" if (_llm_model and "llama" in _llm_model) else "grok"

    # Ensure ai_response always has an impact field
    if result.get("ai_response") and "impact" not in result["ai_response"]:
        result["ai_response"]["impact"] = _default_impact(primary)

    result["ai_source"] = ai_source
    return jsonify(result)


def _default_impact(incident: dict | None) -> str:
    """Provide a sensible impact string when using simulated responses."""
    if not incident:
        return "Unknown — manual review required"
    impacts = {
        "db_failure":      "Service degradation for all DB-dependent endpoints; potential data loss risk",
        "high_latency":    "Degraded user experience; SLA breach likely if unresolved within 15 min",
        "request_failure": "Elevated error rate; downstream consumers receiving 5xx responses",
        "memory_pressure": "Risk of OOM worker kills; potential cascading restarts under load",
        "auth_failure":    "Users unable to authenticate; possible security incident in progress",
    }
    return impacts.get(incident["id"], "Service impact — investigate immediately")


@app.route("/fix", methods=["POST"])
def apply_fix():
    """POST /fix — returns step-by-step recovery log lines."""
    steps = [
        "[INFO] Incidentiq auto-remediation initiated...",
        "[INFO] Isolating affected service replicas",
        "[INFO] Draining active connections from degraded pool",
        "[INFO] Restarting service workers (1/3)...",
        "[INFO] Restarting service workers (2/3)...",
        "[INFO] Restarting service workers (3/3)...",
        "[INFO] Reconnecting to primary database — attempt 1/3",
        "[INFO] Database connection re-established ✓",
        "[INFO] Warming cache — pre-loading 1,240 hot keys",
        "[INFO] Connection pool resized: max_connections=25",
        "[INFO] Health check passed — latency 38ms (nominal)",
        "[INFO] All systems operational — incident resolved ✓",
    ]
    return jsonify({"fix_logs": steps, "status": "resolved"})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
