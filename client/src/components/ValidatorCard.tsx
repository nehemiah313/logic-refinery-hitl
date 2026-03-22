/**
 * ValidatorCard — The main Tinder-style trace review card
 * Design: Forensic Terminal — dark card with amber accents, monospace trace content
 */
import { useState } from "react";
import { type Trace } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  SkipForward,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Cpu,
  Hash,
} from "lucide-react";

interface ValidatorCardProps {
  trace: Trace;
  swipeDirection: "left" | "right" | null;
  onApprove: () => void;
  onDeny: () => void;
  onSkip: () => void;
}

const NICHE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  MSK_Forensics: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30" },
  Oncology_Billing: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" },
  Evaluation_Management: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30" },
  Radiology_Forensics: { bg: "bg-violet-500/10", text: "text-violet-400", border: "border-violet-500/30" },
  Cardiology_Forensics: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" },
  Anesthesia_Billing: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30" },
  Urology_Forensics: { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/30" },
};

function ScoreMeter({ score }: { score: number }) {
  const color = score >= 95 ? "bg-emerald-400" : score >= 85 ? "bg-amber-400" : "bg-destructive";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-accent rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={`font-mono text-xs font-bold ${
        score >= 95 ? "text-emerald-400" : score >= 85 ? "text-amber-400" : "text-destructive"
      }`}>
        {score}/100
      </span>
    </div>
  );
}

export function ValidatorCard({ trace, swipeDirection, onApprove, onDeny, onSkip }: ValidatorCardProps) {
  const [showFullCot, setShowFullCot] = useState(false);
  const nicheStyle = NICHE_STYLES[trace.niche] || { bg: "bg-accent/30", text: "text-foreground", border: "border-border" };
  const isPositiveImpact = trace.financial_impact > 0;
  const isNeutral = trace.financial_impact === 0;

  const animClass = swipeDirection === "right"
    ? "card-swipe-right"
    : swipeDirection === "left"
    ? "card-swipe-left"
    : "card-enter";

  return (
    <div
      className={`relative rounded-xl border border-border bg-card overflow-hidden ${animClass}`}
      style={{
        boxShadow: "0 4px 32px oklch(0 0 0 / 40%), 0 1px 0 oklch(1 0 0 / 5%) inset",
      }}
    >
      {/* Swipe overlay */}
      {swipeDirection === "right" && (
        <div className="absolute inset-0 bg-emerald-500/20 z-10 flex items-center justify-center rounded-xl border-2 border-emerald-500/60 glow-valid">
          <div className="flex items-center gap-2 bg-emerald-500/30 px-4 py-2 rounded-full">
            <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            <span className="font-mono font-bold text-emerald-400 text-lg">APPROVED</span>
          </div>
        </div>
      )}
      {swipeDirection === "left" && (
        <div className="absolute inset-0 bg-destructive/20 z-10 flex items-center justify-center rounded-xl border-2 border-destructive/60 glow-deny">
          <div className="flex items-center gap-2 bg-destructive/30 px-4 py-2 rounded-full">
            <XCircle className="w-6 h-6 text-destructive" />
            <span className="font-mono font-bold text-destructive text-lg">DENIED</span>
          </div>
        </div>
      )}

      {/* Card Header */}
      <div className="px-5 pt-4 pb-3 border-b border-border">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className={`stage-badge ${nicheStyle.bg} ${nicheStyle.text} border ${nicheStyle.border}`}>
                {trace.niche.replace("_", " ")}
              </span>
              <span className="stage-badge bg-accent/50 text-muted-foreground border border-border">
                Stage 4 — HITL
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Hash className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span className="font-mono text-xs text-muted-foreground cursor-blink">
                {trace.trace_id}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="font-mono text-xs text-muted-foreground">{trace.node}</span>
          </div>
        </div>

        {/* Validator Score */}
        <div className="mt-2.5">
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono text-xs text-muted-foreground">LLM-as-Judge Score</span>
          </div>
          <ScoreMeter score={trace.validator_score} />
        </div>
      </div>

      {/* CPT Codes + ICD-10 */}
      <div className="px-5 py-3 border-b border-border bg-accent/20">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="font-mono text-xs text-muted-foreground">CPT:</span>
          {trace.cpt_codes.map((code, i) => (
            <span
              key={i}
              className={`font-mono text-xs font-semibold px-2 py-0.5 rounded ${nicheStyle.bg} ${nicheStyle.text} border ${nicheStyle.border}`}
            >
              {code}
            </span>
          ))}
          {trace.icd10 && (
            <>
              <span className="font-mono text-xs text-muted-foreground ml-1">ICD-10:</span>
              <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-accent/50 text-foreground border border-border">
                {trace.icd10}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Medical Narrative */}
      <div className="px-5 py-3 border-b border-border">
        <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2">
          Medical Narrative
        </p>
        <p className="text-sm text-foreground leading-relaxed">
          {trace.medical_narrative}
        </p>
      </div>

      {/* Chain of Thought */}
      <div className="px-5 py-3 border-b border-border">
        <button
          onClick={() => setShowFullCot(!showFullCot)}
          className="flex items-center justify-between w-full mb-2 group"
        >
          <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider group-hover:text-primary transition-colors">
            Chain of Thought ({trace.chain_of_thought.length} steps)
          </p>
          {showFullCot ? (
            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
          )}
        </button>

        <div className={`space-y-1.5 overflow-hidden transition-all ${showFullCot ? "" : "max-h-20"}`}>
          {trace.chain_of_thought.map((step, i) => (
            <div key={i} className="flex gap-2">
              <span className="font-mono text-xs text-primary flex-shrink-0 mt-0.5">›</span>
              <p className="font-mono text-xs text-muted-foreground leading-relaxed">{step}</p>
            </div>
          ))}
        </div>

        {!showFullCot && trace.chain_of_thought.length > 2 && (
          <p className="font-mono text-xs text-primary/60 mt-1">
            +{trace.chain_of_thought.length - 2} more steps...
          </p>
        )}
      </div>

      {/* Final Decision */}
      <div className="px-5 py-3 border-b border-border bg-accent/10">
        <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2">
          AI Decision
        </p>
        <p className="font-mono text-sm font-semibold text-foreground leading-relaxed">
          {trace.final_decision}
        </p>

        {/* Financial Impact */}
        <div className="flex items-center gap-2 mt-2">
          <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-mono text-xs text-muted-foreground">Financial Impact:</span>
          <span className={`font-mono text-sm font-bold ${
            isNeutral ? "text-muted-foreground" :
            isPositiveImpact ? "text-emerald-400" : "text-amber-400"
          }`}>
            {isNeutral
              ? "$0.00 (No overbilling)"
              : isPositiveImpact
              ? `+$${trace.financial_impact.toFixed(2)} recovered`
              : `$${Math.abs(trace.financial_impact).toFixed(2)} adjustment`
            }
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="px-5 py-4 flex items-center gap-3">
        <Button
          onClick={onDeny}
          variant="outline"
          className="flex-1 font-mono text-sm border-destructive/40 text-destructive hover:bg-destructive/10 hover:border-destructive/70 glow-deny transition-all"
        >
          <XCircle className="w-4 h-4 mr-2" />
          Deny
        </Button>
        <Button
          onClick={onSkip}
          variant="outline"
          className="font-mono text-sm px-4 border-border text-muted-foreground hover:bg-accent/50"
        >
          <SkipForward className="w-4 h-4" />
        </Button>
        <Button
          onClick={onApprove}
          className="flex-1 font-mono text-sm bg-emerald-600 hover:bg-emerald-500 text-white border-0 glow-valid transition-all"
        >
          <CheckCircle2 className="w-4 h-4 mr-2" />
          Approve
        </Button>
      </div>
    </div>
  );
}
