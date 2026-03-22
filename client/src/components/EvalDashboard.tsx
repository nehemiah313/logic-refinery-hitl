/**
 * EvalDashboard.tsx — Logic Refinery Claim Map Eval Harness UI
 * ============================================================
 * Design: Forensic Terminal — dark background, amber/green scoring,
 * monospace data, clinical precision.
 *
 * Displays:
 *   - Overall pass rate and composite score
 *   - Four-dimension score breakdown (Syntax, Code, NCCI, Financial)
 *   - Niche-by-niche performance bar chart
 *   - Per-example results table with pass/fail and top issue
 *   - "Run Eval" trigger button with live status polling
 *   - Gold Standard example browser
 */

import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "@/lib/api";
import {
  CheckCircle, XCircle, PlayCircle, RefreshCw, AlertTriangle,
  ChevronDown, ChevronRight, Shield, BookOpen, Zap, DollarSign,
  FileText, Activity, BarChart3, Download
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScoreSet {
  syntax: number;
  code: number;
  ncci: number;
  financial: number;
  composite: number;
}

interface NicheSummary {
  pass_rate: number;
  avg_composite: number;
  passed: number;
  total: number;
}

interface EvalReport {
  status: "no_report" | "complete";
  message?: string;
  run_timestamp?: string;
  model?: string;
  total_examples: number;
  passed: number;
  failed?: number;
  pass_rate: number;
  avg_scores: ScoreSet;
  niche_summary: Record<string, NicheSummary>;
  weights?: Record<string, number>;
}

interface EvalResult {
  eval_id: string;
  niche: string;
  timestamp: string;
  elapsed_seconds: number;
  scores: ScoreSet;
  issues: Record<string, string[]>;
  gold: {
    icd10_primary: string;
    cpt_codes: string[];
    ncci_edit_type: string;
    estimated_financial_exposure: number;
  };
  predicted: Record<string, unknown> | null;
  passed: boolean;
}

interface GoldExample {
  eval_id: string;
  niche: string;
  scenario_preview: string;
  gold_cpt_codes: string[];
  gold_icd10: string;
  gold_ncci_edit_type: string;
  gold_financial_exposure: number;
  ncci_citation: string;
  oig_priority: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NICHE_COLORS: Record<string, string> = {
  MSK_Forensics: "text-blue-400",
  Oncology_Billing: "text-purple-400",
  Evaluation_Management: "text-cyan-400",
  Radiology_Forensics: "text-yellow-400",
  Cardiology_Forensics: "text-red-400",
  Anesthesia_Billing: "text-orange-400",
  Urology_Forensics: "text-teal-400",
  HomeHealth_Upcoding: "text-pink-400",
  DME_Unbundling: "text-lime-400",
  BehavioralHealth_EM: "text-indigo-400",
};

const NICHE_SHORT: Record<string, string> = {
  MSK_Forensics: "MSK",
  Oncology_Billing: "Onco",
  Evaluation_Management: "E/M",
  Radiology_Forensics: "Rad",
  Cardiology_Forensics: "Card",
  Anesthesia_Billing: "Anes",
  Urology_Forensics: "Urol",
  HomeHealth_Upcoding: "HH",
  DME_Unbundling: "DME",
  BehavioralHealth_EM: "BH",
};

const DIMENSION_META = [
  { key: "syntax",    label: "Syntax",    icon: FileText,  weight: "15%", desc: "Valid JSON with all required fields" },
  { key: "code",      label: "Code Acc.", icon: BookOpen,  weight: "35%", desc: "CPT and ICD-10 code correctness" },
  { key: "ncci",      label: "NCCI",      icon: Shield,    weight: "35%", desc: "Edit type and modifier flag accuracy" },
  { key: "financial", label: "Financial", icon: DollarSign,weight: "15%", desc: "Exposure within ±20% of gold value" },
];

// ─── Score Color Helper ────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 0.90) return "text-green-400";
  if (score >= 0.70) return "text-amber-400";
  return "text-red-400";
}

function scoreBg(score: number): string {
  if (score >= 0.90) return "bg-green-500";
  if (score >= 0.70) return "bg-amber-500";
  return "bg-red-500";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const pct = Math.round(score * 100);
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`text-2xl font-mono font-bold ${scoreColor(score)}`}>{pct}%</div>
      <div className="text-xs text-[var(--color-muted-foreground)] uppercase tracking-wider">{label}</div>
      <div className="w-full h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden mt-1">
        <div className={`h-full rounded-full transition-all duration-700 ${scoreBg(score)}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function NicheBar({ niche, stats }: { niche: string; stats: NicheSummary }) {
  const pct = Math.round(stats.avg_composite * 100);
  const color = NICHE_COLORS[niche] || "text-gray-400";
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className={`text-xs font-mono w-12 shrink-0 ${color}`}>{NICHE_SHORT[niche] || niche.slice(0, 4)}</div>
      <div className="flex-1 h-2 bg-[var(--color-border)] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${pct >= 90 ? "bg-green-500" : pct >= 70 ? "bg-amber-500" : "bg-red-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={`text-xs font-mono w-10 text-right ${scoreColor(stats.avg_composite)}`}>{pct}%</div>
      <div className="text-xs text-[var(--color-muted-foreground)] w-12 text-right">{stats.passed}/{stats.total}</div>
    </div>
  );
}

function ResultRow({ result, expanded, onToggle }: {
  result: EvalResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  const allIssues = Object.values(result.issues).flat().filter(Boolean);
  return (
    <div className={`border-b border-[var(--color-border)] ${result.passed ? "" : "bg-red-950/10"}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-accent)]/30 transition-colors text-left"
      >
        {result.passed
          ? <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
          : <XCircle className="w-4 h-4 text-red-400 shrink-0" />
        }
        <span className="font-mono text-xs text-[var(--color-muted-foreground)] w-32 shrink-0">{result.eval_id}</span>
        <span className={`text-xs w-28 shrink-0 ${NICHE_COLORS[result.niche] || "text-gray-400"}`}>
          {NICHE_SHORT[result.niche] || result.niche}
        </span>
        <span className={`font-mono text-sm font-bold ${scoreColor(result.scores.composite)}`}>
          {Math.round(result.scores.composite * 100)}%
        </span>
        {!result.passed && allIssues[0] && (
          <span className="text-xs text-red-400 truncate flex-1 ml-2">{allIssues[0]}</span>
        )}
        <span className="ml-auto text-[var(--color-muted-foreground)]">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2 bg-[var(--color-accent)]/10">
          {/* Score breakdown */}
          <div className="grid grid-cols-4 gap-2 pt-2">
            {DIMENSION_META.map(d => (
              <div key={d.key} className="text-center">
                <div className={`text-sm font-mono font-bold ${scoreColor(result.scores[d.key as keyof ScoreSet])}`}>
                  {Math.round(result.scores[d.key as keyof ScoreSet] * 100)}%
                </div>
                <div className="text-xs text-[var(--color-muted-foreground)]">{d.label}</div>
              </div>
            ))}
          </div>

          {/* Gold vs Predicted */}
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div className="bg-green-950/30 border border-green-800/30 rounded p-2">
              <div className="text-xs text-green-400 font-semibold mb-1">GOLD STANDARD</div>
              <div className="text-xs font-mono text-[var(--color-foreground)]">
                ICD-10: {result.gold.icd10_primary}<br />
                CPT: {result.gold.cpt_codes.join(", ")}<br />
                NCCI: {result.gold.ncci_edit_type}<br />
                Exposure: ${result.gold.estimated_financial_exposure.toFixed(2)}
              </div>
            </div>
            <div className={`border rounded p-2 ${result.passed ? "bg-blue-950/20 border-blue-800/30" : "bg-red-950/20 border-red-800/30"}`}>
              <div className={`text-xs font-semibold mb-1 ${result.passed ? "text-blue-400" : "text-red-400"}`}>PREDICTED</div>
              {result.predicted ? (
                <div className="text-xs font-mono text-[var(--color-foreground)]">
                  ICD-10: {String(result.predicted.icd10_primary || "—")}<br />
                  CPT: {Array.isArray(result.predicted.cpt_codes) ? (result.predicted.cpt_codes as string[]).join(", ") : "—"}<br />
                  NCCI: {String(result.predicted.ncci_edit_type || "—")}<br />
                  Exposure: ${typeof result.predicted.estimated_financial_exposure === "number" ? (result.predicted.estimated_financial_exposure as number).toFixed(2) : "—"}
                </div>
              ) : (
                <div className="text-xs text-red-400">Parse failed</div>
              )}
            </div>
          </div>

          {/* Issues */}
          {allIssues.length > 0 && (
            <div className="mt-1">
              {allIssues.map((issue, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-amber-400">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>{issue}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function EvalDashboard() {
  const [report, setReport] = useState<EvalReport | null>(null);
  const [results, setResults] = useState<EvalResult[]>([]);
  const [goldExamples, setGoldExamples] = useState<GoldExample[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "results" | "gold">("overview");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [nicheFilter, setNicheFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const fetchReport = useCallback(async () => {
    try {
      const [rpt, status] = await Promise.all([
        fetch(`${API_BASE}/api/eval/report`).then(r => r.json()),
        fetch(`${API_BASE}/api/eval/status`).then(r => r.json()),
      ]);
      setReport(rpt);
      setIsRunning(status.running);
      setLastRefreshed(new Date());
    } catch {
      // backend may not be running
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchResults = useCallback(async () => {
    try {
      const data = await fetch(`${API_BASE}/api/eval/results`).then(r => r.json());
      setResults(data.results || []);
    } catch { /* ignore */ }
  }, []);

  const fetchGold = useCallback(async () => {
    try {
      const data = await fetch(`${API_BASE}/api/eval/gold`).then(r => r.json());
      setGoldExamples(data.examples || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchReport();
    fetchResults();
    fetchGold();
  }, [fetchReport, fetchResults, fetchGold]);

  // Poll while running
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(async () => {
      await fetchReport();
      await fetchResults();
    }, 3000);
    return () => clearInterval(interval);
  }, [isRunning, fetchReport, fetchResults]);

  const handleRunEval = async (useMock = true) => {
    try {
      const resp = await fetch(`${API_BASE}/api/eval/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mock: useMock }),
      });
      const data = await resp.json();
      if (data.status === "started") {
        setIsRunning(true);
      }
    } catch { /* ignore */ }
  };

  const filteredResults = nicheFilter === "all"
    ? results
    : results.filter(r => r.niche === nicheFilter);

  const niches = Object.keys(report?.niche_summary || {});

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-[var(--color-muted-foreground)]" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[var(--color-background)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-amber-400" />
          <span className="font-mono text-sm font-semibold text-[var(--color-foreground)]">Claim Map Eval Harness</span>
          <span className="text-xs text-[var(--color-muted-foreground)] font-mono">v2.1 · 50 gold examples · phi4-mini</span>
        </div>
        <div className="flex items-center gap-2">
          {lastRefreshed && (
            <span className="text-xs text-[var(--color-muted-foreground)] font-mono hidden sm:block">
              {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
          {isRunning ? (
            <div className="flex items-center gap-1.5 text-amber-400 text-xs font-mono">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Running…
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleRunEval(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-mono rounded hover:bg-amber-500/20 transition-colors"
              >
                <Zap className="w-3.5 h-3.5" />
                Mock Run
              </button>
              <button
                onClick={() => handleRunEval(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-mono rounded hover:bg-green-500/20 transition-colors"
              >
                <PlayCircle className="w-3.5 h-3.5" />
                Live Run
              </button>
              {report && report.status !== "no_report" && (
                <a
                  href={`${API_BASE}/api/eval/export/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-mono rounded hover:bg-blue-500/20 transition-colors"
                  title="Download PDF audit report"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Report</span>
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--color-border)] shrink-0">
        {[
          { id: "overview", label: "Overview", icon: BarChart3 },
          { id: "results",  label: `Results (${results.length})`, icon: FileText },
          { id: "gold",     label: `Gold (${goldExamples.length})`, icon: Shield },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-amber-400 text-amber-400"
                : "border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

        {/* ── Overview Tab ── */}
        {activeTab === "overview" && (
          <div className="p-4 space-y-4">
            {report?.status === "no_report" ? (
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <Activity className="w-12 h-12 text-[var(--color-muted-foreground)]" />
                <p className="text-sm text-[var(--color-muted-foreground)] font-mono text-center">
                  No eval has been run yet.<br />Click <span className="text-amber-400">Mock Run</span> to test without Ollama,<br />
                  or <span className="text-green-400">Live Run</span> to score against phi4-mini.
                </p>
              </div>
            ) : (
              <>
                {/* Pass Rate Hero */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="col-span-2 sm:col-span-1 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 flex flex-col items-center justify-center">
                    <div className={`text-4xl font-mono font-bold ${scoreColor(report?.pass_rate || 0)}`}>
                      {Math.round((report?.pass_rate || 0) * 100)}%
                    </div>
                    <div className="text-xs text-[var(--color-muted-foreground)] mt-1 uppercase tracking-wider">Pass Rate</div>
                    <div className="text-xs text-[var(--color-muted-foreground)] font-mono mt-0.5">
                      {report?.passed}/{report?.total_examples} examples
                    </div>
                  </div>

                  {DIMENSION_META.map(d => (
                    <div key={d.key} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
                      <div className="flex items-center gap-1.5 mb-2">
                        <d.icon className="w-3.5 h-3.5 text-[var(--color-muted-foreground)]" />
                        <span className="text-xs text-[var(--color-muted-foreground)] font-mono">{d.label}</span>
                        <span className="text-xs text-[var(--color-muted-foreground)] ml-auto">{d.weight}</span>
                      </div>
                      <ScoreGauge
                        score={report?.avg_scores[d.key as keyof ScoreSet] || 0}
                        label={d.desc}
                      />
                    </div>
                  ))}
                </div>

                {/* Niche Breakdown */}
                <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-mono font-semibold text-[var(--color-foreground)]">Niche Performance</span>
                    <span className="text-xs text-[var(--color-muted-foreground)] ml-auto font-mono">
                      {report?.model || "phi4-mini"} · {report?.run_timestamp?.slice(0, 10)}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {Object.entries(report?.niche_summary || {})
                      .sort((a, b) => a[1].avg_composite - b[1].avg_composite)
                      .map(([niche, stats]) => (
                        <NicheBar key={niche} niche={niche} stats={stats} />
                      ))}
                  </div>
                </div>

                {/* Weights reference */}
                <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3">
                  <div className="text-xs text-[var(--color-muted-foreground)] font-mono">
                    <span className="text-amber-400 font-semibold">Scoring Weights: </span>
                    Syntax 15% · Code Accuracy 35% · NCCI Correctness 35% · Financial Exposure 15% · Pass threshold: 70%
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Results Tab ── */}
        {activeTab === "results" && (
          <div>
            {/* Niche filter */}
            <div className="flex gap-1.5 p-3 border-b border-[var(--color-border)] overflow-x-auto">
              <button
                onClick={() => setNicheFilter("all")}
                className={`px-2.5 py-1 rounded text-xs font-mono shrink-0 transition-colors ${nicheFilter === "all" ? "bg-amber-500/20 text-amber-400 border border-amber-500/40" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"}`}
              >
                All ({results.length})
              </button>
              {niches.map(n => (
                <button
                  key={n}
                  onClick={() => setNicheFilter(n)}
                  className={`px-2.5 py-1 rounded text-xs font-mono shrink-0 transition-colors ${nicheFilter === n ? `bg-amber-500/20 text-amber-400 border border-amber-500/40` : `text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]`}`}
                >
                  {NICHE_SHORT[n] || n}
                </button>
              ))}
            </div>

            {filteredResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <FileText className="w-10 h-10 text-[var(--color-muted-foreground)]" />
                <p className="text-sm text-[var(--color-muted-foreground)] font-mono">No results yet. Run an eval first.</p>
              </div>
            ) : (
              <div>
                {filteredResults.map(r => (
                  <ResultRow
                    key={r.eval_id}
                    result={r}
                    expanded={expandedId === r.eval_id}
                    onToggle={() => setExpandedId(expandedId === r.eval_id ? null : r.eval_id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Gold Tab ── */}
        {activeTab === "gold" && (
          <div className="p-4 space-y-2">
            <p className="text-xs text-[var(--color-muted-foreground)] font-mono mb-3">
              50 manually authored gold-standard Claim Maps across 10 niches. These are the ground truth examples phi4-mini is scored against.
            </p>
            {goldExamples.map(ex => (
              <div key={ex.eval_id} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3">
                <div className="flex items-start gap-2 mb-2">
                  <span className={`text-xs font-mono font-semibold ${NICHE_COLORS[ex.niche] || "text-gray-400"}`}>
                    {NICHE_SHORT[ex.niche] || ex.niche}
                  </span>
                  <span className="text-xs text-[var(--color-muted-foreground)] font-mono">{ex.eval_id}</span>
                  {ex.oig_priority && (
                    <span className="ml-auto flex items-center gap-1 text-xs text-red-400 font-mono">
                      <Shield className="w-3 h-3" /> OIG
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--color-muted-foreground)] mb-2 leading-relaxed">{ex.scenario_preview}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
                  <div><span className="text-[var(--color-muted-foreground)]">ICD-10: </span><span className="text-[var(--color-foreground)]">{ex.gold_icd10}</span></div>
                  <div><span className="text-[var(--color-muted-foreground)]">CPT: </span><span className="text-[var(--color-foreground)]">{ex.gold_cpt_codes.join(", ")}</span></div>
                  <div><span className="text-[var(--color-muted-foreground)]">NCCI: </span><span className="text-amber-400">{ex.gold_ncci_edit_type}</span></div>
                  <div><span className="text-[var(--color-muted-foreground)]">Exposure: </span><span className="text-green-400">${ex.gold_financial_exposure.toFixed(2)}</span></div>
                </div>
                {ex.ncci_citation && (
                  <div className="mt-2 text-xs text-blue-400 font-mono border-t border-[var(--color-border)] pt-2">
                    {ex.ncci_citation}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
