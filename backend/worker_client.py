"""
Logic Refinery — Worker Node Client
=====================================
This script runs on each of the 7 i5 worker nodes.
It connects to the orchestrator (Flask backend) and:

  1. Registers itself with the orchestrator
  2. Polls for jobs every 30 seconds
  3. When a job arrives, calls Ollama Phi-4-Mini locally to generate traces
  4. Submits the generated traces back to the orchestrator
  5. Sends heartbeats every 60 seconds to stay marked as online

SETUP ON EACH WORKER NODE:
  1. Install Python 3.10+:    sudo apt install python3 python3-pip -y
  2. Install requests:        pip3 install requests
  3. Make sure Ollama is running: ollama serve
  4. Pull Phi-4-Mini:         ollama pull phi4-mini
  5. Run this script:
       python3 worker_client.py --node-id node_01 --orchestrator http://192.168.1.100:5001

  Replace 192.168.1.100 with the IP of your orchestrator machine.
  Replace node_01 with a unique ID for each machine (node_01 through node_07).

Author: Manus AI
"""

import argparse
import json
import logging
import socket
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
DEFAULT_OLLAMA = "http://localhost:11434"
DEFAULT_MODEL = "phi4-mini"
POLL_INTERVAL = 30        # seconds between job polls
HEARTBEAT_INTERVAL = 60   # seconds between heartbeats
MAX_RETRIES = 3

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
# Ollama Interface
# ---------------------------------------------------------------------------

def call_ollama(prompt: str, model: str, ollama_url: str) -> str:
    """
    Call Ollama's local API to generate a response from Phi-4-Mini.
    Returns the raw text response.
    """
    url = f"{ollama_url}/api/generate"
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.3,    # Low temperature for consistent medical reasoning
            "num_predict": 1024,   # Max tokens per trace
        },
    }
    try:
        resp = requests.post(url, json=payload, timeout=120)
        resp.raise_for_status()
        return resp.json().get("response", "")
    except requests.exceptions.ConnectionError:
        raise RuntimeError(f"Cannot connect to Ollama at {ollama_url}. Is 'ollama serve' running?")
    except requests.exceptions.Timeout:
        raise RuntimeError("Ollama timed out after 120 seconds.")
    except Exception as e:
        raise RuntimeError(f"Ollama error: {e}")


def parse_ollama_response(raw_text: str, job: dict) -> dict:
    """
    Parse Ollama's response into a structured trace.
    Phi-4-Mini is instructed to return JSON, but we handle plain text too.
    """
    # Try to extract JSON from the response
    trace = {
        "niche": job.get("niche", "Unknown"),
        "icd10": job.get("icd10", ""),
        "cpt_codes": job.get("cpt_codes", []),
        "medical_narrative": job.get("scenario", ""),
        "chain_of_thought": [],
        "final_decision": "",
        "financial_impact": 0.0,
    }

    # Attempt JSON parse
    try:
        # Find JSON block in the response
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

    # Fallback: parse plain text into chain_of_thought
    lines = [line.strip() for line in raw_text.split("\n") if line.strip()]
    cot = []
    decision = ""
    for line in lines:
        lower = line.lower()
        if any(kw in lower for kw in ["decision:", "final:", "conclusion:", "deny", "allow", "approve"]):
            decision = line
        elif len(line) > 20:
            cot.append(line)

    trace["chain_of_thought"] = cot[:8]  # Cap at 8 steps
    trace["final_decision"] = decision or (lines[-1] if lines else "Unable to determine.")
    return trace


# ---------------------------------------------------------------------------
# Orchestrator API Calls
# ---------------------------------------------------------------------------

def register(node_id: str, orchestrator: str, model: str) -> bool:
    """Register this node with the orchestrator."""
    try:
        ip = socket.gethostbyname(socket.gethostname())
        resp = requests.post(
            f"{orchestrator}/api/nodes/register",
            json={"node_id": node_id, "ip": ip, "model": model},
            timeout=10,
        )
        resp.raise_for_status()
        logger.info(f"Registered as {node_id} @ {ip} with orchestrator {orchestrator}")
        return True
    except Exception as e:
        logger.error(f"Registration failed: {e}")
        return False


def send_heartbeat(node_id: str, orchestrator: str):
    """Send a heartbeat to the orchestrator."""
    try:
        requests.post(
            f"{orchestrator}/api/nodes/heartbeat",
            json={"node_id": node_id},
            timeout=5,
        )
    except Exception:
        pass  # Heartbeat failures are non-fatal


def poll_for_job(node_id: str, orchestrator: str) -> dict | None:
    """Poll the orchestrator for a job."""
    try:
        resp = requests.post(
            f"{orchestrator}/api/jobs/claim",
            json={"node_id": node_id},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("success") and data.get("job"):
            return data["job"]
        return None
    except Exception as e:
        logger.warning(f"Job poll failed: {e}")
        return None


def submit_traces(node_id: str, job_id: str, traces: list, orchestrator: str) -> bool:
    """Submit generated traces to the orchestrator."""
    try:
        resp = requests.post(
            f"{orchestrator}/api/traces/submit",
            json={"node_id": node_id, "job_id": job_id, "traces": traces},
            timeout=30,
        )
        resp.raise_for_status()
        result = resp.json()
        logger.info(
            f"Submitted {len(traces)} traces — "
            f"{result.get('accepted', 0)} accepted, {result.get('rejected', 0)} rejected"
        )
        return True
    except Exception as e:
        logger.error(f"Trace submission failed: {e}")
        return False


def mark_job_complete(node_id: str, job_id: str, traces_submitted: int, orchestrator: str):
    """Notify the orchestrator that the job is done."""
    try:
        requests.post(
            f"{orchestrator}/api/jobs/complete",
            json={"node_id": node_id, "job_id": job_id, "traces_submitted": traces_submitted},
            timeout=10,
        )
    except Exception as e:
        logger.warning(f"Job completion notification failed: {e}")


# ---------------------------------------------------------------------------
# Core Worker Loop
# ---------------------------------------------------------------------------

def process_job(job: dict, node_id: str, orchestrator: str, ollama_url: str, model: str):
    """Process a single job: generate traces via Ollama and submit them."""
    job_id = job["job_id"]
    traces_requested = job.get("traces_requested", 5)
    prompt = job.get("prompt_template", "")
    niche = job.get("niche", "Unknown")

    logger.info(f"Processing job {job_id} — {niche} — {traces_requested} traces requested")

    generated_traces = []

    for i in range(traces_requested):
        logger.info(f"  Generating trace {i+1}/{traces_requested} via Ollama {model}...")
        try:
            # Add variation to each trace prompt
            varied_prompt = (
                f"{prompt}\n\n"
                f"Generate trace #{i+1}. "
                f"Vary the clinical details slightly (e.g., patient age, specific findings, "
                f"documentation completeness) while keeping the core billing scenario the same. "
                f"Respond ONLY with valid JSON in this exact format:\n"
                f'{{"chain_of_thought": ["step 1...", "step 2...", ...], '
                f'"final_decision": "...", "financial_impact": 0.00}}'
            )

            raw = call_ollama(varied_prompt, model, ollama_url)
            trace = parse_ollama_response(raw, job)

            # Validate minimum quality
            if len(trace["chain_of_thought"]) < 2 or not trace["final_decision"]:
                logger.warning(f"  Trace {i+1} failed quality check — skipping")
                continue

            generated_traces.append(trace)
            logger.info(f"  Trace {i+1} generated — {len(trace['chain_of_thought'])} CoT steps")

        except RuntimeError as e:
            logger.error(f"  Trace {i+1} failed: {e}")
            # If Ollama is down, abort the job
            if "Cannot connect" in str(e):
                logger.error("Ollama is not running. Aborting job.")
                break
        except Exception as e:
            logger.error(f"  Trace {i+1} unexpected error: {e}")

    if generated_traces:
        submit_traces(node_id, job_id, generated_traces, orchestrator)

    mark_job_complete(node_id, job_id, len(generated_traces), orchestrator)
    logger.info(f"Job {job_id} complete — {len(generated_traces)}/{traces_requested} traces generated")


def heartbeat_loop(node_id: str, orchestrator: str):
    """Background thread that sends heartbeats every 60 seconds."""
    while True:
        time.sleep(HEARTBEAT_INTERVAL)
        send_heartbeat(node_id, orchestrator)


def main_loop(node_id: str, orchestrator: str, ollama_url: str, model: str):
    """Main polling loop — checks for jobs every 30 seconds."""
    logger.info(f"Worker {node_id} started. Polling {orchestrator} every {POLL_INTERVAL}s")
    logger.info(f"Ollama endpoint: {ollama_url} | Model: {model}")

    # Register with orchestrator
    for attempt in range(MAX_RETRIES):
        if register(node_id, orchestrator, model):
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

    # Main poll loop
    while True:
        try:
            job = poll_for_job(node_id, orchestrator)
            if job:
                process_job(job, node_id, orchestrator, ollama_url, model)
            else:
                logger.debug(f"No jobs available. Sleeping {POLL_INTERVAL}s...")
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
        description="Logic Refinery Worker Node Client",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Node 1 connecting to orchestrator at 192.168.1.100
  python3 worker_client.py --node-id node_01 --orchestrator http://192.168.1.100:5001

  # Node 3 with custom Ollama port
  python3 worker_client.py --node-id node_03 --orchestrator http://192.168.1.100:5001 --ollama http://localhost:11434

  # Use a different model (e.g., for Ryzen validator nodes)
  python3 worker_client.py --node-id ryzen_01 --orchestrator http://192.168.1.100:5001 --model llama3.1:8b
        """,
    )
    parser.add_argument(
        "--node-id",
        required=True,
        help="Unique ID for this node (e.g., node_01, node_02, ..., node_07)",
    )
    parser.add_argument(
        "--orchestrator",
        default=DEFAULT_ORCHESTRATOR,
        help=f"Orchestrator URL (default: {DEFAULT_ORCHESTRATOR})",
    )
    parser.add_argument(
        "--ollama",
        default=DEFAULT_OLLAMA,
        help=f"Ollama API URL (default: {DEFAULT_OLLAMA})",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Ollama model name (default: {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--poll-interval",
        type=int,
        default=POLL_INTERVAL,
        help=f"Seconds between job polls (default: {POLL_INTERVAL})",
    )

    args = parser.parse_args()
    POLL_INTERVAL = args.poll_interval

    main_loop(
        node_id=args.node_id,
        orchestrator=args.orchestrator,
        ollama_url=args.ollama,
        model=args.model,
    )
