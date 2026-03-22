/**
 * ValidatorCard — The main Tinder-style trace review card
 * Design: Forensic Terminal — dark card with amber accents, monospace trace content
 * Schema: Gold Standard v2.1 — includes ncci_citation, oig_priority, logic_trace, financial_impact gate
 * Priority 2: Approve with Edit — inline editing of CPT codes, ICD-10, NCCI citation, financial impact
 */
import { useState } from "react";
import { type Trace } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  XCircle,
  SkipForward,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Cpu,
  Hash,
  AlertTriangle,
  BookOpen,
  Brain,
  ShieldAlert,
  Pencil,
  X,
  Plus,
  Trash2,
  Save,
} from "lucide-react";

interface ValidatorCardProps {
  trace: Trace;
  swipeDirection: "left" | "right" | null;
  onApprove: (edits?: TraceEdits) => void;
  onDeny: () => void;
  onSkip: () => void;
  /** When true, hides the in-card action buttons (used on mobile where the thumb-zone bar handles actions) */
  hideActionButtons?: boolean;
}

/** Editable fields that an auditor can correct before approving */
export interface TraceEdits {
  cpt_codes?: string[];
  icd10?: string;
  ncci_citation?: string;
  financial_impact?: number;
  auditor_note?: string;
}

const NICHE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  MSK_Forensics:         { bg: "bg-amber-500/10",   text: "text-amber-400",   border: "border-amber-500/30" },
  Oncology_Billing:      { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" },
  Evaluation_Management: { bg: "bg-blue-500/10",    text: "text-blue-400",    border: "border-blue-500/30" },
  Radiology_Forensics:   { bg: "bg-violet-500/10",  text: "text-violet-400",  border: "border-violet-500/30" },
  Cardiology_Forensics:  { bg: "bg-cyan-500/10",    text: "text-cyan-400",    border: "border-cyan-500/30" },
  Anesthesia_Billing:    { bg: "bg-amber-500/10",   text: "text-amber-400",   border: "border-amber-500/30" },
  Urology_Forensics:     { bg: "bg-orange-500/10",  text: "text-orange-400",  border: "border-orange-500/30" },
  Home_Health_Upcoding:  { bg: "bg-rose-500/10",    text: "text-rose-400",    border: "border-rose-500/30" },
  DME_Forensics:         { bg: "bg-indigo-500/10",  text: "text-indigo-400",  border: "border-indigo-500/30" },
  Behavioral_Health:     { bg: "bg-teal-500/10",    text: "text-teal-400",    border: "border-teal-500/30" },
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

/** Financial Impact Gate — warns auditor if financial_impact is $0 or missing */
function FinancialImpactGate({
  impact,
  onConfirm,
  onCancel,
}: {
  impact: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/90 backdrop-blur-sm rounded-xl">
      <div className="mx-4 rounded-xl border border-amber-500/50 bg-amber-500/10 p-5 max-w-sm w-full shadow-xl">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-mono text-sm font-bold text-amber-400 mb-1">
              Zero Financial Impact Detected
            </p>
            <p className="font-mono text-xs text-muted-foreground leading-relaxed">
              This trace reports{" "}
              <span className="text-amber-400 font-semibold">
                ${Math.abs(impact).toFixed(2)} financial impact
              </span>
              . Low-value traces reduce Gold Standard dataset quality.
            </p>
            <p className="font-mono text-xs text-muted-foreground mt-2 leading-relaxed">
              Are you sure this trace is worth verifying?
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={onCancel}
            variant="outline"
            className="flex-1 font-mono text-xs border-border text-muted-foreground hover:bg-accent/50"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            className="flex-1 font-mono text-xs bg-amber-600 hover:bg-amber-500 text-white border-0"
          >
            Approve Anyway
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Inline Edit Panel — shown when auditor clicks "Approve with Edit" */
function InlineEditPanel({
  trace,
  onSaveAndApprove,
  onCancel,
}: {
  trace: Trace;
  onSaveAndApprove: (edits: TraceEdits) => void;
  onCancel: () => void;
}) {
  const [cptCodes, setCptCodes] = useState<string[]>([...trace.cpt_codes]);
  const [icd10, setIcd10] = useState(trace.icd10 ?? "");
  const [ncciCitation, setNcciCitation] = useState(trace.ncci_citation ?? "");
  const [financialImpact, setFinancialImpact] = useState(String(trace.financial_impact ?? 0));
  const [auditorNote, setAuditorNote] = useState("");
  const [newCpt, setNewCpt] = useState("");

  function addCpt() {
    const code = newCpt.trim().toUpperCase();
    if (code && !cptCodes.includes(code)) {
      setCptCodes([...cptCodes, code]);
      setNewCpt("");
    }
  }

  function removeCpt(code: string) {
    setCptCodes(cptCodes.filter((c) => c !== code));
  }

  function handleSave() {
    const edits: TraceEdits = {};
    if (JSON.stringify(cptCodes) !== JSON.stringify(trace.cpt_codes)) edits.cpt_codes = cptCodes;
    if (icd10 !== (trace.icd10 ?? "")) edits.icd10 = icd10;
    if (ncciCitation !== (trace.ncci_citation ?? "")) edits.ncci_citation = ncciCitation;
    const fi = parseFloat(financialImpact);
    if (!isNaN(fi) && fi !== (trace.financial_impact ?? 0)) edits.financial_impact = fi;
    if (auditorNote.trim()) edits.auditor_note = auditorNote.trim();
    onSaveAndApprove(edits);
  }

  return (
    <div className="absolute inset-0 z-20 overflow-y-auto bg-background/97 backdrop-blur-sm rounded-xl">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-primary" />
            <span className="font-mono text-sm font-bold text-primary">Approve with Edit</span>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="font-mono text-xs text-muted-foreground leading-relaxed border-l-2 border-primary/40 pl-3">
          Correct any fields below before approving. Only changed fields are recorded as auditor edits in the Gold Standard trace.
        </p>

        {/* CPT Codes */}
        <div>
          <label className="font-mono text-xs text-muted-foreground uppercase tracking-wider block mb-2">
            CPT Codes
          </label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {cptCodes.map((code) => (
              <span
                key={code}
                className="flex items-center gap-1 font-mono text-xs font-semibold px-2 py-0.5 rounded
                           bg-primary/10 text-primary border border-primary/30"
              >
                {code}
                <button
                  onClick={() => removeCpt(code)}
                  className="hover:text-destructive transition-colors ml-0.5"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newCpt}
              onChange={(e) => setNewCpt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCpt()}
              placeholder="Add CPT code..."
              className="flex-1 font-mono text-xs bg-accent/30 border border-border rounded px-2 py-1.5
                         text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
            />
            <button
              onClick={addCpt}
              className="px-2 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary
                         hover:bg-primary/20 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* ICD-10 */}
        <div>
          <label className="font-mono text-xs text-muted-foreground uppercase tracking-wider block mb-2">
            ICD-10 Code
          </label>
          <input
            value={icd10}
            onChange={(e) => setIcd10(e.target.value.toUpperCase())}
            placeholder="e.g. M17.11"
            className="w-full font-mono text-xs bg-accent/30 border border-border rounded px-2 py-1.5
                       text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
          />
        </div>

        {/* NCCI Citation */}
        <div>
          <label className="font-mono text-xs text-muted-foreground uppercase tracking-wider block mb-2">
            NCCI Citation
          </label>
          <textarea
            value={ncciCitation}
            onChange={(e) => setNcciCitation(e.target.value)}
            rows={2}
            placeholder="e.g. 2026 NCCI Ch. IV §E — Column 2 edit..."
            className="w-full font-mono text-xs bg-accent/30 border border-border rounded px-2 py-1.5
                       text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50
                       resize-none leading-relaxed"
          />
        </div>

        {/* Financial Impact */}
        <div>
          <label className="font-mono text-xs text-muted-foreground uppercase tracking-wider block mb-2">
            Financial Impact ($)
          </label>
          <input
            type="number"
            value={financialImpact}
            onChange={(e) => setFinancialImpact(e.target.value)}
            placeholder="0.00"
            className="w-full font-mono text-xs bg-accent/30 border border-border rounded px-2 py-1.5
                       text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
          />
        </div>

        {/* Auditor Note */}
        <div>
          <label className="font-mono text-xs text-muted-foreground uppercase tracking-wider block mb-2">
            Auditor Note <span className="normal-case text-muted-foreground/60">(optional)</span>
          </label>
          <textarea
            value={auditorNote}
            onChange={(e) => setAuditorNote(e.target.value)}
            rows={2}
            placeholder="Reason for correction..."
            className="w-full font-mono text-xs bg-accent/30 border border-border rounded px-2 py-1.5
                       text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50
                       resize-none leading-relaxed"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button
            onClick={onCancel}
            variant="outline"
            className="flex-1 font-mono text-xs border-border text-muted-foreground hover:bg-accent/50"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            className="flex-1 font-mono text-xs bg-emerald-600 hover:bg-emerald-500 text-white border-0"
          >
            <Save className="w-3.5 h-3.5 mr-1.5" />
            Save & Approve
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ValidatorCard({ trace, swipeDirection, onApprove, onDeny, onSkip, hideActionButtons = false }: ValidatorCardProps) {
  const [showFullCot, setShowFullCot] = useState(false);
  const [showLogicTrace, setShowLogicTrace] = useState(false);
  const [showImpactGate, setShowImpactGate] = useState(false);
  const [showEditPanel, setShowEditPanel] = useState(false);

  const nicheStyle = NICHE_STYLES[trace.niche] || { bg: "bg-accent/30", text: "text-foreground", border: "border-border" };
  const isPositiveImpact = (trace.financial_impact ?? 0) > 0;
  const isNeutral = (trace.financial_impact ?? 0) === 0;
  const isLowValue = Math.abs(trace.financial_impact ?? 0) < 50;

  const animClass = swipeDirection === "right"
    ? "card-swipe-right"
    : swipeDirection === "left"
    ? "card-swipe-left"
    : "card-enter";

  function handleApproveClick() {
    if (isNeutral || isLowValue) {
      setShowImpactGate(true);
    } else {
      onApprove();
    }
  }

  function handleApproveWithEdit() {
    setShowEditPanel(true);
  }

  // Parse logic_trace: strip <think> tags for display
  const rawLogicTrace = trace.logic_trace ?? "";
  const logicTraceContent = rawLogicTrace
    .replace(/<think>\n?/, "")
    .replace(/\n?<\/think>/, "")
    .trim();

  return (
    <div
      className={`relative rounded-xl border border-border bg-card overflow-hidden ${animClass}`}
      style={{
        boxShadow: "0 4px 32px oklch(0 0 0 / 40%), 0 1px 0 oklch(1 0 0 / 5%) inset",
      }}
    >
      {/* Financial Impact Gate Overlay */}
      {showImpactGate && (
        <FinancialImpactGate
          impact={trace.financial_impact ?? 0}
          onConfirm={() => { setShowImpactGate(false); onApprove(); }}
          onCancel={() => setShowImpactGate(false)}
        />
      )}

      {/* Approve with Edit Panel */}
      {showEditPanel && (
        <InlineEditPanel
          trace={trace}
          onSaveAndApprove={(edits) => { setShowEditPanel(false); onApprove(edits); }}
          onCancel={() => setShowEditPanel(false)}
        />
      )}

      {/* Swipe overlays */}
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
                {trace.niche.replace(/_/g, " ")}
              </span>
              {trace.oig_priority && (
                <span className="stage-badge bg-rose-500/15 text-rose-400 border border-rose-500/30 flex items-center gap-1">
                  <ShieldAlert className="w-2.5 h-2.5" />
                  OIG Priority
                </span>
              )}
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

      {/* NCCI Citation — Gold Standard v2.1 */}
      {trace.ncci_citation && (
        <div className="px-5 py-2.5 border-b border-border bg-primary/5">
          <div className="flex items-start gap-2">
            <BookOpen className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />
            <p className="font-mono text-xs text-primary/80 leading-relaxed">
              <span className="text-primary font-semibold">Regulatory Axiom: </span>
              {trace.ncci_citation}
            </p>
          </div>
        </div>
      )}

      {/* Medical Narrative */}
      <div className="px-5 py-3 border-b border-border">
        <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2">
          Medical Narrative
        </p>
        <p className="text-sm text-foreground leading-relaxed">
          {trace.medical_narrative}
        </p>
      </div>

      {/* Logic Trace (<think> block) — collapsible */}
      {logicTraceContent && (
        <div className="px-5 py-3 border-b border-border bg-accent/10">
          <button
            onClick={() => setShowLogicTrace(!showLogicTrace)}
            className="flex items-center justify-between w-full mb-2 group"
          >
            <div className="flex items-center gap-2">
              <Brain className="w-3.5 h-3.5 text-primary/70 group-hover:text-primary transition-colors" />
              <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider group-hover:text-primary transition-colors">
                Logic Trace &lt;think&gt; Block
              </p>
            </div>
            {showLogicTrace ? (
              <ChevronUp className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
            )}
          </button>

          {showLogicTrace && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 overflow-x-auto">
              <pre className="font-mono text-xs text-primary/80 leading-relaxed whitespace-pre-wrap">
                {logicTraceContent}
              </pre>
            </div>
          )}
        </div>
      )}

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

      {/* Final Decision + Financial Impact */}
      <div className="px-5 py-3 border-b border-border bg-accent/10">
        <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2">
          AI Decision
        </p>
        <p className="font-mono text-sm font-semibold text-foreground leading-relaxed">
          {trace.final_decision}
        </p>

        {/* Financial Impact with low-value warning */}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <DollarSign className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <span className="font-mono text-xs text-muted-foreground">Financial Impact:</span>
          <span className={`font-mono text-sm font-bold ${
            isNeutral ? "text-muted-foreground" :
            isPositiveImpact ? "text-emerald-400" : "text-amber-400"
          }`}>
            {isNeutral
              ? "$0.00 (No overbilling)"
              : isPositiveImpact
              ? `+$${(trace.financial_impact ?? 0).toFixed(2)} recovered`
              : `$${Math.abs(trace.financial_impact ?? 0).toFixed(2)} adjustment`
            }
          </span>
          {(isNeutral || isLowValue) && !isNeutral && (
            <span className="flex items-center gap-1 font-mono text-xs text-amber-400/70">
              <AlertTriangle className="w-3 h-3" />
              Low value
            </span>
          )}
          {isNeutral && (
            <span className="flex items-center gap-1 font-mono text-xs text-amber-400/70">
              <AlertTriangle className="w-3 h-3" />
              Will trigger approval gate
            </span>
          )}
        </div>
      </div>

      {/* Action Buttons — hidden on mobile (thumb-zone bar handles it) */}
      <div className={`px-5 py-4 flex flex-col gap-2 ${hideActionButtons ? "hidden md:flex" : "flex"}`}>
        {/* Primary row: Deny | Skip | Approve */}
        <div className="flex items-center gap-3">
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
            onClick={handleApproveClick}
            className="flex-1 font-mono text-sm bg-emerald-600 hover:bg-emerald-500 text-white border-0 glow-valid transition-all"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Approve
          </Button>
        </div>
        {/* Secondary row: Approve with Edit */}
        <Button
          onClick={handleApproveWithEdit}
          variant="outline"
          className="w-full font-mono text-xs border-primary/30 text-primary/80 hover:bg-primary/10 hover:border-primary/60 hover:text-primary transition-all"
        >
          <Pencil className="w-3.5 h-3.5 mr-2" />
          Approve with Edit
          <span className="ml-2 text-muted-foreground/60 text-[10px]">— correct CPT / ICD-10 / NCCI before approving</span>
        </Button>
      </div>
    </div>
  );
}
