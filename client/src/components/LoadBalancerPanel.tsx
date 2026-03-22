/**
 * LoadBalancerPanel.tsx — Scout & Refiner Load Balancer Dashboard
 * Logic Refinery v3.0
 *
 * Design: Forensic Terminal — dark slate, amber/green accent, monospace data
 * Layout: Two-column split (Scout queue left, Refiner queue right) on desktop,
 *         stacked on mobile. Pipeline flow diagram at top.
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cpu, Zap, ArrowRight, RefreshCw, Shield, AlertTriangle,
  CheckCircle2, Clock, Activity, ChevronDown, ChevronUp,
  Database, FlaskConical, Layers, TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

const API = "http://localhost:5001";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueueStats {
  queued: number;
  in_progress: number;
  completed: number;
  failed: number;
}

interface TopJob {
  job_id: string;
  niche: string;
  financial_impact: number;
  oig_priority: boolean;
  status: string;
}

interface LBStats {
  scout_queue: QueueStats;
  refiner_queue: QueueStats;
  total_jobs: number;
  pipeline_throughput: {
    claim_maps_ready: number;
    traces_ready_for_hitl: number;
  };
  top_refiner_jobs: TopJob[];
}

interface QueueJob {
  job_id: string;
  job_type: string;
  niche: string;
  status: string;
  financial_impact_estimate: number;
  oig_priority: boolean;
  assigned_to: string | null;
  created_at: string;
}

interface TierDetectResult {
  tier: string;
  confidence: string;
  reason: string;
  capabilities: {
    task_types: string[];
    max_concurrent_jobs: number;
    bittensor_eligible: boolean;
    supports_vram: boolean;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NICHE_COLORS: Record<string, string> = {
  MSK_Forensics: "text-blue-400",
  Oncology_Billing: "text-purple-400",
  Evaluation_Management: "text-green-400",
  Radiology_Forensics: "text-cyan-400",
  Cardiology_Forensics: "text-red-400",
  Anesthesia_Billing: "text-orange-400",
  Urology_Forensics: "text-yellow-400",
  Home_Health_Upcoding: "text-pink-400",
  DME_Forensics: "text-teal-400",
  Behavioral_Health: "text-indigo-400",
};

const STATUS_COLORS: Record<string, string> = {
  queued: "text-amber-400",
  in_progress: "text-blue-400",
  completed: "text-emerald-400",
  failed: "text-red-400",
};

function fmt$(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// ─── Pipeline Flow Diagram ────────────────────────────────────────────────────

function PipelineFlow({ stats }: { stats: LBStats | null }) {
  const stages = [
    {
      id: "gcp",
      label: "GCP ML",
      sublabel: "Raw Bills",
      icon: Database,
      color: "border-slate-500 text-slate-400",
      count: null,
    },
    {
      id: "scout",
      label: "i5-Scout",
      sublabel: "Claim Map Parse",
      icon: Cpu,
      color: "border-amber-500 text-amber-400",
      count: stats ? stats.scout_queue.queued + stats.scout_queue.in_progress : null,
    },
    {
      id: "claimmap",
      label: "Claim Maps",
      sublabel: "NCCI Mapped",
      icon: Layers,
      color: "border-blue-500 text-blue-400",
      count: stats ? stats.pipeline_throughput.claim_maps_ready : null,
    },
    {
      id: "refiner",
      label: "Ryzen-Refiner",
      sublabel: "Gold Reasoning",
      icon: Zap,
      color: "border-emerald-500 text-emerald-400",
      count: stats ? stats.refiner_queue.queued + stats.refiner_queue.in_progress : null,
    },
    {
      id: "hitl",
      label: "HITL",
      sublabel: "Human Verify",
      icon: Shield,
      color: "border-purple-500 text-purple-400",
      count: stats ? stats.pipeline_throughput.traces_ready_for_hitl : null,
    },
  ];

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2 scrollbar-none">
      {stages.map((stage, i) => (
        <div key={stage.id} className="flex items-center gap-1 flex-shrink-0">
          <div className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg border bg-slate-900/60 ${stage.color} min-w-[80px]`}>
            <stage.icon className="w-4 h-4" />
            <span className="text-[10px] font-mono font-bold">{stage.label}</span>
            <span className="text-[9px] text-slate-500">{stage.sublabel}</span>
            {stage.count !== null && (
              <span className="text-[10px] font-mono font-bold tabular-nums">
                {stage.count}
              </span>
            )}
          </div>
          {i < stages.length - 1 && (
            <ArrowRight className="w-3 h-3 text-slate-600 flex-shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, color = "text-white",
}: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-slate-900/60 border border-slate-700/50 rounded-lg p-3">
      <div className="text-[10px] text-slate-500 font-mono uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-xl font-mono font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Queue Row ────────────────────────────────────────────────────────────────

function QueueRow({ job, tier }: { job: QueueJob; tier: "scout" | "refiner" }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: tier === "scout" ? -10 : 10 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-700/30 hover:border-slate-600/50 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono font-bold ${NICHE_COLORS[job.niche] || "text-slate-400"}`}>
            {job.niche.replace(/_/g, " ")}
          </span>
          {job.oig_priority && (
            <span className="text-[9px] bg-red-500/20 text-red-400 border border-red-500/30 rounded px-1 py-0.5 font-mono">
              OIG
            </span>
          )}
        </div>
        <div className="text-[9px] text-slate-500 font-mono truncate mt-0.5">
          {job.job_id} · {timeAgo(job.created_at)}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-[11px] font-mono font-bold text-emerald-400 tabular-nums">
          {fmt$(job.financial_impact_estimate)}
        </div>
        <div className={`text-[9px] font-mono ${STATUS_COLORS[job.status] || "text-slate-400"}`}>
          {job.status}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Tier Detector Widget ─────────────────────────────────────────────────────

function TierDetector() {
  const [model, setModel] = useState("phi4-mini");
  const [ram, setRam] = useState("8");
  const [vram, setVram] = useState("0");
  const [cpu, setCpu] = useState("intel i5-12400");
  const [result, setResult] = useState<TierDetectResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const detect = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/lb/detect_tier`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hardware_profile: {
            model,
            ram_gb: parseFloat(ram) || 0,
            vram_gb: parseFloat(vram) || 0,
            cpu_brand: cpu.split(" ")[0],
            cpu_model: cpu,
          },
        }),
      });
      const data = await res.json();
      setResult(data);
    } catch {
      toast.error("Backend unreachable");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-slate-700/50 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-900/60 hover:bg-slate-800/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-mono font-bold text-slate-200">Node Tier Detector</span>
          <span className="text-[10px] text-slate-500">— test your hardware profile</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 bg-slate-950/40 grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Ollama Model", value: model, set: setModel, placeholder: "phi4-mini" },
                { label: "RAM (GB)", value: ram, set: setRam, placeholder: "8" },
                { label: "VRAM (GB)", value: vram, set: setVram, placeholder: "0" },
                { label: "CPU", value: cpu, set: setCpu, placeholder: "intel i5-12400" },
              ].map((f) => (
                <div key={f.label}>
                  <label className="text-[10px] text-slate-500 font-mono uppercase tracking-wider block mb-1">
                    {f.label}
                  </label>
                  <input
                    value={f.value}
                    onChange={(e) => f.set(e.target.value)}
                    placeholder={f.placeholder}
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-500"
                  />
                </div>
              ))}
            </div>

            <div className="px-4 pb-4 bg-slate-950/40 flex items-start gap-4">
              <button
                onClick={detect}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-mono font-bold text-xs rounded-lg transition-colors"
              >
                {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                Detect Tier
              </button>

              {result && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex-1 rounded-lg border px-4 py-3 ${
                    result.tier === "refiner"
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-amber-500/40 bg-amber-500/5"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {result.tier === "refiner" ? (
                      <Zap className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Cpu className="w-4 h-4 text-amber-400" />
                    )}
                    <span className={`text-sm font-mono font-bold uppercase ${result.tier === "refiner" ? "text-emerald-400" : "text-amber-400"}`}>
                      {result.tier === "refiner" ? "Ryzen-Refiner" : "i5-Scout"}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      confidence: {result.confidence}
                    </span>
                    {result.capabilities?.bittensor_eligible && (
                      <span className="text-[9px] bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded px-1.5 py-0.5 font-mono">
                        Bittensor Eligible
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono leading-relaxed">
                    {result.reason}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {result.capabilities?.task_types?.map((t) => (
                      <span key={t} className="text-[9px] bg-slate-700 text-slate-300 rounded px-1.5 py-0.5 font-mono">
                        {t}
                      </span>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function LoadBalancerPanel() {
  const [stats, setStats] = useState<LBStats | null>(null);
  const [scoutJobs, setScoutJobs] = useState<QueueJob[]>([]);
  const [refinerJobs, setRefinerJobs] = useState<QueueJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [generating, setGenerating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, scoutRes, refinerRes] = await Promise.all([
        fetch(`${API}/api/lb/stats`),
        fetch(`${API}/api/lb/queue/scout?limit=15`),
        fetch(`${API}/api/lb/queue/refiner?limit=15`),
      ]);
      const [s, sq, rq] = await Promise.all([
        statsRes.json(), scoutRes.json(), refinerRes.json(),
      ]);
      setStats(s);
      setScoutJobs(sq.queue || []);
      setRefinerJobs(rq.queue || []);
    } catch {
      toast.error("Cannot reach backend — is Flask running on port 5001?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [refresh]);

  const seed = async () => {
    setSeeding(true);
    try {
      const res = await fetch(`${API}/api/lb/seed`, { method: "POST" });
      const data = await res.json();
      toast.success(`Seeded ${data.scout_jobs_created} Scout + ${data.refiner_jobs_created} Refiner jobs`);
      refresh();
    } catch {
      toast.error("Seed failed");
    } finally {
      setSeeding(false);
    }
  };

  const generateClaimMap = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${API}/api/lb/claim_maps/generate_sample`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_id: "demo_scout" }),
      });
      const data = await res.json();
      const cm = data.claim_map;
      toast.success(
        `Claim Map generated — ${cm.niche} · ${fmt$(cm.financial_impact_estimate)} exposure · ${cm.audit_summary.ncci_edits_triggered} NCCI edit(s)`
      );
      refresh();
    } catch {
      toast.error("Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 pb-24 md:pb-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-mono font-bold text-slate-100">Load Balancer</h2>
          <p className="text-[11px] text-slate-500 font-mono">Scout & Refiner routing · dual-queue · score-weighted</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={generateClaimMap}
            disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-mono text-xs rounded-lg transition-colors"
          >
            {generating ? <RefreshCw className="w-3 h-3 animate-spin" /> : <FlaskConical className="w-3 h-3" />}
            Gen Claim Map
          </button>
          <button
            onClick={seed}
            disabled={seeding}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-mono text-xs rounded-lg transition-colors"
          >
            {seeding ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Layers className="w-3 h-3" />}
            Seed Jobs
          </button>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 font-mono text-xs rounded-lg transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Pipeline Flow */}
      <PipelineFlow stats={stats} />

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Scout Queue"
          value={stats?.scout_queue.queued ?? "—"}
          sub={`${stats?.scout_queue.in_progress ?? 0} in progress`}
          color="text-amber-400"
        />
        <StatCard
          label="Refiner Queue"
          value={stats?.refiner_queue.queued ?? "—"}
          sub={`${stats?.refiner_queue.in_progress ?? 0} in progress`}
          color="text-emerald-400"
        />
        <StatCard
          label="Claim Maps Ready"
          value={stats?.pipeline_throughput.claim_maps_ready ?? "—"}
          sub="awaiting refiner"
          color="text-blue-400"
        />
        <StatCard
          label="Traces → HITL"
          value={stats?.pipeline_throughput.traces_ready_for_hitl ?? "—"}
          sub="awaiting human verify"
          color="text-purple-400"
        />
      </div>

      {/* Tier Detector */}
      <TierDetector />

      {/* Dual Queue View */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Scout Queue */}
        <div className="border border-amber-500/20 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-amber-500/5 border-b border-amber-500/20">
            <Cpu className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-mono font-bold text-amber-400">i5-Scout Queue</span>
            <span className="ml-auto text-[10px] font-mono text-slate-500">claim_map_parse · FIFO</span>
            <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
              {stats?.scout_queue.queued ?? 0}
            </span>
          </div>
          <div className="p-3 flex flex-col gap-2 max-h-80 overflow-y-auto">
            {scoutJobs.length === 0 ? (
              <div className="text-center py-8 text-slate-600 font-mono text-xs">
                No Scout jobs queued
              </div>
            ) : (
              scoutJobs.map((job) => (
                <QueueRow key={job.job_id} job={job} tier="scout" />
              ))
            )}
          </div>
          {/* Scout stats footer */}
          <div className="flex items-center gap-4 px-4 py-2 bg-slate-900/40 border-t border-slate-700/30">
            {[
              { label: "Done", value: stats?.scout_queue.completed ?? 0, color: "text-emerald-400" },
              { label: "Active", value: stats?.scout_queue.in_progress ?? 0, color: "text-blue-400" },
              { label: "Failed", value: stats?.scout_queue.failed ?? 0, color: "text-red-400" },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-1">
                <span className="text-[9px] text-slate-500 font-mono">{s.label}:</span>
                <span className={`text-[10px] font-mono font-bold tabular-nums ${s.color}`}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Refiner Queue */}
        <div className="border border-emerald-500/20 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-emerald-500/5 border-b border-emerald-500/20">
            <Zap className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-mono font-bold text-emerald-400">Ryzen-Refiner Queue</span>
            <span className="ml-auto text-[10px] font-mono text-slate-500">gold_standard_reason · score-weighted</span>
            <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-0.5">
              {stats?.refiner_queue.queued ?? 0}
            </span>
          </div>
          <div className="p-3 flex flex-col gap-2 max-h-80 overflow-y-auto">
            {refinerJobs.length === 0 ? (
              <div className="text-center py-8 text-slate-600 font-mono text-xs">
                No Refiner jobs queued
              </div>
            ) : (
              refinerJobs.map((job) => (
                <QueueRow key={job.job_id} job={job} tier="refiner" />
              ))
            )}
          </div>
          {/* Refiner stats footer */}
          <div className="flex items-center gap-4 px-4 py-2 bg-slate-900/40 border-t border-slate-700/30">
            {[
              { label: "Done", value: stats?.refiner_queue.completed ?? 0, color: "text-emerald-400" },
              { label: "Active", value: stats?.refiner_queue.in_progress ?? 0, color: "text-blue-400" },
              { label: "Failed", value: stats?.refiner_queue.failed ?? 0, color: "text-red-400" },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-1">
                <span className="text-[9px] text-slate-500 font-mono">{s.label}:</span>
                <span className={`text-[10px] font-mono font-bold tabular-nums ${s.color}`}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Refiner Jobs (score-weighted preview) */}
      {stats?.top_refiner_jobs && stats.top_refiner_jobs.length > 0 && (
        <div className="border border-slate-700/50 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-slate-900/60 border-b border-slate-700/30">
            <TrendingUp className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-mono font-bold text-slate-200">Top Refiner Jobs</span>
            <span className="text-[10px] text-slate-500 font-mono ml-1">— highest financial impact first</span>
          </div>
          <div className="divide-y divide-slate-700/30">
            {stats.top_refiner_jobs.map((job, i) => (
              <div key={job.job_id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-[10px] font-mono text-slate-600 w-4 tabular-nums">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono font-bold ${NICHE_COLORS[job.niche] || "text-slate-400"}`}>
                      {job.niche.replace(/_/g, " ")}
                    </span>
                    {job.oig_priority && (
                      <span className="flex items-center gap-0.5 text-[9px] bg-red-500/15 text-red-400 border border-red-500/25 rounded px-1 py-0.5 font-mono">
                        <AlertTriangle className="w-2.5 h-2.5" /> OIG
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] text-slate-500 font-mono">{job.job_id}</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono font-bold text-emerald-400 tabular-nums">
                    {fmt$(job.financial_impact)}
                  </div>
                  <div className={`text-[9px] font-mono ${STATUS_COLORS[job.status] || "text-slate-400"}`}>
                    {job.status}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Worker Connection Guide */}
      <div className="border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-slate-900/60 border-b border-slate-700/30">
          <CheckCircle2 className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-mono font-bold text-slate-200">Connect a Worker Node</span>
        </div>
        <div className="p-4 bg-slate-950/40 space-y-3">
          <p className="text-[11px] text-slate-400 font-mono">
            Copy <code className="text-amber-400">worker_client.py</code> to each machine and run:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-[9px] text-amber-400 font-mono uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Cpu className="w-3 h-3" /> i5-Scout (nodes 01–07)
              </div>
              <pre className="bg-slate-900 border border-amber-500/20 rounded-lg p-3 text-[10px] font-mono text-slate-300 overflow-x-auto">
{`python3 worker_client.py \\
  --node-id node_01 \\
  --orchestrator http://YOUR_IP:5001 \\
  --model phi4-mini`}
              </pre>
            </div>
            <div>
              <div className="text-[9px] text-emerald-400 font-mono uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Zap className="w-3 h-3" /> Ryzen-Refiner
              </div>
              <pre className="bg-slate-900 border border-emerald-500/20 rounded-lg p-3 text-[10px] font-mono text-slate-300 overflow-x-auto">
{`python3 worker_client.py \\
  --node-id ryzen_01 \\
  --orchestrator http://YOUR_IP:5001 \\
  --model mistral-nemo`}
              </pre>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 font-mono">
            The Load Balancer auto-detects tier from your hardware profile on first registration.
            Scouts receive <span className="text-amber-400">claim_map_parse</span> jobs.
            Refiners receive <span className="text-emerald-400">gold_standard_reason</span> jobs.
          </p>
        </div>
      </div>

    </div>
  );
}
