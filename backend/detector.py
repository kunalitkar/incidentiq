"""
Incidentiq — Detection Engine
Rule-based incident analysis. No ML required.
Each rule maps to a structured incident with severity: LOW / MEDIUM / HIGH
"""

import re
import datetime
from collections import Counter


# ---------------------------------------------------------------------------
# Detection rules — order matters (more specific first)
# ---------------------------------------------------------------------------

RULES = [
    {
        "id": "db_failure",
        "issue_type": "Database Failure",
        "pattern": re.compile(
            r"database.*timeout|connection.*refused|db.*error|too many connections|pg.*error|mysql.*error|deadlock|pool.*max",
            re.IGNORECASE,
        ),
        "severity": "HIGH",
        "pattern_label": "DB connection exhaustion / timeout loop",
        "priority": 10,   # higher = checked first, wins ties
    },
    {
        "id": "high_latency",
        "issue_type": "High Latency",
        "pattern": re.compile(
            r"slow response|latency|response time.*\d{4,}ms|took \d{4,}ms|threshold.*exceeded|p99|sla.*breach|\d{4,}ms",
            re.IGNORECASE,
        ),
        "severity": "MEDIUM",
        "pattern_label": "Response time exceeding SLA threshold",
        "priority": 8,
    },
    {
        "id": "auth_failure",
        "issue_type": "Auth Failure",
        "pattern": re.compile(
            r"auth.*fail|unauthorized|403|401|invalid.*token|jwt.*expired|session.*revoked|forced.*logout",
            re.IGNORECASE,
        ),
        "severity": "MEDIUM",
        "pattern_label": "Repeated authentication rejections",
        "priority": 7,
    },
    {
        "id": "memory_pressure",
        "issue_type": "Memory Pressure",
        "pattern": re.compile(
            r"memory.*limit|heap.*size|out of memory|oom|memory usage.*\d{2,3}%",
            re.IGNORECASE,
        ),
        "severity": "MEDIUM",
        "pattern_label": "Heap growth without GC reclamation",
        "priority": 6,
    },
    {
        "id": "request_failure",
        "issue_type": "Repeated Request Failure",
        "pattern": re.compile(
            r"5\d{2} error|service.*unavailable|gateway.*timeout|failed to process|unhandled exception|circuit breaker|nullpointer",
            re.IGNORECASE,
        ),
        "severity": "HIGH",
        "pattern_label": "Cascading request failures across endpoints",
        "priority": 5,   # lowest — only wins when nothing more specific matches
    },
]

# Severity sort order for ranking
_SEVERITY_RANK = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}


def analyze_logs(logs: list[str]) -> dict:
    """
    Scan log lines against all rules.
    Returns structured incident data + AI insights.
    """
    detected = []

    for rule in RULES:
        hits = [line for line in logs if rule["pattern"].search(line)]
        if not hits:
            continue

        detected.append({
            "id":          rule["id"],
            "issue_type":  rule["issue_type"],
            "severity":    rule["severity"],
            "pattern":     rule["pattern_label"],
            "priority":    rule["priority"],
            "errors":      hits[:5],
            "occurrences": len(hits),
        })

    # Sort: highest severity first, then by priority, then occurrences
    detected.sort(
        key=lambda x: (_SEVERITY_RANK[x["severity"]], x["priority"], x["occurrences"]),
        reverse=True,
    )

    # Strip internal priority field before returning
    for d in detected:
        d.pop("priority", None)

    # Log-level counts
    error_count = sum(1 for l in logs if "[ERROR]" in l)
    warn_count  = sum(1 for l in logs if "[WARN]"  in l)
    info_count  = sum(1 for l in logs if "[INFO]"  in l)

    primary = detected[0] if detected else None

    return {
        "total_logs":    len(logs),
        "error_count":   error_count,
        "warn_count":    warn_count,
        "info_count":    info_count,
        "incidents":     detected,           # renamed from "issues"
        "primary":       primary,
        "ai_prompt":     build_prompt(primary) if primary else None,
        "ai_response":   simulate_ai_response(primary) if primary else None,
    }


def build_prompt(incident: dict) -> str:
    """
    Structured prompt for the LLM. The system message enforces JSON output;
    this user message provides the incident context.
    """
    samples = "\n".join(incident["errors"])
    return (
        f"Incident Type : {incident['issue_type']}\n"
        f"Severity      : {incident['severity']}\n"
        f"Pattern       : {incident['pattern']}\n"
        f"Occurrences   : {incident['occurrences']}\n\n"
        f"Sample log lines:\n{samples}\n\n"
        f"Return the JSON object only."
    )


# ---------------------------------------------------------------------------
# Simulated AI responses — realistic, concise, DevOps-flavoured
# Replace simulate_ai_response() body with a real LLM call when ready.
# ---------------------------------------------------------------------------

_AI_LIBRARY = {
    "db_failure": {
        "root_cause":     "Connection pool exhausted under sustained load",
        "explanation":    (
            "Active DB connections have hit the pool ceiling. Incoming requests "
            "queue for a free slot and time out before one becomes available, "
            "producing a cascade of connection-refused errors."
        ),
        "suggested_fix":  (
            "1. Raise SQLALCHEMY_POOL_SIZE / DB_MAX_CONNECTIONS to match peak concurrency.\n"
            "2. Enforce query timeouts (statement_timeout in Postgres) to release stalled connections.\n"
            "3. Add a connection health-check and exponential back-off on retry logic."
        ),
        "confidence": 92,
    },
    "high_latency": {
        "root_cause":     "Unoptimised query or blocking downstream call on hot path",
        "explanation":    (
            "P99 response times are breaching SLA thresholds. Root pattern is "
            "typically an N+1 query, a missing index on a high-cardinality column, "
            "or a synchronous third-party call with no timeout guard."
        ),
        "suggested_fix":  (
            "1. Run EXPLAIN ANALYZE on the slowest queries; add composite indexes.\n"
            "2. Cache read-heavy responses in Redis with a short TTL.\n"
            "3. Offload non-critical work to an async task queue (Celery / RQ)."
        ),
        "confidence": 86,
    },
    "request_failure": {
        "root_cause":     "Unhandled exception propagating through request lifecycle",
        "explanation":    (
            "Multiple 5xx responses indicate an unguarded code path throwing "
            "uncaught exceptions. Without a circuit-breaker, each retry amplifies "
            "load on the already-degraded service."
        ),
        "suggested_fix":  (
            "1. Add a global error handler that logs full stack traces and returns structured errors.\n"
            "2. Implement a circuit-breaker (e.g. pybreaker) around failing dependencies.\n"
            "3. Set error-rate alerting: page on-call when error rate > 1% over 5 min."
        ),
        "confidence": 89,
    },
    "memory_pressure": {
        "root_cause":     "Unbounded in-memory cache with no eviction policy",
        "explanation":    (
            "Heap grows monotonically across requests. GC cannot reclaim objects "
            "held by long-lived global structures. Under sustained traffic this "
            "leads to OOM kills and unexpected worker restarts."
        ),
        "suggested_fix":  (
            "1. Replace raw dicts with functools.lru_cache or cachetools.TTLCache.\n"
            "2. Profile with tracemalloc: python -m tracemalloc -s 10 app.py.\n"
            "3. Set worker max-requests (gunicorn --max-requests 500) as a safety net."
        ),
        "confidence": 79,
    },
    "auth_failure": {
        "root_cause":     "JWT secret rotation invalidated active sessions",
        "explanation":    (
            "Signature verification is failing for tokens issued before the key "
            "rotation. Clients holding valid-looking tokens receive 401s and "
            "retry aggressively, amplifying auth service load."
        ),
        "suggested_fix":  (
            "1. Support a grace-period key list during rotation (old + new secret).\n"
            "2. Implement silent token refresh on the client before expiry.\n"
            "3. Rate-limit /auth endpoints to 10 req/s per IP to blunt brute-force."
        ),
        "confidence": 83,
    },
}

_FALLBACK_RESPONSE = {
    "root_cause":    "Anomalous log pattern — no matching rule",
    "explanation":   "Log entries deviate from known baselines but don't match a specific incident signature. Manual triage recommended.",
    "suggested_fix": "Correlate flagged lines with recent deployments, config changes, or dependency version bumps.",
    "confidence":    60,
}


def simulate_ai_response(incident: dict | None) -> dict:
    """Return a canned AI response keyed by incident id."""
    if not incident:
        return _FALLBACK_RESPONSE
    return _AI_LIBRARY.get(incident["id"], _FALLBACK_RESPONSE)
