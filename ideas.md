# Logic Refinery HITL — Design Ideas

<response>
<probability>0.07</probability>
<text>
**Design Movement:** Forensic Terminal / Cyberpunk Data Lab

**Core Principles:**
1. Dark-first, high-contrast — this is an internal auditor tool, not a consumer app
2. Data density over decoration — every pixel earns its place
3. Monospace + sans-serif tension — code feels real, labels feel clinical
4. Amber/green phosphor accents on near-black backgrounds

**Color Philosophy:**
- Background: deep charcoal `oklch(0.12 0.01 240)` — not pure black, has depth
- Surface cards: `oklch(0.17 0.015 240)` — slightly lifted
- Primary accent: amber `oklch(0.78 0.18 75)` — forensic yellow, "caution tape"
- Valid/Approve: emerald `oklch(0.72 0.19 162)` — green light
- Invalid/Deny: crimson `oklch(0.65 0.22 25)` — red flag
- Muted text: `oklch(0.55 0.01 240)` — secondary labels

**Layout Paradigm:**
- Asymmetric split: left 30% sidebar (pipeline status, stats, queue) + right 70% main validator card
- The validator card is centered in the right panel, large, swipeable
- Bottom action bar with keyboard shortcuts (← Deny, → Approve, ↑ Skip)

**Signature Elements:**
1. Blinking cursor on trace_id labels — terminal authenticity
2. Stage progress bar styled as a pipeline flowchart (4 nodes connected by lines)
3. Chain-of-thought rendered as numbered terminal output lines with `>` prefix

**Interaction Philosophy:**
- Keyboard-first: J/K or arrow keys to navigate, A/D or Enter to approve/deny
- Card flip animation reveals the full chain_of_thought on the back
- Swipe gesture support for touch devices

**Animation:**
- Card entrance: slide up from bottom with slight scale (0.95 → 1.0, 300ms ease-out)
- Approve: card flies right with green tint overlay
- Deny: card flies left with red tint overlay
- Pipeline stage transitions: left-to-right fill animation

**Typography System:**
- Display/Headers: `JetBrains Mono` — monospace, technical authority
- Body/Labels: `Inter` at 400/500 — clean readability
- Trace content: `JetBrains Mono` at 13px — code-like fidelity
</text>
</response>

**CHOSEN:** Forensic Terminal / Cyberpunk Data Lab — dark charcoal background, amber forensic accents, monospace typography, asymmetric sidebar + card layout.
