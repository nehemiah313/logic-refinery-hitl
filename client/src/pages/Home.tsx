/**
 * Logic Refinery HITL — Main Page
 * Design: Forensic Terminal × Native Mobile
 * Mobile: Bottom tab nav, full-bleed card, thumb-zone action bar (no sidebar)
 * Desktop: Left sidebar + tabbed main area (preserved)
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
import LoadBalancerPanel from "@/components/LoadBalancerPanel";
import { MobileHeader } from "@/components/MobileHeader";
import { BottomNav, type ActiveTab } from "@/components/BottomNav";
import { MobileStatsSheet } from "@/components/MobileStatsSheet";
import {
  Loader2,
  ShieldCheck,
  Network,
  CheckCircle2,
  XCircle,
  SkipForward,
  Scale,
} from "lucide-react";

// ActiveTab is imported from BottomNav to keep a single source of truth

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

  // Keyboard shortcuts (only active on validator tab, desktop)
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

      {/* ── DESKTOP SIDEBAR (hidden on mobile) ── */}
      <div className="hidden md:flex">
        <Sidebar
          stats={stats}
          queueRemaining={queueRemaining}
          onGenerate={handleGenerate}
          generating={generating}
          auditorId={auditorId}
        />
      </div>

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Mobile Header (hidden on desktop) */}
        <div className="md:hidden">
          <MobileHeader
            stats={stats}
            queueRemaining={queueRemaining}
            auditorId={auditorId}
          />
        </div>

        {/* Desktop Pipeline Diagram (hidden on mobile) */}
        <div className="hidden md:block">
          <PipelineDiagram stats={stats} />
        </div>

        {/* Desktop Tab Bar (hidden on mobile) */}
        <div className="hidden md:flex border-b border-border bg-card/30">
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
          <button
            onClick={() => setActiveTab("balancer")}
            className={`flex items-center gap-2 px-5 py-2.5 font-mono text-xs transition-all border-b-2 ${
              activeTab === "balancer"
                ? "border-amber-500 text-amber-400 bg-amber-500/5"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/30"
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            Load Balancer
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-bold text-xs">
              Scout / Refiner
            </span>
          </button>
        </div>

        {/* ── TAB CONTENT ── */}
        {/* On mobile: activeTab drives what's shown; desktop uses same logic */}
        {(activeTab === "validator") && (
          <>
            {/* Validator Area */}
            <div className="flex-1 flex flex-col overflow-hidden relative">
              {/* Scanlines overlay */}
              <div className="absolute inset-0 scanlines pointer-events-none opacity-20" />

              {loading ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <p className="font-mono text-sm">Initializing Logic Refinery...</p>
                </div>
              ) : !currentTrace ? (
                <div className="flex-1 flex items-center justify-center p-4">
                  <EmptyQueue onGenerate={handleGenerate} generating={generating} />
                </div>
              ) : (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Queue progress bar — mobile-friendly */}
                  <div className="px-4 pt-3 pb-1 flex items-center justify-between">
                    <span className="font-mono text-xs text-muted-foreground">
                      {queueRemaining} remaining
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

                  {/* Scrollable card area */}
                  <div className="flex-1 overflow-y-auto px-3 pb-2">
                    <ValidatorCard
                      trace={currentTrace}
                      swipeDirection={swipeDirection}
                      onApprove={() => handleDecision("approve")}
                      onDeny={() => handleDecision("deny")}
                      onSkip={() => handleDecision("skip")}
                      hideActionButtons={true}
                    />
                  </div>

                  {/* ── THUMB-ZONE ACTION BAR (always visible, pinned above bottom nav) ── */}
                  <div className="relative z-10 px-4 py-3 border-t border-border bg-background/95 backdrop-blur-sm
                                  md:hidden">
                    <div className="flex items-center gap-3 max-w-sm mx-auto">
                      <button
                        onClick={() => handleDecision("deny")}
                        className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl
                                   border-2 border-destructive/50 bg-destructive/10 text-destructive
                                   active:scale-95 transition-transform font-mono text-sm font-bold
                                   hover:bg-destructive/20"
                      >
                        <XCircle className="w-5 h-5" />
                        DENY
                      </button>
                      <button
                        onClick={() => handleDecision("skip")}
                        className="flex items-center justify-center w-12 h-12 rounded-xl
                                   border border-border bg-accent/30 text-muted-foreground
                                   active:scale-95 transition-transform"
                      >
                        <SkipForward className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => handleDecision("approve")}
                        className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl
                                   border-2 border-emerald-500/50 bg-emerald-500/10 text-emerald-400
                                   active:scale-95 transition-transform font-mono text-sm font-bold
                                   hover:bg-emerald-500/20"
                      >
                        <CheckCircle2 className="w-5 h-5" />
                        APPROVE
                      </button>
                    </div>
                  </div>

                  {/* Desktop keyboard hints + action buttons (shown inside card on desktop) */}
                  <div className="hidden md:flex items-center justify-center gap-6 py-3 text-muted-foreground">
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

            {/* Desktop Bottom Stats Bar */}
            <div className="hidden md:block">
              <StatsPanel stats={stats} />
            </div>
          </>
        )}

        {activeTab === "cluster" && (
          <div className="flex-1 overflow-hidden">
            <NodeMonitor />
          </div>
        )}

        {activeTab === "balancer" && (
          <div className="flex-1 overflow-y-auto">
            <LoadBalancerPanel />
          </div>
        )}

        {activeTab === "stats" && (
          <div className="flex-1 overflow-hidden md:hidden">
            <MobileStatsSheet
              stats={stats}
              queueRemaining={queueRemaining}
              onGenerate={handleGenerate}
              generating={generating}
              auditorId={auditorId}
            />
          </div>
        )}
      </main>

      {/* ── BOTTOM NAV (mobile only) ── */}
      <div className="md:hidden">
        <BottomNav
          activeTab={activeTab}
          onTabChange={setActiveTab}
          queueRemaining={queueRemaining}
        />
      </div>
    </div>
  );
}
