/**
 * MobileHeader — Compact top bar for mobile
 * Design: Forensic Terminal × Native Mobile
 * Shows: Logo, live queue count, auditor badge, API status dot
 */
import { type Stats } from "@/lib/api";
import { Activity, Shield } from "lucide-react";

interface MobileHeaderProps {
  stats: Stats | null;
  queueRemaining: number;
  auditorId: string;
}

export function MobileHeader({ stats, queueRemaining, auditorId }: MobileHeaderProps) {
  return (
    <header className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/80 backdrop-blur-sm">
      {/* Left: Logo + status */}
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-primary animate-pulse flex-shrink-0" />
        <div>
          <p className="font-mono text-xs font-bold text-foreground leading-none">Logic Refinery</p>
          <p className="font-mono text-[10px] text-muted-foreground leading-none mt-0.5">HITL Validator</p>
        </div>
      </div>

      {/* Center: Queue badge */}
      {queueRemaining > 0 && (
        <div className="flex items-center gap-1.5 bg-primary/10 border border-primary/20 rounded-full px-3 py-1">
          <span className="font-mono text-xs font-bold text-primary">{queueRemaining}</span>
          <span className="font-mono text-[10px] text-primary/70">in queue</span>
        </div>
      )}

      {/* Right: Auditor + API status */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 bg-accent/50 rounded-full px-2.5 py-1">
          <Shield className="w-3 h-3 text-primary flex-shrink-0" />
          <span className="font-mono text-xs text-foreground">{auditorId}</span>
        </div>
        <div className="flex items-center gap-1">
          <Activity className="w-3 h-3 text-emerald-400" />
          <span className="font-mono text-[10px] text-emerald-400">
            {stats ? "LIVE" : "—"}
          </span>
        </div>
      </div>
    </header>
  );
}
