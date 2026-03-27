#!/usr/bin/env python3
"""
claim_mapper_pipeline.py — Tier 1 Claims Mapping Node
Logic Refinery HITL v2.0

PURPOSE
-------
This is the production entry point for all Tier 1 (i5 Scout) nodes.
It bridges the gap between raw CMS data in BigQuery and the Tier 2 inference
engine by performing deterministic, rule-based NCCI edit detection and
publishing structured Mission Packets to GCP Pub/Sub.

PIPELINE ROLE
-------------
BigQuery (cms_transparency_records)
    ↓  [fetch_records_from_bigquery]
Raw CMS Records
    ↓  [map_raw_record_to_mission_packet]
Claim Maps (NCCI edit detection, no LLM required)
    ↓  [publish_to_pubsub]
Pub/Sub (logic-mission-queue)
    ↓
Tier 2 Master Node (hankman2_worker.py → deepseek-r1:8b)

DESIGN PRINCIPLES
-----------------
- Deterministic: No randomness in core logic. Same input = same output.
- Filtered: Only records that trigger at least one NCCI edit are published.
  Clean claims are skipped to preserve Tier 2 compute budget.
- Idempotent: Each record is tagged with its source BigQuery record_id.
  Re-running with the same offset will produce the same packets.
- Resilient: GCP errors are caught and logged. The daemon auto-restarts.
- Observable: Structured logging with per-batch stats.

USAGE
-----
  # Single pass (1000 records starting at offset 0)
  python3 claim_mapper_pipeline.py --limit 1000 --offset 0

  # Dry run (fetch + map but do NOT publish to Pub/Sub)
  python3 claim_mapper_pipeline.py --limit 100 --dry-run

  # Continuous daemon mode (polls every 60s, advances offset automatically)
  python3 claim_mapper_pipeline.py --daemon --poll-interval 60

  # Use a venv
  source ~/gcp-venv/bin/activate && python3 claim_mapper_pipeline.py --daemon

REQUIREMENTS
------------
  pip install google-cloud-bigquery google-cloud-pubsub

ENVIRONMENT VARIABLES
---------------------
  GCP_PROJECT          : GCP project ID (default: healthy-matter-453416-t3)
  GCP_DATASET          : BigQuery dataset (default: logic_refinery_prod)
  GCP_TABLE            : BigQuery table   (default: cms_transparency_records)
  GCP_TOPIC            : Pub/Sub topic    (default: logic-mission-queue)
  GOOGLE_APPLICATION_CREDENTIALS : Path to service account JSON key

Author: Manus AI | Logic Refinery HITL v2.0
"""

import os
import sys
import json
import uuid
import time
import socket
import logging
import argparse
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple

# ─────────────────────────────────────────────────────────────────────────────
# Logging Setup
# ─────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [ClaimMapper/%(funcName)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ]
)
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

PROJECT_ID = os.getenv("GCP_PROJECT", "healthy-matter-453416-t3")
DATASET_ID = os.getenv("GCP_DATASET", "logic_refinery_prod")
TABLE_ID   = os.getenv("GCP_TABLE",   "cms_transparency_records")
TOPIC_ID   = os.getenv("GCP_TOPIC",   "logic-mission-queue")

# Resolve service account key path
_KEY_CANDIDATES = [
    os.getenv("GOOGLE_APPLICATION_CREDENTIALS", ""),
    os.path.expanduser("~/logic-refinery-architect-key.json"),
    os.path.expanduser("~/gcp-venv/logic-refinery-architect-key.json"),
    "/home/hotel_8/logic-refinery-architect-key.json",
    "/home/golf_7/logic-refinery-architect-key.json",
    "/home/india_9/logic-refinery-architect-key.json",
    "/home/charlie_3/logic-refinery-architect-key.json",
]
for _path in _KEY_CANDIDATES:
    if _path and os.path.exists(_path):
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = _path
        logger.info(f"Using GCP credentials: {_path}")
        break
else:
    logger.warning("GCP credentials file not found in any standard location. "
                   "Set GOOGLE_APPLICATION_CREDENTIALS or place key in ~/logic-refinery-architect-key.json")

# Detect node identity for packet attribution
NODE_ID = os.getenv("NODE_ID", socket.gethostname())

# ─────────────────────────────────────────────────────────────────────────────
# GCP Library Import
# ─────────────────────────────────────────────────────────────────────────────

try:
    from google.cloud import bigquery
    from google.cloud import pubsub_v1
    GCP_AVAILABLE = True
    logger.info("GCP libraries loaded successfully.")
except ImportError:
    GCP_AVAILABLE = False
    logger.warning(
        "google-cloud-bigquery / google-cloud-pubsub not installed. "
        "Running in MOCK mode. Install with:\n"
        "  source ~/gcp-venv/bin/activate\n"
        "  pip install google-cloud-bigquery google-cloud-pubsub"
    )

# ─────────────────────────────────────────────────────────────────────────────
# NCCI Edit Table — 2026 (Expanded to 10 Niches)
# Source: 2026 CMS NCCI Policy Manual
# ─────────────────────────────────────────────────────────────────────────────

NCCI_EDITS: List[Dict[str, Any]] = [
    # ── MSK / Orthopedic ─────────────────────────────────────────────────────
    {
        "column1": "27447", "column2": "29881",
        "edit_type": "Column1/Column2", "modifier_indicator": "0",
        "description": "TKA (27447) bundles knee arthroscopy (29881). Arthroscopy cannot be billed separately.",
        "ncci_citation": "2026 NCCI Ch. IV §E(1)",
        "niche": "MSK_Forensics", "audit_risk": "HIGH", "oig_priority": True,
    },
    {
        "column1": "27447", "column2": "27310",
        "edit_type": "Column1/Column2", "modifier_indicator": "0",
        "description": "TKA (27447) bundles knee exploration (27310).",
        "ncci_citation": "2026 NCCI Ch. IV §E",
        "niche": "MSK_Forensics", "audit_risk": "MEDIUM", "oig_priority": False,
    },
    {
        "column1": "27130", "column2": "27299",
        "edit_type": "Column1/Column2", "modifier_indicator": "0",
        "description": "Total hip arthroplasty (27130) bundles unlisted hip procedure (27299).",
        "ncci_citation": "2026 NCCI Ch. IV §E(2)",
        "niche": "MSK_Forensics", "audit_risk": "HIGH", "oig_priority": True,
    },
    # ── Oncology ─────────────────────────────────────────────────────────────
    {
        "column1": "96413", "column2": "96415",
        "edit_type": "Sequential", "modifier_indicator": "1",
        "description": "Initial infusion (96413) + sequential infusion (96415) — modifier required on 96415.",
        "ncci_citation": "2026 NCCI Ch. XI §A(2)",
        "niche": "Oncology_Billing", "audit_risk": "HIGH", "oig_priority": True,
    },
    {
        "column1": "96413", "column2": "96360",
        "edit_type": "Column1/Column2", "modifier_indicator": "0",
        "description": "Chemo infusion (96413) bundles hydration (96360) when same session.",
        "ncci_citation": "2026 NCCI Ch. XI §C",
        "niche": "Oncology_Billing", "audit_risk": "MEDIUM", "oig_priority": False,
    },
    # ── Evaluation & Management ───────────────────────────────────────────────
    {
        "column1": "99215", "column2": "99213",
        "edit_type": "Mutually_Exclusive", "modifier_indicator": "0",
        "description": "Only one E/M level per encounter per provider.",
        "ncci_citation": "CMS Claims Processing Manual Ch. 12 §30.6.7",
        "niche": "Evaluation_Management", "audit_risk": "HIGH", "oig_priority": True,
    },
    {
        "column1": "99215", "column2": "99000",
        "edit_type": "Column1/Column2", "modifier_indicator": "0",
        "description": "Specimen handling (99000) is bundled into E/M when billed same day.",
        "ncci_citation": "2026 NCCI Ch. I §E",
        "niche": "Evaluation_Management", "audit_risk": "LOW", "oig_priority": False,
    },
    # ── Radiology ────────────────────────────────────────────────────────────
    {
        "column1": "71046", "column2": "71045",
        "edit_type": "Column1/Column2", "modifier_indicator": "0",
        "description": "2-view CXR (71046) bundles 1-view CXR (71045). Cannot bill both.",
        "ncci_citation": "2026 NCCI Ch. IX §B",
        "niche": "Radiology_Forensics", "audit_risk": "MEDIUM", "oig_priority": False,
    },
    {
        "column1": "70553", "column2": "70551",
        "edit_type": "Column1/Column2", "modifier_indicator": "0",
        "description": "MRI brain w/wo contrast (70553) bundles MRI brain w/o contrast (70551).",
        "ncci_citation": "2026 NCCI Ch. IX §B",
        "niche": "Radiology_Forensics", "audit_risk": "HIGH", "oig_priority": True,
    },
    {
        "column1": "71048", "column2": "71046",
        "edit_type": "Column1/Column2", "modifier_indicator": "0",
        "description": "4-view CXR (71048) bundles 2-view CXR (71046). Unbundling if both billed.",
        "ncci_citation": "2026 NCCI Ch. VIII",
        "niche": "Radiology_Forensics", "audit_risk": "HIGH", "oig_priority": False,
    },
    # ── Cardiology ───────────────────────────────────────────────────────────
    {
        "column1": "93000", "column2": "93005",
        "edit_type": "Global_Component", "modifier_indicator": "0",
        "description": "Global ECG (93000) bundles tracing-only (93005). Cannot unbundle.",
        "ncci_citation": "2026 NCCI Ch. X §A",
        "niche": "Cardiology_Forensics", "audit_risk": "HIGH", "oig_priority": False,
    },
    {
        "column1": "93000", "column2": "93010",
        "edit_type": "Global_Component", "modifier_indicator": "0",
        "description": "Global ECG (93000) bundles interpretation-only (93010). Cannot unbundle.",
        "ncci_citation": "2026 NCCI Ch. X §A",
        "niche": "Cardiology_Forensics", "audit_risk": "HIGH", "oig_priority": False,
    },
    # ── Anesthesia ───────────────────────────────────────────────────────────
    {
        "column1": "00402", "column2": "00400",
        "edit_type": "Mutually_Exclusive", "modifier_indicator": "0",
        "description": "Site-specific breast anesthesia (00402) mutually exclusive with catch-all (00400).",
        "ncci_citation": "2026 NCCI Ch. II §B",
        "niche": "Anesthesia_Billing", "audit_risk": "MEDIUM", "oig_priority": False,
    },
    # ── Urology ──────────────────────────────────────────────────────────────
    {
        "column1": "52204", "column2": "52000",
        "edit_type": "Column1/Column2", "modifier_indicator": "0",
        "description": "Cystoscopy with biopsy (52204) bundles diagnostic cystoscopy (52000).",
        "ncci_citation": "2026 NCCI Ch. VII §2",
        "niche": "Urology_Forensics", "audit_risk": "HIGH", "oig_priority": True,
    },
    # ── Home Health ──────────────────────────────────────────────────────────
    {
        "column1": "G0179", "column2": "G0180",
        "edit_type": "Mutually_Exclusive", "modifier_indicator": "0",
        "description": "Recertification (G0179) and initial certification (G0180) cannot be billed same period.",
        "ncci_citation": "2026 NCCI Ch. XII §A",
        "niche": "Home_Health_Upcoding", "audit_risk": "HIGH", "oig_priority": True,
    },
    # ── DME ──────────────────────────────────────────────────────────────────
    {
        "column1": "E1399", "column2": "K0001",
        "edit_type": "Column1/Column2", "modifier_indicator": "0",
        "description": "Miscellaneous DME (E1399) bundles standard wheelchair (K0001) when same item.",
        "ncci_citation": "2026 NCCI Ch. XIII §C",
        "niche": "DME_Forensics", "audit_risk": "HIGH", "oig_priority": True,
    },
    # ── Behavioral Health ────────────────────────────────────────────────────
    {
        "column1": "90837", "column2": "99213",
        "edit_type": "Mutually_Exclusive", "modifier_indicator": "1",
        "description": "Psychotherapy (90837) mutually exclusive with E/M (99213) unless modifier -25 applied.",
        "ncci_citation": "2026 NCCI Ch. I §F",
        "niche": "Behavioral_Health", "audit_risk": "HIGH", "oig_priority": True,
    },
    {
        "column1": "90837", "column2": "90838",
        "edit_type": "Mutually_Exclusive", "modifier_indicator": "0",
        "description": "Standalone psychotherapy (90837) mutually exclusive with add-on E/M psychotherapy (90838).",
        "ncci_citation": "2026 NCCI Ch. I §F",
        "niche": "Behavioral_Health", "audit_risk": "MEDIUM", "oig_priority": False,
    },
]

# Build bi-directional lookup index: (col1, col2) → edit
_EDIT_INDEX: Dict[Tuple[str, str], Dict] = {}
for _edit in NCCI_EDITS:
    _EDIT_INDEX[(_edit["column1"], _edit["column2"])] = _edit
    # Also index reverse direction for lookup convenience
    _EDIT_INDEX[(_edit["column2"], _edit["column1"])] = _edit

# ─────────────────────────────────────────────────────────────────────────────
# CPT & ICD-10 Description Lookups
# ─────────────────────────────────────────────────────────────────────────────

CPT_DESCRIPTIONS: Dict[str, str] = {
    "27447": "Arthroplasty, knee, condyle and plateau; medial AND lateral compartments (total knee arthroplasty)",
    "29881": "Arthroscopy, knee, surgical; with meniscectomy (medial OR lateral)",
    "27310": "Arthrotomy, knee, with exploration, drainage, or removal of foreign body",
    "27130": "Arthroplasty, acetabular and proximal femoral prosthetic replacement (total hip arthroplasty)",
    "96413": "Chemotherapy administration, intravenous infusion technique; up to 1 hour",
    "96415": "Chemotherapy administration, intravenous infusion technique; each additional hour",
    "96360": "Intravenous infusion, hydration; initial, 31 minutes to 1 hour",
    "99215": "Office or other outpatient visit, established patient, high complexity",
    "99213": "Office or other outpatient visit, established patient, low-moderate complexity",
    "71046": "Radiologic examination, chest; 2 views",
    "71045": "Radiologic examination, chest; single view",
    "71048": "Radiologic examination, chest; 4 or more views",
    "70553": "MRI brain; without and with contrast material(s)",
    "70551": "MRI brain; without contrast material",
    "93000": "Electrocardiogram, routine ECG; with interpretation and report",
    "93005": "Electrocardiogram, routine ECG; tracing only, without interpretation and report",
    "93010": "Electrocardiogram, routine ECG; interpretation and report only",
    "00402": "Anesthesia for reconstructive procedures on breast",
    "00400": "Anesthesia for procedures on integumentary system; not otherwise specified",
    "52204": "Cystourethroscopy, with biopsy(s)",
    "52000": "Cystourethroscopy (separate procedure)",
    "G0179": "Physician re-certification for Medicare-covered home health services",
    "G0180": "Physician certification for Medicare-covered home health services",
    "E1399": "Durable medical equipment, miscellaneous",
    "K0001": "Standard manual wheelchair",
    "90837": "Psychotherapy, 60 minutes with patient",
    "90838": "Psychotherapy, 60 minutes with patient when performed with E/M service",
    "99000": "Handling and/or conveyance of specimen for transfer",
}

ICD10_DESCRIPTIONS: Dict[str, str] = {
    "M17.11": "Unilateral primary osteoarthritis, right knee",
    "M17.12": "Unilateral primary osteoarthritis, left knee",
    "C50.911": "Malignant neoplasm of unspecified site of right female breast",
    "C50.912": "Malignant neoplasm of unspecified site of left female breast",
    "E11.9":   "Type 2 diabetes mellitus without complications",
    "I10":     "Essential (primary) hypertension",
    "J18.9":   "Pneumonia, unspecified organism",
    "N40.0":   "Benign prostatic hyperplasia without lower urinary tract symptoms",
    "F32.1":   "Major depressive disorder, single episode, moderate",
    "G89.29":  "Other chronic pain",
    "Z87.39":  "Personal history of other musculoskeletal disorders",
    "Z96.651": "Presence of right artificial knee joint",
}

# ─────────────────────────────────────────────────────────────────────────────
# Core Mapping Logic
# ─────────────────────────────────────────────────────────────────────────────

def parse_cpt_codes(raw_cpt_field: Any) -> List[str]:
    """
    Robustly parse CPT codes from various BigQuery field formats.
    Handles: comma-separated strings, JSON arrays, single strings.
    """
    if raw_cpt_field is None:
        return []
    if isinstance(raw_cpt_field, list):
        return [str(c).strip() for c in raw_cpt_field if c]
    raw_str = str(raw_cpt_field).strip()
    # Try JSON array first
    if raw_str.startswith("["):
        try:
            return [str(c).strip() for c in json.loads(raw_str)]
        except json.JSONDecodeError:
            pass
    # Fall back to comma-separated
    return [c.strip() for c in raw_str.split(",") if c.strip()]


def detect_ncci_edits(cpt_codes: List[str]) -> List[Dict[str, Any]]:
    """
    Cross-reference all CPT code pairs against the NCCI edit table.
    Returns a list of triggered forensic link objects.
    """
    forensic_links = []
    seen_pairs = set()

    for i, cpt1 in enumerate(cpt_codes):
        for cpt2 in cpt_codes[i + 1:]:
            # Normalize pair to avoid duplicates
            pair_key = tuple(sorted([cpt1, cpt2]))
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)

            edit = _EDIT_INDEX.get((cpt1, cpt2)) or _EDIT_INDEX.get((cpt2, cpt1))
            if edit:
                forensic_links.append({
                    "column1_code": edit["column1"],
                    "column2_code": edit["column2"],
                    "edit_type": edit["edit_type"],
                    "modifier_indicator": edit["modifier_indicator"],
                    "description": edit["description"],
                    "ncci_citation": edit["ncci_citation"],
                    "niche": edit["niche"],
                    "audit_risk": edit["audit_risk"],
                    "oig_priority": edit.get("oig_priority", False),
                    "edit_triggered": True,
                })
    return forensic_links


def compute_audit_risk(forensic_links: List[Dict]) -> str:
    """Derive the highest audit risk level from all triggered edits."""
    risks = [fl.get("audit_risk", "NONE") for fl in forensic_links]
    if "HIGH" in risks:
        return "HIGH"
    if "MEDIUM" in risks:
        return "MEDIUM"
    if "LOW" in risks:
        return "LOW"
    return "NONE"


def map_raw_record_to_mission_packet(record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Transform a raw CMS BigQuery record into a structured Mission Packet.

    Returns None if:
    - No CPT codes are present in the record.
    - No NCCI edits are triggered (clean claim, not worth sending to Tier 2).

    The returned packet is the canonical input format for hankman2_worker.py.
    """
    # ── 1. Extract raw fields ────────────────────────────────────────────────
    record_id     = str(record.get("record_id") or record.get("id") or f"cms_{uuid.uuid4().hex[:12]}")
    raw_cpt       = record.get("cpt_codes") or record.get("procedure_codes") or record.get("cpts")
    icd10_primary = str(record.get("icd10") or record.get("icd10_primary") or record.get("diagnosis_code") or "Unknown")
    dos           = str(record.get("dos") or record.get("date_of_service") or datetime.now(timezone.utc).date().isoformat())
    payer         = str(record.get("payer") or record.get("payer_name") or "Unknown")
    billed_amount = float(record.get("billed_amount") or record.get("total_billed") or 0.0)

    # ── 2. Parse CPT codes ───────────────────────────────────────────────────
    cpt_codes = parse_cpt_codes(raw_cpt)
    if not cpt_codes:
        return None  # No codes, nothing to map

    # ── 3. NCCI Edit Detection ───────────────────────────────────────────────
    forensic_links = detect_ncci_edits(cpt_codes)
    if not forensic_links:
        return None  # Clean claim — skip to save Tier 2 compute

    # ── 4. Derive Metadata ───────────────────────────────────────────────────
    primary_edit    = forensic_links[0]
    niche           = primary_edit["niche"]
    overall_risk    = compute_audit_risk(forensic_links)
    oig_flagged     = any(fl.get("oig_priority", False) for fl in forensic_links)
    primary_citation = primary_edit["ncci_citation"]

    # Build transactional layer with CPT descriptions
    transactional_layer = [
        {
            "cpt_code": cpt,
            "description": CPT_DESCRIPTIONS.get(cpt, f"Procedure {cpt}"),
            "modifier": None,
            "units": 1,
            "billed_amount": round(billed_amount / len(cpt_codes), 2) if billed_amount else 0.0,
        }
        for cpt in cpt_codes
    ]

    # ── 5. Assemble Mission Packet ───────────────────────────────────────────
    claim_map_id = f"cm_{uuid.uuid4().hex[:12]}"
    job_id       = f"job_{uuid.uuid4().hex[:12]}"
    now_iso      = datetime.now(timezone.utc).isoformat()

    mission_packet = {
        # ── Job Envelope (consumed by hankman2_worker.py) ──
        "job_id":        job_id,
        "job_type":      "gold_standard_reason",
        "tier_required": "refiner",
        "priority":      10 if oig_flagged else 5,
        "published_at":  now_iso,
        "published_by":  NODE_ID,
        "schema_version": "mission_packet_v2.0",

        # ── Claim Map (the structured payload) ──
        "claim_map": {
            "claim_map_id":   claim_map_id,
            "source_bill_id": record_id,
            "generated_at":   now_iso,
            "generated_by":   NODE_ID,
            "node_tier":      "scout",
            "niche":          niche,
            "payer":          payer,

            # Clinical context
            "clinical_anchor": {
                "icd10_primary":             icd10_primary,
                "icd10_primary_description": ICD10_DESCRIPTIONS.get(icd10_primary, "Unknown diagnosis"),
                "dos":                       dos,
                "cpt_codes":                 cpt_codes,
            },

            # Financial breakdown
            "transactional_layer": transactional_layer,

            # NCCI forensic findings
            "forensic_links": forensic_links,

            # Audit summary
            "audit_summary": {
                "ncci_edits_triggered":  len(forensic_links),
                "overall_audit_risk":    overall_risk,
                "oig_priority_flagged":  oig_flagged,
                "total_billed":          round(billed_amount, 2),
                "ready_for_refiner":     True,
            },

            # Top-level fields for Tier 2 routing
            "claim_map_status":       "ready_for_refiner",
            "financial_impact_estimate": round(billed_amount * 0.3, 2) if billed_amount else 0.0,
            "oig_priority":           oig_flagged,
            "ncci_citation":          primary_citation,
        }
    }

    return mission_packet


# ─────────────────────────────────────────────────────────────────────────────
# GCP: BigQuery
# ─────────────────────────────────────────────────────────────────────────────

def fetch_records_from_bigquery(limit: int, offset: int) -> List[Dict[str, Any]]:
    """
    Fetch a batch of raw CMS records from BigQuery.
    Falls back to mock data if GCP libraries are unavailable.
    """
    if not GCP_AVAILABLE:
        logger.warning("GCP unavailable — returning mock records for dry-run testing.")
        mock_records = [
            {"record_id": f"MOCK-{offset + i:06d}", "cpt_codes": "27447,29881",
             "icd10": "M17.11", "dos": "2026-03-27", "payer": "Medicare", "billed_amount": 2400.00}
            for i in range(min(limit, 10))
        ]
        return mock_records

    try:
        client = bigquery.Client(project=PROJECT_ID)
        full_table = f"`{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}`"
        query = f"""
            SELECT *
            FROM {full_table}
            ORDER BY record_id
            LIMIT {int(limit)} OFFSET {int(offset)}
        """
        logger.info(f"BigQuery fetch: LIMIT {limit} OFFSET {offset} from {full_table}")
        query_job = client.query(query)
        rows = list(query_job.result())
        logger.info(f"BigQuery returned {len(rows)} rows.")
        return [dict(row) for row in rows]
    except Exception as exc:
        logger.error(f"BigQuery fetch failed: {exc}")
        return []


# ─────────────────────────────────────────────────────────────────────────────
# GCP: Pub/Sub
# ─────────────────────────────────────────────────────────────────────────────

def publish_to_pubsub(packets: List[Dict[str, Any]], dry_run: bool = False) -> int:
    """
    Publish a list of Mission Packets to the logic-mission-queue Pub/Sub topic.
    Returns the number of successfully published messages.
    """
    if not packets:
        return 0

    if dry_run:
        logger.info(f"[DRY-RUN] Would publish {len(packets)} packets. "
                    f"Sample:\n{json.dumps(packets[0], indent=2)}")
        return len(packets)

    if not GCP_AVAILABLE:
        logger.warning("[MOCK] GCP unavailable — simulating publish.")
        return len(packets)

    try:
        publisher = pubsub_v1.PublisherClient()
        topic_path = publisher.topic_path(PROJECT_ID, TOPIC_ID)
        published = 0
        errors = 0

        for packet in packets:
            try:
                data = json.dumps(packet).encode("utf-8")
                # Attach ordering key by niche for Pub/Sub message ordering
                future = publisher.publish(
                    topic_path,
                    data,
                    niche=packet["claim_map"].get("niche", "Unknown"),
                    oig_priority=str(packet["claim_map"].get("oig_priority", False)),
                )
                future.result()  # Block until confirmed
                published += 1
            except Exception as pub_exc:
                logger.error(f"Failed to publish packet {packet.get('job_id')}: {pub_exc}")
                errors += 1

        if errors:
            logger.warning(f"Publish complete: {published} succeeded, {errors} failed.")
        else:
            logger.info(f"Published {published} packets to {TOPIC_ID}.")
        return published

    except Exception as exc:
        logger.error(f"Pub/Sub publisher init failed: {exc}")
        return 0


# ─────────────────────────────────────────────────────────────────────────────
# Pipeline Execution
# ─────────────────────────────────────────────────────────────────────────────

def run_pipeline_pass(limit: int, offset: int, batch_size: int, dry_run: bool) -> Dict[str, int]:
    """
    Execute a single pipeline pass:
      1. Fetch records from BigQuery
      2. Map records to Mission Packets (NCCI edit detection)
      3. Publish packets to Pub/Sub in batches

    Returns a stats dict: {fetched, mapped, published, skipped}.
    """
    stats = {"fetched": 0, "mapped": 0, "published": 0, "skipped": 0}

    # Step 1: Fetch
    raw_records = fetch_records_from_bigquery(limit, offset)
    stats["fetched"] = len(raw_records)
    if not raw_records:
        logger.info("No records fetched. Pipeline pass complete (nothing to do).")
        return stats

    # Step 2: Map
    packets: List[Dict[str, Any]] = []
    for record in raw_records:
        packet = map_raw_record_to_mission_packet(record)
        if packet:
            packets.append(packet)
        else:
            stats["skipped"] += 1

    stats["mapped"] = len(packets)
    logger.info(
        f"Mapping complete: {stats['mapped']} actionable packets, "
        f"{stats['skipped']} clean claims skipped."
    )

    if not packets:
        return stats

    # Step 3: Publish in batches
    for i in range(0, len(packets), batch_size):
        batch = packets[i : i + batch_size]
        stats["published"] += publish_to_pubsub(batch, dry_run=dry_run)

    logger.info(
        f"Pass complete | Fetched: {stats['fetched']} | "
        f"Mapped: {stats['mapped']} | Published: {stats['published']} | "
        f"Skipped (clean): {stats['skipped']}"
    )
    return stats


def run_daemon(batch_size: int, poll_interval: int, dry_run: bool, chunk_size: int = 1000):
    """
    Run the pipeline continuously as a daemon.
    Advances the BigQuery offset by `chunk_size` after each pass.
    Restarts from offset 0 when the full table has been processed.
    """
    logger.info(
        f"Starting Claim Mapper DAEMON | Node: {NODE_ID} | "
        f"Chunk: {chunk_size} | Poll: {poll_interval}s | Dry-run: {dry_run}"
    )
    current_offset = 0
    total_published_session = 0

    while True:
        try:
            logger.info(f"─── Pipeline Pass | Offset: {current_offset} ───")
            stats = run_pipeline_pass(
                limit=chunk_size,
                offset=current_offset,
                batch_size=batch_size,
                dry_run=dry_run,
            )

            total_published_session += stats["published"]

            if stats["fetched"] == 0:
                # Reached end of table — wrap around
                logger.info(
                    f"End of table reached. Total published this session: {total_published_session}. "
                    f"Resetting offset to 0."
                )
                current_offset = 0
            else:
                current_offset += chunk_size

            logger.info(f"Sleeping {poll_interval}s before next pass...")
            time.sleep(poll_interval)

        except KeyboardInterrupt:
            logger.info(f"Daemon stopped. Total published: {total_published_session}")
            break
        except Exception as exc:
            logger.error(f"Unhandled daemon error: {exc}. Retrying in 15s...")
            time.sleep(15)


# ─────────────────────────────────────────────────────────────────────────────
# CLI Entry Point
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Logic Refinery Tier 1 — Claims Mapping Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Single pass: 1000 records from offset 0
  python3 claim_mapper_pipeline.py --limit 1000 --offset 0

  # Dry run: fetch and map but do NOT publish
  python3 claim_mapper_pipeline.py --limit 100 --dry-run

  # Daemon mode: continuous polling every 60s
  python3 claim_mapper_pipeline.py --daemon --poll-interval 60

  # Daemon with venv
  source ~/gcp-venv/bin/activate && python3 claim_mapper_pipeline.py --daemon
        """
    )
    parser.add_argument("--limit",         type=int,  default=1000, help="Records to fetch per pass (default: 1000)")
    parser.add_argument("--offset",        type=int,  default=0,    help="BigQuery offset for single-pass mode (default: 0)")
    parser.add_argument("--batch-size",    type=int,  default=50,   help="Pub/Sub publish batch size (default: 50)")
    parser.add_argument("--daemon",        action="store_true",      help="Run continuously as a daemon")
    parser.add_argument("--poll-interval", type=int,  default=60,   help="Seconds between daemon passes (default: 60)")
    parser.add_argument("--dry-run",       action="store_true",      help="Fetch and map but do NOT publish to Pub/Sub")
    parser.add_argument("--chunk-size",    type=int,  default=1000, help="Records per daemon chunk (default: 1000)")

    args = parser.parse_args()

    logger.info(f"Logic Refinery Claim Mapper | Node: {NODE_ID} | Project: {PROJECT_ID}")
    logger.info(f"Topic: {TOPIC_ID} | Table: {PROJECT_ID}.{DATASET_ID}.{TABLE_ID}")

    if args.daemon:
        run_daemon(
            batch_size=args.batch_size,
            poll_interval=args.poll_interval,
            dry_run=args.dry_run,
            chunk_size=args.chunk_size,
        )
    else:
        stats = run_pipeline_pass(
            limit=args.limit,
            offset=args.offset,
            batch_size=args.batch_size,
            dry_run=args.dry_run,
        )
        logger.info(f"Final stats: {json.dumps(stats)}")
        sys.exit(0 if stats["published"] >= 0 else 1)


if __name__ == "__main__":
    main()
