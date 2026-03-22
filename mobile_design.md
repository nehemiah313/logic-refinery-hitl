# Logic Refinery HITL — Mobile-First Design Philosophy

## Design Movement: Forensic Terminal × Native Mobile

The existing desktop design is strong — dark, amber-accented, monospace forensic terminal.
The mobile redesign must preserve that identity while making every interaction thumb-native.

---

## Core Principles

1. **Thumb Zone First** — All primary actions (Approve / Deny / Skip) live in the bottom 40% of the screen, reachable with one thumb. No reaching to the top.
2. **Progressive Disclosure** — Show only what the auditor needs to make a decision. Medical narrative + CPT codes + final decision are always visible. Chain of thought, logic trace, and NCCI citation are behind a single tap to expand.
3. **Swipe as Primary Verb** — Right = Approve (green), Left = Deny (red). The gesture is the action. Buttons are secondary confirmation, not the primary path.
4. **Single Column, Full Bleed** — No sidebars. The card fills the screen width. Navigation is a bottom tab bar (iOS/Android native pattern).
5. **Density Control** — Monospace text is kept small but legible (12px minimum). Section headers use uppercase tracking to create visual separation without consuming vertical space.

---

## Layout Architecture

### Mobile (< 768px)
```
┌─────────────────────────┐
│  Header: Logo + Queue # │  ← 48px fixed top bar
├─────────────────────────┤
│                         │
│   TRACE CARD            │  ← Scrollable, fills remaining height
│   (swipeable)           │
│                         │
│   [Niche] [OIG] [Stage] │
│   Trace ID / Node       │
│   Score meter           │
│   ─────────────────     │
│   CPT codes + ICD-10    │
│   ─────────────────     │
│   Regulatory Axiom ▼    │  ← Collapsed by default
│   ─────────────────     │
│   Medical Narrative     │
│   ─────────────────     │
│   AI Decision           │
│   Financial Impact      │
│   ─────────────────     │
│   CoT (2 steps) ▼       │  ← Collapsed by default
│   Logic Trace ▼         │  ← Collapsed by default
│                         │
├─────────────────────────┤
│  [✗ DENY] [→] [✓ APPROVE] │  ← Fixed thumb-zone action bar (72px)
├─────────────────────────┤
│  [Validate] [Cluster] [Export] │  ← Bottom tab nav (56px)
└─────────────────────────┘
```

### Desktop (≥ 768px)
```
┌──────────┬──────────────────────────┐
│          │  Header                  │
│ Sidebar  ├──────────────────────────┤
│ (Stats + │                          │
│  Nodes)  │  TRACE CARD              │
│          │                          │
│          ├──────────────────────────┤
│          │  Action Bar              │
└──────────┴──────────────────────────┘
```

---

## Signature Elements

1. **Swipe Gesture with Haptic-style Visual Feedback** — As the card tilts left/right, a color wash (red/green) bleeds in from the edge with the DENY/APPROVE stamp appearing at 30% threshold.
2. **Floating Action Bar** — The Deny/Skip/Approve buttons are in a pill-shaped floating bar pinned above the bottom nav, with a subtle frosted glass background.
3. **Compact Score Ring** — Replace the horizontal score bar with a small circular ring indicator in the card header (more space-efficient on mobile).
4. **Pull-to-Refresh** — Pull down on the card stack to load new traces from the backend.

---

## Touch Interaction Philosophy

- **Swipe threshold**: 80px horizontal drag triggers the decision
- **Drag feedback**: Card rotates slightly (max 8deg) and translates as user drags
- **Release**: If past threshold → commit decision with animation. If not → spring back.
- **Tap to expand**: All secondary sections (CoT, Logic Trace, NCCI Citation) expand inline on tap, no modal required.

---

## Color / Typography (unchanged from desktop)

- Background: `oklch(0.10 0.008 265)` — near-black with slight blue tint
- Card: `oklch(0.14 0.006 265)` — slightly lighter
- Primary accent: amber `oklch(0.78 0.15 75)`
- Approve: emerald `oklch(0.65 0.18 155)`
- Deny: destructive red `oklch(0.62 0.22 25)`
- Font: JetBrains Mono (monospace) for codes/traces, system-ui for narrative text

## Selected Approach: Option A — Native Mobile Terminal
Full commitment to the thumb-zone layout with touch swipe, bottom nav, and floating action bar.
