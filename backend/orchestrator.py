"""
Logic Refinery — Orchestrator
================================
Runs alongside Flask. Manages:
  - Job queue: generates job specs and dispatches to worker nodes
  - Node registry: tracks which nodes are alive and their last heartbeat
  - Cycle scheduler: fires a new generation batch every 2 hours

Gold Standard Schema (v2.1):
  Each job spec now includes:
    - ncci_citation: explicit regulatory citation (2026 NCCI Manual or CMS Claims Processing Manual)
    - oig_priority: True if this niche appears on the 2026 OIG Work Plan
    - prompt_template: upgraded to Gold Standard format with <think> tag, axiom-driven logic,
      and multi-stage Read → Analyze → Plan → Implement → Verify trajectory

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
# Gold Standard Prompt Header — injected into every job spec prompt
# Instructs Phi-4-Mini to produce <think> tag reasoning with axiom-driven
# multi-stage trajectories per the Messari "Logic Oil" specification.
# ---------------------------------------------------------------------------
_GOLD_PROMPT_HEADER = (
    "You are a Neuro-Symbolic Medical Billing Auditor operating within the Logic Refinery pipeline. "
    "Your reasoning MUST follow the Gold Standard multi-stage trajectory:\n"
    "  Stage 1 [READ]: Identify all CPT codes, ICD-10 codes, modifiers, and claim metadata.\n"
    "  Stage 2 [ANALYZE]: Cross-reference each code pair against the applicable NCCI edit table or MUE limit.\n"
    "  Stage 3 [PLAN]: Identify the specific regulatory axiom (NCCI chapter/section or CMS Manual citation) "
    "that governs this claim.\n"
    "  Stage 4 [IMPLEMENT]: Apply the axiom. Determine which codes are payable, which are denied, "
    "and calculate the financial impact in USD.\n"
    "  Stage 5 [VERIFY]: Confirm the decision is internally consistent. Check for Modifier exceptions "
    "(Modifier 25, 51, 59, XS, XU) that could override the edit.\n\n"
    "Format your ENTIRE response as a single JSON object with these exact keys:\n"
    "  'logic_trace': a string containing your full reasoning enclosed in <think>...</think> tags, "
    "with each stage numbered and labeled.\n"
    "  'chain_of_thought': an array of strings, one per reasoning step (mirrors logic_trace in structured form).\n"
    "  'final_decision': a single string with the billing verdict and financial impact.\n"
    "  'financial_impact': a float (positive = overbilling detected, negative = underpayment, 0 = compliant).\n"
    "  'ncci_citation': a string with the exact regulatory citation used.\n"
    "  'confidence': a float between 0.0 and 1.0.\n\n"
)

# ---------------------------------------------------------------------------
# Job Specs — the "prompts" sent to worker nodes
# 10 specs across 10 niches (7 original + 3 new OIG 2026 priority niches)
# ---------------------------------------------------------------------------
JOB_SPECS = [
    # -----------------------------------------------------------------------
    # 1. MSK Forensics — TKA + arthroscopic meniscectomy unbundling
    # -----------------------------------------------------------------------
    {
        "niche": "MSK_Forensics",
        "cpt_codes": ["27447", "29881"],
        "icd10": "M17.11",
        "ncci_citation": "2026 NCCI Ch. IV §E(1) — Surgical arthroscopy includes diagnostic arthroscopy; CPT 29881 is Column 2 edit to CPT 27447",
        "oig_priority": True,
        "scenario": "TKA with same-day arthroscopic meniscectomy — NCCI Column 2 edit",
        "prompt_template": (
            _GOLD_PROMPT_HEADER +
            "CLAIM DATA:\n"
            "  Patient: 55-year-old male, BMI 28.5\n"
            "  Diagnosis: ICD-10 M17.11 (Unilateral primary osteoarthritis, right knee), "
            "Kellgren-Lawrence Grade 4 confirmed on weight-bearing X-ray.\n"
            "  CPT 27447 — Total Knee Arthroplasty (TKA)\n"
            "  CPT 29881 — Arthroscopic Meniscectomy, medial and/or lateral\n"
            "  Date of Service: Single operative session. No separate arthroscopic session documented.\n"
            "  Regulatory Axiom: 2026 NCCI Ch. IV §E(1) — CPT 29881 is a Column 2 edit to CPT 27447. "
            "Modifier 59 requires documentation of a distinct procedural service at a separate anatomical site "
            "or a separate session. No such documentation exists.\n"
            "Analyze this claim. Apply the Gold Standard multi-stage trajectory."
        ),
    },
    # -----------------------------------------------------------------------
    # 2. Oncology — Chemotherapy MUE unit validation
    # -----------------------------------------------------------------------
    {
        "niche": "Oncology_Billing",
        "cpt_codes": ["96413", "96415", "96415", "96415"],
        "icd10": "C50.912",
        "ncci_citation": "2026 NCCI Ch. XI §A(2) — CPT 96413 is initial service; CPT 96415 MUE = 6 units/day per CMS MUE Table v2026Q1",
        "oig_priority": True,
        "scenario": "Chemotherapy infusion — MUE unit validation (4-hour Pertuzumab infusion)",
        "prompt_template": (
            _GOLD_PROMPT_HEADER +
            "CLAIM DATA:\n"
            "  Patient: 62-year-old female\n"
            "  Diagnosis: ICD-10 C50.912 (Stage III HER2-positive left breast cancer)\n"
            "  CPT 96413 — Chemotherapy administration, intravenous infusion technique, up to 1 hour\n"
            "  CPT 96415 x3 — Each additional hour of chemotherapy infusion (>30 min beyond first hour)\n"
            "  Drug: J9306 (Pertuzumab/Perjeta, 840mg IV). Total documented infusion time: 4 hours.\n"
            "  CMS MUE for CPT 96415: 6 units per day (CMS MUE Table v2026Q1).\n"
            "  Regulatory Axiom: 2026 NCCI Ch. XI §A(2) — 96413 covers the first hour; each 96415 unit "
            "covers each additional hour beyond the first. 3 units of 96415 for a 4-hour infusion is correct.\n"
            "Validate the submitted units against CMS MUE limits. Determine if the claim is payable as submitted. "
            "Apply the Gold Standard multi-stage trajectory."
        ),
    },
    # -----------------------------------------------------------------------
    # 3. Evaluation & Management — Dual E/M same-day duplicate billing
    # -----------------------------------------------------------------------
    {
        "niche": "Evaluation_Management",
        "cpt_codes": ["99215", "99213"],
        "icd10": "E11.9",
        "ncci_citation": "CMS Claims Processing Manual Ch. 12 §30.6.7 — One E/M per provider per DOS; Modifier 25 requires separate, distinct encounter with new diagnosis",
        "oig_priority": True,
        "scenario": "Dual E/M codes same-day same-provider — duplicate billing audit",
        "prompt_template": (
            _GOLD_PROMPT_HEADER +
            "CLAIM DATA:\n"
            "  Patient: Established patient with Type 2 diabetes mellitus (ICD-10 E11.9)\n"
            "  CPT 99215 — Level 5 established patient office visit (high medical decision complexity, "
            "requires 40+ min or high MDM)\n"
            "  CPT 99213 — Level 3 established patient office visit (low medical decision complexity)\n"
            "  Date of Service: Same date, same provider, same patient.\n"
            "  Medical Record: Only one encounter note found for this date. No Modifier 25 appended. "
            "No documentation of a separate, distinct encounter or new problem.\n"
            "  Regulatory Axiom: CMS Claims Processing Manual Ch. 12 §30.6.7 — A provider may not bill "
            "two E/M services on the same date for the same patient without Modifier 25 and documentation "
            "of a separate, distinct medical problem requiring additional evaluation.\n"
            "Analyze for duplicate billing. Identify which code should be denied and calculate the financial "
            "impact. Apply the Gold Standard multi-stage trajectory."
        ),
    },
    # -----------------------------------------------------------------------
    # 4. Radiology Forensics — Chest X-ray unbundling
    # -----------------------------------------------------------------------
    {
        "niche": "Radiology_Forensics",
        "cpt_codes": ["71046", "71048"],
        "icd10": "J18.9",
        "ncci_citation": "2026 NCCI Ch. VIII — CPT 71046 (2-view CXR) is a component of CPT 71048 (4-view CXR); billing both without two distinct sessions is unbundling",
        "oig_priority": False,
        "scenario": "Chest X-ray unbundling — component code billed with comprehensive code",
        "prompt_template": (
            _GOLD_PROMPT_HEADER +
            "CLAIM DATA:\n"
            "  Patient: Community-acquired pneumonia (ICD-10 J18.9)\n"
            "  CPT 71046 — Radiologic examination, chest, 2 views\n"
            "  CPT 71048 — Radiologic examination, chest, 4 or more views\n"
            "  Date of Service: Same date. No documentation of two separate imaging sessions.\n"
            "  Regulatory Axiom: 2026 NCCI Ch. VIII — CPT 71046 is a component code of CPT 71048. "
            "The 4-view study includes the 2-view study by definition. Billing both without documentation "
            "of two distinct, separate imaging sessions constitutes unbundling.\n"
            "Analyze for unbundling. Apply the Gold Standard multi-stage trajectory."
        ),
    },
    # -----------------------------------------------------------------------
    # 5. Cardiology Forensics — ECG global + both components triple billing
    # -----------------------------------------------------------------------
    {
        "niche": "Cardiology_Forensics",
        "cpt_codes": ["93000", "93005", "93010"],
        "icd10": "I10",
        "ncci_citation": "2026 NCCI Ch. IX §12 — CPT 93000 (global ECG) includes CPT 93005 (tracing) and CPT 93010 (interpretation); component codes are not separately reportable with the global code",
        "oig_priority": False,
        "scenario": "ECG triple billing — global code billed with both component codes",
        "prompt_template": (
            _GOLD_PROMPT_HEADER +
            "CLAIM DATA:\n"
            "  Patient: Hypertension management visit (ICD-10 I10)\n"
            "  CPT 93000 — Electrocardiogram, routine ECG with at least 12 leads; with interpretation and report\n"
            "  CPT 93005 — Electrocardiogram, routine ECG with at least 12 leads; tracing only, without interpretation and report\n"
            "  CPT 93010 — Electrocardiogram, routine ECG with at least 12 leads; interpretation and report only\n"
            "  Date of Service: All three codes billed same date, same provider.\n"
            "  Regulatory Axiom: 2026 NCCI Ch. IX §12 — CPT 93000 is the global code that includes both "
            "the technical component (93005) and the professional component (93010). Billing the global code "
            "with either or both component codes is unbundling and violates NCCI.\n"
            "Analyze for unbundling. Identify which codes should be denied. Apply the Gold Standard multi-stage trajectory."
        ),
    },
    # -----------------------------------------------------------------------
    # 6. Anesthesia Billing — catch-all vs. site-specific mutual exclusivity
    # -----------------------------------------------------------------------
    {
        "niche": "Anesthesia_Billing",
        "cpt_codes": ["00400", "00402"],
        "icd10": "Z42.1",
        "ncci_citation": "2026 NCCI Ch. II §B — Anesthesia codes are mutually exclusive per surgical encounter; the most specific applicable code is the only payable code",
        "oig_priority": False,
        "scenario": "Dual anesthesia codes — catch-all vs. site-specific mutual exclusivity",
        "prompt_template": (
            _GOLD_PROMPT_HEADER +
            "CLAIM DATA:\n"
            "  Patient: ICD-10 Z42.1 (Encounter for breast reconstruction following mastectomy)\n"
            "  CPT 00400 — Anesthesia for procedures on the integumentary system of the extremities, "
            "anterior trunk and perineum (catch-all code)\n"
            "  CPT 00402 — Anesthesia for reconstructive procedures on the breast, e.g., reduction or "
            "augmentation mammoplasty, muscle flaps (site-specific code)\n"
            "  Date of Service: Single operative session. Operative report confirms left breast "
            "reconstruction with TRAM flap only. No second surgical site documented.\n"
            "  Regulatory Axiom: 2026 NCCI Ch. II §B — Anesthesia codes are mutually exclusive for the "
            "same surgical encounter. CPT 00400 is a catch-all code subsumed by the more specific CPT 00402 "
            "for breast reconstruction procedures. Only CPT 00402 is payable.\n"
            "Analyze NCCI mutual exclusivity. Identify the correct payable code. Apply the Gold Standard multi-stage trajectory."
        ),
    },
    # -----------------------------------------------------------------------
    # 7. Urology Forensics — diagnostic cystoscopy included in surgical scope
    # -----------------------------------------------------------------------
    {
        "niche": "Urology_Forensics",
        "cpt_codes": ["52000", "52204"],
        "icd10": "D41.4",
        "ncci_citation": "2026 NCCI Ch. VII §2 — CPT 52000 (diagnostic cystoscopy) is a Column 2 edit to CPT 52204 (cystoscopy with biopsy); diagnostic scope is included in the surgical scope",
        "oig_priority": True,
        "scenario": "Cystoscopy + biopsy — diagnostic scope included in surgical scope",
        "prompt_template": (
            _GOLD_PROMPT_HEADER +
            "CLAIM DATA:\n"
            "  Patient: Bladder lesion (ICD-10 D41.4 — Neoplasm of uncertain behavior, bladder)\n"
            "  CPT 52000 — Cystourethroscopy (diagnostic cystoscopy)\n"
            "  CPT 52204 — Cystourethroscopy with biopsy(s)\n"
            "  Date of Service: Same date. No documentation of a separate diagnostic session prior to biopsy.\n"
            "  Regulatory Axiom: 2026 NCCI Ch. VII §2 — CPT 52000 is a Column 2 edit to CPT 52204. "
            "The surgical cystoscopy (52204) includes the diagnostic visualization of the bladder. "
            "Modifier 59 requires documentation of a separate diagnostic session at a different time.\n"
            "Analyze NCCI Column 2 edit. Apply the Gold Standard multi-stage trajectory."
        ),
    },
    # -----------------------------------------------------------------------
    # 8. NEW — Home Health Upcoding (2026 OIG Work Plan Priority)
    #    Focus: OASIS score manipulation to inflate PDGM episode payments
    # -----------------------------------------------------------------------
    {
        "niche": "Home_Health_Upcoding",
        "cpt_codes": ["G0299", "G0300"],
        "icd10": "I69.351",
        "ncci_citation": "CMS PDGM Manual 2026 §40.2 — OASIS-E functional scores directly determine PDGM case-mix group; inflated scores constitute upcoding under 42 CFR §424.22",
        "oig_priority": True,
        "scenario": "OASIS score manipulation — inflated functional limitation scores to upcode PDGM episode payment",
        "prompt_template": (
            _GOLD_PROMPT_HEADER +
            "CLAIM DATA:\n"
            "  Patient: 74-year-old female, post-stroke hemiplegia (ICD-10 I69.351 — Hemiplegia following "
            "cerebral infarction affecting right dominant side)\n"
            "  G0299 — Direct skilled nursing services of a registered nurse in the home health setting\n"
            "  G0300 — Direct skilled nursing services of a licensed practical nurse in the home health setting\n"
            "  OASIS-E Assessment Filed: M1800 (Grooming) = 3 (totally dependent), M1810 (Dressing upper body) = 3, "
            "M1820 (Dressing lower body) = 3, M1830 (Bathing) = 5 (totally dependent).\n"
            "  Audit Finding: Physical therapy discharge note from prior SNF stay (3 weeks prior) documents "
            "patient as 'Modified Independent' for grooming (FIM score 6/7) and 'Supervision Only' for dressing.\n"
            "  Regulatory Axiom: CMS PDGM Manual 2026 §40.2 — OASIS-E functional scores must reflect the "
            "patient's actual status at the time of assessment. Inflating functional limitation scores to "
            "achieve a higher PDGM case-mix group (and thus higher episode payment) constitutes upcoding "
            "under 42 CFR §424.22 and is a False Claims Act risk.\n"
            "Analyze the discrepancy between OASIS scores and prior PT documentation. Calculate the PDGM "
            "payment difference between the submitted case-mix group and the correct group. "
            "Apply the Gold Standard multi-stage trajectory."
        ),
    },
    # -----------------------------------------------------------------------
    # 9. NEW — DME Unbundling (2026 OIG Work Plan Priority)
    #    Focus: Power wheelchair components billed separately when included in base code
    # -----------------------------------------------------------------------
    {
        "niche": "DME_Forensics",
        "cpt_codes": ["K0856", "K0108", "E2310"],
        "icd10": "G35",
        "ncci_citation": "CMS DME MAC Policy Article A52498 — Power wheelchair base codes (K0856) include standard components; separately billing included accessories (K0108, E2310) without documentation of medical necessity for upgraded components is unbundling",
        "oig_priority": True,
        "scenario": "Power wheelchair unbundling — base code components billed separately without medical necessity documentation",
        "prompt_template": (
            _GOLD_PROMPT_HEADER +
            "CLAIM DATA:\n"
            "  Patient: 48-year-old male with Multiple Sclerosis (ICD-10 G35)\n"
            "  K0856 — Power wheelchair, group 3 standard, sling/solid seat/back, patient weight capacity up to and including 300 lbs\n"
            "  K0108 — Wheelchair component or accessory, not otherwise specified\n"
            "  E2310 — Power wheelchair accessory, electronic connection between power wheelchair controller "
            "and display module, replacement only\n"
            "  Claim: All three codes billed on the same date of delivery. No separate Certificate of Medical "
            "Necessity (CMN) for K0108 or E2310. No documentation that the standard K0856 components were "
            "medically insufficient or that upgraded components were required.\n"
            "  Regulatory Axiom: CMS DME MAC Policy Article A52498 — The K0856 base code includes standard "
            "seating, controller, and display components. Separately billing K0108 and E2310 without a CMN "
            "documenting medical necessity for components beyond the base code standard constitutes unbundling.\n"
            "Analyze for DME unbundling. Identify which HCPCS codes should be denied. Calculate the financial "
            "impact. Apply the Gold Standard multi-stage trajectory."
        ),
    },
    # -----------------------------------------------------------------------
    # 10. NEW — Behavioral Health E/M + Psychotherapy Add-on (2026 OIG Work Plan Priority)
    #     Focus: 90837 (60-min psychotherapy) billed with 99213 E/M without Modifier 25 or
    #     documentation of a separately identifiable medical service
    # -----------------------------------------------------------------------
    {
        "niche": "Behavioral_Health",
        "cpt_codes": ["99213", "90837"],
        "icd10": "F32.1",
        "ncci_citation": "CMS Claims Processing Manual Ch. 12 §210 — Psychotherapy add-on codes (90833, 90836, 90838) are used with E/M; standalone 90837 billed with E/M on same DOS requires Modifier 25 and documentation of a separately identifiable medical service",
        "oig_priority": True,
        "scenario": "Behavioral Health E/M + standalone psychotherapy — Modifier 25 and separate service documentation required",
        "prompt_template": (
            _GOLD_PROMPT_HEADER +
            "CLAIM DATA:\n"
            "  Patient: 34-year-old female with major depressive disorder, moderate (ICD-10 F32.1)\n"
            "  CPT 99213 — Level 3 established patient office visit (low-moderate medical decision complexity)\n"
            "  CPT 90837 — Psychotherapy, 60 minutes with patient\n"
            "  Date of Service: Same date, same provider (psychiatrist). No Modifier 25 on 99213.\n"
            "  Medical Record: Single combined note. No documentation of a separately identifiable "
            "medical service distinct from the psychotherapy session (e.g., medication management requiring "
            "independent evaluation and management beyond the psychotherapy).\n"
            "  Regulatory Axiom: CMS Claims Processing Manual Ch. 12 §210 — When a psychiatrist bills "
            "both an E/M service and a psychotherapy service on the same date, the E/M must be a separately "
            "identifiable service appended with Modifier 25. The correct coding for combined E/M + "
            "psychotherapy is to use the E/M code with the psychotherapy add-on codes (90833, 90836, or 90838), "
            "NOT standalone 90837. Billing 99213 + 90837 without Modifier 25 and separate documentation "
            "is a known OIG audit target.\n"
            "Analyze the coding pattern. Identify the correct code set. Calculate the financial impact. "
            "Apply the Gold Standard multi-stage trajectory."
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
    Each job is assigned to a specific node. ncci_citation and oig_priority are
    now included in the dispatched job payload.
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
            "ncci_citation": spec.get("ncci_citation", ""),
            "oig_priority": spec.get("oig_priority", False),
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
        logger.info(f"Job created: {job['job_id']} → {node_id} ({spec['niche']}) [OIG: {spec.get('oig_priority', False)}]")

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
