/**
 * PipelineDiagram — Top bar showing the 4-stage pipeline status
 * Design: Forensic Terminal — horizontal pipeline with node indicators
 */
import { type Stats } from "@/lib/api";
import { Brain, Database, Cpu, UserCheck, ArrowRight } from "lucide-react";

interface PipelineDiagramProps {
  stats: Stats | null;
}

const STAGES = [
  {
    id: 1,
    label: "Stage 1",
    name: "Neural",
    desc: "Phi-4-Mini",
    icon: Brain,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    key: "stage_1_neural" as const,
  },
  {
    id: 2,
    label: "Stage 2",
    name: "Augment",
    desc: "GCP ML Baseline",
    icon: Database,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    key: "stage_2_augment" as const,
  },
  {
    id: 3,
    label: "Stage 3",
    name: "Judge",
    desc: "Llama 3.1 8B",
    icon: Cpu,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
    key: "stage_3_judge" as const,
  },
  {
    id: 4,
    label: "Stage 4",
    name: "HITL",
    desc: "Human Auditor",
    icon: UserCheck,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    key: "stage_4_hitl_complete" as const,
  },
];

export function PipelineDiagram({ stats }: PipelineDiagramProps) {
  return (
    <div className="border-b border-border bg-card/50 px-6 py-3">
      <div className="flex items-center gap-1">
        {STAGES.map((stage, i) => {
          const Icon = stage.icon;
          const count = stats?.pipeline_stages?.[stage.key] ?? 0;
          const isActive = stage.id === 4;

          return (
            <div key={stage.id} className="flex items-center gap-1">
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md border transition-all ${
                  isActive
                    ? `${stage.bg} ${stage.border} ${stage.color}`
                    : "bg-accent/20 border-border text-muted-foreground"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? stage.color : "text-muted-foreground"}`} />
                <div>
                  <p className="font-mono text-xs font-semibold leading-none">{stage.name}</p>
                  <p className="font-mono text-xs text-muted-foreground leading-none mt-0.5">{stage.desc}</p>
                </div>
                <span className={`font-mono text-xs font-bold ml-1 ${isActive ? stage.color : "text-muted-foreground"}`}>
                  {count}
                </span>
              </div>
              {i < STAGES.length - 1 && (
                <ArrowRight className="w-3.5 h-3.5 text-border flex-shrink-0" />
              )}
            </div>
          );
        })}

        {/* Right side: total impact */}
        <div className="ml-auto flex items-center gap-3">
          <div className="text-right">
            <p className="font-mono text-xs text-muted-foreground">Financial Impact Captured</p>
            <p className="font-mono text-sm font-bold text-emerald-400">
              ${(stats?.total_financial_impact_usd ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
