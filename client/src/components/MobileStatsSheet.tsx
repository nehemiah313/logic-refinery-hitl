/**
 * MobileStatsSheet — Full-page stats view for mobile (replaces sidebar)
 * Design: Forensic Terminal × Native Mobile — scrollable stats cards
 */
import { useState } from "react";
import { type Stats, api } from "@/lib/api";
import {
  Activity,
  CheckCircle2,
  Clock,
  Database,
  Download,
  Loader2,
  Plus,
  Shield,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

interface MobileStatsSheetProps {
  stats: Stats | null;
  queueRemaining: number;
  onGenerate: () => void;
  generating: boolean;
  auditorId: string;
}

const NICHE_COLORS: Record<string, string> = {
  MSK_Forensics:          "bg-amber-400",
  Oncology_Billing:       "bg-emerald-400",
  Evaluation_Management:  "bg-blue-400",
  Radiology_Forensics:    "bg-violet-400",
  Cardiology_Forensics:   "bg-cyan-400",
  Anesthesia_Billing:     "bg-amber-400",
  Urology_Forensics:      "bg-orange-400",
  Home_Health_Upcoding:   "bg-rose-400",
  DME_Forensics:          "bg-indigo-400",
  Behavioral_Health:      "bg-teal-400",
};

const NICHE_TEXT: Record<string, string> = {
  MSK_Forensics:          "text-amber-400",
  Oncology_Billing:       "text-emerald-400",
  Evaluation_Management:  "text-blue-400",
  Radiology_Forensics:    "text-violet-400",
  Cardiology_Forensics:   "text-cyan-400",
  Anesthesia_Billing:     "text-amber-400",
  Urology_Forensics:      "text-orange-400",
  Home_Health_Upcoding:   "text-rose-400",
  DME_Forensics:          "text-indigo-400",
  Behavioral_Health:      "text-teal-400",
};

export function MobileStatsSheet({
  stats,
  queueRemaining,
  onGenerate,
  generating,
  auditorId,
}: MobileStatsSheetProps) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      api.downloadGoldJSONL();
      toast.success("Gold Standard JSONL download started");
    } catch {
      toast.error("Export failed");
    } finally {
      setTimeout(() => setDownloading(false), 2000);
    }
  };

  const approvalRate =
    stats && stats.verified > 0
      ? Math.round((stats.approved / stats.verified) * 100)
      : 0;

  return (
    <div className="h-full overflow-y-auto pb-20 px-4 pt-4 space-y-4">

      {/* Auditor badge */}
      <div className="flex items-center gap-3 bg-accent/40 border border-border rounded-xl px-4 py-3">
        <Shield className="w-4 h-4 text-primary flex-shrink-0" />
        <div>
          <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Auditor</p>
          <p className="font-mono text-sm font-bold text-foreground">{auditorId}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-mono text-xs text-emerald-400">ONLINE</span>
        </div>
      </div>

      {/* Queue stats — 2×2 grid */}
      <div>
        <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest mb-2">
          Queue Status
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Pending",  value: stats?.pending ?? queueRemaining, color: "text-amber-400",   icon: Clock },
            { label: "Verified", value: stats?.verified ?? 0,             color: "text-emerald-400", icon: CheckCircle2 },
            { label: "Approved", value: stats?.approved ?? 0,             color: "text-emerald-400", icon: CheckCircle2 },
            { label: "Denied",   value: stats?.denied ?? 0,               color: "text-destructive", icon: XCircle },
          ].map(({ label, value, color, icon: Icon }) => (
            <div key={label} className="bg-accent/30 border border-border/50 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Icon className={`w-3.5 h-3.5 ${color}`} />
                <span className="font-mono text-[10px] text-muted-foreground uppercase">{label}</span>
              </div>
              <span className={`font-mono text-2xl font-bold ${color}`}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Approval rate */}
      <div className="bg-accent/30 border border-border/50 rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-primary" />
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Approval Rate</span>
          </div>
          <span className="font-mono text-sm font-bold text-primary">{approvalRate}%</span>
        </div>
        <div className="h-2 bg-accent rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${approvalRate}%` }}
          />
        </div>
      </div>

      {/* Gold Standard value */}
      <div className="bg-primary/10 border border-primary/20 rounded-xl p-4">
        <div className="flex items-center gap-1.5 mb-2">
          <TrendingUp className="w-3.5 h-3.5 text-primary" />
          <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
            Gold Standard Dataset Value
          </p>
        </div>
        <p className="font-mono text-xl font-bold text-primary">
          ${stats?.gold_value_low?.toFixed(2) ?? "0.00"} – ${stats?.gold_value_high?.toFixed(2) ?? "0.00"}
        </p>
        <p className="font-mono text-xs text-muted-foreground mt-1">
          {stats?.verified ?? 0} verified traces × $1–$5 / trace (2026 Bittensor market)
        </p>
      </div>

      {/* Avg validator score */}
      <div className="flex items-center gap-3 bg-accent/30 border border-border/50 rounded-xl px-4 py-3">
        <Zap className="w-4 h-4 text-amber-400 flex-shrink-0" />
        <div>
          <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Avg LLM-as-Judge Score</p>
          <p className="font-mono text-lg font-bold text-amber-400">
            {stats?.avg_validator_score ?? 0}/100
          </p>
        </div>
        <div className="ml-auto">
          <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Vault Size</p>
          <p className="font-mono text-lg font-bold text-foreground">
            {stats?.total_in_vault ?? 0}
          </p>
        </div>
      </div>

      {/* Niche distribution */}
      {stats?.niche_distribution && Object.keys(stats.niche_distribution).length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Database className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
              Niche Distribution
            </p>
          </div>
          <div className="bg-accent/20 border border-border/50 rounded-xl p-3 space-y-2.5">
            {Object.entries(stats.niche_distribution)
              .sort(([, a], [, b]) => b - a)
              .map(([niche, count]) => {
                const total = stats.total_in_vault || 1;
                const pct = Math.round((count / total) * 100);
                const barColor = NICHE_COLORS[niche] || "bg-foreground";
                const textColor = NICHE_TEXT[niche] || "text-foreground";
                return (
                  <div key={niche}>
                    <div className="flex justify-between items-center mb-1">
                      <span className={`font-mono text-xs ${textColor}`}>
                        {niche.replace(/_/g, " ")}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {count} ({pct}%)
                      </span>
                    </div>
                    <div className="h-1.5 bg-accent rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${barColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="space-y-2 pb-4">
        <button
          onClick={onGenerate}
          disabled={generating}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl
                     border border-primary/40 bg-primary/10 text-primary
                     font-mono text-sm font-semibold
                     disabled:opacity-50 active:scale-98 transition-transform"
        >
          {generating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          Generate Traces
        </button>
        <button
          onClick={handleDownload}
          disabled={downloading || (stats?.verified ?? 0) === 0}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl
                     border border-emerald-500/40 bg-emerald-500/10 text-emerald-400
                     font-mono text-sm font-semibold
                     disabled:opacity-40 active:scale-98 transition-transform"
        >
          {downloading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          Export Gold JSONL
        </button>
      </div>
    </div>
  );
}
