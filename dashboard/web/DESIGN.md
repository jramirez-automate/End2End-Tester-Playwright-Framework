# E2E Control — visual identities

Four themes share one token set; components use only the tokens, so every view
works in all of them. Picked in Settings → Appearance, stored per browser
(`src/theme.ts`), written as `data-theme` on `<html>` — the id is also the daisyUI
theme name, and `index.html` applies it before first paint. Tokens and per-theme
effects live in `src/styles.css`; the `@theme` block holds Matrix as the base.

## Token roles (every theme)

| Token | Role |
|---|---|
| `--ink-0` / `--ink-1` / `--ink-2` | page / panels / raised cards |
| `--line` | hairline borders |
| `--bone` | primary text |
| `--putty` | secondary text — the contrast floor (≥4.5:1 on ink-0/1 in every theme) |
| `--tally` | ON AIR lamp — Playwright executing right now |
| `--ok` `--fault` `--standby` `--feed` | pass / fail / gate or waiting on you / Claude or in-flight activity |

Rules: signal colors appear only on state indicators (lamps, LED segments, status
chips, gate banners) — never as button chrome or decoration. Every colored dot also
says its state in text (visible or `sr-only`). Never apply opacity modifiers
(`/60`…) to text colors. Type roles: **display** (headings, UPPERCASE eyebrows),
**body**, **mono** (anything live or countable: ids, counts, clocks, log lines).

## Matrix (default)

A phosphor terminal: **digital rain** (`components/DigitalRain.tsx`, a fixed canvas
under the app at 22% opacity, ~14fps, paused while hidden, one still frame under
reduced motion), CRT scanlines, phosphor glow, square corners, a blinking `_` after
the wordmark. Panels are slightly translucent so rain reads in the gaps, never
behind text. Type: Share Tech Mono / IBM Plex Mono.
Palette: ink `#000400`, text `#8cff9e`, putty `#4cc76a`, ok `#00ff41`, fault
`#ff3b3b`, standby `#ffd23f`, feed `#3fe0ff`, tally `#d8ffde` (white-hot lead glyph).

## Retro

1970s print, light: cream stock (`#f1e4c3` page, `#fbf3dc` panels), brown ink
(`#3b2414`), and an orange/mustard/brown **racing stripe** under the console strip.
Chunky 14px panels with a 2px border and a warm offset shadow; burnt-orange wordmark.
Type: Righteous / Work Sans / Courier Prime. Signals darkened for cream: ok
`#3f6b1f`, fault `#a8321b`, standby `#8a5a00`, feed `#1f5d73`; tally `#e8590c` ringed.

## Futuristic

A starship HUD, dark: deep-space `#04060d` with a fixed 40px cyan grid and two
nebula washes, **glass** panels (translucent navy + `backdrop-filter: blur`), cyan
HUD corner brackets on every panel, glowing eyebrows and LED segments, magenta tally.
Type: Orbitron / Exo 2 / JetBrains Mono. Signals: ok `#2ee6b6`, fault `#ff5c7a`,
standby `#ffc04d`, feed `#7aa2ff`, tally `#ff2bd6`.

## Minimal

White paper, light: `#fafafa` page, white panels, `#e4e4e7` hairlines, near-black
ink `#18181b`, putty `#52525b`. One typeface (Inter, JetBrains Mono for numbers), no
glow, texture or shadow; the tally lamp is the only thing that moves. Signals: ok
`#15803d`, fault `#b91c1c`, standby `#a16207`, feed `#1d4ed8`, tally `#e11d48`.

## Shared structure

### Layout

- **Console strip** (top bar, 48px, `--ink-1`, hairline bottom): wordmark "E2E CONTROL"
  (display face, letterspaced), view links (Attention · Tickets · Board · Bugs ·
  Coverage), the Rundown, run tabs, right = mono readouts (env locks, live count).
- **Needs attention** (`/`, home): sections of to-dos — gates, blocked pipelines,
  bugs to retest, Jira "Ready for test", failing, waiting on prod verification.
- **Monitor wall** (`/wall`): responsive grid of monitor cards, `minmax(320px, 1fr)`,
  plus pipelines running outside the dashboard.
- **Run view** (`/runs/:id`): 3 panes — pipeline rail `260px` | chat `1fr` | feed `380px`,
  hairline dividers, panes scroll independently.

### Signature elements

1. **Monitor card**: `--ink-2` bezel, thumbnail area 16:10 with the live
   feed (or last evidence still, dimmed 60% when idle). Top-left: tally lamp (8px dot —
   `--tally` glowing when executing, `--standby` when gated, `--line` when idle).
   Top-right eyebrow: state ("ON AIR" / "STANDBY" / "WRAP" / "FAULT"). Below: ticket id
   (mono) + Jira title (body), then the LED meter.
2. **LED segment meter** — the progress bar is 12 discrete segments (one per pipeline
   step), 3px gaps: `--ok` done, `--tally` active-executing, `--feed` active-thinking,
   `--standby` blocked/gate, `--line` pending, `--putty` at 40% opacity for skipped.
   Used at full width in the rail, mini (60px) on cards and tabs.
3. **Gate banner**: `--standby` left border (3px), `--ink-1` fill, gate question in
   body type, quick-reply buttons + free-text — the amber is the loudest non-tally
   element on screen.

### Motion

- Tally lamp: 2s opacity pulse (0.75→1). Thumbnail refresh: 150ms crossfade.
- Matrix only: digital rain and the wordmark cursor.
- `@media (prefers-reduced-motion: reduce)`: lamp static, no crossfade, rain is one
  still frame, cursor steady.
- Nothing else animates except native scrolling and 120ms hover transitions.

### Copy register

Operator's console, sentence case, verbs first: "Answer gate", "Open run",
"Interrupt", "Recapture evidence". State words come from broadcast: ON AIR
(executing), STANDBY (gated), WRAP (completed), FAULT (failed). Errors say what
happened and the fix: "claude CLI not logged in — run `claude` in a terminal, then
Resume."

### Quality floor

Responsive to ~1100px (feed pane collapses under chat), visible keyboard focus
(`outline: 2px solid --feed`), reduced motion respected, all live regions
`aria-live="polite"`.
