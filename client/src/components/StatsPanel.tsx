/**
 * StatsPanel — Bottom status bar with live statistics
 * Design: Forensic Terminal — compact dark bar
 */
import { type Stats } from "@/lib/api";
import { Activity, Zap, Shield } from "lucide-react";

interface StatsPanelProps {
  stats: Stats | null;
}

export function StatsPanel({ stats }: StatsPanelProps) {
  const approvalRate =
    stats && stats.verified > 0
      ? Math.round((stats.approved / stats.verified) * 100)
      : 0;

  return (
    <div className="border-t border-border bg-card/50 px-6 py-2 flex items-center gap-6">
      <div className="flex items-center gap-1.5">
        <Activity className="w-3 h-3 text-emerald-400" />
        <span className="font-mono text-xs text-muted-foreground">
          Vault: <span className="text-foreground font-semibold">{stats?.total_in_vault ?? 0}</span> traces
        </span>
      </div>
      <div className="w-px h-3 bg-border" />
      <div className="flex items-center gap-1.5">
        <Shield className="w-3 h-3 text-amber-400" />
        <span className="font-mono text-xs text-muted-foreground">
          Gold Standard: <span className="text-amber-400 font-semibold">{stats?.verified ?? 0}</span> verified
        </span>
      </div>
      <div className="w-px h-3 bg-border" />
      <div className="flex items-center gap-1.5">
        <Zap className="w-3 h-3 text-primary" />
        <span className="font-mono text-xs text-muted-foreground">
          Approval Rate: <span className="text-primary font-semibold">{approvalRate}%</span>
        </span>
      </div>
      <div className="ml-auto">
        <span className="font-mono text-xs text-muted-foreground">
          Bittensor Subnet Ready •{" "}
          <span className="text-emerald-400">
            {stats?.verified ?? 0} × $1–$5 = ${stats?.gold_value_low?.toFixed(2) ?? "0.00"}–${stats?.gold_value_high?.toFixed(2) ?? "0.00"}
          </span>
        </span>
      </div>
    </div>
  );
}
