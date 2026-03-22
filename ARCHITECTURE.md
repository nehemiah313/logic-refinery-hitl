# Logic Refinery — Distributed 7-Node Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    YOUR LOCAL NETWORK (LAN)                              │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              ORCHESTRATOR NODE (Your main machine)               │   │
│  │                                                                  │   │
│  │   Flask Backend (port 5001)     React HITL App (port 3000)      │   │
│  │   ┌─────────────────────┐       ┌──────────────────────────┐    │   │
│  │   │  Job Queue          │       │  Validator UI            │    │   │
│  │   │  Node Registry      │       │  Node Monitor Panel      │    │   │
│  │   │  Vault (JSONL)      │       │  Live Cluster Dashboard  │    │   │
│  │   │  Gold Standard      │       │                          │    │   │
│  │   └─────────────────────┘       └──────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│            ▲  ▲  ▲  ▲  ▲  ▲  ▲  (HTTP polling, ~30s interval)          │
│            │  │  │  │  │  │  │                                          │
│   ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                    │
│   │ N1 │ │ N2 │ │ N3 │ │ N4 │ │ N5 │ │ N6 │ │ N7 │                    │
│   │i5  │ │i5  │ │i5  │ │i5  │ │i5  │ │i5  │ │i5  │                    │
│   │8GB │ │8GB │ │8GB │ │8GB │ │8GB │ │8GB │ │8GB │                    │
│   │Phi4│ │Phi4│ │Phi4│ │Phi4│ │Phi4│ │Phi4│ │Phi4│                    │
│   └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘                    │
│   WORKER NODES — each runs worker_client.py + Ollama + picoclaw          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## The Job Cycle (Every 2–3 Hours)

```
ORCHESTRATOR                         WORKER NODE (x7)
─────────────                        ────────────────
1. Scheduler fires                   
   (every 2h cron)                   
2. Generates job batch               
   (7 jobs × 5 traces = 35)          
3. Pushes jobs to queue              
                                     4. Worker polls GET /api/jobs/claim
                                        (every 30 seconds)
                                     5. Claims one job
                                     6. Calls Ollama Phi-4-Mini locally
                                     7. Generates 5 traces
                                     8. POSTs traces to /api/traces/submit
9. Flask receives traces             
10. Runs Stage 2 (GCP augment)       
11. Runs Stage 3 (LLM judge score)   
12. Queues top traces for HITL       
                                     
13. Human auditor reviews in         
    web app (or Telegram)            
14. Approved → gold_standard.jsonl   
15. Bittensor export ready           
```

---

## Data Flow Detail

### Stage 1 — Neural Generation (Worker Nodes)
Each worker node receives a **Job Spec** from the orchestrator:

```json
{
  "job_id": "job_abc123",
  "niche": "MSK_Forensics",
  "cpt_codes": ["27447", "29881"],
  "icd10": "M17.11",
  "prompt_template": "Generate a medical billing audit trace for...",
  "traces_requested": 5,
  "assigned_to": "node_03",
  "deadline": "2026-03-22T06:00:00Z"
}
```

The worker runs this prompt through Ollama Phi-4-Mini and returns raw traces.

### Stage 2 — Augmentation (Orchestrator)
Flask cross-references each raw trace against the GCP ML baseline patterns (the 500k SynPUF records). It adds:
- Historical denial/approval rate for this CPT combination
- NCCI edit flags
- MUE unit limit checks

### Stage 3 — LLM-as-Judge (Orchestrator)
Flask scores each trace 0–100 using rule-based NCCI logic (and optionally a second Ollama call to a larger model on the Ryzen validators). Only traces scoring ≥ 85 are promoted to Stage 4.

### Stage 4 — HITL (Web App / Telegram)
The top-scored traces appear in the validator card queue. Human auditor approves or denies. Verified traces get `human_verified: true` and are written to `gold_standard.jsonl`.

---

## Network Requirements

| Requirement | Value |
| :--- | :--- |
| All nodes on same LAN | Required (or VPN) |
| Orchestrator IP | Static (e.g., 192.168.1.100) |
| Orchestrator port | 5001 (Flask) |
| Worker → Orchestrator | HTTP only, no inbound needed on workers |
| Ollama port on workers | 11434 (local only) |
| picoclaw port on workers | 11435 (local only) |

Workers only need **outbound** HTTP access to the orchestrator. No ports need to be opened on the worker machines.

---

## Throughput Estimate

| Variable | Value |
| :--- | :--- |
| Nodes | 7 |
| Traces per node per cycle | 5 |
| Cycle interval | 2 hours |
| Raw traces per day | 7 × 5 × 12 = **420 traces/day** |
| Stage 3 pass rate (≥85 score) | ~70% → **294 traces/day** reach HITL |
| Human review speed | ~2 min/trace → **~10 traces/hour** |
| Gold Standard per day (1 auditor) | ~80 verified traces |
| Gold Standard value per day | $80–$400/day |

---

## File Structure After This Build

```
logic-refinery-hitl/
├── backend/
│   ├── app.py              ← Extended with job queue + node registry
│   ├── orchestrator.py     ← NEW: Scheduler + job dispatch
│   ├── worker_client.py    ← NEW: Runs on each i5 node
│   ├── vault.jsonl         ← All raw traces
│   └── gold_standard.jsonl ← Human-verified only
├── client/
│   └── src/
│       ├── components/
│       │   ├── NodeMonitor.tsx   ← NEW: Live cluster dashboard
│       │   └── ...existing...
│       └── pages/
│           └── Home.tsx
└── start.sh
```
