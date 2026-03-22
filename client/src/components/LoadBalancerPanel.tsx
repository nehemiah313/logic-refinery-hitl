/*
 * LoadBalancerPanel.tsx — Scout & Refiner Load Balancer Dashboard
 * Logic Refinery v3.1
 *
 * Design: Forensic Terminal — dark slate, amber/green accent, monospace data
 * New in v3.1:
 *   - ThroughputChart: Recharts line graph of Scout/Refiner completions (24h)
 *   - ClaimMapDrawer: slide-up inspector showing clinical anchor, transactional
 *     layer, NCCI forensic link, and raw JSON for any queue row
 *   - Clickable QueueRow: tap any job to open its Claim Map in the drawer
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cpu, Zap, ArrowRight, RefreshCw, Shield, AlertTriangle,
  CheckCircle2, Activity, ChevronDown, ChevronUp,
  Database, FlaskConical, Layers, TrendingUp,
  X, FileJson, ExternalLink, BarChart2,
} from "lucide-react";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";

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

interface ThroughputData {
  hours: string[];
  scout: number[];
  refiner: number[];
  total_scout: number;
  total_refiner: number;
}

interface ClaimMap {
  claim_map_id: string;
  niche: string;
  source_bill_id: string;
  node_id: string;
  icd10_primary: string;
  cpt_codes: string[];
  ncci_citation: string;
  oig_priority: boolean;
  financial_impact_estimate: number;
  audit_summary: {
    overall_audit_risk: string;
    ncci_edits_triggered: number;
    ready_for_refiner: boolean;
    flags: string[];
  };
  clinical_anchor: { diagnosis: string; icd10: string; clinical_context: string };
  transactional_layer: { primary_cpt: string; secondary_cpts: string[]; modifiers: string[] };
  forensic_link: { ncci_edit_type: string; bundling_rule: string; financial_exposure: number };
  generated_at: string;
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
    { id: "gcp", label: "GCP ML", sublabel: "Raw Bills", icon: Database, color: "border-slate-500 text-slate-400", count: null },
    { id: "scout", label: "i5-Scout", sublabel: "Claim Map Parse", icon: Cpu, color: "border-amber-500 text-amber-400", count: stats ? stats.scout_queue.queued + stats.scout_queue.in_progress : null },
    { id: "claimmap", label: "Claim Maps", sublabel: "NCCI Mapped", icon: Layers, color: "border-blue-500 text-blue-400", count: stats ? stats.pipeline_throughput.claim_maps_ready : null },
    { id: "refiner", label: "Ryzen-Refiner", sublabel: "Gold Reasoning", icon: Zap, color: "border-emerald-500 text-emerald-400", count: stats ? stats.refiner_queue.queued + stats.refiner_queue.in_progress : null },
    { id: "hitl", label: "HITL", sublabel: "Human Verify", icon: Shield, color: "border-purple-500 text-purple-400", count: stats ? stats.pipeline_throughput.traces_ready_for_hitl : null },
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
              <span className="text-[10px] font-mono font-bold tabular-nums">{stage.count}</span>
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

function StatCard({ label, value, sub, color = "text-white" }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-slate-900/60 border border-slate-700/50 rounded-lg p-3">
      <div className="text-[10px] text-slate-500 font-mono uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-xl font-mono font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Claim Map Inspector Drawer ───────────────────────────────────────────────

function ClaimMapDrawer({ map, onClose }: { map: ClaimMap; onClose: () => void }) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: "spring", damping: 28, stiffness: 300 }}
          className="w-full md:max-w-2xl max-h-[85vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-t-2xl md:rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drawer header */}
          <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 bg-slate-900 border-b border-slate-700">
            <div className="flex items-center gap-3">
              <FileJson className="w-5 h-5 text-blue-400" />
              <div>
                <div className="text-sm font-mono font-bold text-slate-100">Claim Map Inspector</div>
                <div className="text-[10px] text-slate-500 font-mono">{map.claim_map_id}</div>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            {/* Summary row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-800/60 rounded-lg p-3">
                <div className="text-[9px] text-slate-500 font-mono uppercase tracking-wider mb-1">Niche</div>
                <div className={`text-xs font-mono font-bold ${NICHE_COLORS[map.niche] || "text-slate-300"}`}>{map.niche.replace(/_/g, " ")}</div>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-3">
                <div className="text-[9px] text-slate-500 font-mono uppercase tracking-wider mb-1">Exposure</div>
                <div className="text-xs font-mono font-bold text-emerald-400">{fmt$(map.financial_impact_estimate)}</div>
              </div>
              <div className={`rounded-lg p-3 ${
                map.audit_summary?.overall_audit_risk === "HIGH"
                  ? "bg-red-500/10 border border-red-500/20"
                  : map.audit_summary?.overall_audit_risk === "MEDIUM"
                  ? "bg-amber-500/10 border border-amber-500/20"
                  : "bg-emerald-500/10 border border-emerald-500/20"
              }`}>
                <div className="text-[9px] text-slate-500 font-mono uppercase tracking-wider mb-1">Audit Risk</div>
                <div className={`text-xs font-mono font-bold ${
                  map.audit_summary?.overall_audit_risk === "HIGH" ? "text-red-400"
                  : map.audit_summary?.overall_audit_risk === "MEDIUM" ? "text-amber-400"
                  : "text-emerald-400"
                }`}>{map.audit_summary?.overall_audit_risk || "—"}</div>
              </div>
            </div>

            {/* OIG + NCCI citation badges */}
            {(map.oig_priority || map.ncci_citation) && (
              <div className="flex flex-wrap gap-2">
                {map.oig_priority && (
                  <span className="flex items-center gap-1 text-[10px] bg-red-500/15 text-red-400 border border-red-500/25 rounded-full px-2.5 py-1 font-mono">
                    <AlertTriangle className="w-3 h-3" /> OIG 2026 Priority
                  </span>
                )}
                {map.ncci_citation && (
                  <span className="text-[10px] bg-blue-500/15 text-blue-400 border border-blue-500/25 rounded-full px-2.5 py-1 font-mono">
                    {map.ncci_citation}
                  </span>
                )}
              </div>
            )}

            {/* Clinical Anchor */}
            <div className="border border-slate-700/50 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-800/40 border-b border-slate-700/30">
                <span className="text-[10px] font-mono font-bold text-blue-400 uppercase tracking-wider">Clinical Anchor</span>
              </div>
              <div className="p-4 space-y-2">
                <div className="flex items-start gap-3">
                  <span className="text-[9px] text-slate-500 font-mono w-16 flex-shrink-0 pt-0.5">ICD-10</span>
                  <span className="text-xs font-mono text-amber-400 font-bold">{map.icd10_primary}</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-[9px] text-slate-500 font-mono w-16 flex-shrink-0 pt-0.5">Diagnosis</span>
                  <span className="text-xs font-mono text-slate-300">{map.clinical_anchor?.diagnosis || map.icd10_primary}</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-[9px] text-slate-500 font-mono w-16 flex-shrink-0 pt-0.5">Context</span>
                  <span className="text-xs font-mono text-slate-400 leading-relaxed">{map.clinical_anchor?.clinical_context || "—"}</span>
                </div>
              </div>
            </div>

            {/* Transactional Layer */}
            <div className="border border-slate-700/50 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-800/40 border-b border-slate-700/30">
                <span className="text-[10px] font-mono font-bold text-amber-400 uppercase tracking-wider">Transactional Layer</span>
              </div>
              <div className="p-4 space-y-2">
                <div className="flex items-start gap-3">
                  <span className="text-[9px] text-slate-500 font-mono w-16 flex-shrink-0 pt-0.5">Primary CPT</span>
                  <span className="text-xs font-mono text-white font-bold">{map.transactional_layer?.primary_cpt || map.cpt_codes?.[0] || "—"}</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-[9px] text-slate-500 font-mono w-16 flex-shrink-0 pt-0.5">All CPTs</span>
                  <div className="flex flex-wrap gap-1">
                    {(map.cpt_codes || []).map((c) => (
                      <span key={c} className="text-[10px] bg-slate-700 text-slate-200 rounded px-1.5 py-0.5 font-mono">{c}</span>
                    ))}
                  </div>
                </div>
                {(map.transactional_layer?.modifiers?.length ?? 0) > 0 && (
                  <div className="flex items-start gap-3">
                    <span className="text-[9px] text-slate-500 font-mono w-16 flex-shrink-0 pt-0.5">Modifiers</span>
                    <div className="flex flex-wrap gap-1">
                      {map.transactional_layer.modifiers.map((m) => (
                        <span key={m} className="text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/25 rounded px-1.5 py-0.5 font-mono">{m}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Forensic Link */}
            <div className="border border-red-500/20 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-red-500/5 border-b border-red-500/20">
                <span className="text-[10px] font-mono font-bold text-red-400 uppercase tracking-wider">Forensic Link — NCCI Edit</span>
              </div>
              <div className="p-4 space-y-2">
                <div className="flex items-start gap-3">
                  <span className="text-[9px] text-slate-500 font-mono w-20 flex-shrink-0 pt-0.5">Edit Type</span>
                  <span className="text-xs font-mono text-red-400 font-bold">{map.forensic_link?.ncci_edit_type || "—"}</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-[9px] text-slate-500 font-mono w-20 flex-shrink-0 pt-0.5">Bundling Rule</span>
                  <span className="text-xs font-mono text-slate-300 leading-relaxed">{map.forensic_link?.bundling_rule || "—"}</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-[9px] text-slate-500 font-mono w-20 flex-shrink-0 pt-0.5">Exposure</span>
                  <span className="text-xs font-mono text-emerald-400 font-bold">{fmt$(map.forensic_link?.financial_exposure || 0)}</span>
                </div>
              </div>
            </div>

            {/* Audit Flags */}
            {(map.audit_summary?.flags?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Audit Flags</div>
                <div className="space-y-1">
                  {map.audit_summary.flags.map((flag, i) => (
                    <div key={i} className="flex items-start gap-2 text-[11px] font-mono text-slate-300">
                      <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />
                      {flag}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Raw JSON toggle */}
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer text-[10px] font-mono text-slate-500 hover:text-slate-300 transition-colors list-none">
                <ExternalLink className="w-3 h-3" />
                View raw JSON
              </summary>
              <pre className="mt-2 p-3 bg-slate-950 border border-slate-700/50 rounded-lg text-[9px] font-mono text-slate-400 overflow-x-auto max-h-48 overflow-y-auto">
                {JSON.stringify(map, null, 2)}
              </pre>
            </details>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Throughput Chart ─────────────────────────────────────────────────────────

function ThroughputChart({ data }: { data: ThroughputData | null }) {
  if (!data) {
    return (
      <div className="border border-slate-700/50 rounded-xl p-4 flex items-center justify-center h-40 text-slate-600 font-mono text-xs">
        Loading throughput data...
      </div>
    );
  }

  const chartData = data.hours.map((h, i) => ({
    hour: h,
    Scout: data.scout[i] ?? 0,
    Refiner: data.refiner[i] ?? 0,
  }));

  return (
    <div className="border border-slate-700/50 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900/60 border-b border-slate-700/30">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-mono font-bold text-slate-200">Pipeline Throughput</span>
          <span className="text-[10px] text-slate-500 font-mono ml-1">— last 24 hours</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-[10px] font-mono text-slate-400">Scout: {data.total_scout}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-[10px] font-mono text-slate-400">Refiner: {data.total_refiner}</span>
          </div>
        </div>
      </div>
      <div className="p-4 bg-slate-950/40">
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.15)" />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 9, fontFamily: "JetBrains Mono, monospace", fill: "#64748b" }}
              tickLine={false}
              axisLine={false}
              interval={3}
            />
            <YAxis
              tick={{ fontSize: 9, fontFamily: "JetBrains Mono, monospace", fill: "#64748b" }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid rgba(100,116,139,0.3)",
                borderRadius: "8px",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: "11px",
              }}
              labelStyle={{ color: "#94a3b8" }}
            />
            <Line type="monotone" dataKey="Scout" stroke="#f59e0b" strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: "#f59e0b" }} />
            <Line type="monotone" dataKey="Refiner" stroke="#10b981" strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: "#10b981" }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Queue Row (clickable for Claim Map inspection) ───────────────────────────

function QueueRow({ job, tier, onInspect }: { job: QueueJob; tier: "scout" | "refiner"; onInspect?: (jobId: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: tier === "scout" ? -10 : 10 }}
      animate={{ opacity: 1, x: 0 }}
      onClick={() => onInspect?.(job.job_id)}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-700/30 transition-colors ${
        onInspect ? "hover:border-blue-500/40 hover:bg-slate-800/40 cursor-pointer" : ""
      }`}
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
      {onInspect && (
        <FileJson className="w-3 h-3 text-slate-600 flex-shrink-0" />
      )}
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
                    <span className="text-[10px] text-slate-500 font-mono">confidence: {result.confidence}</span>
                    {result.capabilities?.bittensor_eligible && (
                      <span className="text-[9px] bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded px-1.5 py-0.5 font-mono">
                        Bittensor Eligible
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono leading-relaxed">{result.reason}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {result.capabilities?.task_types?.map((t) => (
                      <span key={t} className="text-[9px] bg-slate-700 text-slate-300 rounded px-1.5 py-0.5 font-mono">{t}</span>
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
  const [throughput, setThroughput] = useState<ThroughputData | null>(null);
  const [inspectMap, setInspectMap] = useState<ClaimMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [generating, setGenerating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, scoutRes, refinerRes, throughputRes] = await Promise.all([
        fetch(`${API}/api/lb/stats`),
        fetch(`${API}/api/lb/queue/scout?limit=15`),
        fetch(`${API}/api/lb/queue/refiner?limit=15`),
        fetch(`${API}/api/lb/throughput?hours=24`),
      ]);
      const [s, sq, rq, tp] = await Promise.all([
        statsRes.json(), scoutRes.json(), refinerRes.json(), throughputRes.json(),
      ]);
      setStats(s);
      setScoutJobs(sq.queue || []);
      setRefinerJobs(rq.queue || []);
      setThroughput(tp);
    } catch {
      toast.error("Cannot reach backend — is Flask running on port 5001?");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInspect = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`${API}/api/lb/claim_maps?limit=50`);
      const data = await res.json();
      const maps: ClaimMap[] = data.claim_maps || [];
      const match = maps.find((m) => m.claim_map_id?.includes(jobId.slice(-6))) || maps[0];
      if (match) {
        setInspectMap(match);
      } else {
        const job = [...scoutJobs, ...refinerJobs].find((j) => j.job_id === jobId);
        const genRes = await fetch(`${API}/api/lb/claim_maps/generate_sample`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ niche: job?.niche, node_id: "inspector_demo" }),
        });
        const genData = await genRes.json();
        if (genData.claim_map) setInspectMap(genData.claim_map);
      }
    } catch {
      toast.error("Could not load Claim Map");
    }
  }, [scoutJobs, refinerJobs]);

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
      setInspectMap(cm);
      refresh();
    } catch {
      toast.error("Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
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
        <StatCard label="Scout Queue" value={stats?.scout_queue.queued ?? "—"} sub={`${stats?.scout_queue.in_progress ?? 0} in progress`} color="text-amber-400" />
        <StatCard label="Refiner Queue" value={stats?.refiner_queue.queued ?? "—"} sub={`${stats?.refiner_queue.in_progress ?? 0} in progress`} color="text-emerald-400" />
        <StatCard label="Claim Maps Ready" value={stats?.pipeline_throughput.claim_maps_ready ?? "—"} sub="awaiting refiner" color="text-blue-400" />
        <StatCard label="Traces → HITL" value={stats?.pipeline_throughput.traces_ready_for_hitl ?? "—"} sub="awaiting human verify" color="text-purple-400" />
      </div>

      {/* Throughput Chart */}
      <ThroughputChart data={throughput} />

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
              <div className="text-center py-8 text-slate-600 font-mono text-xs">No Scout jobs queued</div>
            ) : (
              scoutJobs.map((job) => (
                <QueueRow key={job.job_id} job={job} tier="scout" onInspect={handleInspect} />
              ))
            )}
          </div>
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
              <div className="text-center py-8 text-slate-600 font-mono text-xs">No Refiner jobs queued</div>
            ) : (
              refinerJobs.map((job) => (
                <QueueRow key={job.job_id} job={job} tier="refiner" onInspect={handleInspect} />
              ))
            )}
          </div>
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
  --tier scout`}
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
  --tier refiner --model mistral-nemo`}
              </pre>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 font-mono">
            Use <code className="text-amber-400">--tier auto</code> to let the orchestrator classify your hardware automatically.
            Scouts receive <span className="text-amber-400">claim_map_parse</span> jobs.
            Refiners receive <span className="text-emerald-400">gold_standard_reason</span> jobs.
          </p>
        </div>
      </div>

    </div>
      {/* Claim Map Inspector Drawer */}
      {inspectMap && (
        <ClaimMapDrawer map={inspectMap as ClaimMap} onClose={() => setInspectMap(null)} />
      )}
    </>
  );
}
