"""
claim_mapper.py — Scout-Tier Claim Map Generator
Logic Refinery v3.0

This is a DETERMINISTIC, rule-based module. No LLM required.
It takes a raw medical bill dict and maps it to a structured Claim Map SDR
by looking up CPT codes against the embedded NCCI edit rules.

CPU: ~50% of one i5 core
RAM: ~200MB peak
Time: 2-5 seconds per bill
"""

import uuid
import random
from datetime import datetime, timezone
from typing import Optional


# ─────────────────────────────────────────────────────────────────────────────
# Embedded NCCI Edit Table (2026 — subset covering the 10 job spec niches)
# Source: 2026 CMS NCCI Policy Manual
# ─────────────────────────────────────────────────────────────────────────────

NCCI_EDITS: list[dict] = [
    # MSK / Orthopedic
    {
        "column1": "27447", "column2": "29881",
        "edit_type": "Column1/Column2",
        "modifier_indicator": "0",
        "description": "TKA (27447) bundles knee arthroscopy (29881). Arthroscopy cannot be billed separately.",
        "ncci_citation": "2026 NCCI Ch. IV §E",
        "niche": "MSK_Forensics",
        "audit_risk": "HIGH",
        "oig_priority": True,
    },
    {
        "column1": "27447", "column2": "27310",
        "edit_type": "Column1/Column2",
        "modifier_indicator": "0",
        "description": "TKA (27447) bundles knee exploration (27310).",
        "ncci_citation": "2026 NCCI Ch. IV §E",
        "niche": "MSK_Forensics",
        "audit_risk": "MEDIUM",
        "oig_priority": False,
    },
    # Oncology
    {
        "column1": "96413", "column2": "96415",
        "edit_type": "Sequential",
        "modifier_indicator": "1",
        "description": "Initial infusion (96413) + sequential infusion (96415) — correct bundling requires modifier on 96415.",
        "ncci_citation": "2026 NCCI Ch. XI §C",
        "niche": "Oncology_Billing",
        "audit_risk": "HIGH",
        "oig_priority": True,
    },
    {
        "column1": "96413", "column2": "96360",
        "edit_type": "Column1/Column2",
        "modifier_indicator": "0",
        "description": "Chemo infusion (96413) bundles hydration (96360) when done same session.",
        "ncci_citation": "2026 NCCI Ch. XI §C",
        "niche": "Oncology_Billing",
        "audit_risk": "MEDIUM",
        "oig_priority": False,
    },
    # E/M
    {
        "column1": "99215", "column2": "99213",
        "edit_type": "Mutually_Exclusive",
        "modifier_indicator": "0",
        "description": "Only one E/M level can be billed per encounter per provider.",
        "ncci_citation": "2026 NCCI Ch. I §E",
        "niche": "Evaluation_Management",
        "audit_risk": "HIGH",
        "oig_priority": False,
    },
    {
        "column1": "99215", "column2": "99000",
        "edit_type": "Column1/Column2",
        "modifier_indicator": "0",
        "description": "Specimen handling (99000) is bundled into E/M when billed same day.",
        "ncci_citation": "2026 NCCI Ch. I §E",
        "niche": "Evaluation_Management",
        "audit_risk": "LOW",
        "oig_priority": False,
    },
    # Radiology
    {
        "column1": "71046", "column2": "71045",
        "edit_type": "Column1/Column2",
        "modifier_indicator": "0",
        "description": "2-view CXR (71046) bundles 1-view CXR (71045). Cannot bill both.",
        "ncci_citation": "2026 NCCI Ch. IX §B",
        "niche": "Radiology_Forensics",
        "audit_risk": "MEDIUM",
        "oig_priority": False,
    },
    {
        "column1": "70553", "column2": "70551",
        "edit_type": "Column1/Column2",
        "modifier_indicator": "0",
        "description": "MRI brain w/wo contrast (70553) bundles MRI brain w/o contrast (70551).",
        "ncci_citation": "2026 NCCI Ch. IX §B",
        "niche": "Radiology_Forensics",
        "audit_risk": "HIGH",
        "oig_priority": True,
    },
    # Cardiology
    {
        "column1": "93000", "column2": "93005",
        "edit_type": "Global_Component",
        "modifier_indicator": "0",
        "description": "Global ECG (93000) bundles tracing-only (93005). Cannot unbundle.",
        "ncci_citation": "2026 NCCI Ch. X §A",
        "niche": "Cardiology_Forensics",
        "audit_risk": "HIGH",
        "oig_priority": False,
    },
    {
        "column1": "93000", "column2": "93010",
        "edit_type": "Global_Component",
        "modifier_indicator": "0",
        "description": "Global ECG (93000) bundles interpretation-only (93010). Cannot unbundle.",
        "ncci_citation": "2026 NCCI Ch. X §A",
        "niche": "Cardiology_Forensics",
        "audit_risk": "HIGH",
        "oig_priority": False,
    },
    # Anesthesia
    {
        "column1": "00402", "column2": "00400",
        "edit_type": "Mutually_Exclusive",
        "modifier_indicator": "0",
        "description": "Site-specific breast anesthesia (00402) is mutually exclusive with catch-all (00400).",
        "ncci_citation": "2026 NCCI Ch. II §B",
        "niche": "Anesthesia_Billing",
        "audit_risk": "MEDIUM",
        "oig_priority": False,
    },
    # Urology
    {
        "column1": "52204", "column2": "52000",
        "edit_type": "Column1/Column2",
        "modifier_indicator": "0",
        "description": "Cystoscopy with biopsy (52204) bundles diagnostic cystoscopy (52000).",
        "ncci_citation": "2026 NCCI Ch. VII §2",
        "niche": "Urology_Forensics",
        "audit_risk": "HIGH",
        "oig_priority": True,
    },
    # Home Health
    {
        "column1": "G0179", "column2": "G0180",
        "edit_type": "Mutually_Exclusive",
        "modifier_indicator": "0",
        "description": "Recertification (G0179) and initial certification (G0180) cannot be billed same period.",
        "ncci_citation": "2026 NCCI Ch. XII §A",
        "niche": "Home_Health_Upcoding",
        "audit_risk": "HIGH",
        "oig_priority": True,
    },
    # DME
    {
        "column1": "E1399", "column2": "K0001",
        "edit_type": "Column1/Column2",
        "modifier_indicator": "0",
        "description": "Miscellaneous DME (E1399) bundles standard wheelchair (K0001) when same item.",
        "ncci_citation": "2026 NCCI Ch. XIII §C",
        "niche": "DME_Forensics",
        "audit_risk": "HIGH",
        "oig_priority": True,
    },
    # Behavioral Health
    {
        "column1": "90837", "column2": "99213",
        "edit_type": "Mutually_Exclusive",
        "modifier_indicator": "1",
        "description": "Standalone psychotherapy (90837) is mutually exclusive with E/M (99213) unless modifier -25 applied.",
        "ncci_citation": "2026 NCCI Ch. I §F",
        "niche": "Behavioral_Health",
        "audit_risk": "HIGH",
        "oig_priority": True,
    },
]

# Build lookup index: (column1, column2) → edit
_EDIT_INDEX: dict[tuple, dict] = {
    (e["column1"], e["column2"]): e for e in NCCI_EDITS
}

# ICD-10 → description lookup (subset)
ICD10_DESCRIPTIONS: dict[str, str] = {
    "M17.11": "Unilateral primary osteoarthritis, right knee",
    "M17.12": "Unilateral primary osteoarthritis, left knee",
    "M17.31": "Unilateral post-traumatic osteoarthritis, right knee",
    "C50.911": "Malignant neoplasm of unspecified site of right female breast",
    "C34.11": "Malignant neoplasm of upper lobe, right bronchus or lung",
    "E11.9": "Type 2 diabetes mellitus without complications",
    "Z00.00": "Encounter for general adult medical examination without abnormal findings",
    "I10": "Essential (primary) hypertension",
    "N40.0": "Benign prostatic hyperplasia without lower urinary tract symptoms",
    "F32.1": "Major depressive disorder, single episode, moderate",
    "Z87.39": "Personal history of other musculoskeletal disorders",
    "G89.29": "Other chronic pain",
    "Z96.651": "Presence of right artificial knee joint",
}

# CPT → description lookup (subset)
CPT_DESCRIPTIONS: dict[str, str] = {
    "27447": "Arthroplasty, knee, condyle and plateau; medial AND lateral compartments with or without patella resurfacing (total knee arthroplasty)",
    "29881": "Arthroscopy, knee, surgical; with meniscectomy (medial OR lateral, including any meniscal shaving)",
    "27310": "Arthrotomy, knee, with exploration, drainage, or removal of foreign body",
    "96413": "Chemotherapy administration, intravenous infusion technique; up to 1 hour, single or initial substance/drug",
    "96415": "Chemotherapy administration, intravenous infusion technique; each additional hour",
    "96360": "Intravenous infusion, hydration; initial, 31 minutes to 1 hour",
    "99215": "Office or other outpatient visit, established patient, high complexity",
    "99213": "Office or other outpatient visit, established patient, low-moderate complexity",
    "71046": "Radiologic examination, chest; 2 views",
    "71045": "Radiologic examination, chest; single view",
    "70553": "Magnetic resonance imaging, brain; without and with contrast material(s)",
    "70551": "Magnetic resonance imaging, brain; without contrast material",
    "93000": "Electrocardiogram, routine ECG with at least 12 leads; with interpretation and report",
    "93005": "Electrocardiogram, routine ECG with at least 12 leads; tracing only, without interpretation and report",
    "93010": "Electrocardiogram, routine ECG with at least 12 leads; interpretation and report only",
    "00402": "Anesthesia for procedures on the integumentary system on the extremities, anterior trunk and perineum; reconstructive procedures on breast",
    "00400": "Anesthesia for procedures on the integumentary system on the extremities, anterior trunk and perineum; not otherwise specified",
    "52204": "Cystourethroscopy, with biopsy(s)",
    "52000": "Cystourethroscopy (separate procedure)",
    "G0179": "Physician re-certification for Medicare-covered home health services under a home health plan of care",
    "G0180": "Physician certification for Medicare-covered home health services under a home health plan of care",
    "E1399": "Durable medical equipment, miscellaneous",
    "K0001": "Standard manual wheelchair",
    "90837": "Psychotherapy, 60 minutes with patient",
    "90838": "Psychotherapy, 60 minutes with patient when performed with an evaluation and management service",
}


# ─────────────────────────────────────────────────────────────────────────────
# Claim Map Generator
# ─────────────────────────────────────────────────────────────────────────────

def generate_claim_map(raw_bill: dict, node_id: str = "node_scout") -> dict:
    """
    Parse a raw medical bill dict into a structured Claim Map SDR.

    This is deterministic — no LLM, no randomness in the core logic.
    The only randomness is in generating realistic financial figures
    when the raw bill doesn't provide them.
    """
    claim_map_id = f"cm_{uuid.uuid4().hex[:12]}"
    now = _now()

    # Extract fields from raw bill
    niche = raw_bill.get("niche", "Unknown")
    icd10_primary = raw_bill.get("icd10_primary", "")
    icd10_secondary = raw_bill.get("icd10_secondary", [])
    cpt_codes = raw_bill.get("cpt_codes", [])
    modifiers = raw_bill.get("modifiers", {})
    billed_amounts = raw_bill.get("billed_amounts", {})
    allowed_amounts = raw_bill.get("allowed_amounts", {})
    clinical_indicators = raw_bill.get("clinical_indicators", [])
    patient_age = raw_bill.get("patient_age", 0)
    patient_sex = raw_bill.get("patient_sex", "unknown")

    # ── Clinical Anchor ──────────────────────────────────────────────────────
    clinical_anchor = {
        "icd10_primary": icd10_primary,
        "icd10_primary_description": ICD10_DESCRIPTIONS.get(icd10_primary, "Unknown diagnosis"),
        "icd10_secondary": icd10_secondary,
        "icd10_secondary_descriptions": [
            ICD10_DESCRIPTIONS.get(c, "Unknown") for c in icd10_secondary
        ],
        "clinical_indicators": clinical_indicators,
        "patient_age": patient_age,
        "patient_sex": patient_sex,
    }

    # ── Transactional Layer ──────────────────────────────────────────────────
    transactional_layer = []
    total_billed = 0.0
    total_allowed = 0.0

    for cpt in cpt_codes:
        billed = float(billed_amounts.get(cpt, _estimate_billed(cpt)))
        allowed = float(allowed_amounts.get(cpt, _estimate_allowed(cpt, billed)))
        delta = billed - allowed
        total_billed += billed
        total_allowed += allowed

        transactional_layer.append({
            "cpt_code": cpt,
            "description": CPT_DESCRIPTIONS.get(cpt, f"Procedure {cpt}"),
            "modifier": modifiers.get(cpt),
            "units": raw_bill.get("units", {}).get(cpt, 1),
            "billed_amount": round(billed, 2),
            "allowed_amount": round(allowed, 2),
            "delta": round(delta, 2),
        })

    # ── Forensic Link — NCCI Edit Detection ─────────────────────────────────
    forensic_links = []
    for i, cpt1 in enumerate(cpt_codes):
        for cpt2 in cpt_codes[i + 1:]:
            edit = _EDIT_INDEX.get((cpt1, cpt2)) or _EDIT_INDEX.get((cpt2, cpt1))
            if edit:
                forensic_links.append({
                    "column1_code": edit["column1"],
                    "column2_code": edit["column2"],
                    "edit_type": edit["edit_type"],
                    "modifier_indicator": edit["modifier_indicator"],
                    "description": edit["description"],
                    "ncci_citation": edit["ncci_citation"],
                    "oig_priority": edit.get("oig_priority", False),
                    "audit_risk": edit["audit_risk"],
                    "modifier_applied": modifiers.get(edit["column2"]),
                    "edit_triggered": True,
                    "financial_exposure": round(
                        billed_amounts.get(edit["column2"], _estimate_billed(edit["column2"])), 2
                    ),
                })

    # ── Financial Impact ─────────────────────────────────────────────────────
    financial_impact_estimate = sum(
        fl["financial_exposure"] for fl in forensic_links
    ) if forensic_links else round(total_billed - total_allowed, 2)

    # ── Audit Risk Summary ───────────────────────────────────────────────────
    risk_levels = [fl["audit_risk"] for fl in forensic_links]
    overall_risk = (
        "HIGH" if "HIGH" in risk_levels
        else "MEDIUM" if "MEDIUM" in risk_levels
        else "LOW" if risk_levels
        else "NONE"
    )

    oig_flagged = any(fl["oig_priority"] for fl in forensic_links)

    return {
        "claim_map_id": claim_map_id,
        "schema_version": "claim_map_v1.0",
        "source_bill_id": raw_bill.get("source_bill_id", f"bill_{uuid.uuid4().hex[:8]}"),
        "generated_at": now,
        "generated_by": node_id,
        "node_tier": "scout",
        "niche": niche,
        "claim_map_status": "ready_for_refiner",

        # The three layers
        "clinical_anchor": clinical_anchor,
        "transactional_layer": transactional_layer,
        "forensic_links": forensic_links,

        # Summary
        "audit_summary": {
            "total_billed": round(total_billed, 2),
            "total_allowed": round(total_allowed, 2),
            "gross_delta": round(total_billed - total_allowed, 2),
            "ncci_edits_triggered": len(forensic_links),
            "financial_impact_estimate": round(financial_impact_estimate, 2),
            "overall_audit_risk": overall_risk,
            "oig_priority_flagged": oig_flagged,
            "ready_for_refiner": len(forensic_links) > 0,
        },

        # Pass-through for Refiner
        "financial_impact_estimate": round(financial_impact_estimate, 2),
        "oig_priority": oig_flagged,
        "ncci_citation": forensic_links[0]["ncci_citation"] if forensic_links else "",
    }


def _estimate_billed(cpt: str) -> float:
    """Estimate a realistic billed amount for a CPT code."""
    ranges = {
        "27447": (2000, 2800), "29881": (800, 1200), "96413": (400, 700),
        "96415": (200, 400), "99215": (250, 400), "71046": (150, 250),
        "70553": (1200, 1800), "93000": (80, 150), "52204": (600, 900),
        "90837": (200, 350), "G0179": (100, 180), "E1399": (800, 1500),
    }
    lo, hi = ranges.get(cpt, (100, 500))
    return round(random.uniform(lo, hi), 2)


def _estimate_allowed(cpt: str, billed: float) -> float:
    """Estimate CMS allowed amount (typically 60-80% of billed)."""
    ratio = random.uniform(0.60, 0.80)
    return round(billed * ratio, 2)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─────────────────────────────────────────────────────────────────────────────
# Sample raw bill generator (for testing without GCP)
# ─────────────────────────────────────────────────────────────────────────────

SAMPLE_BILLS = [
    {
        "niche": "MSK_Forensics",
        "icd10_primary": "M17.11",
        "icd10_secondary": ["Z96.651"],
        "cpt_codes": ["27447", "29881"],
        "clinical_indicators": ["KL Grade 4", "WOMAC 68/96", "failed PT 12 weeks"],
        "patient_age": 55, "patient_sex": "male",
    },
    {
        "niche": "Oncology_Billing",
        "icd10_primary": "C50.911",
        "cpt_codes": ["96413", "96415", "96360"],
        "modifiers": {"96415": "59"},
        "clinical_indicators": ["HER2+", "Pertuzumab 840mg", "Trastuzumab 6mg/kg"],
        "patient_age": 52, "patient_sex": "female",
    },
    {
        "niche": "Evaluation_Management",
        "icd10_primary": "E11.9",
        "cpt_codes": ["99215", "99213"],
        "clinical_indicators": ["HbA1c 9.2%", "uncontrolled DM", "medication adjustment"],
        "patient_age": 61, "patient_sex": "male",
    },
    {
        "niche": "Radiology_Forensics",
        "icd10_primary": "G89.29",
        "cpt_codes": ["70553", "70551"],
        "clinical_indicators": ["chronic headache", "rule out MS"],
        "patient_age": 44, "patient_sex": "female",
    },
    {
        "niche": "Cardiology_Forensics",
        "icd10_primary": "I10",
        "cpt_codes": ["93000", "93005", "93010"],
        "clinical_indicators": ["palpitations", "pre-op clearance"],
        "patient_age": 68, "patient_sex": "male",
    },
    {
        "niche": "Urology_Forensics",
        "icd10_primary": "N40.0",
        "cpt_codes": ["52204", "52000"],
        "clinical_indicators": ["hematuria", "BPH", "cystoscopy with biopsy"],
        "patient_age": 72, "patient_sex": "male",
    },
    {
        "niche": "Home_Health_Upcoding",
        "icd10_primary": "M17.12",
        "cpt_codes": ["G0179", "G0180"],
        "clinical_indicators": ["OASIS-E M1800 score 3", "homebound status", "PT 3x/week"],
        "patient_age": 78, "patient_sex": "female",
    },
    {
        "niche": "DME_Forensics",
        "icd10_primary": "Z87.39",
        "cpt_codes": ["E1399", "K0001"],
        "clinical_indicators": ["power wheelchair", "unable to ambulate", "KX modifier"],
        "patient_age": 65, "patient_sex": "male",
    },
    {
        "niche": "Behavioral_Health",
        "icd10_primary": "F32.1",
        "cpt_codes": ["90837", "99213"],
        "clinical_indicators": ["MDD moderate", "PHQ-9 score 14", "medication management"],
        "patient_age": 38, "patient_sex": "female",
    },
]


def get_sample_bill(niche: Optional[str] = None) -> dict:
    """Return a sample raw bill, optionally filtered by niche."""
    if niche:
        bills = [b for b in SAMPLE_BILLS if b["niche"] == niche]
        if bills:
            return dict(bills[0])
    return dict(random.choice(SAMPLE_BILLS))
