/**
 * Logic Refinery HITL — Main Page
 * Design: Forensic Terminal / Cyberpunk Data Lab
 * Layout: Asymmetric sidebar (left 28%) + tabbed main area (right 72%)
 * Tabs: Validator (HITL card queue) | Cluster Monitor (7-node dashboard)
 */
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { api, type Trace, type Stats } from "@/lib/api";
import { Sidebar } from "@/components/Sidebar";
import { ValidatorCard } from "@/components/ValidatorCard";
import { PipelineDiagram } from "@/components/PipelineDiagram";
import { StatsPanel } from "@/components/StatsPanel";
import { EmptyQueue } from "@/components/EmptyQueue";
import { NodeMonitor } from "@/components/NodeMonitor";
import { Loader2, ShieldCheck, Network } from "lucide-react";

type ActiveTab = "validator" | "cluster";

export default function Home() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [swipeDirection, setSwipeDirection] = useState<"left" | "right" | null>(null);
  const [auditorId] = useState("aud_001");
  const [generating, setGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("validator");

  const loadData = useCallback(async () => {
    try {
      const [tracesRes, statsRes] = await Promise.all([
        api.getPendingTraces(20),
        api.getStats(),
      ]);
      setTraces(tracesRes.traces);
      setStats(statsRes);
      setCurrentIndex(0);
    } catch {
      toast.error("Failed to connect to Logic Refinery backend. Is Flask running on port 5001?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Keyboard shortcuts (only active on validator tab)
  useEffect(() => {
    if (activeTab !== "validator") return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight" || e.key === "a" || e.key === "A") handleDecision("approve");
      if (e.key === "ArrowLeft" || e.key === "d" || e.key === "D") handleDecision("deny");
      if (e.key === "ArrowUp" || e.key === "s" || e.key === "S") handleDecision("skip");
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentIndex, traces, activeTab]);

  const handleDecision = useCallback(
    async (decision: "approve" | "deny" | "skip") => {
      const trace = traces[currentIndex];
      if (!trace) return;

      setSwipeDirection(decision === "approve" ? "right" : "left");

      setTimeout(async () => {
        try {
          const res = await api.verifyTrace({
            trace_id: trace.trace_id,
            decision,
            auditor_id: auditorId,
          });

          if (decision === "approve") {
            toast.success(`✓ Approved — ${res.gold_standard_count} Gold traces total`, {
              style: { borderLeft: "3px solid oklch(0.72 0.19 162)" },
            });
          } else if (decision === "deny") {
            toast.error(`✗ Denied — trace flagged`, {
              style: { borderLeft: "3px solid oklch(0.65 0.22 25)" },
            });
          } else {
            toast.info(`→ Skipped`);
          }

          setSwipeDirection(null);
          setCurrentIndex((prev) => prev + 1);

          const newStats = await api.getStats();
          setStats(newStats);
        } catch {
          setSwipeDirection(null);
          toast.error("Failed to submit decision. Check backend connection.");
        }
      }, 400);
    },
    [traces, currentIndex, auditorId]
  );

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await api.generateTraces(5);
      toast.success(`Generated ${res.generated} new traces via Phi-4-Mini pipeline`);
      await loadData();
    } catch {
      toast.error("Failed to generate traces.");
    } finally {
      setGenerating(false);
    }
  };

  const currentTrace = traces[currentIndex];
  const queueRemaining = traces.length - currentIndex;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Left Sidebar */}
      <Sidebar
        stats={stats}
        queueRemaining={queueRemaining}
        onGenerate={handleGenerate}
        generating={generating}
        auditorId={auditorId}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Pipeline Diagram */}
        <PipelineDiagram stats={stats} />

        {/* Tab Bar */}
        <div className="flex border-b border-border bg-card/30">
          <button
            onClick={() => setActiveTab("validator")}
            className={`flex items-center gap-2 px-5 py-2.5 font-mono text-xs transition-all border-b-2 ${
              activeTab === "validator"
                ? "border-primary text-primary bg-primary/5"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/30"
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            HITL Validator
            {queueRemaining > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/20 text-primary font-bold text-xs">
                {queueRemaining}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("cluster")}
            className={`flex items-center gap-2 px-5 py-2.5 font-mono text-xs transition-all border-b-2 ${
              activeTab === "cluster"
                ? "border-primary text-primary bg-primary/5"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/30"
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            Cluster Monitor
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-accent/50 text-muted-foreground font-bold text-xs">
              7 nodes
            </span>
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === "validator" ? (
          <>
            {/* Validator Area */}
            <div className="flex-1 flex items-center justify-center p-6 overflow-hidden relative">
              {/* Scanlines overlay */}
              <div className="absolute inset-0 scanlines pointer-events-none opacity-30" />

              {loading ? (
                <div className="flex flex-col items-center gap-4 text-muted-foreground">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <p className="font-mono text-sm">Initializing Logic Refinery...</p>
                </div>
              ) : !currentTrace ? (
                <EmptyQueue onGenerate={handleGenerate} generating={generating} />
              ) : (
                <div className="w-full max-w-2xl">
                  {/* Queue indicator */}
                  <div className="flex items-center justify-between mb-3 px-1">
                    <span className="font-mono text-xs text-muted-foreground">
                      QUEUE: {queueRemaining} remaining
                    </span>
                    <div className="flex gap-1">
                      {Array.from({ length: Math.min(queueRemaining, 8) }).map((_, i) => (
                        <div
                          key={i}
                          className={`h-1 rounded-full transition-all ${
                            i === 0 ? "w-6 bg-primary" : "w-2 bg-border"
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  <ValidatorCard
                    trace={currentTrace}
                    swipeDirection={swipeDirection}
                    onApprove={() => handleDecision("approve")}
                    onDeny={() => handleDecision("deny")}
                    onSkip={() => handleDecision("skip")}
                  />

                  {/* Keyboard hints */}
                  <div className="flex items-center justify-center gap-6 mt-4 text-muted-foreground">
                    <span className="font-mono text-xs flex items-center gap-1.5">
                      <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border text-[10px]">←</kbd>
                      Deny
                    </span>
                    <span className="font-mono text-xs flex items-center gap-1.5">
                      <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border text-[10px]">↑</kbd>
                      Skip
                    </span>
                    <span className="font-mono text-xs flex items-center gap-1.5">
                      Approve
                      <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border text-[10px]">→</kbd>
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Stats Bar */}
            <StatsPanel stats={stats} />
          </>
        ) : (
          <div className="flex-1 overflow-hidden">
            <NodeMonitor />
          </div>
        )}
      </main>
    </div>
  );
}
