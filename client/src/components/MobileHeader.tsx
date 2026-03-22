/**
 * MobileHeader — Compact top bar for mobile
 * Design: Forensic Terminal × Native Mobile
 * Shows: Logo, live queue count, auditor badge, API status dot
 * Priority 2: Eval regression alert banner — polls /api/eval/report and shows red/amber/green threshold
 */
import { useState, useEffect } from "react";
import { type Stats } from "@/lib/api";
import { Activity, Shield, AlertTriangle, CheckCircle2, XCircle, FlaskConical } from "lucide-react";

const API_BASE = "http://localhost:5001";
const EVAL_THRESHOLD_FAIL = 85;
const EVAL_THRESHOLD_WARN = 92;
const POLL_INTERVAL_MS = 60_000; // poll every 60 seconds

interface EvalStatus {
  composite_score: number;
  pass_rate: number;
  passed: number;
  total_examples: number;
  run_at: string | null;
}

interface MobileHeaderProps {
  stats: Stats | null;
  queueRemaining: number;
  auditorId: string;
}

function EvalAlertBanner({ evalStatus }: { evalStatus: EvalStatus | null }) {
  if (!evalStatus || !evalStatus.run_at) return null;

  const score = evalStatus.composite_score;
  const isFail = score < EVAL_THRESHOLD_FAIL;
  const isWarn = score >= EVAL_THRESHOLD_FAIL && score < EVAL_THRESHOLD_WARN;
  const isPass = score >= EVAL_THRESHOLD_WARN;

  if (isPass) return null; // No banner needed when healthy

  return (
    <div
      className={`flex items-center gap-2 px-4 py-1.5 text-xs font-mono border-b
        ${isFail
          ? "bg-destructive/15 border-destructive/30 text-destructive"
          : "bg-amber-500/15 border-amber-500/30 text-amber-400"
        }`}
    >
      {isFail ? (
        <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
      ) : (
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
      )}
      <span className="font-semibold">
        {isFail ? "EVAL REGRESSION" : "EVAL WARNING"}
      </span>
      <span className="text-[10px] opacity-80">
        Composite {score.toFixed(1)}% — {evalStatus.passed}/{evalStatus.total_examples} passing
        {isFail ? " — BELOW 85% FLOOR" : " — below 92% target"}
      </span>
    </div>
  );
}

export function MobileHeader({ stats, queueRemaining, auditorId }: MobileHeaderProps) {
  const [evalStatus, setEvalStatus] = useState<EvalStatus | null>(null);

  useEffect(() => {
    async function fetchEvalStatus() {
      try {
        const res = await fetch(`${API_BASE}/api/eval/report`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.composite_score !== undefined) {
          setEvalStatus({
            composite_score: data.composite_score,
            pass_rate: data.pass_rate,
            passed: data.passed,
            total_examples: data.total_examples,
            run_at: data.run_at ?? null,
          });
        }
      } catch {
        // Backend not available — silently skip
      }
    }

    fetchEvalStatus();
    const interval = setInterval(fetchEvalStatus, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const evalScore = evalStatus?.composite_score ?? null;
  const evalColor =
    evalScore === null ? "text-muted-foreground" :
    evalScore < EVAL_THRESHOLD_FAIL ? "text-destructive" :
    evalScore < EVAL_THRESHOLD_WARN ? "text-amber-400" :
    "text-emerald-400";

  return (
    <div>
      {/* Eval Regression Alert Banner */}
      <EvalAlertBanner evalStatus={evalStatus} />

      {/* Main Header Bar */}
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

        {/* Right: Eval score pill + Auditor + API status */}
        <div className="flex items-center gap-2">
          {/* Eval score mini-indicator */}
          {evalScore !== null && (
            <div className={`flex items-center gap-1 bg-accent/40 rounded-full px-2 py-0.5 border border-border`}>
              <FlaskConical className={`w-2.5 h-2.5 flex-shrink-0 ${evalColor}`} />
              <span className={`font-mono text-[10px] font-bold ${evalColor}`}>
                {evalScore.toFixed(0)}%
              </span>
            </div>
          )}

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
    </div>
  );
}
