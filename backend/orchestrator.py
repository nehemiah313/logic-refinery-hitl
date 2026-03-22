"""
Logic Refinery — Orchestrator
================================
Runs alongside Flask. Manages:
  - Job queue: generates job specs and dispatches to worker nodes
  - Node registry: tracks which nodes are alive and their last heartbeat
  - Cycle scheduler: fires a new generation batch every 2 hours

This module is imported by app.py and runs in a background thread.

Author: Manus AI
"""

import json
import uuid
import random
import threading
import time
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

logger = logging.getLogger("orchestrator")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")

# ---------------------------------------------------------------------------
# Job Specs — the "prompts" sent to worker nodes
# Each spec tells a worker WHAT to generate and HOW
# ---------------------------------------------------------------------------
JOB_SPECS = [
    {
        "niche": "MSK_Forensics",
        "cpt_codes": ["27447", "29881"],
        "icd10": "M17.11",
        "scenario": "TKA with same-day arthroscopic meniscectomy — NCCI Column 2 edit",
        "prompt_template": (
            "You are a medical billing AI auditor. A claim was submitted for a 55-year-old male "
            "with Kellgren-Lawrence Grade 4 osteoarthritis (ICD-10 M17.11). "
            "CPT 27447 (Total Knee Arthroplasty) and CPT 29881 (Arthroscopic Meniscectomy) were billed "
            "on the same date of service. "
            "Analyze this claim against NCCI edits. Provide a step-by-step chain of thought "
            "and a final billing decision. Format your response as JSON with keys: "
            "'chain_of_thought' (array of strings), 'final_decision' (string), 'financial_impact' (float)."
        ),
    },
    {
        "niche": "Oncology_Billing",
        "cpt_codes": ["96413", "96415", "96415", "96415"],
        "icd10": "C50.912",
        "scenario": "Chemotherapy infusion — MUE unit validation (4-hour Pertuzumab infusion)",
        "prompt_template": (
            "You are a medical billing AI auditor. A claim was submitted for a 62-year-old female "
            "with Stage III HER2-positive left breast cancer (ICD-10 C50.912). "
            "CPT 96413 (initial chemotherapy infusion, first hour) and CPT 96415 x3 "
            "(additional infusion hours, each >30 min beyond first hour) were billed. "
            "Drug administered: J9306 (Pertuzumab/Perjeta, 840mg IV). Total infusion time: 4 hours. "
            "CMS MUE for CPT 96415 is 6 units per day. "
            "Validate the submitted units against CMS MUE limits. Determine if the claim is payable "
            "as submitted or if a unit reduction is required. "
            "Provide chain_of_thought array and final_decision string."
        ),
    },
    {
        "niche": "Evaluation_Management",
        "cpt_codes": ["99215", "99213"],
        "icd10": "E11.9",
        "scenario": "Dual E/M codes same-day same-provider — duplicate billing audit",
        "prompt_template": (
            "You are a medical billing AI auditor. A provider billed CPT 99215 (Level 5 "
            "established patient office visit, high medical decision complexity) and CPT 99213 "
            "(Level 3 established patient office visit, low medical decision complexity) "
            "on the same date of service for the same patient with Type 2 diabetes mellitus "
            "(ICD-10 E11.9). Only one encounter note exists in the medical record. "
            "No modifier 25 or documentation of a separate, distinct encounter is present. "
            "Per CMS Claims Processing Manual Chapter 12 §30.6.7, only one E/M service "
            "may be billed per provider per date of service for the same patient unless "
            "a separate and distinct encounter is documented with modifier 25. "
            "Analyze for duplicate billing. Identify which code should be denied and calculate "
            "the financial impact of the denial. "
            "Provide chain_of_thought array and final_decision string."
        ),
    },
    {
        "niche": "Radiology_Forensics",
        "cpt_codes": ["71046", "71048"],
        "icd10": "J18.9",
        "scenario": "Chest X-ray unbundling — component code billed with comprehensive",
        "prompt_template": (
            "You are a medical billing AI auditor. A claim includes CPT 71046 (2-view CXR) "
            "and CPT 71048 (4-view CXR) on the same date for a patient with pneumonia (ICD-10 J18.9). "
            "No documentation of two separate imaging sessions. "
            "Analyze for unbundling. Provide chain_of_thought array and final_decision string."
        ),
    },
    {
        "niche": "Cardiology_Forensics",
        "cpt_codes": ["93000", "93005", "93010"],
        "icd10": "I10",
        "scenario": "ECG triple billing — global + both components",
        "prompt_template": (
            "You are a medical billing AI auditor. A cardiology claim includes CPT 93000 (ECG global), "
            "CPT 93005 (ECG tracing only), and CPT 93010 (ECG interpretation only) "
            "on the same date for a hypertension patient (ICD-10 I10). "
            "Analyze for unbundling of global code. Provide chain_of_thought array and final_decision string."
        ),
    },
    {
        "niche": "Anesthesia_Billing",
        "cpt_codes": ["00400", "00402"],
        "icd10": "Z42.1",
        "scenario": "Dual anesthesia codes — catch-all vs. site-specific mutual exclusivity",
        "prompt_template": (
            "You are a medical billing AI auditor. An anesthesia claim includes both CPT 00400 "
            "(Anesthesia for procedures on the integumentary system, extremities, anterior trunk "
            "and perineum — a catch-all code) and CPT 00402 (Anesthesia for reconstructive "
            "procedures of the breast, e.g., reduction or augmentation mammoplasty, muscle flaps) "
            "on the same date of service. The patient's diagnosis is ICD-10 Z42.1 (Encounter for "
            "breast reconstruction following mastectomy). The operative report confirms a single "
            "procedure: left breast reconstruction with TRAM flap. No second surgical site is "
            "documented. Per 2026 NCCI Chapter II, anesthesia codes are mutually exclusive for "
            "the same surgical encounter — only the most specific applicable code may be billed. "
            "CPT 00400 was billed erroneously as a catch-all; CPT 00402 is the correct "
            "site-specific anesthesia code for breast reconstruction. "
            "Analyze NCCI mutual exclusivity, identify the correct payable code, and determine "
            "which code should be denied. Provide chain_of_thought array and final_decision string."
        ),
    },
    {
        "niche": "Urology_Forensics",
        "cpt_codes": ["52000", "52204"],
        "icd10": "D41.4",
        "scenario": "Cystoscopy + biopsy — diagnostic scope included in surgical scope",
        "prompt_template": (
            "You are a medical billing AI auditor. A urology claim includes CPT 52000 "
            "(diagnostic cystoscopy) and CPT 52204 (cystoscopy with biopsy) "
            "on the same date for a bladder lesion patient (ICD-10 D41.4). "
            "No separate diagnostic session documented. "
            "Analyze NCCI Column 2 edit. Provide chain_of_thought array and final_decision string."
        ),
    },
]


# ---------------------------------------------------------------------------
# In-memory state (shared with app.py via module-level dicts)
# ---------------------------------------------------------------------------

# Node registry: node_id → {last_seen, status, jobs_completed, current_job}
NODE_REGISTRY: dict[str, dict] = {}

# Job queue: job_id → job dict
JOB_QUEUE: dict[str, dict] = {}

# Lock for thread safety
_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Node Registry
# ---------------------------------------------------------------------------

def register_node(node_id: str, ip: str, model: str = "phi4-mini") -> dict:
    """Register or update a worker node."""
    with _lock:
        if node_id not in NODE_REGISTRY:
            NODE_REGISTRY[node_id] = {
                "node_id": node_id,
                "ip": ip,
                "model": model,
                "status": "idle",
                "registered_at": _now(),
                "last_seen": _now(),
                "jobs_completed": 0,
                "traces_submitted": 0,
                "current_job": None,
                "errors": 0,
            }
            logger.info(f"New node registered: {node_id} @ {ip}")
        else:
            NODE_REGISTRY[node_id]["last_seen"] = _now()
            NODE_REGISTRY[node_id]["ip"] = ip
            NODE_REGISTRY[node_id]["status"] = "idle"
        return NODE_REGISTRY[node_id]


def heartbeat(node_id: str) -> Optional[dict]:
    """Update a node's last-seen timestamp."""
    with _lock:
        if node_id in NODE_REGISTRY:
            NODE_REGISTRY[node_id]["last_seen"] = _now()
            return NODE_REGISTRY[node_id]
        return None


def get_all_nodes() -> list[dict]:
    """Return all registered nodes with staleness detection."""
    now = datetime.now(timezone.utc)
    nodes = []
    with _lock:
        for node in NODE_REGISTRY.values():
            n = dict(node)
            try:
                last = datetime.fromisoformat(n["last_seen"].replace("Z", "+00:00"))
                seconds_ago = (now - last).total_seconds()
                n["seconds_since_seen"] = int(seconds_ago)
                if seconds_ago < 90:
                    n["online"] = True
                elif seconds_ago < 300:
                    n["online"] = True  # grace period
                    n["status"] = "stale"
                else:
                    n["online"] = False
                    n["status"] = "offline"
            except Exception:
                n["online"] = False
                n["seconds_since_seen"] = 9999
            nodes.append(n)
    return nodes


# ---------------------------------------------------------------------------
# Job Queue
# ---------------------------------------------------------------------------

def create_job_batch(traces_per_node: int = 5) -> list[dict]:
    """
    Create a batch of jobs — one per registered node (or 7 if none registered yet).
    Each job is assigned to a specific node.
    """
    with _lock:
        active_nodes = [
            nid for nid, n in NODE_REGISTRY.items()
            if n.get("status") in ("idle", "stale")
        ]

    # If no nodes registered yet, create 7 placeholder jobs
    if not active_nodes:
        active_nodes = [f"node_{str(i+1).zfill(2)}" for i in range(7)]

    jobs = []
    specs = JOB_SPECS.copy()
    random.shuffle(specs)

    for i, node_id in enumerate(active_nodes):
        spec = specs[i % len(specs)]
        job = {
            "job_id": f"job_{uuid.uuid4().hex[:8]}",
            "assigned_to": node_id,
            "niche": spec["niche"],
            "cpt_codes": spec["cpt_codes"],
            "icd10": spec["icd10"],
            "scenario": spec["scenario"],
            "prompt_template": spec["prompt_template"],
            "traces_requested": traces_per_node,
            "status": "queued",
            "created_at": _now(),
            "claimed_at": None,
            "completed_at": None,
            "deadline": (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        with _lock:
            JOB_QUEUE[job["job_id"]] = job
        jobs.append(job)
        logger.info(f"Job created: {job['job_id']} → {node_id} ({spec['niche']})")

    return jobs


def claim_job(node_id: str) -> Optional[dict]:
    """
    A worker node calls this to claim the next available job assigned to it.
    Falls back to any unclaimed queued job if none are assigned.
    """
    with _lock:
        # First: look for a job specifically assigned to this node
        for job in JOB_QUEUE.values():
            if job["status"] == "queued" and job["assigned_to"] == node_id:
                job["status"] = "in_progress"
                job["claimed_at"] = _now()
                if node_id in NODE_REGISTRY:
                    NODE_REGISTRY[node_id]["status"] = "working"
                    NODE_REGISTRY[node_id]["current_job"] = job["job_id"]
                logger.info(f"Job {job['job_id']} claimed by {node_id}")
                return dict(job)

        # Fallback: any unclaimed queued job
        for job in JOB_QUEUE.values():
            if job["status"] == "queued":
                job["status"] = "in_progress"
                job["claimed_at"] = _now()
                job["assigned_to"] = node_id  # reassign
                if node_id in NODE_REGISTRY:
                    NODE_REGISTRY[node_id]["status"] = "working"
                    NODE_REGISTRY[node_id]["current_job"] = job["job_id"]
                logger.info(f"Job {job['job_id']} claimed (fallback) by {node_id}")
                return dict(job)

    return None  # No jobs available


def complete_job(job_id: str, node_id: str, traces_submitted: int) -> bool:
    """Mark a job as completed."""
    with _lock:
        if job_id in JOB_QUEUE:
            JOB_QUEUE[job_id]["status"] = "completed"
            JOB_QUEUE[job_id]["completed_at"] = _now()
            JOB_QUEUE[job_id]["traces_submitted"] = traces_submitted
            if node_id in NODE_REGISTRY:
                NODE_REGISTRY[node_id]["status"] = "idle"
                NODE_REGISTRY[node_id]["current_job"] = None
                NODE_REGISTRY[node_id]["jobs_completed"] += 1
                NODE_REGISTRY[node_id]["traces_submitted"] += traces_submitted
            logger.info(f"Job {job_id} completed by {node_id} — {traces_submitted} traces")
            return True
    return False


def get_queue_stats() -> dict:
    """Return job queue statistics."""
    with _lock:
        total = len(JOB_QUEUE)
        queued = sum(1 for j in JOB_QUEUE.values() if j["status"] == "queued")
        in_progress = sum(1 for j in JOB_QUEUE.values() if j["status"] == "in_progress")
        completed = sum(1 for j in JOB_QUEUE.values() if j["status"] == "completed")
        failed = sum(1 for j in JOB_QUEUE.values() if j["status"] == "failed")
    return {
        "total_jobs": total,
        "queued": queued,
        "in_progress": in_progress,
        "completed": completed,
        "failed": failed,
    }


# ---------------------------------------------------------------------------
# Background Scheduler — fires every 2 hours
# ---------------------------------------------------------------------------

def _scheduler_loop(interval_seconds: int = 7200):
    """
    Background thread that fires a new job batch every `interval_seconds`.
    Default: 7200 seconds = 2 hours.
    """
    logger.info(f"Orchestrator scheduler started — cycle every {interval_seconds}s ({interval_seconds//3600}h)")

    # Fire immediately on first start
    _fire_cycle()

    while True:
        time.sleep(interval_seconds)
        _fire_cycle()


def _fire_cycle():
    """Create a new job batch and log the cycle."""
    logger.info("=== GENERATION CYCLE FIRING ===")
    jobs = create_job_batch(traces_per_node=5)
    logger.info(f"Dispatched {len(jobs)} jobs to worker nodes")


def start_scheduler(interval_seconds: int = 7200):
    """Start the background scheduler in a daemon thread."""
    t = threading.Thread(
        target=_scheduler_loop,
        args=(interval_seconds,),
        daemon=True,
        name="orchestrator-scheduler",
    )
    t.start()
    logger.info("Orchestrator scheduler thread started")
    return t


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
