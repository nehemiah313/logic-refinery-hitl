"""
eval_harness.py — Logic Refinery Claim Map Eval Harness
========================================================
Design Philosophy: Eval-Driven Development (Ethan Mollick / Lenny's Podcast)
  "Companies should create their own benchmarks to test AI for their specific
   use cases, including both quantitative and qualitative measures."

Scoring Dimensions:
  1. Syntax Eval       — Is the output valid JSON with all required fields?
  2. Code Accuracy     — Are CPT and ICD-10 codes correct vs. gold standard?
  3. NCCI Correctness  — Is the edit type and modifier flag correct?
  4. Financial Exposure — Is the estimated financial exposure within ±20%?

Usage:
  python3 eval_harness.py                    # Run all 50 gold examples
  python3 eval_harness.py --niche MSK_Forensics   # Run one niche
  python3 eval_harness.py --eval-id eval_msk_001  # Run single example
  python3 eval_harness.py --mock             # Use mock Scout output (no Ollama needed)
"""

import json
import time
import argparse
import requests
import re
import sys
from pathlib import Path
from datetime import datetime
from typing import Optional

# ─── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent
GOLD_FILE = BASE_DIR / "eval_gold_standard.jsonl"
RESULTS_FILE = BASE_DIR / "eval_results.jsonl"
REPORT_FILE = BASE_DIR / "eval_report.json"

# ─── Ollama Config ─────────────────────────────────────────────────────────────
OLLAMA_URL = "http://localhost:11434/api/generate"
SCOUT_MODEL = "phi4-mini"
OLLAMA_TIMEOUT = 120  # seconds

# ─── Scoring Weights ──────────────────────────────────────────────────────────
WEIGHTS = {
    "syntax":    0.15,   # 15% — baseline gate
    "code":      0.35,   # 35% — most critical for billing accuracy
    "ncci":      0.35,   # 35% — the forensic differentiator
    "financial": 0.15,   # 15% — directional accuracy
}

FINANCIAL_TOLERANCE = 0.20  # ±20% of gold value is acceptable


# ─── Prompt Builder ────────────────────────────────────────────────────────────
def build_scout_prompt(scenario: str, ncci_citation: str, oig_priority: bool) -> str:
    oig_flag = "⚠️ OIG PRIORITY NICHE — Apply heightened scrutiny." if oig_priority else ""
    return f"""<|system|>
You are a medical billing forensic analyst operating as an i5-Scout node in the Logic Refinery pipeline.
Your role is to perform deterministic Claim Map extraction from raw billing scenarios.
You MUST reason step by step inside <think>...</think> tags, then output ONLY valid JSON.
{oig_flag}
Regulatory Axiom: {ncci_citation}
<|end|>
<|user|>
Analyze this billing scenario and produce a structured Claim Map:

SCENARIO:
{scenario}

Your Claim Map JSON must include these exact fields:
{{
  "icd10_primary": "string — primary ICD-10 code",
  "cpt_codes": ["array of valid CPT/HCPCS codes that should be billed"],
  "billing_flags": ["array of audit flags explaining any NCCI violations or issues"],
  "ncci_edit_type": "string — one of: comprehensive_component, mutually_exclusive, medically_unlikely_edit, global_component_split, unbundling_violation, upcoding_flag, modifier_misuse, time_unit_discrepancy, qualifier_misapplication, cross_billing_error, sequential_service_bundling, same_day_em_bundling, dme_component_unbundling, oasis_score_manipulation, episode_extension_fraud, primary_diagnosis_miscoding, medical_necessity_failure, duplicate_service, standalone_vs_addon_misuse, add_on_criteria_not_met, provider_scope_violation, time_inconsistency, unit_verification, quantity_verification, none",
  "modifier_applicable": true or false,
  "estimated_financial_exposure": float — dollar amount of overbilling or underpayment
}}

Reason through the NCCI edits carefully. Output <think>reasoning</think> then the JSON object.
<|end|>
<|assistant|>
"""


# ─── Ollama Caller ─────────────────────────────────────────────────────────────
def call_ollama(prompt: str) -> tuple[str, str]:
    """Returns (raw_output, reasoning_trace)"""
    payload = {
        "model": SCOUT_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.1,
            "top_p": 0.9,
            "num_predict": 1024,
        }
    }
    try:
        resp = requests.post(OLLAMA_URL, json=payload, timeout=OLLAMA_TIMEOUT)
        resp.raise_for_status()
        raw = resp.json().get("response", "")
        return raw, ""
    except requests.exceptions.ConnectionError:
        raise RuntimeError(f"Ollama not running at {OLLAMA_URL}. Start with: ollama serve")
    except requests.exceptions.Timeout:
        raise RuntimeError(f"Ollama timed out after {OLLAMA_TIMEOUT}s")


def mock_scout_output(gold: dict) -> str:
    """Generate a slightly imperfect mock output for testing without Ollama."""
    import random
    g = gold["gold"]
    # Introduce controlled errors for testing the scorer
    cpt = g["cpt_codes"].copy()
    ncci = g["ncci_edit_type"]
    exposure = g["estimated_financial_exposure"]
    modifier = g["modifier_applicable"]

    # 20% chance of a code error
    if random.random() < 0.20 and len(cpt) > 0:
        cpt[0] = cpt[0][:-1] + str((int(cpt[0][-1]) + 1) % 10) if cpt[0][-1].isdigit() else cpt[0]

    # 15% chance of wrong NCCI type
    if random.random() < 0.15:
        ncci = "comprehensive_component" if ncci != "comprehensive_component" else "mutually_exclusive"

    # 25% chance of financial exposure off by 15-30%
    if random.random() < 0.25:
        exposure = exposure * random.uniform(0.70, 1.30)

    output = {
        "icd10_primary": g["icd10_primary"],
        "cpt_codes": cpt,
        "billing_flags": g["billing_flags"],
        "ncci_edit_type": ncci,
        "modifier_applicable": modifier,
        "estimated_financial_exposure": round(exposure, 2)
    }
    return f"<think>Mock reasoning trace for testing purposes.</think>\n{json.dumps(output, indent=2)}"


# ─── Output Parser ─────────────────────────────────────────────────────────────
def parse_scout_output(raw: str) -> tuple[Optional[dict], str, str]:
    """
    Returns (parsed_json, reasoning_trace, parse_error)
    """
    # Extract <think> block
    think_match = re.search(r"<think>(.*?)</think>", raw, re.DOTALL)
    reasoning = think_match.group(1).strip() if think_match else ""

    # Strip think block and find JSON
    clean = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()

    # Try to find JSON object
    json_match = re.search(r"\{.*\}", clean, re.DOTALL)
    if not json_match:
        return None, reasoning, "No JSON object found in output"

    try:
        parsed = json.loads(json_match.group(0))
        return parsed, reasoning, ""
    except json.JSONDecodeError as e:
        return None, reasoning, f"JSON parse error: {e}"


# ─── Scorer ────────────────────────────────────────────────────────────────────
REQUIRED_FIELDS = [
    "icd10_primary", "cpt_codes", "billing_flags",
    "ncci_edit_type", "modifier_applicable", "estimated_financial_exposure"
]

def score_syntax(parsed: Optional[dict], parse_error: str) -> tuple[float, list]:
    """Score 0.0–1.0 for syntax correctness."""
    issues = []
    if parsed is None:
        return 0.0, [f"Parse failure: {parse_error}"]

    missing = [f for f in REQUIRED_FIELDS if f not in parsed]
    if missing:
        issues.append(f"Missing fields: {missing}")
        return max(0.0, 1.0 - (len(missing) / len(REQUIRED_FIELDS))), issues

    # Type checks
    if not isinstance(parsed.get("cpt_codes"), list):
        issues.append("cpt_codes must be an array")
    if not isinstance(parsed.get("billing_flags"), list):
        issues.append("billing_flags must be an array")
    if not isinstance(parsed.get("modifier_applicable"), bool):
        issues.append("modifier_applicable must be boolean")
    if not isinstance(parsed.get("estimated_financial_exposure"), (int, float)):
        issues.append("estimated_financial_exposure must be numeric")

    score = 1.0 - (len(issues) * 0.25)
    return max(0.0, score), issues


def score_code_accuracy(parsed: dict, gold: dict) -> tuple[float, list]:
    """Score 0.0–1.0 for CPT/ICD-10 code correctness."""
    issues = []
    score = 1.0

    # ICD-10 primary
    gold_icd = gold["icd10_primary"].upper().strip()
    pred_icd = parsed.get("icd10_primary", "").upper().strip()
    if gold_icd != pred_icd:
        issues.append(f"ICD-10 mismatch: expected {gold_icd}, got {pred_icd}")
        score -= 0.40

    # CPT codes — check set overlap
    gold_cpts = set(c.upper().strip() for c in gold["cpt_codes"])
    pred_cpts = set(c.upper().strip() for c in parsed.get("cpt_codes", []))

    if gold_cpts == pred_cpts:
        pass  # Perfect match
    else:
        missing_cpts = gold_cpts - pred_cpts
        extra_cpts = pred_cpts - gold_cpts
        if missing_cpts:
            issues.append(f"Missing CPT codes: {missing_cpts}")
            score -= 0.30 * (len(missing_cpts) / max(len(gold_cpts), 1))
        if extra_cpts:
            issues.append(f"Extra CPT codes (potential unbundling): {extra_cpts}")
            score -= 0.30 * (len(extra_cpts) / max(len(gold_cpts), 1))

    return max(0.0, score), issues


def score_ncci_correctness(parsed: dict, gold: dict) -> tuple[float, list]:
    """Score 0.0–1.0 for NCCI edit type and modifier flag correctness."""
    issues = []
    score = 1.0

    # NCCI edit type
    gold_edit = gold["ncci_edit_type"].lower().strip()
    pred_edit = parsed.get("ncci_edit_type", "").lower().strip()
    if gold_edit != pred_edit:
        issues.append(f"NCCI edit type mismatch: expected '{gold_edit}', got '{pred_edit}'")
        score -= 0.60

    # Modifier applicable
    gold_mod = gold["modifier_applicable"]
    pred_mod = parsed.get("modifier_applicable")
    if gold_mod != pred_mod:
        issues.append(f"Modifier flag mismatch: expected {gold_mod}, got {pred_mod}")
        score -= 0.40

    return max(0.0, score), issues


def score_financial_exposure(parsed: dict, gold: dict) -> tuple[float, list]:
    """Score 0.0–1.0 for financial exposure accuracy within ±20%."""
    issues = []
    gold_exp = gold["estimated_financial_exposure"]
    pred_exp = parsed.get("estimated_financial_exposure", 0.0)

    if gold_exp == 0.0:
        # No exposure expected — check if model correctly reports 0
        if pred_exp == 0.0:
            return 1.0, []
        else:
            issues.append(f"Expected $0 exposure, got ${pred_exp:.2f}")
            return 0.5, issues

    pct_diff = abs(pred_exp - gold_exp) / gold_exp
    if pct_diff <= FINANCIAL_TOLERANCE:
        return 1.0, []
    elif pct_diff <= 0.40:
        issues.append(f"Financial exposure off by {pct_diff*100:.1f}%: expected ${gold_exp:.2f}, got ${pred_exp:.2f}")
        return 0.5, issues
    else:
        issues.append(f"Financial exposure severely off by {pct_diff*100:.1f}%: expected ${gold_exp:.2f}, got ${pred_exp:.2f}")
        return 0.0, issues


def compute_composite_score(syntax: float, code: float, ncci: float, financial: float) -> float:
    return (
        syntax    * WEIGHTS["syntax"] +
        code      * WEIGHTS["code"] +
        ncci      * WEIGHTS["ncci"] +
        financial * WEIGHTS["financial"]
    )


# ─── Single Eval Runner ────────────────────────────────────────────────────────
def run_single_eval(example: dict, use_mock: bool = False) -> dict:
    eval_id = example["eval_id"]
    niche = example["niche"]
    scenario = example["scenario"]
    gold = example["gold"]
    ncci_citation = example.get("ncci_citation", "")
    oig_priority = example.get("oig_priority", False)

    start = time.time()

    # Generate Scout output
    if use_mock:
        raw_output = mock_scout_output(example)
        reasoning = "Mock reasoning trace"
    else:
        prompt = build_scout_prompt(scenario, ncci_citation, oig_priority)
        raw_output, _ = call_ollama(prompt)
        reasoning = ""

    elapsed = time.time() - start

    # Parse
    parsed, reasoning_trace, parse_error = parse_scout_output(raw_output)
    if not reasoning:
        reasoning = reasoning_trace

    # Score
    if parsed is None:
        s_syntax, i_syntax = 0.0, [f"Parse failure: {parse_error}"]
        s_code, i_code = 0.0, ["Cannot score — parse failed"]
        s_ncci, i_ncci = 0.0, ["Cannot score — parse failed"]
        s_fin, i_fin = 0.0, ["Cannot score — parse failed"]
    else:
        s_syntax, i_syntax = score_syntax(parsed, parse_error)
        s_code, i_code = score_code_accuracy(parsed, gold)
        s_ncci, i_ncci = score_ncci_correctness(parsed, gold)
        s_fin, i_fin = score_financial_exposure(parsed, gold)

    composite = compute_composite_score(s_syntax, s_code, s_ncci, s_fin)

    result = {
        "eval_id": eval_id,
        "niche": niche,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "elapsed_seconds": round(elapsed, 2),
        "scores": {
            "syntax":    round(s_syntax, 3),
            "code":      round(s_code, 3),
            "ncci":      round(s_ncci, 3),
            "financial": round(s_fin, 3),
            "composite": round(composite, 3),
        },
        "issues": {
            "syntax":    i_syntax,
            "code":      i_code,
            "ncci":      i_ncci,
            "financial": i_fin,
        },
        "gold": gold,
        "predicted": parsed,
        "reasoning_trace": reasoning[:500] if reasoning else "",
        "passed": composite >= 0.70,
    }
    return result


# ─── Batch Runner ──────────────────────────────────────────────────────────────
def run_eval_suite(
    niche_filter: Optional[str] = None,
    eval_id_filter: Optional[str] = None,
    use_mock: bool = False,
    verbose: bool = True,
) -> dict:
    # Load gold examples
    examples = []
    with open(GOLD_FILE) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            ex = json.loads(line)
            if niche_filter and ex["niche"] != niche_filter:
                continue
            if eval_id_filter and ex["eval_id"] != eval_id_filter:
                continue
            examples.append(ex)

    if not examples:
        print(f"No examples found for filters: niche={niche_filter}, eval_id={eval_id_filter}")
        return {}

    print(f"\n{'='*60}")
    print(f"  Logic Refinery — Claim Map Eval Harness")
    print(f"  Running {len(examples)} examples | Model: {'MOCK' if use_mock else SCOUT_MODEL}")
    print(f"{'='*60}\n")

    results = []
    passed = 0
    total_scores = {"syntax": 0, "code": 0, "ncci": 0, "financial": 0, "composite": 0}

    for i, example in enumerate(examples, 1):
        if verbose:
            print(f"[{i:02d}/{len(examples)}] {example['eval_id']} ({example['niche']})...", end=" ", flush=True)

        result = run_single_eval(example, use_mock=use_mock)
        results.append(result)

        for k in total_scores:
            total_scores[k] += result["scores"][k]

        if result["passed"]:
            passed += 1
            if verbose:
                print(f"✅ {result['scores']['composite']:.0%}")
        else:
            if verbose:
                print(f"❌ {result['scores']['composite']:.0%}")
                # Show top issue
                all_issues = []
                for dim_issues in result["issues"].values():
                    all_issues.extend(dim_issues)
                if all_issues:
                    print(f"       ↳ {all_issues[0]}")

    # Aggregate report
    n = len(results)
    avg_scores = {k: round(v / n, 3) for k, v in total_scores.items()}

    # Niche breakdown
    niche_stats = {}
    for r in results:
        niche = r["niche"]
        if niche not in niche_stats:
            niche_stats[niche] = {"total": 0, "passed": 0, "composite_sum": 0}
        niche_stats[niche]["total"] += 1
        niche_stats[niche]["composite_sum"] += r["scores"]["composite"]
        if r["passed"]:
            niche_stats[niche]["passed"] += 1

    niche_summary = {}
    for niche, stats in niche_stats.items():
        niche_summary[niche] = {
            "pass_rate": round(stats["passed"] / stats["total"], 3),
            "avg_composite": round(stats["composite_sum"] / stats["total"], 3),
            "passed": stats["passed"],
            "total": stats["total"],
        }

    report = {
        "run_timestamp": datetime.utcnow().isoformat() + "Z",
        "model": "MOCK" if use_mock else SCOUT_MODEL,
        "total_examples": n,
        "passed": passed,
        "failed": n - passed,
        "pass_rate": round(passed / n, 3),
        "avg_scores": avg_scores,
        "niche_summary": niche_summary,
        "weights": WEIGHTS,
        "financial_tolerance_pct": FINANCIAL_TOLERANCE * 100,
        "results": results,
    }

    # Save results
    with open(RESULTS_FILE, "w") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")

    with open(REPORT_FILE, "w") as f:
        json.dump(report, f, indent=2)

    # Print summary
    print(f"\n{'='*60}")
    print(f"  EVAL SUMMARY")
    print(f"{'='*60}")
    print(f"  Pass Rate:    {passed}/{n} ({passed/n:.0%})")
    print(f"  Composite:    {avg_scores['composite']:.0%}")
    print(f"  Syntax:       {avg_scores['syntax']:.0%}")
    print(f"  Code Acc:     {avg_scores['code']:.0%}")
    print(f"  NCCI Correct: {avg_scores['ncci']:.0%}")
    print(f"  Financial:    {avg_scores['financial']:.0%}")
    print(f"\n  Niche Breakdown:")
    for niche, stats in sorted(niche_summary.items(), key=lambda x: x[1]["avg_composite"]):
        bar = "█" * int(stats["avg_composite"] * 10) + "░" * (10 - int(stats["avg_composite"] * 10))
        print(f"  {niche:<30} {bar} {stats['avg_composite']:.0%} ({stats['passed']}/{stats['total']})")
    print(f"\n  Results saved to: {RESULTS_FILE}")
    print(f"  Report saved to:  {REPORT_FILE}")
    print(f"{'='*60}\n")

    return report


# ─── Flask-Compatible API ──────────────────────────────────────────────────────
def get_latest_report() -> Optional[dict]:
    """Load the latest eval report for the Flask API."""
    if REPORT_FILE.exists():
        with open(REPORT_FILE) as f:
            return json.load(f)
    return None


def get_gold_examples(niche: Optional[str] = None) -> list:
    """Return gold examples, optionally filtered by niche."""
    examples = []
    with open(GOLD_FILE) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            ex = json.loads(line)
            if niche and ex["niche"] != niche:
                continue
            examples.append(ex)
    return examples


# ─── CLI Entry Point ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Logic Refinery Claim Map Eval Harness")
    parser.add_argument("--niche", type=str, help="Filter by niche name")
    parser.add_argument("--eval-id", type=str, help="Run a single eval by ID")
    parser.add_argument("--mock", action="store_true", help="Use mock output (no Ollama required)")
    parser.add_argument("--quiet", action="store_true", help="Suppress per-example output")
    args = parser.parse_args()

    report = run_eval_suite(
        niche_filter=args.niche,
        eval_id_filter=args.eval_id,
        use_mock=args.mock,
        verbose=not args.quiet,
    )

    # Exit with non-zero if pass rate < 70%
    if report.get("pass_rate", 0) < 0.70:
        print(f"⚠️  Pass rate {report['pass_rate']:.0%} is below 70% threshold — review failing cases.")
        sys.exit(1)
    else:
        print(f"✅ Pass rate {report['pass_rate']:.0%} meets the 70% threshold.")
        sys.exit(0)
