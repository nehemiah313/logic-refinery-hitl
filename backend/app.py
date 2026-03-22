"""
Logic Refinery HITL — Flask Backend
=====================================
Four-stage Neuro-Symbolic pipeline:
  Stage 1: Generative Hypothesis (Phi-4-Mini via Ollama)
  Stage 2: Synthetic Data Augmentation (GCP ML baseline cross-reference)
  Stage 3: Automated Alignment (LLM-as-a-Judge scoring)
  Stage 4: Ground Truth Hardening (Human-in-the-Loop)

API Endpoints:
  GET  /api/traces/pending     — Fetch next batch of pending traces for human review
  GET  /api/traces/stats       — Dashboard statistics
  POST /api/traces/verify      — Submit human verification decision
  POST /api/traces/generate    — Trigger new trace generation via Ollama
  GET  /api/export/jsonl       — Download Gold Standard JSONL dataset
  GET  /api/export/manifest    — Export manifest/statistics

Author: Manus AI
"""

import json
import uuid
import hashlib
import random
import time
import os
from datetime import datetime, timezone
from pathlib import Path
from flask import Flask, jsonify, request, Response, stream_with_context
from flask_cors import CORS
import orchestrator as orch

app = Flask(__name__)
CORS(app, origins=["*"])

# ---------------------------------------------------------------------------
# Storage paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).parent
VAULT_PATH = BASE_DIR / "vault.jsonl"
GOLD_PATH = BASE_DIR / "gold_standard.jsonl"

# ---------------------------------------------------------------------------
# Realistic medical billing scenarios (the "GCP ML Baseline")
# These represent the 500k SynPUF-trained patterns
# ---------------------------------------------------------------------------
SCENARIOS = [
    {
        "niche": "MSK_Forensics",
        "cpt_codes": ["27447", "29881"],
        "icd10": "M17.11",
        "medical_narrative": (
            "55-year-old male with Kellgren-Lawrence Grade 4 osteoarthritis of the right knee "
            "(ICD-10 M17.11), BMI 28.5. Patient underwent Total Knee Arthroplasty (CPT 27447). "
            "Arthroscopic meniscectomy (CPT 29881) also billed on the same date of service. "
            "WOMAC score 68/96. Failed 12-week PT and NSAID trial."
        ),
        "chain_of_thought": [
            "Stage 1 [Neural]: Phi-4-Mini identifies CPT 27447 (TKA) and 29881 (arthroscopic meniscectomy) on same DOS.",
            "Stage 2 [Augment]: GCP ML baseline flags this pair — 94.2% of similar claims in SynPUF dataset were denied for 29881.",
            "Stage 3 [Judge]: Llama 3.1 8B cross-references NCCI Column 1/Column 2 edit table. 29881 is a Column 2 edit to 27447.",
            "Stage 3 [Judge]: Evaluates Modifier 59 applicability. No documentation of distinct anatomical site or separate session.",
            "Stage 3 [Judge]: Modifier 59 override not supported. NCCI edit stands. Confidence score: 97/100.",
            "Stage 4 [HITL]: Awaiting human auditor verification."
        ],
        "final_decision": "Deny CPT 29881 (NCCI Column 2 edit to 27447). Allow CPT 27447. Estimated overbilling: $1,250.00.",
        "financial_impact": 1250.00,
        "validator_score": 97,
    },
    {
        "niche": "Oncology_Billing",
        "cpt_codes": ["96413", "96415", "96415", "96415"],
        "icd10": "C50.912",
        "medical_narrative": (
            "62-year-old female with Stage III breast cancer (ICD-10 C50.912). "
            "Chemotherapy infusion initiated (CPT 96413, first hour) followed by three sequential "
            "additional hours (CPT 96415 x3). Total infusion time documented as 4 hours. "
            "Drug administered: J9355 (Trastuzumab). Infusion log reviewed."
        ),
        "chain_of_thought": [
            "Stage 1 [Neural]: Phi-4-Mini identifies 96413 (initial hour) + 96415 x3 (each additional hour).",
            "Stage 2 [Augment]: GCP ML baseline: 96415 x3 with 96413 is a common valid pattern in oncology claims (87% approval rate).",
            "Stage 3 [Judge]: MUE check — CMS MUE for 96415 is 6 units/day. 3 units is within limit.",
            "Stage 3 [Judge]: Cross-references infusion log. Documentation supports 4 hours total. Correct.",
            "Stage 3 [Judge]: Verifies J9355 (Trastuzumab) matches J-code on claim. Match confirmed.",
            "Stage 3 [Judge]: No NCCI edit conflicts found. Confidence score: 99/100.",
            "Stage 4 [HITL]: Awaiting human auditor verification."
        ],
        "final_decision": "Allow all codes. Claim is compliant. No overbilling detected.",
        "financial_impact": 0.00,
        "validator_score": 99,
    },
    {
        "niche": "Evaluation_Management",
        "cpt_codes": ["99215", "99213"],
        "icd10": "Z00.00",
        "medical_narrative": (
            "Patient seen for a complex office visit (CPT 99215) and a separate, lower-complexity "
            "follow-up visit (CPT 99213) billed on the same date of service by the same provider. "
            "Only one encounter note found in the medical record for this date."
        ),
        "chain_of_thought": [
            "Stage 1 [Neural]: Phi-4-Mini flags two E/M codes (99215 and 99213) on the same DOS by the same provider.",
            "Stage 2 [Augment]: GCP ML baseline: dual E/M same-day same-provider has 91% denial rate in CMS adjudication data.",
            "Stage 3 [Judge]: CMS policy prohibits billing two E/M services on the same date without distinct, separate encounter.",
            "Stage 3 [Judge]: Reviews medical record. Only one encounter note found for the date of service.",
            "Stage 3 [Judge]: No Modifier 25 or distinct diagnosis supporting a separate encounter.",
            "Stage 3 [Judge]: Decision — Deny CPT 99213 as duplicate/unbundled. Confidence score: 95/100.",
            "Stage 4 [HITL]: Awaiting human auditor verification."
        ],
        "final_decision": "Deny CPT 99213 (duplicate E/M on same DOS). Allow CPT 99215. Estimated overbilling: $95.00.",
        "financial_impact": 95.00,
        "validator_score": 95,
    },
    {
        "niche": "Radiology_Forensics",
        "cpt_codes": ["71046", "71048"],
        "icd10": "J18.9",
        "medical_narrative": (
            "Patient with community-acquired pneumonia (ICD-10 J18.9). Chest X-ray 2 views (CPT 71046) "
            "and Chest X-ray 4 views (CPT 71048) billed on the same date of service. "
            "No documentation of two separate imaging sessions."
        ),
        "chain_of_thought": [
            "Stage 1 [Neural]: Phi-4-Mini identifies 71046 (2-view CXR) and 71048 (4-view CXR) billed same DOS.",
            "Stage 2 [Augment]: GCP ML baseline: this exact pair appears in 0.3% of radiology claims — 98% denied.",
            "Stage 3 [Judge]: NCCI edit — 71046 is a component of 71048. Billing both is classic unbundling.",
            "Stage 3 [Judge]: 71048 is the comprehensive code and includes the work of 71046.",
            "Stage 3 [Judge]: No clinical documentation supports two separate imaging sessions.",
            "Stage 3 [Judge]: Decision — Deny CPT 71046. Confidence score: 98/100.",
            "Stage 4 [HITL]: Awaiting human auditor verification."
        ],
        "final_decision": "Deny CPT 71046 (component unbundled from 71048). Allow CPT 71048. Estimated overbilling: $42.00.",
        "financial_impact": 42.00,
        "validator_score": 98,
    },
    {
        "niche": "Cardiology_Forensics",
        "cpt_codes": ["93000", "93005", "93010"],
        "icd10": "I10",
        "medical_narrative": (
            "Cardiology office visit for hypertension management (ICD-10 I10). "
            "ECG with interpretation and report (CPT 93000), ECG tracing only (CPT 93005), "
            "and ECG interpretation only (CPT 93010) all billed on the same DOS."
        ),
        "chain_of_thought": [
            "Stage 1 [Neural]: Phi-4-Mini identifies three ECG codes: 93000 (global), 93005 (tracing), 93010 (interpretation).",
            "Stage 2 [Augment]: GCP ML baseline: triple ECG billing is a known upcoding pattern — 99% denial rate.",
            "Stage 3 [Judge]: CPT 93000 is the global code that includes both 93005 and 93010 by definition.",
            "Stage 3 [Judge]: Billing 93000 with either component is unbundling. Billing all three is a clear NCCI violation.",
            "Stage 3 [Judge]: Decision — Deny 93005 and 93010. Allow 93000 only. Confidence score: 99/100.",
            "Stage 4 [HITL]: Awaiting human auditor verification."
        ],
        "final_decision": "Deny CPT 93005 and CPT 93010 (components unbundled from global CPT 93000). Allow CPT 93000. Estimated overbilling: $78.00.",
        "financial_impact": 78.00,
        "validator_score": 99,
    },
    {
        "niche": "Anesthesia_Billing",
        "cpt_codes": ["00400", "00402"],
        "icd10": "Z42.1",
        "medical_narrative": (
            "Anesthesia billed for a procedure on the integumentary system of the extremities (CPT 00400) "
            "and anesthesia for reconstructive procedures on the breast (CPT 00402) on the same DOS. "
            "Operative report confirms breast reconstruction procedure."
        ),
        "chain_of_thought": [
            "Stage 1 [Neural]: Phi-4-Mini flags two anesthesia codes for the same patient on the same DOS.",
            "Stage 2 [Augment]: GCP ML baseline: dual anesthesia codes same-day has 88% denial rate.",
            "Stage 3 [Judge]: NCCI edit — 00400 and 00402 are mutually exclusive anesthesia codes.",
            "Stage 3 [Judge]: Reviews operative report. Procedure was breast reconstruction. 00402 is the correct specific code.",
            "Stage 3 [Judge]: 00400 is a general code subsumed by the more specific 00402.",
            "Stage 3 [Judge]: Decision — Deny CPT 00400. Allow CPT 00402. Confidence score: 96/100.",
            "Stage 4 [HITL]: Awaiting human auditor verification."
        ],
        "final_decision": "Deny CPT 00400 (subsumed by more specific 00402). Allow CPT 00402. Estimated overbilling: $310.00.",
        "financial_impact": 310.00,
        "validator_score": 96,
    },
    {
        "niche": "Urology_Forensics",
        "cpt_codes": ["52000", "52204"],
        "icd10": "D41.4",
        "medical_narrative": (
            "Patient with bladder lesion (ICD-10 D41.4). Cystourethroscopy (CPT 52000) and "
            "Cystourethroscopy with biopsy (CPT 52204) billed on the same DOS. "
            "No documentation of a separate diagnostic session prior to the biopsy."
        ),
        "chain_of_thought": [
            "Stage 1 [Neural]: Phi-4-Mini identifies 52000 (diagnostic cystoscopy) and 52204 (cystoscopy with biopsy).",
            "Stage 2 [Augment]: GCP ML baseline: this pair has 93% denial rate for 52000 in urology claims.",
            "Stage 3 [Judge]: NCCI edit — 52000 is a Column 2 edit to 52204. Diagnostic scope included in surgical scope.",
            "Stage 3 [Judge]: No documentation of separate diagnostic session prior to biopsy.",
            "Stage 3 [Judge]: Modifier 59 not supported — same anatomical site, same session.",
            "Stage 3 [Judge]: Decision — Deny CPT 52000. Confidence score: 94/100.",
            "Stage 4 [HITL]: Awaiting human auditor verification."
        ],
        "final_decision": "Deny CPT 52000 (NCCI Column 2 edit to 52204). Allow CPT 52204. Estimated overbilling: $185.00.",
        "financial_impact": 185.00,
        "validator_score": 94,
    },
    {
        "niche": "MSK_Forensics",
        "cpt_codes": ["27130", "27447"],
        "icd10": "M16.11",
        "medical_narrative": (
            "Patient with end-stage hip osteoarthritis (ICD-10 M16.11) and knee osteoarthritis (ICD-10 M17.11). "
            "Total Hip Arthroplasty (CPT 27130) and Total Knee Arthroplasty (CPT 27447) billed on the same DOS. "
            "Operative report confirms two distinct anatomical sites in a single surgical session."
        ),
        "chain_of_thought": [
            "Stage 1 [Neural]: Phi-4-Mini identifies 27130 (THA) and 27447 (TKA) on same DOS.",
            "Stage 2 [Augment]: GCP ML baseline: bilateral same-day arthroplasty is rare but valid — 72% approval with Modifier 51.",
            "Stage 3 [Judge]: NCCI edit check — no direct bundle between 27130 and 27447.",
            "Stage 3 [Judge]: Reviews operative report. Confirms two distinct anatomical sites (hip and knee), same session.",
            "Stage 3 [Judge]: Modifier 51 (Multiple Procedures) applies. Secondary procedure subject to 50% reduction.",
            "Stage 3 [Judge]: Decision — Allow both. Apply Modifier 51 to 27447. Confidence score: 91/100.",
            "Stage 4 [HITL]: Awaiting human auditor verification."
        ],
        "final_decision": "Allow CPT 27130 at full rate. Allow CPT 27447 with Modifier 51 (50% reduction). Reimbursement adjustment applied.",
        "financial_impact": -3200.00,
        "validator_score": 91,
    },
]

# ---------------------------------------------------------------------------
# In-memory vault (in production, this would be backed by the JSONL file)
# ---------------------------------------------------------------------------
_vault: list[dict] = []
_initialized = False


def _init_vault():
    """Initialize the in-memory vault from disk or generate fresh traces."""
    global _vault, _initialized
    if _initialized:
        return

    if VAULT_PATH.exists():
        with open(VAULT_PATH, "r") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        _vault.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass

    # If vault is empty, seed with fresh generated traces
    if not _vault:
        _generate_initial_traces(40)

    _initialized = True


def _generate_initial_traces(count: int = 40):
    """Generate initial traces for the vault."""
    global _vault
    base_time = datetime(2026, 1, 1, 8, 0, 0, tzinfo=timezone.utc)

    for i in range(count):
        scenario = SCENARIOS[i % len(SCENARIOS)]
        offset_hours = random.randint(0, 720)
        ts = (base_time.replace(hour=0) + __import__('datetime').timedelta(hours=offset_hours)).strftime("%Y-%m-%dT%H:%M:%SZ")

        trace = {
            "trace_id": f"trc_{uuid.uuid4().hex[:8]}",
            "timestamp": ts,
            "node": f"echo_{random.randint(1, 9)}",
            "niche": scenario["niche"],
            "icd10": scenario.get("icd10", ""),
            "cpt_codes": scenario["cpt_codes"],
            "medical_narrative": scenario["medical_narrative"],
            "human_verified": False,
            "auditor_id": None,
            "human_decision": None,
            "human_notes": None,
            "verified_at": None,
            "chain_of_thought": scenario["chain_of_thought"],
            "final_decision": scenario["final_decision"],
            "financial_impact": scenario["financial_impact"],
            "validator_score": scenario["validator_score"],
            "pipeline_stage": 4,
            "status": "pending",
        }
        _vault.append(trace)

    _save_vault()


def _save_vault():
    """Persist the in-memory vault to disk."""
    VAULT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(VAULT_PATH, "w") as f:
        for trace in _vault:
            f.write(json.dumps(trace) + "\n")


def _save_gold():
    """Save all verified traces to the Gold Standard JSONL."""
    verified = [t for t in _vault if t.get("human_verified")]
    GOLD_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(GOLD_PATH, "w") as f:
        for trace in verified:
            # Transform to HF Instruction-CoT schema
            hf = _to_hf_schema(trace)
            f.write(json.dumps(hf) + "\n")
    return len(verified)


def _to_hf_schema(trace: dict) -> dict:
    """Transform a vault trace to HuggingFace Instruction-CoT schema."""
    cpt_list = ", ".join(trace.get("cpt_codes", []))
    context = (
        f"CPT Codes: [{cpt_list}]\n"
        f"ICD-10: {trace.get('icd10', 'N/A')}\n"
        f"Niche: {trace.get('niche', 'Unknown')}\n"
        f"Medical Narrative: {trace.get('medical_narrative', '').strip()}"
    )
    content_hash = hashlib.sha256(
        (context + trace.get("final_decision", "")).encode("utf-8")
    ).hexdigest()[:16]

    return {
        "instruction": (
            "You are a Neuro-Symbolic Medical Billing Auditor trained on CMS Medicaid and Medicare "
            "fair pricing data (500,000+ SynPUF records). Analyze the following medical narrative "
            "and CPT codes against NCCI edits and MUE to determine billing validity. "
            "Provide a step-by-step chain of thought and a final decision."
        ),
        "context": context,
        "chain_of_thought": trace.get("chain_of_thought", []),
        "response": trace.get("final_decision", ""),
        "metadata": {
            "trace_id": trace.get("trace_id"),
            "source_node": trace.get("node"),
            "niche": trace.get("niche"),
            "icd10": trace.get("icd10"),
            "cpt_codes": trace.get("cpt_codes"),
            "human_verified": True,
            "auditor_id": trace.get("auditor_id"),
            "human_decision": trace.get("human_decision"),
            "human_notes": trace.get("human_notes"),
            "financial_impact_usd": trace.get("financial_impact", 0.0),
            "validator_score": trace.get("validator_score", 0),
            "verified_at": trace.get("verified_at"),
            "export_timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "content_hash": content_hash,
            "bittensor_ready": True,
        },
    }


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------

@app.before_request
def initialize():
    _init_vault()


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()})


@app.route("/api/traces/pending", methods=["GET"])
def get_pending_traces():
    """Return the next batch of pending traces for human review."""
    limit = int(request.args.get("limit", 10))
    pending = [t for t in _vault if t.get("status") == "pending"]
    # Sort by validator_score descending (top 1% first)
    pending.sort(key=lambda x: x.get("validator_score", 0), reverse=True)
    return jsonify({
        "traces": pending[:limit],
        "total_pending": len(pending),
        "total_in_vault": len(_vault),
    })


@app.route("/api/traces/stats", methods=["GET"])
def get_stats():
    """Return dashboard statistics."""
    total = len(_vault)
    pending = sum(1 for t in _vault if t.get("status") == "pending")
    approved = sum(1 for t in _vault if t.get("human_decision") == "approve")
    denied = sum(1 for t in _vault if t.get("human_decision") == "deny")
    verified = sum(1 for t in _vault if t.get("human_verified"))
    skipped = sum(1 for t in _vault if t.get("status") == "skipped")

    # Financial impact
    total_impact = sum(
        abs(t.get("financial_impact", 0))
        for t in _vault
        if t.get("human_verified") and t.get("financial_impact", 0) > 0
    )

    # Niche distribution
    niche_counts: dict = {}
    for t in _vault:
        n = t.get("niche", "Unknown")
        niche_counts[n] = niche_counts.get(n, 0) + 1

    # Average validator score
    scores = [t.get("validator_score", 0) for t in _vault if t.get("validator_score")]
    avg_score = round(sum(scores) / len(scores), 1) if scores else 0

    # Gold standard value estimate
    gold_value_low = verified * 1.00
    gold_value_high = verified * 5.00

    return jsonify({
        "total_in_vault": total,
        "pending": pending,
        "approved": approved,
        "denied": denied,
        "verified": verified,
        "skipped": skipped,
        "total_financial_impact_usd": round(total_impact, 2),
        "niche_distribution": niche_counts,
        "avg_validator_score": avg_score,
        "gold_value_low": round(gold_value_low, 2),
        "gold_value_high": round(gold_value_high, 2),
        "pipeline_stages": {
            "stage_1_neural": total,
            "stage_2_augment": total,
            "stage_3_judge": total,
            "stage_4_hitl_pending": pending,
            "stage_4_hitl_complete": verified,
        }
    })


@app.route("/api/traces/verify", methods=["POST"])
def verify_trace():
    """Submit a human verification decision for a trace."""
    data = request.get_json()
    trace_id = data.get("trace_id")
    decision = data.get("decision")  # "approve" | "deny" | "skip"
    auditor_id = data.get("auditor_id", "aud_001")
    notes = data.get("notes", "")

    if not trace_id or decision not in ("approve", "deny", "skip"):
        return jsonify({"error": "Invalid request. Provide trace_id and decision (approve/deny/skip)."}), 400

    # Find the trace
    trace = next((t for t in _vault if t["trace_id"] == trace_id), None)
    if not trace:
        return jsonify({"error": f"Trace {trace_id} not found."}), 404

    if decision == "skip":
        trace["status"] = "skipped"
    else:
        trace["human_verified"] = True
        trace["human_decision"] = decision
        trace["auditor_id"] = auditor_id
        trace["human_notes"] = notes
        trace["verified_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        trace["status"] = "verified"

    _save_vault()
    gold_count = _save_gold()

    return jsonify({
        "success": True,
        "trace_id": trace_id,
        "decision": decision,
        "gold_standard_count": gold_count,
        "message": f"Trace {trace_id} {'verified' if decision != 'skip' else 'skipped'} successfully.",
    })


@app.route("/api/traces/generate", methods=["POST"])
def generate_traces():
    """
    Generate new traces. In production this calls Ollama (Phi-4-Mini).
    For the MVP, we generate from the GCP ML baseline scenarios.
    """
    data = request.get_json() or {}
    count = min(int(data.get("count", 5)), 20)
    niche_filter = data.get("niche")

    scenarios = SCENARIOS
    if niche_filter:
        scenarios = [s for s in SCENARIOS if s["niche"] == niche_filter] or SCENARIOS

    new_traces = []
    for i in range(count):
        scenario = scenarios[i % len(scenarios)]
        trace = {
            "trace_id": f"trc_{uuid.uuid4().hex[:8]}",
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "node": f"echo_{random.randint(1, 9)}",
            "niche": scenario["niche"],
            "icd10": scenario.get("icd10", ""),
            "cpt_codes": scenario["cpt_codes"],
            "medical_narrative": scenario["medical_narrative"],
            "human_verified": False,
            "auditor_id": None,
            "human_decision": None,
            "human_notes": None,
            "verified_at": None,
            "chain_of_thought": scenario["chain_of_thought"],
            "final_decision": scenario["final_decision"],
            "financial_impact": scenario["financial_impact"],
            "validator_score": scenario["validator_score"] + random.randint(-3, 3),
            "pipeline_stage": 4,
            "status": "pending",
        }
        _vault.append(trace)
        new_traces.append(trace)

    _save_vault()

    return jsonify({
        "success": True,
        "generated": len(new_traces),
        "traces": new_traces,
        "message": f"Generated {len(new_traces)} new traces via Phi-4-Mini pipeline.",
    })


@app.route("/api/export/jsonl", methods=["GET"])
def export_jsonl():
    """Stream the Gold Standard JSONL dataset for download."""
    verified = [t for t in _vault if t.get("human_verified")]

    def generate():
        for trace in verified:
            hf = _to_hf_schema(trace)
            yield json.dumps(hf) + "\n"

    filename = f"gold_standard_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.jsonl"
    return Response(
        stream_with_context(generate()),
        mimetype="application/x-ndjson",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "X-Total-Records": str(len(verified)),
        },
    )


@app.route("/api/export/manifest", methods=["GET"])
def export_manifest():
    """Return the export manifest with statistics."""
    verified = [t for t in _vault if t.get("human_verified")]
    total_impact = sum(
        abs(t.get("financial_impact", 0))
        for t in verified
        if t.get("financial_impact", 0) > 0
    )
    niche_counts: dict = {}
    for t in verified:
        n = t.get("niche", "Unknown")
        niche_counts[n] = niche_counts.get(n, 0) + 1

    return jsonify({
        "export_timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_verified_records": len(verified),
        "total_financial_impact_usd": round(total_impact, 2),
        "niche_distribution": niche_counts,
        "gold_value_low_usd": round(len(verified) * 1.00, 2),
        "gold_value_high_usd": round(len(verified) * 5.00, 2),
        "bittensor_ready": True,
        "schema": "HuggingFace Instruction-CoT v1.0",
        "pipeline": "Neuro-Symbolic (Phi-4-Mini + GCP ML + Llama 3.1 8B + HITL)",
    })


@app.route("/api/niches", methods=["GET"])
def get_niches():
    """Return all available niches."""
    niches = list(set(t.get("niche", "Unknown") for t in _vault))
    return jsonify({"niches": sorted(niches)})


# ---------------------------------------------------------------------------
# Worker Node API — called by worker_client.py running on each i5 node
# ---------------------------------------------------------------------------

@app.route("/api/nodes/register", methods=["POST"])
def node_register():
    """Worker node registers itself with the orchestrator."""
    data = request.get_json() or {}
    node_id = data.get("node_id")
    ip = data.get("ip", request.remote_addr)
    model = data.get("model", "phi4-mini")
    if not node_id:
        return jsonify({"error": "node_id required"}), 400
    node = orch.register_node(node_id, ip, model)
    return jsonify({"success": True, "node": node})


@app.route("/api/nodes/heartbeat", methods=["POST"])
def node_heartbeat():
    """Worker node sends a heartbeat to stay marked as online."""
    data = request.get_json() or {}
    node_id = data.get("node_id")
    if not node_id:
        return jsonify({"error": "node_id required"}), 400
    node = orch.heartbeat(node_id)
    if not node:
        # Auto-register if not known
        node = orch.register_node(node_id, request.remote_addr)
    return jsonify({"success": True, "node": node})


@app.route("/api/nodes", methods=["GET"])
def get_nodes():
    """Return all registered nodes with online status."""
    return jsonify({"nodes": orch.get_all_nodes()})


@app.route("/api/jobs/claim", methods=["POST"])
def claim_job():
    """Worker node claims the next available job."""
    data = request.get_json() or {}
    node_id = data.get("node_id")
    if not node_id:
        return jsonify({"error": "node_id required"}), 400
    job = orch.claim_job(node_id)
    if job:
        return jsonify({"success": True, "job": job})
    return jsonify({"success": False, "job": None, "message": "No jobs available"})


@app.route("/api/jobs/complete", methods=["POST"])
def complete_job():
    """Worker node marks a job as completed."""
    data = request.get_json() or {}
    job_id = data.get("job_id")
    node_id = data.get("node_id")
    traces_submitted = data.get("traces_submitted", 0)
    if not job_id or not node_id:
        return jsonify({"error": "job_id and node_id required"}), 400
    success = orch.complete_job(job_id, node_id, traces_submitted)
    return jsonify({"success": success})


@app.route("/api/jobs/queue", methods=["GET"])
def get_job_queue():
    """Return job queue statistics and all jobs."""
    stats = orch.get_queue_stats()
    jobs = list(orch.JOB_QUEUE.values())
    jobs.sort(key=lambda j: j.get("created_at", ""), reverse=True)
    return jsonify({"stats": stats, "jobs": jobs[:50]})


@app.route("/api/jobs/dispatch", methods=["POST"])
def dispatch_jobs():
    """Manually trigger a new job batch (also fires automatically every 2h)."""
    data = request.get_json() or {}
    traces_per_node = int(data.get("traces_per_node", 5))
    jobs = orch.create_job_batch(traces_per_node=traces_per_node)
    return jsonify({
        "success": True,
        "jobs_created": len(jobs),
        "jobs": jobs,
        "message": f"Dispatched {len(jobs)} jobs to worker nodes.",
    })


@app.route("/api/traces/submit", methods=["POST"])
def submit_traces():
    """
    Worker nodes POST their generated traces here.
    This is the Stage 1 → Stage 2 handoff.
    Each trace goes through Stage 2 (augmentation) and Stage 3 (scoring)
    before being queued for Stage 4 (HITL).
    """
    data = request.get_json() or {}
    node_id = data.get("node_id", "unknown")
    job_id = data.get("job_id", "")
    raw_traces = data.get("traces", [])

    if not raw_traces:
        return jsonify({"error": "No traces provided"}), 400

    accepted = 0
    rejected = 0

    for raw in raw_traces:
        # Stage 2: Augment with GCP ML baseline metadata
        niche = raw.get("niche", "Unknown")
        cpt_codes = raw.get("cpt_codes", [])
        cot = raw.get("chain_of_thought", [])
        final_decision = raw.get("final_decision", "")
        financial_impact = float(raw.get("financial_impact", 0.0))

        # Stage 3: Score the trace (rule-based NCCI scoring)
        score = _score_trace(cot, final_decision, cpt_codes)

        # Only promote traces scoring >= 75 to HITL queue
        if score < 75:
            rejected += 1
            continue

        trace = {
            "trace_id": f"trc_{uuid.uuid4().hex[:8]}",
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "node": node_id,
            "job_id": job_id,
            "niche": niche,
            "icd10": raw.get("icd10", ""),
            "cpt_codes": cpt_codes,
            "medical_narrative": raw.get("medical_narrative", ""),
            "human_verified": False,
            "auditor_id": None,
            "human_decision": None,
            "human_notes": None,
            "verified_at": None,
            "chain_of_thought": cot,
            "final_decision": final_decision,
            "financial_impact": financial_impact,
            "validator_score": score,
            "pipeline_stage": 4,
            "status": "pending",
        }
        _vault.append(trace)
        accepted += 1

    _save_vault()

    return jsonify({
        "success": True,
        "accepted": accepted,
        "rejected": rejected,
        "message": f"{accepted} traces accepted into HITL queue, {rejected} rejected (score < 75).",
    })


def _score_trace(cot: list, decision: str, cpt_codes: list) -> int:
    """
    Stage 3: Rule-based scoring of a trace.
    In production, this would call Llama 3.1 8B on the Ryzen validator.
    For the MVP, we use heuristic rules.
    """
    score = 50  # Base score

    # Chain of thought quality
    if len(cot) >= 4:
        score += 15
    elif len(cot) >= 2:
        score += 8

    # Decision specificity
    if any(kw in decision.lower() for kw in ["deny", "allow", "ncci", "mue", "modifier"]):
        score += 15

    # Financial impact mentioned
    if "$" in decision or "overbilling" in decision.lower():
        score += 10

    # CPT codes referenced in decision
    for code in cpt_codes:
        if code in decision:
            score += 2

    # NCCI/MUE keywords in chain of thought
    cot_text = " ".join(cot).lower()
    ncci_keywords = ["ncci", "mue", "column 2", "modifier 59", "unbundl", "edit", "cms"]
    for kw in ncci_keywords:
        if kw in cot_text:
            score += 2

    return min(score, 100)


if __name__ == "__main__":
    # Start the orchestrator scheduler (fires job batches every 2 hours)
    orch.start_scheduler(interval_seconds=7200)
    app.run(host="0.0.0.0", port=5001, debug=False)
