/**
 * BottomNav — Mobile bottom tab navigation bar
 * Design: Forensic Terminal × Native Mobile — frosted glass pill tabs
 * Tabs: Validator (HITL) | Cluster Monitor | Load Balancer | Stats & Export
 */
import { ShieldCheck, Network, BarChart3, Scale, Activity } from "lucide-react";

export type ActiveTab = "validator" | "cluster" | "balancer" | "stats" | "eval";

interface BottomNavProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  queueRemaining: number;
}

const TABS: {
  id: ActiveTab;
  label: string;
  Icon: React.FC<{ className?: string }>;
}[] = [
  { id: "validator", label: "Validate", Icon: ShieldCheck },
  { id: "cluster",   label: "Cluster",  Icon: Network },
  { id: "balancer",  label: "Balancer", Icon: Scale },
  { id: "stats",     label: "Stats",    Icon: BarChart3 },
  { id: "eval",      label: "Eval",     Icon: Activity },
];

export function BottomNav({ activeTab, onTabChange, queueRemaining }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur-md
                    pb-safe">
      <div className="flex items-stretch h-14">
        {TABS.map(({ id, label, Icon }) => {
          const isActive = activeTab === id;
          const showBadge = id === "validator" && queueRemaining > 0;

          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 relative
                          transition-colors active:scale-95
                          ${isActive
                            ? id === "balancer" ? "text-amber-400" : "text-primary"
                            : "text-muted-foreground hover:text-foreground"
                          }`}
            >
              {/* Active indicator line */}
              {isActive && (
                <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full ${
                  id === "balancer" ? "bg-amber-400" : "bg-primary"
                }`} />
              )}

              <div className="relative">
                <Icon className={`w-5 h-5 transition-transform ${isActive ? "scale-110" : ""}`} />
                {showBadge && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full
                                   bg-primary text-primary-foreground font-mono text-[9px] font-bold
                                   flex items-center justify-center leading-none">
                    {queueRemaining > 99 ? "99+" : queueRemaining}
                  </span>
                )}
              </div>

              <span className={`font-mono text-[10px] leading-none transition-colors
                                ${isActive
                                  ? id === "balancer" ? "text-amber-400 font-semibold" : "text-primary font-semibold"
                                  : "text-muted-foreground"
                                }`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
