/**
 * NodeMonitor — Live cluster dashboard showing all 7 worker nodes
 * Design: Forensic Terminal × Native Mobile
 * Mobile: Single-column node list, compact queue stats, collapsible setup panel
 * Desktop: 2-column node grid (preserved)
 */
import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import {
  Cpu,
  Wifi,
  WifiOff,
  Loader2,
  Clock,
  AlertTriangle,
  Play,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface NodeInfo {
  node_id: string;
  ip: string;
  model: string;
  status: "idle" | "working" | "stale" | "offline";
  online: boolean;
  registered_at: string;
  last_seen: string;
  jobs_completed: number;
  traces_submitted: number;
  current_job: string | null;
  errors: number;
  seconds_since_seen: number;
}

interface JobQueueStats {
  total_jobs: number;
  queued: number;
  in_progress: number;
  completed: number;
  failed: number;
}

interface JobEntry {
  job_id: string;
  assigned_to: string;
  niche: string;
  status: string;
  created_at: string;
  traces_requested: number;
}

const STATUS_CONFIG = {
  idle:    { color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", dot: "bg-emerald-400",                  label: "IDLE" },
  working: { color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/30",   dot: "bg-amber-400 animate-pulse",       label: "WORKING" },
  stale:   { color: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/30",  dot: "bg-orange-400",                    label: "STALE" },
  offline: { color: "text-muted-foreground", bg: "bg-accent/20", border: "border-border",          dot: "bg-muted-foreground",              label: "OFFLINE" },
};

function NodeCard({ node }: { node: NodeInfo }) {
  const cfg = STATUS_CONFIG[node.status] || STATUS_CONFIG.offline;
  const seenAgo = node.seconds_since_seen < 60
    ? `${node.seconds_since_seen}s ago`
    : node.seconds_since_seen < 3600
    ? `${Math.floor(node.seconds_since_seen / 60)}m ago`
    : "offline";

  return (
    <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-3 transition-all`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
          <span className="font-mono text-sm font-bold text-foreground">{node.node_id}</span>
        </div>
        <span className={`font-mono text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.border} ${cfg.color}`}>
          {cfg.label}
        </span>
      </div>

      {/* IP + Model — single row on mobile */}
      <div className="flex items-center gap-3 mb-2">
        <div className="flex items-center gap-1">
          {node.online
            ? <Wifi className="w-3 h-3 text-emerald-400" />
            : <WifiOff className="w-3 h-3 text-muted-foreground" />
          }
          <span className="font-mono text-xs text-muted-foreground">{node.ip || "—"}</span>
        </div>
        <div className="flex items-center gap-1">
          <Cpu className="w-3 h-3 text-muted-foreground" />
          <span className="font-mono text-xs text-muted-foreground">{node.model}</span>
        </div>
      </div>

      {/* Active job */}
      {node.current_job && (
        <div className="flex items-center gap-1.5 mb-2 bg-amber-500/10 rounded-lg px-2.5 py-1.5">
          <Loader2 className="w-3 h-3 text-amber-400 animate-spin flex-shrink-0" />
          <span className="font-mono text-xs text-amber-400 truncate">{node.current_job}</span>
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center justify-between border-t border-border/50 pt-2">
        <div className="flex items-center gap-3">
          <div>
            <p className="font-mono text-[10px] text-muted-foreground">Jobs</p>
            <p className="font-mono text-sm font-bold text-foreground">{node.jobs_completed}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] text-muted-foreground">Traces</p>
            <p className="font-mono text-sm font-bold text-foreground">{node.traces_submitted}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Clock className="w-2.5 h-2.5" />
          <span className="font-mono text-[10px]">{seenAgo}</span>
        </div>
      </div>
    </div>
  );
}

export function NodeMonitor() {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [queueStats, setQueueStats] = useState<JobQueueStats | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showJobs, setShowJobs] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [nodesRes, queueRes] = await Promise.all([
        fetch("http://localhost:5001/api/nodes").then(r => r.json()),
        fetch("http://localhost:5001/api/jobs/queue").then(r => r.json()),
      ]);
      setNodes(nodesRes.nodes || []);
      setQueueStats(queueRes.stats || null);
      setRecentJobs((queueRes.jobs || []).slice(0, 10));
    } catch {
      // Backend may not be running
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleDispatch = async () => {
    setDispatching(true);
    try {
      const res = await fetch("http://localhost:5001/api/jobs/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ traces_per_node: 5 }),
      });
      const data = await res.json();
      toast.success(`Dispatched ${data.jobs_created} jobs to worker nodes`);
      await refresh();
    } catch {
      toast.error("Failed to dispatch jobs. Is the backend running?");
    } finally {
      setDispatching(false);
    }
  };

  const onlineCount = nodes.filter(n => n.online).length;
  const workingCount = nodes.filter(n => n.status === "working").length;

  const displayNodes = nodes.length > 0
    ? nodes
    : Array.from({ length: 7 }, (_, i) => ({
        node_id: `node_0${i + 1}`,
        ip: "—",
        model: "phi4-mini",
        status: "offline" as const,
        online: false,
        registered_at: "",
        last_seen: "",
        jobs_completed: 0,
        traces_submitted: 0,
        current_job: null,
        errors: 0,
        seconds_since_seen: 9999,
      }));

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-card/50">
        <div>
          <h2 className="font-mono text-sm font-bold text-foreground">Cluster Monitor</h2>
          <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
            {onlineCount}/{displayNodes.length} online
            {workingCount > 0 && ` · ${workingCount} generating`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={refresh}
            variant="outline"
            size="sm"
            className="font-mono text-xs border-border text-muted-foreground hover:text-foreground h-8 w-8 p-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button
            onClick={handleDispatch}
            disabled={dispatching}
            size="sm"
            className="font-mono text-xs bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-3"
          >
            {dispatching ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            <span className="ml-1.5 hidden sm:inline">Dispatch</span>
          </Button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-20">

        {/* Queue Stats — 2×2 on mobile, 4-col on desktop */}
        {queueStats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: "Queued",  value: queueStats.queued,      color: "text-amber-400",   icon: Clock },
              { label: "Running", value: queueStats.in_progress, color: "text-blue-400",    icon: Activity },
              { label: "Done",    value: queueStats.completed,   color: "text-emerald-400", icon: CheckCircle2 },
              { label: "Failed",  value: queueStats.failed,      color: "text-destructive", icon: XCircle },
            ].map(({ label, value, color, icon: Icon }) => (
              <div key={label} className="bg-accent/30 border border-border/50 rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className={`w-3 h-3 ${color}`} />
                  <p className="font-mono text-[10px] text-muted-foreground uppercase">{label}</p>
                </div>
                <p className={`font-mono text-xl font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Node Grid — single column on mobile, 2-col on sm+ */}
        <div>
          <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest mb-2">
            Worker Nodes — 7 × i5 / 8GB / Phi-4-Mini
          </p>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="font-mono text-xs">Loading node status...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {displayNodes.map(node => (
                <NodeCard key={node.node_id} node={node} />
              ))}
            </div>
          )}
        </div>

        {/* Setup Instructions — collapsible on mobile */}
        {nodes.length === 0 && (
          <div className="bg-accent/20 border border-border rounded-xl overflow-hidden">
            <button
              onClick={() => setShowSetup(!showSetup)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <p className="font-mono text-xs font-semibold text-amber-400">No nodes connected yet</p>
              </div>
              {showSetup
                ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                : <ChevronDown className="w-4 h-4 text-muted-foreground" />
              }
            </button>
            {showSetup && (
              <div className="px-4 pb-4">
                <p className="font-mono text-xs text-muted-foreground mb-3">
                  Run this on each i5 worker (replace X with 01–07):
                </p>
                <div className="bg-background rounded-lg p-3 border border-border overflow-x-auto">
                  <code className="font-mono text-xs text-emerald-400 block whitespace-pre">{`python3 worker_client.py \\
  --node-id node_0X \\
  --orchestrator http://YOUR_IP:5001`}</code>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Recent Jobs — collapsible */}
        {recentJobs.length > 0 && (
          <div>
            <button
              onClick={() => setShowJobs(!showJobs)}
              className="flex items-center justify-between w-full mb-2"
            >
              <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
                Recent Jobs ({recentJobs.length})
              </p>
              {showJobs
                ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              }
            </button>
            {showJobs && (
              <div className="space-y-1.5">
                {recentJobs.map(job => (
                  <div
                    key={job.job_id}
                    className="flex items-center justify-between bg-accent/20 rounded-lg px-3 py-2 border border-border/50"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        job.status === "completed"  ? "bg-emerald-400" :
                        job.status === "in_progress"? "bg-amber-400 animate-pulse" :
                        job.status === "failed"     ? "bg-destructive" :
                        "bg-muted-foreground"
                      }`} />
                      <span className="font-mono text-xs text-foreground truncate">
                        {job.niche?.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      <span className="font-mono text-[10px] text-muted-foreground">{job.assigned_to}</span>
                      <span className={`font-mono text-[10px] ${
                        job.status === "completed"  ? "text-emerald-400" :
                        job.status === "in_progress"? "text-amber-400" :
                        "text-muted-foreground"
                      }`}>
                        {job.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
