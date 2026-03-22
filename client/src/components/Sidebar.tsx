/**
 * Sidebar — Left panel with stats, queue info, auditor ID, and controls
 * Design: Forensic Terminal dark sidebar
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { type Stats } from "@/lib/api";
import {
  Activity,
  Download,
  Loader2,
  Plus,
  Shield,
  Zap,
  CheckCircle2,
  XCircle,
  Clock,
  Database,
  TrendingUp,
} from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface SidebarProps {
  stats: Stats | null;
  queueRemaining: number;
  onGenerate: () => void;
  generating: boolean;
  auditorId: string;
}

const NICHE_COLORS: Record<string, string> = {
  MSK_Forensics: "text-amber-400",
  Oncology_Billing: "text-emerald-400",
  Evaluation_Management: "text-blue-400",
  Radiology_Forensics: "text-violet-400",
  Cardiology_Forensics: "text-emerald-400",
  Anesthesia_Billing: "text-amber-400",
  Urology_Forensics: "text-orange-400",
};

export function Sidebar({ stats, queueRemaining, onGenerate, generating, auditorId }: SidebarProps) {
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

  return (
    <aside className="w-72 flex-shrink-0 flex flex-col border-r border-border bg-sidebar overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="font-mono text-xs text-muted-foreground tracking-widest uppercase">
            Logic Refinery
          </span>
        </div>
        <h1 className="font-mono text-lg font-bold text-foreground leading-tight">
          HITL Validator
        </h1>
        <p className="font-mono text-xs text-muted-foreground mt-0.5">
          Bittensor Gold Standard Pipeline
        </p>
      </div>

      {/* Auditor Badge */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 bg-accent/50 rounded-md px-3 py-2">
          <Shield className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          <div>
            <p className="font-mono text-xs text-muted-foreground">AUDITOR</p>
            <p className="font-mono text-sm font-semibold text-foreground cursor-blink">{auditorId}</p>
          </div>
        </div>
      </div>

      {/* Queue Status */}
      <div className="px-4 py-3 border-b border-border">
        <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2">
          Queue Status
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-accent/30 rounded p-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Clock className="w-3 h-3 text-amber-400" />
              <span className="font-mono text-xs text-muted-foreground">Pending</span>
            </div>
            <span className="font-mono text-xl font-bold text-amber-400">
              {stats?.pending ?? queueRemaining}
            </span>
          </div>
          <div className="bg-accent/30 rounded p-2">
            <div className="flex items-center gap-1.5 mb-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span className="font-mono text-xs text-muted-foreground">Verified</span>
            </div>
            <span className="font-mono text-xl font-bold text-emerald-400">
              {stats?.verified ?? 0}
            </span>
          </div>
          <div className="bg-accent/30 rounded p-2">
            <div className="flex items-center gap-1.5 mb-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span className="font-mono text-xs text-muted-foreground">Approved</span>
            </div>
            <span className="font-mono text-lg font-bold text-emerald-400">
              {stats?.approved ?? 0}
            </span>
          </div>
          <div className="bg-accent/30 rounded p-2">
            <div className="flex items-center gap-1.5 mb-1">
              <XCircle className="w-3 h-3 text-destructive" />
              <span className="font-mono text-xs text-muted-foreground">Denied</span>
            </div>
            <span className="font-mono text-lg font-bold text-destructive">
              {stats?.denied ?? 0}
            </span>
          </div>
        </div>
      </div>

      {/* Gold Standard Value */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-1.5 mb-2">
          <TrendingUp className="w-3.5 h-3.5 text-primary" />
          <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
            Dataset Value
          </p>
        </div>
        <div className="bg-primary/10 border border-primary/20 rounded-md p-3">
          <p className="font-mono text-xs text-muted-foreground mb-1">Gold Standard (2026 Market)</p>
          <p className="font-mono text-base font-bold text-primary">
            ${stats?.gold_value_low?.toFixed(2) ?? "0.00"} – ${stats?.gold_value_high?.toFixed(2) ?? "0.00"}
          </p>
          <p className="font-mono text-xs text-muted-foreground mt-1">
            {stats?.verified ?? 0} verified × $1–$5/trace
          </p>
        </div>
      </div>

      {/* Niche Distribution */}
      {stats?.niche_distribution && Object.keys(stats.niche_distribution).length > 0 && (
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-1.5 mb-2">
            <Database className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
              Niche Distribution
            </p>
          </div>
          <div className="space-y-1.5">
            {Object.entries(stats.niche_distribution).map(([niche, count]) => {
              const total = stats.total_in_vault || 1;
              const pct = Math.round((count / total) * 100);
              const colorClass = NICHE_COLORS[niche] || "text-foreground";
              return (
                <div key={niche}>
                  <div className="flex justify-between items-center mb-0.5">
                    <span className={`font-mono text-xs ${colorClass}`}>
                      {niche.replace("_", " ")}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">{count}</span>
                  </div>
                  <div className="h-1 bg-accent rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${colorClass.replace("text-", "bg-")}`}
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
      <div className="px-4 py-3 mt-auto space-y-2">
        <Button
          onClick={onGenerate}
          disabled={generating}
          variant="outline"
          className="w-full font-mono text-xs border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/60"
        >
          {generating ? (
            <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
          ) : (
            <Plus className="w-3.5 h-3.5 mr-2" />
          )}
          Generate Traces
        </Button>
        <Button
          onClick={handleDownload}
          disabled={downloading || (stats?.verified ?? 0) === 0}
          variant="outline"
          className="w-full font-mono text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/60"
        >
          {downloading ? (
            <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5 mr-2" />
          )}
          Export Gold JSONL
        </Button>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border">
        <div className="flex items-center gap-2">
          <Activity className="w-3 h-3 text-emerald-400" />
          <span className="font-mono text-xs text-muted-foreground">
            Flask API: <span className="text-emerald-400">ONLINE</span>
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <Zap className="w-3 h-3 text-amber-400" />
          <span className="font-mono text-xs text-muted-foreground">
            Avg Score: <span className="text-amber-400">{stats?.avg_validator_score ?? 0}/100</span>
          </span>
        </div>
      </div>
    </aside>
  );
}
