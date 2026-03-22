# Logic Refinery — HITL Validator

> **Neuro-Symbolic Reasoning Pipeline for Medical Billing Forensics**
>
> A distributed, human-in-the-loop data refinery that transforms raw CPT/HCPCS billing data into Gold Standard logic traces for AI training on the Bittensor network.

[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Flask](https://img.shields.io/badge/Flask-3.x-000000?style=flat-square&logo=flask&logoColor=white)](https://flask.palletsprojects.com)
[![Ollama](https://img.shields.io/badge/Ollama-phi4--mini-FF6B35?style=flat-square)](https://ollama.com)
[![Schema](https://img.shields.io/badge/Schema-Gold_Standard_v2.1-DAA520?style=flat-square)](#gold-standard-schema)
[![License](https://img.shields.io/badge/License-MIT-22C55E?style=flat-square)](LICENSE)

---

## What Is This?

The Logic Refinery is a **four-stage Neuro-Symbolic reasoning pipeline** that produces verified, HuggingFace-compatible `Instruction-CoT` training datasets for medical billing AI. It combines a fleet of local LLM worker nodes with a human forensic auditor interface to create the highest-value asset in the 2026 AI data market: **human-verified chain-of-thought reasoning traces grounded in CMS regulatory citations**.

The core insight is that AI training data has two tiers:

| Tier | Description | Market Value |
|---|---|---|
| Crude (unverified AI) | Raw phi4-mini output, hallucination risk | ~$0.01 / 1k traces |
| **Gold Standard** | **Human-verified + NCCI-cited + forensically grounded** | **$1.00–$5.00 / trace** |

The `human_verified: true` flag is the **Proof of Work** for the Bittensor network. This system manufactures that flag at scale.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                      LOGIC REFINERY PIPELINE                          │
│                                                                        │
│  Stage 1 · Neural Layer            Stage 2 · Augmentation             │
│  ┌──────────────────────┐          ┌──────────────────────┐           │
│  │  7× i5 Scout Nodes   │─────────▶│  GCP ML Baseline     │           │
│  │  phi4-mini (Ollama)  │          │  500k SynPUF Records │           │
│  │  Claim Map Gen       │          │  CMS Adjudication    │           │
│  └──────────────────────┘          └──────────┬───────────┘           │
│                                               │                        │
│  Stage 4 · Ground Truth            Stage 3 · LLM-as-Judge             │
│  ┌──────────────────────┐          ┌──────────▼───────────┐           │
│  │  HITL Web App        │◀─────────│  Ryzen Refiner Nodes │           │
│  │  Human Auditors      │          │  Llama 3.1 8B        │           │
│  │  Gold Standard Vault │          │  Score & Re-rank     │           │
│  └──────────┬───────────┘          └──────────────────────┘           │
│             │                                                           │
│             ▼                                                           │
│  ┌──────────────────────┐                                              │
│  │  Bittensor Network   │  ← HuggingFace Instruction-CoT JSONL         │
│  │  Subnet Submission   │    Gold Standard v2.1 Schema                 │
│  └──────────────────────┘                                              │
└──────────────────────────────────────────────────────────────────────┘
```

### Node Tiers

| Tier | Hardware | Model | Task |
|---|---|---|---|
| **i5-Scout** | Intel i5, 8 GB RAM | `phi4-mini` via Ollama | Deterministic Claim Map generation |
| **Ryzen-Refiner** | Ryzen + NVIDIA GPU, 16–32 GB | `llama3.1:8b` | Gold Standard reasoning & scoring |

The load balancer auto-detects tier from CPU model string, RAM, and VRAM. Override with `--tier scout` or `--tier refiner`.

---

## Key Features

### HITL Validator ("Tinder for Logic")
A mobile-first web application where forensic auditors review traces with a single tap or keyboard shortcut. Every card surfaces the full `<think>` reasoning block, NCCI regulatory citation, OIG priority flag, and financial impact before a decision is made. Auditors can **Approve**, **Deny**, **Skip**, or **Approve with Edit** — correcting CPT codes, ICD-10 codes, or NCCI citations inline before the trace enters the Gold Standard vault.

### Scout & Refiner Load Balancer
Automatic node-tier detection classifies connected hardware. The orchestrator maintains two separate job queues — lightweight Claim Map jobs for Scouts, high-complexity Gold Standard reasoning jobs for Refiners — and routes work accordingly. A 24-hour throughput chart shows Scout vs. Refiner completion rates in real time.

### Claim Map Inspector
Clicking any job in the queue opens a slide-up drawer showing the full Claim Map JSON: clinical anchor (ICD-10 + symptoms), transactional layer (CPT + modifiers), NCCI forensic link (edit type + citation), and audit flags. The phi4-mini `<think>` reasoning block is surfaced for auditor review.

### Eval Harness
A 50-example gold-standard regression test suite scoring phi4-mini output across four dimensions: JSON syntax validity, CPT/ICD-10 code accuracy, NCCI edit correctness, and financial exposure accuracy. Runs on demand or on a scheduled cycle. A live alert banner fires when the composite score drops below 85%. Results export as a 3-page PDF audit report.

### Daily Bittensor Target Tracker
A progress bar showing verified traces vs. the 1,500/day Bittensor submission target, color-shifting from red → amber → green. Includes a niche filter bar (10 billing categories) and a one-tap **Promote to Refiner** button for fast-tracking high-value Scout jobs.

### Gold Standard JSONL Export
A streaming exporter that filters `human_verified: true` traces and reformats them into the HuggingFace `Instruction-CoT` schema with full provenance: `ncci_citation`, `oig_priority`, `chain_of_thought`, `reasoning_trace`, `bittensor_ready`, and `schema_version: gold_standard_v2.1`.

---

## Gold Standard Schema

```json
{
  "schema_version": "gold_standard_v2.1",
  "trace_id": "trace_20260322_001",
  "niche": "MSK_Forensics",
  "icd10": "M17.11",
  "cpt_codes": ["27447", "29881"],
  "ncci_citation": "2026 NCCI Ch. IV §E — Arthroscopy/Arthroplasty",
  "oig_priority": false,
  "financial_impact": 4200.00,
  "instruction": "You are a Neuro-Symbolic Medical Billing Auditor...",
  "chain_of_thought": [
    "READ: Identify all CPT codes present in the claim.",
    "ANALYZE: Cross-reference against NCCI Column 1/Column 2 edit table.",
    "PLAN: Determine if a modifier exception applies.",
    "IMPLEMENT: Calculate the correct reimbursable amount.",
    "VERIFY: Confirm against CMS Claims Processing Manual §30.6.7."
  ],
  "reasoning_trace": "<think>CPT 29881 is a Column 2 code to 27447 per NCCI Ch. IV §E. No modifier exception applies because both procedures were performed on the same anatomical site in the same operative session...</think>",
  "output": "DENY: CPT 29881 is unbundled by 27447 per NCCI edit. Correct reimbursement: CPT 27447 only.",
  "human_verified": true,
  "auditor_id": "aud_001",
  "verified_at": "2026-03-22T14:30:00Z",
  "bittensor_ready": true
}
```

---

## Repository Structure

```
logic-refinery-hitl/
├── backend/
│   ├── app.py                     # Flask API server — all endpoints
│   ├── orchestrator.py            # Job scheduler & 2-hour dispatch cycle
│   ├── load_balancer.py           # Scout/Refiner tier detection & routing
│   ├── claim_mapper.py            # Deterministic NCCI Claim Map generator
│   ├── eval_harness.py            # 4-dimension regression test runner
│   ├── worker_client.py           # Worker node client (runs on each node)
│   ├── setup_node.sh              # One-command node installer
│   ├── eval_gold_standard.jsonl   # 50 gold-standard eval examples
│   └── requirements.txt           # Python dependencies
├── client/
│   └── src/
│       ├── components/
│       │   ├── ValidatorCard.tsx      # HITL trace card with Approve/Edit/Deny
│       │   ├── LoadBalancerPanel.tsx  # Scout/Refiner queue dashboard
│       │   ├── NodeMonitor.tsx        # Cluster health & node status
│       │   ├── EvalDashboard.tsx      # Eval harness results & PDF export
│       │   ├── MobileHeader.tsx       # Header with eval regression alert
│       │   ├── BottomNav.tsx          # Mobile bottom tab navigation
│       │   └── MobileStatsSheet.tsx   # Mobile stats & export panel
│       ├── pages/Home.tsx             # Main layout & tab routing
│       └── lib/api.ts                 # Typed API client
├── ARCHITECTURE.md                # Full distributed system design
├── LOAD_BALANCER_SPEC.md          # Scout & Refiner specification
├── NODE_SETUP.md                  # Step-by-step node connection guide
└── start.sh                       # Launch backend + frontend together
```

---

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 22+ and [pnpm](https://pnpm.io)
- [Ollama](https://ollama.com) with `phi4-mini` pulled: `ollama pull phi4-mini`

### 1. Clone and Install

```bash
git clone https://github.com/nehemiah313/logic-refinery-hitl.git
cd logic-refinery-hitl

# Frontend dependencies
pnpm install

# Backend dependencies
pip3 install -r backend/requirements.txt
```

### 2. Start the Application

```bash
# Start everything with one command
bash start.sh

# OR start separately:
# Terminal 1 — Flask backend (port 5001)
cd backend && python3 app.py

# Terminal 2 — React frontend (port 3000)
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Connect Worker Nodes

On each i5 Scout machine, copy `backend/worker_client.py` and `backend/setup_node.sh`, then run:

```bash
chmod +x setup_node.sh

./setup_node.sh \
  --node-id node_01 \
  --orchestrator http://YOUR_ORCHESTRATOR_IP:5001 \
  --tier scout \
  --systemd     # optional: install as systemd service for auto-restart
```

The node appears in the **Cluster Monitor** tab within 30 seconds. Repeat with `node_02` through `node_07`.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `→` or `L` | Approve trace |
| `←` or `J` | Deny trace |
| `↑` or `K` | Skip trace |
| `E` | Enter Approve with Edit mode |

---

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `GET /api/health` | GET | System health, vault stats, node count |
| `GET /api/traces/pending` | GET | Fetch next unverified trace for review |
| `POST /api/traces/verify` | POST | Submit auditor decision (approve/deny/skip) |
| `POST /api/traces/generate` | POST | Trigger new trace generation cycle |
| `POST /api/lb/detect_tier` | POST | Detect node tier from hardware profile |
| `POST /api/lb/jobs/claim/scout` | POST | Scout node claims a Claim Map job |
| `POST /api/lb/jobs/claim/refiner` | POST | Refiner node claims a reasoning job |
| `POST /api/lb/promote` | POST | Promote Scout job to Refiner queue |
| `GET /api/lb/throughput` | GET | 24-hour Scout/Refiner completion data |
| `GET /api/lb/daily_stats` | GET | Daily Gold trace count vs. 1,500 target |
| `POST /api/eval/run` | POST | Trigger eval harness run |
| `GET /api/eval/report` | GET | Latest eval results & composite score |
| `GET /api/eval/export_pdf` | GET | Download PDF audit report |
| `GET /api/export/jsonl` | GET | Stream Gold Standard JSONL export |

---

## Supported Billing Niches

Ten high-value medical billing niches, including three flagged as 2026 OIG Work Plan priorities:

| Niche | NCCI Reference | OIG 2026 |
|---|---|---|
| MSK Forensics (TKA / Arthroscopy) | Ch. IV §E | — |
| Oncology Billing | Ch. VIII §D | — |
| Evaluation & Management (E/M) | Ch. I §C | — |
| Radiology Forensics | Ch. X §B | — |
| Cardiology Forensics | Ch. V §A | — |
| Anesthesia Billing | Ch. II §F | — |
| Urology Forensics | Ch. VII §2 | — |
| Home Health Upcoding (OASIS-E) | CMS HH PPS §30.2 | ✅ Priority |
| DME Unbundling | HCPCS DME §4.2 | ✅ Priority |
| Behavioral Health (90837/90838) | CPT Psych §90.4 | ✅ Priority |

---

## Regulatory Grounding

All trace generation and validation is grounded in current regulatory sources:

- **2026 CMS NCCI Policy Manual** (effective January 1, 2026)
- **CMS Medicare Claims Processing Manual** (Pub. 100-04)
- **2026 OIG Work Plan** — Home Health, DME, and Behavioral Health priority areas
- **AZ HB 2175 / TX SB 1188** — State-level AI-in-healthcare human oversight mandates

The HITL step satisfies the human oversight requirements of AZ HB 2175 and TX SB 1188, making the Gold Standard label legally defensible in those jurisdictions.

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Acknowledgements

Built on [Ollama](https://ollama.com), [phi-4-mini](https://huggingface.co/microsoft/Phi-4-mini-reasoning), [React 19](https://react.dev), [Flask](https://flask.palletsprojects.com), and [shadcn/ui](https://ui.shadcn.com). Medical billing logic grounded in CMS public data from [data.cms.gov](https://data.cms.gov).
