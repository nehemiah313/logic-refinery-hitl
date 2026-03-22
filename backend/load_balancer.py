"""
load_balancer.py — Scout & Refiner Load Balancer
Logic Refinery v3.0

Responsibilities:
  1. Detect node tier (i5-Scout vs Ryzen-Refiner) from hardware_profile at registration
  2. Maintain two separate job queues: scout_queue and refiner_queue
  3. Route claim_map_parse jobs to Scouts only
  4. Route gold_standard_reason jobs to Refiners only
  5. Score-weight the Refiner queue by financial_impact_estimate
  6. Expose stats for the dashboard
"""

import uuid
import time
import threading
from datetime import datetime, timezone
from typing import Optional


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

SCOUT_MODELS = {
    "phi4-mini", "phi4:mini", "phi-4-mini",
    "phi3-mini", "phi3:mini", "phi-3-mini",
    "phi3", "phi4",
    "llama3.2:1b", "llama3.2:3b",
    "tinyllama", "gemma:2b", "gemma2:2b",
    "qwen2.5:1.5b", "qwen2.5:3b",
}

REFINER_MODELS = {
    "mistral-nemo", "mistral-nemo:12b",
    "llama3.1:8b", "llama3.1:70b",
    "llama3:8b", "llama3:70b",
    "mistral:7b", "mistral:latest",
    "mixtral:8x7b",
    "qwen2.5:7b", "qwen2.5:14b",
    "deepseek-r1:7b", "deepseek-r1:8b",
}

SCOUT_CPU_KEYWORDS = {"intel", "i3", "i5", "i7-6", "i7-7", "i7-8", "core"}
REFINER_CPU_KEYWORDS = {"amd", "ryzen", "epyc", "threadripper", "xeon"}

# RAM thresholds (GB)
SCOUT_MAX_RAM = 10
REFINER_MIN_RAM = 14

# VRAM thresholds (GB)
REFINER_MIN_VRAM = 6


# ─────────────────────────────────────────────────────────────────────────────
# Tier Detection
# ─────────────────────────────────────────────────────────────────────────────

def detect_node_tier(hardware_profile: dict) -> dict:
    """
    Determine node tier from hardware_profile sent at registration.

    Returns:
        {
            "tier": "scout" | "refiner",
            "confidence": "high" | "medium" | "low",
            "reason": str,
            "capabilities": {...}
        }
    """
    # Manual override always wins
    if "node_tier" in hardware_profile:
        tier = hardware_profile["node_tier"].lower()
        if tier in ("scout", "refiner"):
            return {
                "tier": tier,
                "confidence": "high",
                "reason": "manual_override",
                "capabilities": _build_capabilities(tier, hardware_profile),
            }

    score_refiner = 0
    score_scout = 0
    reasons = []

    model = hardware_profile.get("model", "").lower().strip()
    ram_gb = float(hardware_profile.get("ram_gb", 0))
    vram_gb = float(hardware_profile.get("vram_gb", 0))
    cpu_brand = hardware_profile.get("cpu_brand", "").lower()
    cpu_model = hardware_profile.get("cpu_model", "").lower()

    # ── Model check (highest weight) ──
    if model in REFINER_MODELS:
        score_refiner += 4
        reasons.append(f"model={model} is Refiner-class")
    elif model in SCOUT_MODELS:
        score_scout += 4
        reasons.append(f"model={model} is Scout-class")
    elif model:
        # Unknown model — use parameter count hint if available
        param_count = hardware_profile.get("model_params_b", 0)
        if param_count >= 7:
            score_refiner += 2
            reasons.append(f"model={model} params={param_count}B → Refiner-class")
        else:
            score_scout += 2
            reasons.append(f"model={model} params={param_count}B → Scout-class")

    # ── VRAM check ──
    if vram_gb >= REFINER_MIN_VRAM:
        score_refiner += 3
        reasons.append(f"vram={vram_gb}GB ≥ {REFINER_MIN_VRAM}GB Refiner threshold")
    elif vram_gb == 0:
        score_scout += 2
        reasons.append("no VRAM detected → Scout-class")

    # ── RAM check ──
    if ram_gb >= REFINER_MIN_RAM:
        score_refiner += 2
        reasons.append(f"ram={ram_gb}GB ≥ {REFINER_MIN_RAM}GB Refiner threshold")
    elif ram_gb <= SCOUT_MAX_RAM:
        score_scout += 2
        reasons.append(f"ram={ram_gb}GB ≤ {SCOUT_MAX_RAM}GB Scout threshold")

    # ── CPU brand check ──
    cpu_str = f"{cpu_brand} {cpu_model}"
    if any(k in cpu_str for k in REFINER_CPU_KEYWORDS):
        score_refiner += 2
        reasons.append(f"cpu={cpu_str!r} is Refiner-class (AMD/Ryzen)")
    elif any(k in cpu_str for k in SCOUT_CPU_KEYWORDS):
        score_scout += 1
        reasons.append(f"cpu={cpu_str!r} is Scout-class (Intel i5)")

    # ── Decision ──
    total = score_refiner + score_scout
    if total == 0:
        tier = "scout"
        confidence = "low"
        reasons.append("no hardware signals detected → defaulting to Scout")
    elif score_refiner > score_scout:
        tier = "refiner"
        confidence = "high" if score_refiner >= 6 else "medium"
    else:
        tier = "scout"
        confidence = "high" if score_scout >= 4 else "medium"

    return {
        "tier": tier,
        "confidence": confidence,
        "reason": "; ".join(reasons),
        "capabilities": _build_capabilities(tier, hardware_profile),
    }


def _build_capabilities(tier: str, hw: dict) -> dict:
    if tier == "refiner":
        return {
            "task_types": ["gold_standard_reason", "claim_map_parse"],
            "max_concurrent_jobs": 1,
            "max_tokens": 4096,
            "supports_vram": float(hw.get("vram_gb", 0)) > 0,
            "bittensor_eligible": True,
        }
    else:
        return {
            "task_types": ["claim_map_parse"],
            "max_concurrent_jobs": 2,
            "max_tokens": 512,
            "supports_vram": False,
            "bittensor_eligible": False,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Job Queue
# ─────────────────────────────────────────────────────────────────────────────

class LoadBalancer:
    """
    Dual-queue load balancer.
    - scout_queue: FIFO, claim_map_parse jobs only
    - refiner_queue: score-weighted, gold_standard_reason jobs only
    """

    def __init__(self):
        self._lock = threading.Lock()
        self.scout_queue: list[dict] = []
        self.refiner_queue: list[dict] = []
        self.active_jobs: dict[str, dict] = {}   # job_id → job
        self.completed_jobs: list[dict] = []
        self.failed_jobs: list[dict] = []

    # ── Enqueue ──────────────────────────────────────────────────────────────

    def enqueue_scout_job(
        self,
        niche: str,
        raw_bill: dict,
        priority: int = 5,
        source_bill_id: Optional[str] = None,
    ) -> dict:
        """Add a Claim Map parse job to the Scout queue (FIFO)."""
        job = {
            "job_id": f"scout_{uuid.uuid4().hex[:10]}",
            "job_type": "claim_map_parse",
            "tier_required": "scout",
            "niche": niche,
            "raw_bill": raw_bill,
            "source_bill_id": source_bill_id or f"bill_{uuid.uuid4().hex[:8]}",
            "status": "queued",
            "priority": priority,
            "financial_impact_estimate": raw_bill.get("financial_impact_estimate", 0.0),
            "created_at": _now(),
            "assigned_to": None,
            "claimed_at": None,
            "completed_at": None,
            "claim_map_id": None,
        }
        with self._lock:
            self.scout_queue.append(job)
        return job

    def enqueue_refiner_job(
        self,
        claim_map: dict,
        ncci_citation: str = "",
        oig_priority: bool = False,
    ) -> dict:
        """
        Add a Gold Standard reasoning job to the Refiner queue.
        Queue is sorted by financial_impact_estimate (highest first).
        """
        financial_impact = claim_map.get("financial_impact_estimate", 0.0)
        job = {
            "job_id": f"refiner_{uuid.uuid4().hex[:10]}",
            "job_type": "gold_standard_reason",
            "tier_required": "refiner",
            "niche": claim_map.get("niche", "Unknown"),
            "claim_map": claim_map,
            "claim_map_id": claim_map.get("claim_map_id"),
            "status": "queued",
            "financial_impact_estimate": financial_impact,
            "oig_priority": oig_priority,
            "ncci_citation": ncci_citation,
            "created_at": _now(),
            "assigned_to": None,
            "claimed_at": None,
            "completed_at": None,
            "trace_id": None,
        }
        with self._lock:
            self.refiner_queue.append(job)
            # Score-weight sort: OIG priority first, then by financial impact
            self.refiner_queue.sort(
                key=lambda j: (
                    -int(j.get("oig_priority", False)),
                    -j.get("financial_impact_estimate", 0.0),
                )
            )
        return job

    # ── Claim (worker polls for next job) ────────────────────────────────────

    def claim_job(self, node_id: str, node_tier: str) -> Optional[dict]:
        """
        Worker calls this to claim the next available job for its tier.
        Returns the job dict or None if nothing is available.
        """
        with self._lock:
            queue = self.refiner_queue if node_tier == "refiner" else self.scout_queue
            for job in queue:
                if job["status"] == "queued":
                    job["status"] = "in_progress"
                    job["assigned_to"] = node_id
                    job["claimed_at"] = _now()
                    self.active_jobs[job["job_id"]] = job
                    return job
        return None

    # ── Complete / Fail ───────────────────────────────────────────────────────

    def complete_job(self, job_id: str, result: dict) -> Optional[dict]:
        """Mark a job as completed and store the result."""
        with self._lock:
            job = self.active_jobs.get(job_id)
            if not job:
                # Search queues
                for q in (self.scout_queue, self.refiner_queue):
                    for j in q:
                        if j["job_id"] == job_id:
                            job = j
                            break
            if job:
                job["status"] = "completed"
                job["completed_at"] = _now()
                job["result"] = result
                self.completed_jobs.append(job)
                self.active_jobs.pop(job_id, None)
        return job

    def fail_job(self, job_id: str, error: str) -> Optional[dict]:
        """Mark a job as failed."""
        with self._lock:
            job = self.active_jobs.get(job_id)
            if job:
                job["status"] = "failed"
                job["completed_at"] = _now()
                job["error"] = error
                self.failed_jobs.append(job)
                self.active_jobs.pop(job_id, None)
        return job

    # ── Stats ─────────────────────────────────────────────────────────────────

    def get_stats(self) -> dict:
        with self._lock:
            scout_q = [j for j in self.scout_queue if j["status"] == "queued"]
            refiner_q = [j for j in self.refiner_queue if j["status"] == "queued"]
            active_scout = [j for j in self.active_jobs.values() if j["tier_required"] == "scout"]
            active_refiner = [j for j in self.active_jobs.values() if j["tier_required"] == "refiner"]
            completed_scout = [j for j in self.completed_jobs if j["tier_required"] == "scout"]
            completed_refiner = [j for j in self.completed_jobs if j["tier_required"] == "refiner"]

            return {
                "scout_queue": {
                    "queued": len(scout_q),
                    "in_progress": len(active_scout),
                    "completed": len(completed_scout),
                    "failed": len([j for j in self.failed_jobs if j["tier_required"] == "scout"]),
                },
                "refiner_queue": {
                    "queued": len(refiner_q),
                    "in_progress": len(active_refiner),
                    "completed": len(completed_refiner),
                    "failed": len([j for j in self.failed_jobs if j["tier_required"] == "refiner"]),
                },
                "total_jobs": (
                    len(self.scout_queue) + len(self.refiner_queue)
                ),
                "pipeline_throughput": {
                    "claim_maps_ready": len([
                        j for j in self.completed_jobs
                        if j["tier_required"] == "scout"
                        and j.get("result", {}).get("claim_map_id")
                    ]),
                    "traces_ready_for_hitl": len([
                        j for j in self.completed_jobs
                        if j["tier_required"] == "refiner"
                        and j.get("result", {}).get("trace_id")
                    ]),
                },
                "top_refiner_jobs": [
                    {
                        "job_id": j["job_id"],
                        "niche": j["niche"],
                        "financial_impact": j["financial_impact_estimate"],
                        "oig_priority": j.get("oig_priority", False),
                        "status": j["status"],
                    }
                    for j in self.refiner_queue[:5]
                ],
            }

    def get_queue_snapshot(self, tier: str, limit: int = 20) -> list:
        """Return a snapshot of the queue for a given tier."""
        with self._lock:
            queue = self.refiner_queue if tier == "refiner" else self.scout_queue
            return [
                {
                    "job_id": j["job_id"],
                    "job_type": j["job_type"],
                    "niche": j["niche"],
                    "status": j["status"],
                    "financial_impact_estimate": j.get("financial_impact_estimate", 0),
                    "oig_priority": j.get("oig_priority", False),
                    "assigned_to": j.get("assigned_to"),
                    "created_at": j["created_at"],
                }
                for j in queue[:limit]
            ]


# ─────────────────────────────────────────────────────────────────────────────
# Singleton instance (imported by app.py)
# ─────────────────────────────────────────────────────────────────────────────

load_balancer = LoadBalancer()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
