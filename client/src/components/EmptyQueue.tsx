/**
 * EmptyQueue — Shown when all pending traces have been reviewed
 * Design: Forensic Terminal — terminal-style completion screen
 */
import { Button } from "@/components/ui/button";
import { CheckCircle2, Plus, Loader2 } from "lucide-react";

interface EmptyQueueProps {
  onGenerate: () => void;
  generating: boolean;
}

export function EmptyQueue({ onGenerate, generating }: EmptyQueueProps) {
  return (
    <div className="flex flex-col items-center gap-6 text-center max-w-sm">
      {/* Terminal-style icon */}
      <div className="relative">
        <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center glow-valid">
          <CheckCircle2 className="w-8 h-8 text-emerald-400" />
        </div>
        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-background" />
      </div>

      <div>
        <h2 className="font-mono text-lg font-bold text-foreground mb-1">
          Queue Complete
        </h2>
        <p className="font-mono text-sm text-muted-foreground leading-relaxed">
          All pending traces have been reviewed. Generate a new batch from the Phi-4-Mini pipeline to continue.
        </p>
      </div>

      {/* Terminal output */}
      <div className="w-full bg-accent/30 border border-border rounded-lg p-4 text-left">
        <p className="font-mono text-xs text-emerald-400 mb-2">$ logic_refinery --status</p>
        <p className="font-mono text-xs text-muted-foreground">
          <span className="text-primary">›</span> Pipeline: <span className="text-emerald-400">IDLE</span>
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          <span className="text-primary">›</span> Queue: <span className="text-amber-400">EMPTY</span>
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          <span className="text-primary">›</span> Status: <span className="text-emerald-400">READY FOR NEW BATCH</span>
        </p>
        <p className="font-mono text-xs text-muted-foreground mt-2 cursor-blink">
          Awaiting next generation cycle...
        </p>
      </div>

      <Button
        onClick={onGenerate}
        disabled={generating}
        className="font-mono text-sm bg-primary text-primary-foreground hover:bg-primary/90 glow-amber"
      >
        {generating ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Plus className="w-4 h-4 mr-2" />
        )}
        Generate New Traces
      </Button>
    </div>
  );
}
