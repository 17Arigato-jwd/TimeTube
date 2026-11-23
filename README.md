# TimeTube ⏱️📺

[![CI](https://github.com/17Arigato-jwd/TimeTube/actions/workflows/ci.yml/badge.svg)](https://github.com/17Arigato-jwd/TimeTube/actions/workflows/ci.yml)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Cross-Browser](https://img.shields.io/badge/Browser-Chrome%20%7C%20Firefox%20%7C%20Edge%20%7C%20Brave-orange.svg)]()
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-Passing%20(12%2F12)-brightgreen.svg)]()
[![Version](https://img.shields.io/badge/Version-v1.3.0-purple.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Never lose track of time on YouTube again.**
> Cross-browser (Chrome, Firefox, Edge, Brave) extension that dynamically filters Home, Search, and Watch recommendations so you only see videos you actually have time to finish before your break ends.

Originally developed as **TimeFit**, **TimeTube** has evolved into a complete, in-page session management tool featuring real-time YouTube header integration, intelligent recommendation pruning, smart Shorts guardrails, video overrun protection, and automatic session reset.

---

## 📑 Table of Contents

- [Overview](#timetube-)
- [✨ Key Features](#-key-features)
  - [1. In-Page YouTube Top-Bar Menu & Live Badges](#1-in-page-youtube-top-bar-menu--live-badges)
  - [2. Flexible Budget Modes](#2-flexible-budget-modes)
  - [3. Active Watch-Sidebar & Feed Pruning](#3-active-watch-sidebar--feed-pruning)
  - [4. Overrun Guard & Dynamic Playback Speed](#4-overrun-guard--dynamic-playback-speed)
  - [5. Smart Shorts & Navigation Guardrails](#5-smart-shorts--navigation-guardrails)
  - [6. Silent Autoplay Verification](#6-silent-autoplay-verification)
  - [7. Clean Takeover & Lifecycle Auto-Reset](#7-clean-times-up--takeover--lifecycle-auto-reset)
- [🚀 Installation Guide](#-installation-guide)
  - [Step 1: Download or Clone the Repository](#step-1-download-or-clone-the-repository)
  - [Step 2: Load the Extension into Your Browser](#step-2-load-the-extension-into-your-browser)
    - [Google Chrome & Chromium](#google-chrome--chromium)
    - [Brave Browser](#brave-browser)
    - [Microsoft Edge](#microsoft-edge)
    - [Mozilla Firefox (Desktop)](#mozilla-firefox-desktop)
    - [Mozilla Firefox (Android / Nightly)](#mozilla-firefox-android--nightly)
    - [Opera & Vivaldi](#opera--vivaldi)
  - [Step 3: Verify the Installation](#step-3-verify-the-installation)
  - [Troubleshooting & Updating](#troubleshooting--updating)
- [🏗️ Architecture & Codebase Structure](#️-architecture--codebase-structure)
- [🛠️ Development & Testing](#️-development--testing)
  - [Prerequisites](#prerequisites)
  - [Development Commands](#development-commands)
  - [Automated Unit Tests](#automated-unit-tests)
- [🤖 Continuous Integration (GitHub Actions)](#-continuous-integration-github-actions)
- [🤝 Contributing Guidelines](#-contributing-guidelines)
  - [1. Code of Conduct & Etiquette](#1-code-of-conduct--etiquette)
  - [2. Getting Started & Git Workflow](#2-getting-started--git-workflow)
  - [3. Commit Message Standards (Conventional Commits)](#3-commit-message-standards-conventional-commits)
  - [4. Mandatory Quality Gates & Verification Checklist](#4-mandatory-quality-gates--verification-checklist)
  - [5. Architectural & Cross-Browser Principles](#5-architectural--cross-browser-principles)
  - [6. Submitting Pull Requests](#6-submitting-pull-requests)
  - [7. Reporting Bugs & Requesting Features](#7-reporting-bugs--requesting-features)
- [📜 Version History & Git Milestones](#-version-history--git-milestones)
- [🔒 Permissions Justification](#-permissions-justification)
- [📄 License](#-license)

---

## ✨ Key Features

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

## 🚀 Installation Guide

You can install TimeTube in any Chromium-based or Gecko-based modern browser in just a couple of minutes.

### Step 1: Download or Clone the Repository

**Option A: Clone with Git**
```bash
git clone https://github.com/17Arigato-jwd/TimeTube.git
cd TimeTube
```

**Option B: Download ZIP from GitHub**
1. Visit [TimeTube on GitHub](https://github.com/17Arigato-jwd/TimeTube).
2. Click the green **Code** button and choose **Download ZIP**.
3. Extract the downloaded archive to a folder on your computer.

*(Note: Pre-compiled distribution bundles in `dist/` are already included in the repository. If you modify source code, see [Development & Testing](#️-development--testing) to rebuild).*

---

### Step 2: Load the Extension into Your Browser

#### Google Chrome & Chromium
1. Open Google Chrome and enter `chrome://extensions` into your URL address bar.
2. Toggle on **Developer mode** using the switch located in the top-right corner.
3. Click the **Load unpacked** button that appears in the top-left toolbar.
4. In the file picker, select the `TimeTube` root folder (the folder containing `manifest.json`).
5. TimeTube is now installed and active!

#### Brave Browser
1. In Brave, navigate to `brave://extensions`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select the `TimeTube` root directory containing `manifest.json`.

#### Microsoft Edge
1. In Edge, navigate to `edge://extensions`.
2. Enable the **Developer mode** toggle in the left navigation sidebar.
3. Click the **Load unpacked** button in the main panel.
4. Browse to and select the `TimeTube` root directory.

#### Mozilla Firefox (Desktop)
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Under the **Temporary Extensions** section, click the **Load Temporary Add-on...** button.
3. In the file dialog, select `manifest.json` from the `TimeTube` folder.
4. TimeTube is now active in your Firefox session!

> [!NOTE]
> Firefox unloads temporary extensions when the browser is completely closed. For permanent installation in Firefox Developer Edition or Nightly, you can package the directory using `web-ext` and load the signed `.xpi` or unsigned extension via `about:config` (`xpinstall.signatures.required = false`).

#### Mozilla Firefox (Android / Nightly)
1. In Firefox Nightly on Android, go to **Settings** → **About Firefox Nightly**.
2. Tap the Firefox logo 5 times to enable developer options.
3. Use `web-ext` on your desktop (`npx web-ext run --target=firefox-android`) or add TimeTube to a custom add-on collection in your Mozilla Add-ons profile to load it onto your device.

#### Opera & Vivaldi
1. **Opera:** Navigate to `opera://extensions`, enable **Developer Mode**, and click **Load unpacked extension**.
2. **Vivaldi:** Navigate to `vivaldi://extensions`, toggle **Developer mode**, and select **Load unpacked**.

---

### Step 3: Verify the Installation

1. Open a new tab and navigate to [https://www.youtube.com](https://www.youtube.com).
2. Look at the top navigation bar next to YouTube's **+ Create** button:
   - You will see the **TimeTube clock badge** injected directly into the header.
3. Click on the badge to open the quick-access popover:
   - Choose a preset (e.g., `25m`) or set a clock end time.
4. Watch as the sidebar and home feeds dynamically prune unfinishable videos in real time!

---

### Troubleshooting & Updating

- **Updated code not reflecting?**
  Navigate back to your browser's extensions page (`chrome://extensions` or `about:debugging`), find **TimeTube**, and click the 🔄 **Reload** icon.
- **Rebuilding after TypeScript edits:**
  If you edit files in `src/`, run:
  ```bash
  npm run build
  ```
  and then click the reload icon in your browser's extension manager.

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

## 🛠️ Development & Testing

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- `npm`

### Development Commands

```bash
# Install development dependencies cleanly
npm ci

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

## 🤖 Continuous Integration (GitHub Actions)

This repository includes an automated GitHub Actions CI pipeline located at [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

On every `push` and `pull_request` to the `main` branch, the workflow:
1. **Checks out the repository** on Ubuntu latest.
2. **Sets up Node.js 22** with automated `npm` dependency caching.
3. **Installs exact dependencies** via `npm ci`.
4. **Runs TypeScript typechecking** (`tsc --noEmit`).
5. **Runs all 12 automated unit tests** (`npm test`).
6. **Compiles production bundles** (`npm run build`).
7. **Packages and uploads the extension artifact** (`timetube-extension-build`), generating a ready-to-download `.zip` on every build run.

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

## 🤝 Contributing Guidelines

We welcome contributions to **TimeTube**! Whether you are fixing a bug, adding support for a new YouTube UI layout, improving accessibility, or writing tests, your help is appreciated.

To ensure stability, cross-browser compatibility, and maintainability, all contributors must follow these guidelines.

---

### 1. Code of Conduct & Etiquette
- Be respectful, constructive, and inclusive in issues, PR discussions, and code reviews.
- Focus on productivity and digital wellbeing—features that encourage dark patterns, engagement-traps, or endless scrolling are strictly anti-goals.

---

### 2. Getting Started & Git Workflow
1. **Fork the repository** on GitHub: [https://github.com/17Arigato-jwd/TimeTube](https://github.com/17Arigato-jwd/TimeTube)
2. **Clone your fork locally**:
   ```bash
   git clone https://github.com/<your-username>/TimeTube.git
   cd TimeTube
   ```
3. **Install dependencies cleanly**:
   ```bash
   npm ci
   ```
4. **Create a topic branch** branching from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/your-bugfix-description
   ```

---

### 3. Commit Message Standards (Conventional Commits)
All commit messages must adhere to the **[Conventional Commits](https://www.conventionalcommits.org/)** specification:

```
<type>(<scope>): <short description in imperative mood>
```

- **Allowed Types:**
  - `feat`: A new feature, UI capability, or policy option
  - `fix`: A bug fix or selector update
  - `docs`: Documentation updates or typo corrections
  - `refactor`: Internal code reorganization that doesn't fix a bug or add a feature
  - `test`: Adding missing tests or refactoring test suites
  - `style`: Formatting, whitespace, or CSS token tweaks
  - `chore`: Build tooling, dependency bumps, or repository configuration
- **Examples:**
  - `feat(topbar): add custom snooze button in quick popover`
  - `fix(parser): support localized Portuguese ARIA duration formats`
  - `test(policy): add test case for midnight timer rollover`
  - `docs(readme): clarify unpacked loading steps for Firefox Nightly`

---

### 4. Mandatory Quality Gates & Verification Checklist
Before opening a Pull Request, ensure every item on this checklist passes locally:

```bash
# 1. Typecheck: Zero TypeScript errors
npm run typecheck

# 2. Automated Tests: All tests pass
npm test

# 3. Production Build: Bundles compile cleanly without errors
npm run build
```

- **Automated CI Check:** Every PR will trigger the GitHub Actions CI pipeline. PRs will not be merged if any check fails.
- **Unit Test Coverage for Logic Changes:**
  - If you modify `src/core/duration.ts`, `src/core/policy.ts`, or add new budget rules, you **must** add or update corresponding test assertions in `tests/policy.test.ts`.
  - Strive for 100% test pass rate.

---

### 5. Architectural & Cross-Browser Principles

To keep TimeTube reliable across continuous YouTube updates and different browsers, keep these core principles in mind:

- **1. Strict Cross-Browser MV3 Compatibility:**
  - TimeTube targets both **Chromium** (Chrome, Brave, Edge, Opera) and **Gecko** (Firefox Desktop & Android) using Manifest V3.
  - Never call `chrome.*` directly if Firefox behaves differently. Always import browser runtime and storage helpers from `src/shared/webext.ts`.
- **2. Decouple Core Logic from DOM:**
  - The `src/core/` folder must remain **pure TypeScript** with zero DOM dependencies (`document`, `window`, or browser globals).
  - This allows domain logic to be executed and tested at lightning speed in Node.js without needing a browser harness.
- **3. Defensive YouTube DOM Querying:**
  - YouTube frequently updates its custom elements (`ytd-*`, `yt-*`) and obfuscates class names.
  - In `src/content/`, always query using multiple fallback selectors, handle `null` safely, and never assume an element is guaranteed to exist.
- **4. Scoped CSS & Design Tokens:**
  - Do not use global tag selectors that could leak into native YouTube components.
  - All extension styles in `src/content/styles.css` and `popup/popup.css` should use `--tt-*` CSS variables and `.yt-tt-*` class namespaces.

---

### 6. Submitting Pull Requests

1. Push your branch to your GitHub fork:
   ```bash
   git push origin feat/your-feature-name
   ```
2. Open a Pull Request against the `main` branch of `17Arigato-jwd/TimeTube`.
3. Provide a clear description:
   - What problem does this solve?
   - How was it tested?
   - For UI changes, attach screenshots or a short screen recording showing the before/after in YouTube.
4. Respond promptly to review feedback. Keep PRs focused and small—smaller PRs are reviewed and merged much faster!

---

### 7. Reporting Bugs & Requesting Features
- **Bug Reports:** Open an issue on GitHub with:
  - Browser name and exact version (e.g. Chrome 131, Firefox 133)
  - Operating system
  - YouTube page type (Watch page, Home feed, Search results, Shorts)
  - Clear step-by-step reproduction instructions and expected vs actual behavior
  - Console errors from DevTools (if any)
- **Feature Requests:** Open an issue detailing the use case, why it benefits productivity, and how you envision the user experience.

---

## 🔒 Permissions Justification

- **`storage`**: Persists your active budget, timer countdown, and preferences across tabs and browser restarts.
- **`alarms`**: Powers accurate background countdown ticks and scheduled expiration checks in Manifest V3.
- **Host Permissions (`*://*.youtube.com/*`)**: Injects content scripts, displays the topbar menu, and filters unfinishable video recommendations.

---

## 📄 License

[MIT License](LICENSE) © 2026 17Arigato.jwd
