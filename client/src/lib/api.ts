/**
 * Logic Refinery HITL — API Client
 * Connects the React frontend to the Flask backend on port 5001.
 * In production, this would be proxied through the same origin.
 */

export const API_BASE = "http://localhost:5001";

export interface Trace {
  trace_id: string;
  timestamp: string;
  node: string;
  niche: string;
  icd10: string;
  cpt_codes: string[];
  ncci_citation?: string;
  oig_priority?: boolean;
  logic_trace?: string;
  medical_narrative: string;
  human_verified: boolean;
  auditor_id: string | null;
  human_decision: "approve" | "deny" | null;
  human_notes: string | null;
  verified_at: string | null;
  chain_of_thought: string[];
  final_decision: string;
  financial_impact: number;
  validator_score: number;
  pipeline_stage: number;
  status: "pending" | "verified" | "skipped";
}

export interface Stats {
  total_in_vault: number;
  pending: number;
  approved: number;
  denied: number;
  verified: number;
  skipped: number;
  total_financial_impact_usd: number;
  niche_distribution: Record<string, number>;
  avg_validator_score: number;
  gold_value_low: number;
  gold_value_high: number;
  pipeline_stages: {
    stage_1_neural: number;
    stage_2_augment: number;
    stage_3_judge: number;
    stage_4_hitl_pending: number;
    stage_4_hitl_complete: number;
  };
}

export interface VerifyPayload {
  trace_id: string;
  decision: "approve" | "deny" | "skip";
  auditor_id?: string;
  notes?: string;
}

const API_PATH = `${API_BASE}/api`;

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_PATH}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  /** Fetch pending traces for human review */
  getPendingTraces: (limit = 10) =>
    fetchJson<{ traces: Trace[]; total_pending: number; total_in_vault: number }>(
      `/traces/pending?limit=${limit}`
    ),

  /** Get dashboard statistics */
  getStats: () => fetchJson<Stats>("/traces/stats"),

  /** Submit a human verification decision */
  verifyTrace: (payload: VerifyPayload) =>
    fetchJson<{ success: boolean; trace_id: string; decision: string; gold_standard_count: number }>(
      "/traces/verify",
      { method: "POST", body: JSON.stringify(payload) }
    ),

  /** Generate new traces via Phi-4-Mini pipeline */
  generateTraces: (count = 5, niche?: string) =>
    fetchJson<{ success: boolean; generated: number; traces: Trace[] }>(
      "/traces/generate",
      { method: "POST", body: JSON.stringify({ count, niche }) }
    ),

  /** Get all available niches */
  getNiches: () => fetchJson<{ niches: string[] }>("/niches"),

  /** Download Gold Standard JSONL */
  downloadGoldJSONL: () => {
    window.open(`${API_PATH}/export/jsonl`, "_blank");
  },

  /** Get export manifest */
  getManifest: () => fetchJson<Record<string, unknown>>("/export/manifest"),
};
