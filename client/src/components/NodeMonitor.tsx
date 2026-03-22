/**
 * NodeMonitor — Live cluster dashboard showing all 7 worker nodes
 * Design: Forensic Terminal — dark grid with per-node status indicators
 */
import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import {
  Cpu,
  Wifi,
  WifiOff,
  Activity,
  Loader2,
  Zap,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Play,
  RefreshCw,
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
  idle: { color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", dot: "bg-emerald-400", label: "IDLE" },
  working: { color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", dot: "bg-amber-400 animate-pulse", label: "WORKING" },
  stale: { color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30", dot: "bg-orange-400", label: "STALE" },
  offline: { color: "text-muted-foreground", bg: "bg-accent/20", border: "border-border", dot: "bg-muted-foreground", label: "OFFLINE" },
};

function NodeCard({ node }: { node: NodeInfo }) {
  const cfg = STATUS_CONFIG[node.status] || STATUS_CONFIG.offline;
  const seenAgo = node.seconds_since_seen < 60
    ? `${node.seconds_since_seen}s ago`
    : node.seconds_since_seen < 3600
    ? `${Math.floor(node.seconds_since_seen / 60)}m ago`
    : "offline";

  return (
    <div className={`rounded-lg border ${cfg.border} ${cfg.bg} p-3 transition-all`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
          <span className="font-mono text-sm font-bold text-foreground">{node.node_id}</span>
        </div>
        <span className={`font-mono text-xs ${cfg.color} stage-badge ${cfg.bg} border ${cfg.border}`}>
          {cfg.label}
        </span>
      </div>

      {/* IP + Model */}
      <div className="space-y-1 mb-2">
        <div className="flex items-center gap-1.5">
          {node.online ? (
            <Wifi className="w-3 h-3 text-emerald-400 flex-shrink-0" />
          ) : (
            <WifiOff className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          )}
          <span className="font-mono text-xs text-muted-foreground">{node.ip || "—"}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Cpu className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          <span className="font-mono text-xs text-muted-foreground">{node.model}</span>
        </div>
      </div>

      {/* Current job */}
      {node.current_job && (
        <div className="flex items-center gap-1.5 mb-2 bg-amber-500/10 rounded px-2 py-1">
          <Loader2 className="w-3 h-3 text-amber-400 animate-spin flex-shrink-0" />
          <span className="font-mono text-xs text-amber-400 truncate">{node.current_job}</span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-1 border-t border-border/50 pt-2 mt-1">
        <div>
          <p className="font-mono text-xs text-muted-foreground">Jobs Done</p>
          <p className="font-mono text-sm font-bold text-foreground">{node.jobs_completed}</p>
        </div>
        <div>
          <p className="font-mono text-xs text-muted-foreground">Traces</p>
          <p className="font-mono text-sm font-bold text-foreground">{node.traces_submitted}</p>
        </div>
      </div>

      {/* Last seen */}
      <div className="flex items-center gap-1 mt-1.5">
        <Clock className="w-2.5 h-2.5 text-muted-foreground" />
        <span className="font-mono text-xs text-muted-foreground">Last seen: {seenAgo}</span>
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
    const interval = setInterval(refresh, 15000); // refresh every 15s
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

  // Show placeholder nodes if none registered yet
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
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="font-mono text-base font-bold text-foreground">Cluster Monitor</h2>
          <p className="font-mono text-xs text-muted-foreground mt-0.5">
            {onlineCount}/{displayNodes.length} nodes online
            {workingCount > 0 && ` · ${workingCount} generating`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={refresh}
            variant="outline"
            size="sm"
            className="font-mono text-xs border-border text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button
            onClick={handleDispatch}
            disabled={dispatching}
            size="sm"
            className="font-mono text-xs bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {dispatching ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 mr-1.5" />
            )}
            Dispatch Cycle
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Queue Stats */}
        {queueStats && (
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Queued", value: queueStats.queued, color: "text-amber-400" },
              { label: "Running", value: queueStats.in_progress, color: "text-blue-400" },
              { label: "Done", value: queueStats.completed, color: "text-emerald-400" },
              { label: "Failed", value: queueStats.failed, color: "text-destructive" },
            ].map(stat => (
              <div key={stat.label} className="bg-accent/30 rounded-lg p-2 text-center">
                <p className="font-mono text-xs text-muted-foreground">{stat.label}</p>
                <p className={`font-mono text-lg font-bold ${stat.color}`}>{stat.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Node Grid */}
        <div>
          <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2">
            Worker Nodes (7 × i5 / 8GB / Phi-4-Mini)
          </p>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="font-mono text-xs">Loading node status...</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {displayNodes.map(node => (
                <NodeCard key={node.node_id} node={node} />
              ))}
            </div>
          )}
        </div>

        {/* Setup Instructions (shown when no nodes are registered) */}
        {nodes.length === 0 && (
          <div className="bg-accent/20 border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <p className="font-mono text-xs font-semibold text-amber-400">No nodes connected yet</p>
            </div>
            <p className="font-mono text-xs text-muted-foreground mb-3">
              Run this command on each i5 worker node:
            </p>
            <div className="bg-background rounded p-3 border border-border">
              <code className="font-mono text-xs text-emerald-400 block">
                # On each worker machine (replace X with 01-07)
              </code>
              <code className="font-mono text-xs text-foreground block mt-1">
                python3 worker_client.py \
              </code>
              <code className="font-mono text-xs text-foreground block pl-4">
                --node-id node_0X \
              </code>
              <code className="font-mono text-xs text-foreground block pl-4">
                --orchestrator http://YOUR_IP:5001
              </code>
            </div>
          </div>
        )}

        {/* Recent Jobs */}
        {recentJobs.length > 0 && (
          <div>
            <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2">
              Recent Jobs
            </p>
            <div className="space-y-1">
              {recentJobs.map(job => (
                <div
                  key={job.job_id}
                  className="flex items-center justify-between bg-accent/20 rounded px-3 py-1.5 border border-border/50"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      job.status === "completed" ? "bg-emerald-400" :
                      job.status === "in_progress" ? "bg-amber-400 animate-pulse" :
                      job.status === "failed" ? "bg-destructive" :
                      "bg-muted-foreground"
                    }`} />
                    <span className="font-mono text-xs text-muted-foreground truncate">{job.job_id}</span>
                    <span className="font-mono text-xs text-foreground truncate">{job.niche?.replace("_", " ")}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="font-mono text-xs text-muted-foreground">{job.assigned_to}</span>
                    <span className={`font-mono text-xs ${
                      job.status === "completed" ? "text-emerald-400" :
                      job.status === "in_progress" ? "text-amber-400" :
                      "text-muted-foreground"
                    }`}>
                      {job.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
