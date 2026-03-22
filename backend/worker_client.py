"""
Logic Refinery v3.0 — Worker Node Client (Scout & Refiner Contract)
=====================================================================
This script runs on each worker node. It auto-detects its tier (Scout or
Refiner) from hardware profile, then routes to the correct Load Balancer
endpoints.

TIER ROUTING:
  i5-Scout  → /api/lb/jobs/claim/scout  → Claim Map parsing (deterministic)
  Ryzen-Refiner → /api/lb/jobs/claim/refiner → Gold Standard reasoning (LLM)

SETUP ON EACH WORKER NODE:
  1. Install Python 3.10+:    sudo apt install python3 python3-pip -y
  2. Install requests:        pip3 install requests
  3. Make sure Ollama is running: ollama serve
  4. Pull your model:
       i5-Scout:        ollama pull phi4-mini
       Ryzen-Refiner:   ollama pull mistral-nemo   (or llama3.1:8b)
  5. Run this script:
       # Auto-detect tier (recommended):
       python3 worker_client.py --node-id node_01 --orchestrator http://192.168.1.100:5001

       # Force Scout tier:
       python3 worker_client.py --node-id node_01 --orchestrator http://192.168.1.100:5001 --tier scout

       # Force Refiner tier:
       python3 worker_client.py --node-id ryzen_01 --orchestrator http://192.168.1.100:5001 --tier refiner --model mistral-nemo

Author: Manus AI — Logic Refinery v3.0
"""

import argparse
import json
import logging
import os
import platform
import socket
import subprocess
import sys
import time
import threading
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    print("ERROR: 'requests' not installed. Run: pip3 install requests")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
DEFAULT_ORCHESTRATOR = "http://192.168.1.100:5001"
DEFAULT_OLLAMA       = "http://localhost:11434"
DEFAULT_SCOUT_MODEL  = "phi4-mini"
DEFAULT_REFINER_MODEL = "mistral-nemo"
POLL_INTERVAL        = 30        # seconds between job polls
HEARTBEAT_INTERVAL   = 60        # seconds between heartbeats
MAX_RETRIES          = 3

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s — %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("worker.log"),
    ],
)
logger = logging.getLogger("worker")


# ---------------------------------------------------------------------------
# Hardware Profile Detection
# ---------------------------------------------------------------------------

def detect_hardware_profile(model: str) -> dict:
    """
    Probe the local machine for RAM, VRAM, and CPU info.
    Returns a hardware_profile dict suitable for /api/lb/detect_tier.
    """
    profile = {
        "model": model,
        "ram_gb": 8.0,
        "vram_gb": 0.0,
        "cpu_brand": "unknown",
        "cpu_model": platform.processor() or "unknown",
    }

    # RAM detection
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    kb = int(line.split()[1])
                    profile["ram_gb"] = round(kb / 1024 / 1024, 1)
                    break
    except Exception:
        pass

    # VRAM detection via nvidia-smi
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            vram_mb = int(result.stdout.strip().split("\n")[0])
            profile["vram_gb"] = round(vram_mb / 1024, 1)
    except Exception:
        pass

    # CPU brand from /proc/cpuinfo
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if "model name" in line.lower():
                    cpu_str = line.split(":")[1].strip().lower()
                    profile["cpu_model"] = cpu_str
                    if "amd" in cpu_str or "ryzen" in cpu_str:
                        profile["cpu_brand"] = "amd"
                    elif "intel" in cpu_str:
                        profile["cpu_brand"] = "intel"
                    break
    except Exception:
        pass

    return profile


def detect_tier_from_orchestrator(node_id: str, orchestrator: str, model: str) -> str:
    """
    Send hardware profile to the orchestrator's tier detection endpoint.
    Returns 'scout' or 'refiner'.
    """
    profile = detect_hardware_profile(model)
    logger.info(
        f"Hardware profile: RAM={profile['ram_gb']}GB VRAM={profile['vram_gb']}GB "
        f"CPU={profile['cpu_model']} Model={profile['model']}"
    )
    try:
        resp = requests.post(
            f"{orchestrator}/api/lb/detect_tier",
            json={"hardware_profile": profile},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        tier = data.get("tier", "scout")
        confidence = data.get("confidence", "unknown")
        reason = data.get("reason", "")
        logger.info(f"Tier detected: {tier.upper()} (confidence={confidence})")
        logger.info(f"  Reason: {reason}")
        return tier
    except Exception as e:
        logger.warning(f"Tier detection failed ({e}), defaulting to scout")
        return "scout"


# ---------------------------------------------------------------------------
# Ollama Interface
# ---------------------------------------------------------------------------

def call_ollama(prompt: str, model: str, ollama_url: str, max_tokens: int = 1024) -> str:
    """Call Ollama's local API. Returns the raw text response."""
    url = f"{ollama_url}/api/generate"
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.3,
            "num_predict": max_tokens,
        },
    }
    try:
        resp = requests.post(url, json=payload, timeout=180)
        resp.raise_for_status()
        return resp.json().get("response", "")
    except requests.exceptions.ConnectionError:
        raise RuntimeError(f"Cannot connect to Ollama at {ollama_url}. Is 'ollama serve' running?")
    except requests.exceptions.Timeout:
        raise RuntimeError("Ollama timed out after 180 seconds.")
    except Exception as e:
        raise RuntimeError(f"Ollama error: {e}")


# ---------------------------------------------------------------------------
# Scout Task: Claim Map Parsing
# ---------------------------------------------------------------------------

def process_scout_job(job: dict, node_id: str, orchestrator: str, ollama_url: str, model: str):
    """
    Scout task: parse a raw bill scenario into a structured Claim Map.
    This is a lightweight, deterministic task — uses Ollama only for
    narrative extraction, then posts the Claim Map to the orchestrator.
    """
    job_id = job["job_id"]
    niche = job.get("niche", "Unknown")
    scenario = job.get("scenario", "")
    logger.info(f"[SCOUT] Processing job {job_id} — {niche}")

    # phi4-mini reasoning prompt — uses <think> chain-of-thought for Claim Map generation
    ncci_hint = job.get('ncci_citation', '')
    oig_flag  = "[OIG PRIORITY]" if job.get('oig_priority') else ""
    prompt = (
        f"<|system|>\n"
        f"You are a medical billing forensic analyst specializing in CMS NCCI edits and claim adjudication. "
        f"Your task is to parse a raw medical billing scenario into a structured Claim Map. "
        f"Use your <think> block to reason step-by-step through the ICD-10 diagnosis, CPT procedure codes, "
        f"NCCI bundling rules, and financial exposure before producing the final JSON output.\n"
        f"<|end|>\n"
        f"<|user|>\n"
        f"BILLING SCENARIO {oig_flag}:\n{scenario}\n\n"
        f"NCCI REFERENCE: {ncci_hint}\n\n"
        f"Step 1 — Think through the clinical and billing logic in a <think> block.\n"
        f"Step 2 — Output ONLY valid JSON with this exact structure after your thinking:\n"
        f'{{\n'
        f'  "icd10_primary": "M17.11",\n'
        f'  "cpt_codes": ["27447", "27370"],\n'
        f'  "clinical_summary": "one sentence",\n'
        f'  "billing_flags": ["NCCI Column 2 edit triggered"],\n'
        f'  "ncci_edit_type": "comprehensive_component",\n'
        f'  "modifier_applicable": false,\n'
        f'  "estimated_financial_exposure": 1250.00\n'
        f'}}\n'
        f"<|end|>\n"
        f"<|assistant|>\n"
    )

    claim_map_data = None
    try:
        raw = call_ollama(prompt, model, ollama_url, max_tokens=768)
        # Strip phi4-mini <think>...</think> block before JSON parsing
        import re as _re
        think_match = _re.search(r"<think>(.*?)</think>", raw, _re.DOTALL)
        think_text = think_match.group(1).strip() if think_match else ""
        clean = _re.sub(r"<think>.*?</think>", "", raw, flags=_re.DOTALL).strip()
        # Find JSON in the cleaned output
        start = clean.find("{")
        end = clean.rfind("}") + 1
        if start >= 0 and end > start:
            parsed = json.loads(clean[start:end])
            claim_map_data = {
                "job_id": job_id,
                "node_id": node_id,
                "niche": niche,
                "node_tier": "scout",
                "model": model,
                "icd10_primary": parsed.get("icd10_primary", job.get("icd10", "")),
                "cpt_codes": parsed.get("cpt_codes", job.get("cpt_codes", [])),
                "clinical_summary": parsed.get("clinical_summary", ""),
                "billing_flags": parsed.get("billing_flags", []),
                "ncci_edit_type": parsed.get("ncci_edit_type", ""),
                "modifier_applicable": parsed.get("modifier_applicable", False),
                "estimated_financial_exposure": float(parsed.get("estimated_financial_exposure", 0.0)),
                "ncci_citation": job.get("ncci_citation", ""),
                "oig_priority": job.get("oig_priority", False),
                "claim_map_status": "ready_for_refiner",
                "reasoning_trace": think_text[:800] if think_text else "",
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }
        else:
            raise ValueError("No JSON found in Ollama response")
    except Exception as e:
        logger.warning(f"[SCOUT] LLM extraction failed ({e}), using job metadata as fallback")
        claim_map_data = {
            "job_id": job_id,
            "node_id": node_id,
            "niche": niche,
            "node_tier": "scout",
            "icd10_primary": job.get("icd10", ""),
            "cpt_codes": job.get("cpt_codes", []),
            "clinical_summary": scenario[:200] if scenario else "",
            "billing_flags": [],
            "estimated_financial_exposure": job.get("financial_impact_estimate", 0.0),
            "ncci_citation": job.get("ncci_citation", ""),
            "oig_priority": job.get("oig_priority", False),
            "claim_map_status": "ready_for_refiner",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    # Submit the Claim Map to the orchestrator
    try:
        resp = requests.post(
            f"{orchestrator}/api/lb/claim_maps/submit",
            json={"node_id": node_id, "job_id": job_id, "claim_map": claim_map_data},
            timeout=15,
        )
        resp.raise_for_status()
        logger.info(f"[SCOUT] Claim Map submitted for job {job_id}")
    except Exception as e:
        logger.error(f"[SCOUT] Claim Map submission failed: {e}")

    # Mark job complete
    _mark_lb_job_complete(node_id, job_id, "scout", 1, orchestrator)


# ---------------------------------------------------------------------------
# Refiner Task: Gold Standard Reasoning
# ---------------------------------------------------------------------------

def parse_refiner_response(raw_text: str, job: dict) -> dict:
    """
    Parse Ollama's Gold Standard reasoning response into a structured trace.
    Handles both clean JSON and plain-text fallback.
    """
    trace = {
        "niche": job.get("niche", "Unknown"),
        "icd10": job.get("icd10", ""),
        "cpt_codes": job.get("cpt_codes", []),
        "medical_narrative": job.get("scenario", ""),
        "ncci_citation": job.get("ncci_citation", ""),
        "oig_priority": job.get("oig_priority", False),
        "chain_of_thought": [],
        "final_decision": "",
        "financial_impact": 0.0,
        "schema_version": "gold_standard_v2.1",
        "bittensor_ready": True,
    }

    # Attempt JSON parse
    try:
        start = raw_text.find("{")
        end = raw_text.rfind("}") + 1
        if start >= 0 and end > start:
            parsed = json.loads(raw_text[start:end])
            trace["chain_of_thought"] = parsed.get("chain_of_thought", [])
            trace["final_decision"] = parsed.get("final_decision", "")
            trace["financial_impact"] = float(parsed.get("financial_impact", 0.0))
            return trace
    except (json.JSONDecodeError, ValueError):
        pass

    # Fallback: extract think block and plain text
    think_start = raw_text.find("<think>")
    think_end = raw_text.find("</think>")
    if think_start >= 0 and think_end > think_start:
        think_content = raw_text[think_start + 7:think_end].strip()
        steps = [s.strip() for s in think_content.split("\n") if s.strip() and len(s.strip()) > 20]
        trace["chain_of_thought"] = steps[:8]

    lines = [l.strip() for l in raw_text.split("\n") if l.strip()]
    for line in lines:
        lower = line.lower()
        if any(kw in lower for kw in ["decision:", "final:", "conclusion:", "deny", "allow", "approve", "reduce"]):
            trace["final_decision"] = line
            break

    if not trace["chain_of_thought"]:
        trace["chain_of_thought"] = [l for l in lines if len(l) > 20][:8]
    if not trace["final_decision"] and lines:
        trace["final_decision"] = lines[-1]

    return trace


def process_refiner_job(job: dict, node_id: str, orchestrator: str, ollama_url: str, model: str):
    """
    Refiner task: generate Gold Standard logic traces via full LLM reasoning.
    Uses the job's prompt_template (which includes <think> tag instructions).
    """
    job_id = job["job_id"]
    traces_requested = job.get("traces_requested", 3)
    prompt = job.get("prompt_template", "")
    niche = job.get("niche", "Unknown")

    logger.info(f"[REFINER] Processing job {job_id} — {niche} — {traces_requested} Gold traces requested")

    generated_traces = []

    for i in range(traces_requested):
        logger.info(f"  [REFINER] Generating Gold trace {i+1}/{traces_requested} via {model}...")
        try:
            varied_prompt = (
                f"{prompt}\n\n"
                f"Generate Gold Standard trace #{i+1}. "
                f"Use <think>...</think> tags for your multi-stage reasoning "
                f"(READ → ANALYZE → PLAN → IMPLEMENT → VERIFY). "
                f"Vary clinical details slightly while keeping the core NCCI scenario. "
                f"Respond ONLY with valid JSON:\n"
                f'{{"chain_of_thought": ["READ: ...", "ANALYZE: ...", "PLAN: ...", "IMPLEMENT: ...", "VERIFY: ..."], '
                f'"final_decision": "...", "financial_impact": 0.00}}'
            )

            raw = call_ollama(varied_prompt, model, ollama_url, max_tokens=2048)
            trace = parse_refiner_response(raw, job)

            # Quality gate: require at least 3 CoT steps and a decision
            if len(trace["chain_of_thought"]) < 3 or not trace["final_decision"]:
                logger.warning(f"  [REFINER] Trace {i+1} failed quality gate — skipping")
                continue

            generated_traces.append(trace)
            logger.info(
                f"  [REFINER] Trace {i+1} generated — "
                f"{len(trace['chain_of_thought'])} CoT steps — "
                f"impact=${trace['financial_impact']:.2f}"
            )

        except RuntimeError as e:
            logger.error(f"  [REFINER] Trace {i+1} failed: {e}")
            if "Cannot connect" in str(e):
                logger.error("Ollama is not running. Aborting job.")
                break
        except Exception as e:
            logger.error(f"  [REFINER] Trace {i+1} unexpected error: {e}")

    # Submit traces to the main HITL vault
    if generated_traces:
        _submit_traces_to_vault(node_id, job_id, generated_traces, orchestrator)

    _mark_lb_job_complete(node_id, job_id, "refiner", len(generated_traces), orchestrator)
    logger.info(f"[REFINER] Job {job_id} complete — {len(generated_traces)}/{traces_requested} Gold traces generated")


# ---------------------------------------------------------------------------
# Orchestrator API Calls (Load Balancer Contract)
# ---------------------------------------------------------------------------

def register_with_lb(node_id: str, orchestrator: str, model: str, tier: str) -> bool:
    """Register this node with the orchestrator using the LB-aware endpoint."""
    try:
        ip = socket.gethostbyname(socket.gethostname())
        profile = detect_hardware_profile(model)
        resp = requests.post(
            f"{orchestrator}/api/nodes/register",
            json={
                "node_id": node_id,
                "ip": ip,
                "model": model,
                "tier": tier,
                "hardware_profile": profile,
            },
            timeout=10,
        )
        resp.raise_for_status()
        logger.info(f"Registered as {node_id} (tier={tier.upper()}) @ {ip}")
        return True
    except Exception as e:
        logger.error(f"Registration failed: {e}")
        return False


def send_heartbeat(node_id: str, orchestrator: str):
    """Send a heartbeat to keep the node marked as online."""
    try:
        requests.post(
            f"{orchestrator}/api/nodes/heartbeat",
            json={"node_id": node_id},
            timeout=5,
        )
    except Exception:
        pass


def poll_for_lb_job(node_id: str, orchestrator: str, tier: str) -> dict | None:
    """
    Poll the Load Balancer for a tier-specific job.
    Scout → /api/lb/jobs/claim/scout
    Refiner → /api/lb/jobs/claim/refiner
    """
    endpoint = f"{orchestrator}/api/lb/jobs/claim/{tier}"
    try:
        resp = requests.post(endpoint, json={"node_id": node_id}, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        if data.get("success") and data.get("job"):
            return data["job"]
        return None
    except Exception as e:
        logger.warning(f"Job poll failed ({tier}): {e}")
        return None


def _submit_traces_to_vault(node_id: str, job_id: str, traces: list, orchestrator: str) -> bool:
    """Submit Gold Standard traces to the main HITL vault."""
    try:
        resp = requests.post(
            f"{orchestrator}/api/traces/submit",
            json={"node_id": node_id, "job_id": job_id, "traces": traces},
            timeout=30,
        )
        resp.raise_for_status()
        result = resp.json()
        logger.info(
            f"Vault submission: {result.get('accepted', 0)} accepted, "
            f"{result.get('rejected', 0)} rejected"
        )
        return True
    except Exception as e:
        logger.error(f"Vault submission failed: {e}")
        return False


def _mark_lb_job_complete(node_id: str, job_id: str, tier: str, count: int, orchestrator: str):
    """Notify the Load Balancer that a job is complete."""
    try:
        requests.post(
            f"{orchestrator}/api/lb/jobs/complete",
            json={
                "node_id": node_id,
                "job_id": job_id,
                "tier": tier,
                "items_produced": count,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            },
            timeout=10,
        )
    except Exception as e:
        logger.warning(f"Job completion notification failed: {e}")


# ---------------------------------------------------------------------------
# Core Worker Loop
# ---------------------------------------------------------------------------

def heartbeat_loop(node_id: str, orchestrator: str):
    """Background thread that sends heartbeats every 60 seconds."""
    while True:
        time.sleep(HEARTBEAT_INTERVAL)
        send_heartbeat(node_id, orchestrator)


def main_loop(node_id: str, orchestrator: str, ollama_url: str, model: str, tier: str):
    """
    Main polling loop.
    - Registers with orchestrator (LB-aware)
    - Polls the correct tier queue every POLL_INTERVAL seconds
    - Routes to process_scout_job or process_refiner_job based on tier
    """
    logger.info("=" * 60)
    logger.info(f"Logic Refinery Worker v3.0 — {node_id}")
    logger.info(f"Tier: {tier.upper()} | Model: {model} | Orchestrator: {orchestrator}")
    logger.info("=" * 60)

    # Register with orchestrator
    for attempt in range(MAX_RETRIES):
        if register_with_lb(node_id, orchestrator, model, tier):
            break
        logger.warning(f"Registration attempt {attempt+1}/{MAX_RETRIES} failed. Retrying in 10s...")
        time.sleep(10)
    else:
        logger.error("Could not register with orchestrator after 3 attempts. Exiting.")
        sys.exit(1)

    # Start heartbeat thread
    hb_thread = threading.Thread(
        target=heartbeat_loop,
        args=(node_id, orchestrator),
        daemon=True,
        name="heartbeat",
    )
    hb_thread.start()
    logger.info(f"Heartbeat thread started. Polling every {POLL_INTERVAL}s...")

    # Main poll loop
    while True:
        try:
            job = poll_for_lb_job(node_id, orchestrator, tier)
            if job:
                if tier == "scout":
                    process_scout_job(job, node_id, orchestrator, ollama_url, model)
                else:
                    process_refiner_job(job, node_id, orchestrator, ollama_url, model)
            else:
                logger.debug(f"No {tier} jobs available. Sleeping {POLL_INTERVAL}s...")
        except KeyboardInterrupt:
            logger.info("Worker stopped by user.")
            break
        except Exception as e:
            logger.error(f"Unexpected error in main loop: {e}")

        time.sleep(POLL_INTERVAL)


# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Logic Refinery v3.0 — Worker Node Client (Scout & Refiner)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Auto-detect tier (recommended — orchestrator classifies your hardware):
  python3 worker_client.py --node-id node_01 --orchestrator http://192.168.1.100:5001

  # Force Scout tier (i5 nodes):
  python3 worker_client.py --node-id node_01 --orchestrator http://192.168.1.100:5001 --tier scout

  # Force Refiner tier (Ryzen nodes):
  python3 worker_client.py --node-id ryzen_01 --orchestrator http://192.168.1.100:5001 --tier refiner --model mistral-nemo

  # Refiner with Llama 3.1 8B:
  python3 worker_client.py --node-id ryzen_02 --orchestrator http://192.168.1.100:5001 --tier refiner --model llama3.1:8b
        """,
    )
    parser.add_argument("--node-id", required=True,
                        help="Unique node ID (e.g., node_01 through node_07, ryzen_01)")
    parser.add_argument("--orchestrator", default=DEFAULT_ORCHESTRATOR,
                        help=f"Orchestrator URL (default: {DEFAULT_ORCHESTRATOR})")
    parser.add_argument("--ollama", default=DEFAULT_OLLAMA,
                        help=f"Ollama API URL (default: {DEFAULT_OLLAMA})")
    parser.add_argument("--model", default=None,
                        help="Ollama model name (auto-selected if not set: phi4-mini for scout, mistral-nemo for refiner)")
    parser.add_argument("--tier", choices=["scout", "refiner", "auto"], default="auto",
                        help="Node tier: scout (Claim Map parsing), refiner (Gold Standard reasoning), auto (detect from hardware)")
    parser.add_argument("--poll-interval", type=int, default=POLL_INTERVAL,
                        help=f"Seconds between job polls (default: {POLL_INTERVAL})")

    args = parser.parse_args()
    POLL_INTERVAL = args.poll_interval

    # Resolve tier
    resolved_tier = args.tier
    if resolved_tier == "auto":
        # Need a model to probe with — use a default for detection
        probe_model = args.model or DEFAULT_SCOUT_MODEL
        resolved_tier = detect_tier_from_orchestrator(args.node_id, args.orchestrator, probe_model)

    # Resolve model based on tier if not explicitly set
    resolved_model = args.model
    if not resolved_model:
        resolved_model = DEFAULT_REFINER_MODEL if resolved_tier == "refiner" else DEFAULT_SCOUT_MODEL
        logger.info(f"Model auto-selected for {resolved_tier.upper()} tier: {resolved_model}")

    main_loop(
        node_id=args.node_id,
        orchestrator=args.orchestrator,
        ollama_url=args.ollama,
        model=resolved_model,
        tier=resolved_tier,
    )
