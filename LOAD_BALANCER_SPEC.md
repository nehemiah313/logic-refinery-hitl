# Scout & Refiner Load Balancer — Architecture Specification
# Logic Refinery v3.0

## Overview

The Load Balancer is the routing intelligence layer of the Logic Refinery pipeline.
It sits between the Orchestrator and the Worker Nodes, and its sole job is to:
1. Detect what tier a node is (i5-Scout vs Ryzen-Refiner) at registration time
2. Assign the right task type to each tier
3. Never send a Gold Standard reasoning job to a Scout, and never waste a Refiner on a Claim Map parse

---

## Node Tier Detection

When a worker calls `POST /api/nodes/register`, it sends a `hardware_profile` object.
The Load Balancer reads this and assigns a `node_tier` automatically.

### Detection Logic (Priority Order)

| Check | Scout (i5) | Refiner (Ryzen) |
|---|---|---|
| `vram_gb` | 0 or absent | ≥ 6 |
| `ram_gb` | ≤ 10 | ≥ 14 |
| `model` | phi4-mini, phi3-mini, llama3.2:1b | mistral-nemo, llama3.1:8b, llama3.1:70b |
| `cpu_brand` | intel, i5, i3 | amd, ryzen, epyc |
| Manual override | `node_tier: "scout"` | `node_tier: "refiner"` |

The worker_client.py auto-detects and sends this profile on startup via `psutil` + `subprocess`.

---

## Task Type Routing

### Vertical A — i5 Scout Tasks (Claim Map Generation)

**What it is:** Deterministic, low-memory parsing of raw medical bill data into a
structured Claim Map SDR (Standardized Data Record).

**Why Scouts:** No LLM reasoning required. Pure rule-based mapping against the
NCCI edit tables. 50% CPU, ~2-3GB RAM. Safe for 8GB machines.

**Claim Map Schema:**
```json
{
  "claim_map_id": "cm_abc123",
  "source_bill_id": "bill_xyz",
  "generated_at": "2026-03-22T00:00:00Z",
  "generated_by": "node_01",
  "node_tier": "scout",
  "clinical_anchor": {
    "icd10_primary": "M17.11",
    "icd10_secondary": ["Z96.651"],
    "diagnosis_description": "Unilateral primary osteoarthritis, right knee",
    "clinical_indicators": ["joint space narrowing", "KL Grade 4", "WOMAC 68/96"]
  },
  "transactional_layer": [
    {
      "cpt_code": "27447",
      "description": "Total knee arthroplasty",
      "modifier": null,
      "units": 1,
      "allowed_amount": 1850.00,
      "billed_amount": 2200.00,
      "delta": 350.00
    }
  ],
  "forensic_link": {
    "ncci_edit_type": "Column1/Column2",
    "column1_code": "27447",
    "column2_code": "29881",
    "edit_status": "BUNDLED",
    "modifier_indicator": "0",
    "ncci_citation": "2026 NCCI Ch. IV §E",
    "oig_priority": true,
    "audit_risk": "HIGH"
  },
  "claim_map_status": "ready_for_refiner",
  "financial_impact_estimate": 350.00
}
```

### Vertical B — Ryzen Refiner Tasks (Gold Standard Reasoning)

**What it is:** Full chain-of-thought reasoning over a completed Claim Map,
producing a Gold Standard Logic Trace for Bittensor submission.

**Why Refiners:** Requires a 7B-12B parameter model (Mistral-Nemo or Llama 3.1 8B)
running with 6-8GB VRAM. Produces the `<think>` block, `chain_of_thought` array,
and `final_decision` that the HITL validator reviews.

**Input:** A `claim_map` object (output of Scout stage)
**Output:** A full `logic_trace` object (Gold Standard v2.1 schema)

---

## Pipeline Flow (End-to-End)

```
GCP ML Model
    │
    ▼ raw medical bill JSON
┌─────────────────────────────┐
│  Orchestrator (Flask)       │
│  - Receives raw bill        │
│  - Creates SCOUT job        │
└────────────┬────────────────┘
             │ POST /api/jobs/claim
             ▼
┌─────────────────────────────┐
│  Load Balancer              │
│  - Detects node tier        │
│  - Routes to i5-Scout queue │
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────┐
│  i5-Scout Node              │
│  - Parses bill → Claim Map  │
│  - Submits claim_map JSON   │
│  - ~2-5 min per bill        │
└────────────┬────────────────┘
             │ POST /api/claim_maps/submit
             ▼
┌─────────────────────────────┐
│  Orchestrator               │
│  - Stores Claim Map         │
│  - Creates REFINER job      │
└────────────┬────────────────┘
             │ POST /api/jobs/refine
             ▼
┌─────────────────────────────┐
│  Load Balancer              │
│  - Routes to Ryzen queue    │
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────┐
│  Ryzen-Refiner Node         │
│  - Runs Llama 3.1 8B        │
│  - Generates Logic Trace    │
│  - Submits trace JSON       │
│  - ~5-15 min per trace      │
└────────────┬────────────────┘
             │ POST /api/traces/submit
             ▼
┌─────────────────────────────┐
│  HITL Validator (Web App)   │
│  - Human reviews trace      │
│  - Approve → Gold Standard  │
│  - Export → Bittensor       │
└─────────────────────────────┘
```

---

## Load Balancer Queue Design

Two separate job queues, never mixed:

| Queue | Job Type | Assigned To | Priority |
|---|---|---|---|
| `scout_queue` | `claim_map_parse` | i5-Scout nodes only | FIFO |
| `refiner_queue` | `gold_standard_reason` | Ryzen-Refiner nodes only | Score-weighted |

The Refiner queue is score-weighted: Claim Maps with higher `financial_impact_estimate`
are promoted to the front of the queue, ensuring the highest-yield traces are
processed first.

---

## Throughput Targets

| Tier | Nodes | Task Time | Daily Output |
|---|---|---|---|
| i5-Scout (×7) | 7 | 3 min/bill | ~1,680 Claim Maps/day |
| Ryzen-Refiner (×3) | 3 | 10 min/trace | ~432 Logic Traces/day |
| HITL Validation | 1 human | 30 sec/trace | ~960 traces/day (theoretical) |
| **Gold Standard Target** | — | — | **~400 verified traces/day** |

At $1-$5 per verified trace (2026 Bittensor market):
- Conservative: 400 × $1.00 = **$400/day = $12,000/month**
- Optimistic: 400 × $5.00 = **$2,000/day = $60,000/month**
