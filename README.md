# TimeTube ⏱️📺

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Cross-Browser](https://img.shields.io/badge/Browser-Chrome%20%7C%20Firefox%20%7C%20Edge%20%7C%20Brave-orange.svg)]()
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-Passing%20(12%2F12)-brightgreen.svg)]()
[![Version](https://img.shields.io/badge/Version-v1.3.0-purple.svg)]()

> **Never lose track of time on YouTube again.**
> Cross-browser (Chrome, Firefox, Edge, Brave) extension that dynamically filters Home, Search, and Watch recommendations so you only see videos you actually have time to finish before your break ends.

Originally developed as **TimeFit**, **TimeTube** has evolved into a complete, in-page session management tool featuring real-time YouTube header integration, intelligent recommendation pruning, smart Shorts guardrails, video overrun protection, and automatic session reset.

---

## ✨ Features

### 1. In-Page YouTube Top-Bar Menu & Live Badges
- **Seamless Header Integration:** Injected directly into the YouTube top navigation bar, right beside the **+ Create** button.
- **Dynamic Remaining Time Badge:** High-visibility pill showing live remaining time (`1.5hr`, `1hr`, `30m`, `2m`, `53s`, `42s`, `3s`).
- **Quick-Access Popover:** Adjust your timer, pause countdowns, switch modes, or view current session status right from the YouTube page without opening the browser toolbar popup.

### 2. Flexible Budget Modes
- **Countdown Timer:** Set quick presets (`15m`, `25m`, `45m`) or choose any custom duration.
- **Clock End Time ("Until HH:MM"):** Pick an exact finish time (e.g., "until 17:30"); automatically handles rollover past midnight.
- **Max Video Duration:** Cap individual recommendation durations while keeping timer active.

### 3. Active Watch-Sidebar & Feed Pruning
- **Live 4-Second Sweeps:** While watching, the extension re-evaluates the Watch sidebar every 4 seconds. As time slips away, unfinishable videos are gracefully hidden or dimmed.
- **Sparse Feed Nudging:** Automatically prompts YouTube's infinite scroll loader when strict filtering makes the feed sparse, ensuring you always have eligible options to watch.

### 4. Overrun Guard & Dynamic Playback Speed
- **Overrun Detection:** If you start or seek into a video longer than your remaining time, TimeTube immediately calculates the deficit.
- **Dynamic Speed Scaling ($\le 2\times$):** Automatically adjusts playback speed so the video concludes exactly as your timer finishes.
- **Early-Cutoff Progress Indicator:** Displays a high-contrast red indicator on the progress bar showing where the video will cut off if kept at standard speed.
- **Exact Time Addition:** Easily add the exact overrun difference to your budget with one click.

### 5. Smart Shorts & Navigation Guardrails
- **Keep Thumbnails, Hide Navigation:** Keeps Shorts thumbnails on Home and Search feeds so you don't miss good creators, but hides the dedicated Shorts navigation button to prevent endless doomscrolling.
- **Duration Pill Resolution:** Lazily inspects and overlays duration pills onto Short thumbnails.
- **Graduated 3-Stage Escalation:** Optional nudge at 50% elapsed, warning at 25% remaining, and mandatory redirection to the standard `/watch?v=` player when under 5–10 minutes remain.

### 6. Silent Autoplay Verification
- Runs silent background checks while playing; only prompts you if YouTube Autoplay is actively switched ON, preventing accidental runaway sessions.

### 7. Clean "Time's up :)" Takeover & Lifecycle Auto-Reset
- **Clean Takeover:** When the timer hits zero, TimeTube smoothly cleans up the active page, stops playback, and redirects to `youtube.com/` with a friendly "Time's up :)" message.
- **10-Second Cooldown Auto-Reset:** Monitors tab lifecycle. When you close all YouTube tabs for $\ge 10$ seconds after a session expires, TimeTube automatically resets itself so your next visit starts fresh.

---

## 🏗️ Architecture & Codebase Structure

TimeTube is built with TypeScript and esbuild, adhering strictly to Manifest V3 specifications.

```
Timetube/
├── manifest.json            # Unified cross-browser MV3 manifest (Chrome & Gecko/Firefox)
├── package.json             # Scripts and dev dependencies
├── tsconfig.json            # Strict TypeScript configuration
├── assets/                  # Icons and SVG branding
│   ├── logo-main.svg        # Vector extension logo
│   ├── topbar-badge.svg     # Top-bar badge container SVG
│   ├── topbar-empty.svg     # Idle top-bar logo SVG
│   └── icon-{16,32,48,128}.png
├── src/
│   ├── core/                # Pure domain logic (zero DOM dependencies, 100% testable)
│   │   ├── duration.ts      # YouTube duration badge & ARIA label parser
│   │   ├── policy.ts        # Budget resolution, pruning rules, overrun logic, tab lifecycle
│   │   └── types.ts         # Shared state interfaces, message contracts, action schemas
│   ├── content/             # In-page scripts running on youtube.com
│   │   ├── index.ts         # Mutation observer, sidebar pruner, takeover screens, video guards
│   │   ├── topbar.ts        # Header injection, popover controller, real-time badge updates
│   │   └── styles.css       # Scoped stylesheet with design tokens for YouTube integration
│   ├── background/          # Background Service Worker
│   │   └── index.ts         # Alarms, tab tracking, cross-tab state broadcast, storage sync
│   ├── popup/               # Browser action popup UI
│   │   ├── index.ts         # Controller for extension toolbar popup
│   │   ├── popup.html       # Popup layout
│   │   └── popup.css        # Popup styling
│   └── shared/              # Shared utilities
│       └── webext.ts        # Unified cross-browser runtime & storage polyfill
├── scripts/
│   ├── build.mjs            # Production bundle pipeline with esbuild
│   └── build-tests.mjs      # Test suite bundling pipeline
├── dist/                    # Bundled extension outputs
└── tests/                   # Node.js native test suite
    └── policy.test.ts       # 12 comprehensive unit test scenarios
```

---

## 🚀 Installation & Unpacked Loading

### Chrome / Brave / Microsoft Edge
1. Clone or download this repository.
2. Open `chrome://extensions` (or `edge://extensions` / `brave://extensions`).
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select this directory (`Timetube/`).

### Firefox (Desktop & Android)
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `manifest.json` in this directory.

---

## 🛠️ Development & Testing

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- `npm`

### Commands

```bash
# Install development dependencies
npm install

# Build extension bundles into dist/
npm run build

# Run TypeScript typechecker
npm run typecheck

# Run test suite
npm test
```

### Automated Unit Tests
The test suite runs with Node's native test runner (`node --test`) and validates:
- [x] Parsing of `MM:SS`, `HH:MM:SS`, and spoken ARIA duration labels (ignoring relative "ago" labels, LIVE, and New badges)
- [x] Badge formatting (`1.5hr`, `1hr`, `30m`, `2m`, `53s`, etc.)
- [x] Countdown and midnight-rollover budget bounds
- [x] Active dynamic Watch-sidebar pruning
- [x] Shorts duration inspection & graduated 3-stage escalation
- [x] Silent Autoplay detection rules
- [x] Overrun calculations (dynamic playback speed $\le 2\times$ and cutoff percentages)
- [x] Paused countdown state persistence
- [x] YouTube tab closure lifecycle tracking & 10s cooldown auto-reset

---

## 📜 Version History & Git Milestones

| Version / Tag | Release Date | Summary & Key Changes |
| :--- | :--- | :--- |
| `timefit-v1.0.0-rev0` | Nov 21, 2026 | **Initial TimeFit prototype.** MV3 dual-manifest setup, duration parser, policy logic, content pruner. |
| `timefit-v1.0.0-rev1` | Nov 21, 2026 | **Manifest unification.** Merged Firefox & Chrome configurations into a single `manifest.json`. |
| `timefit-v1.0.0-rev2` | Nov 21, 2026 | **YouTube Web Components.** Support for modern badge elements, ignored relative timestamps, feed scroll nudging. |
| `timefit-v1.0.0-rev3` | Nov 21, 2026 | **Timer precision.** Sweep timer, exact expiration dispatch, video pause handling, takeover screen. *(rev4 was an identical backup)*. |
| `timefit-v1.0.0-rev4` | Nov 21, 2026 | **Popup redesign.** Modernized UI with tabbed navigation, presets, and autoplay settings. |
| `timefit-v1.0.0-rev5` | Nov 21, 2026 | **Overlay refinements.** Polished modal overlays, smooth video pause transitions. |
| `timefit-v1.0.0-rev6` | Nov 21, 2026 | **Pruning polish.** Edge-case handling for Shorts durations and YouTube infinite scroll. |
| `timetube-assets` | Nov 22, 2026 | **Brand identity redesign.** Addition of TimeTube SVG logos (`Main Extension Logo.svg`, topbar logos). |
| `v1.1.0` | Nov 22, 2026 | **TimeTube Rebrand & In-Page Topbar.** Injected live countdown badge and popover into YouTube navigation header. |
| `v1.2.0` | Nov 22, 2026 | **Topbar polish & Overrun banner.** Finish line banner, overrun management, enhanced popover interactions. |
| `v1.2.0-rev1` | Nov 22, 2026 | **Bugfix patch.** Duration edge-case parsing fixes and top-bar state synchronization. |
| `v1.2.1` | Nov 22, 2026 | **Dynamic Playback Speed.** Overrun guard with automatic speed scaling ($\le 2\times$) and red cutoff bar. |
| `v1.2.2` | Nov 22, 2026 | **Service Worker Lifecycle.** Resilient background worker wakeups and content script reconnection handling. |
| `v1.3.0` | Nov 22, 2026 | **Tab Lifecycle & Auto-Reset.** Tracks YouTube tab closure, 10s cooldown auto-reset, dismissed notice banners. |

---

## 🔒 Permissions Justification

- **`storage`**: Persists your active budget, timer countdown, and preferences across tabs and browser restarts.
- **`alarms`**: Powers accurate background countdown ticks and scheduled expiration checks in Manifest V3.
- **Host Permissions (`*://*.youtube.com/*`)**: Injects content scripts, displays the topbar menu, and filters unfinishable video recommendations.

---

## 📄 License

ISC / MIT - Feel free to adapt for personal productivity.
