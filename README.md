<p align="center">
  <img src="assets/logo-main.svg" alt="TimeTube Logo" width="128" height="128">
</p>

# TimeTube

[![CI](https://github.com/17Arigato-jwd/TimeTube/actions/workflows/ci.yml/badge.svg)](https://github.com/17Arigato-jwd/TimeTube/actions/workflows/ci.yml)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Cross-Browser](https://img.shields.io/badge/Browser-Chrome%20%7C%20Firefox%20%7C%20Edge%20%7C%20Brave-orange.svg)]()
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6.svg)](https://www.typescriptlang.org/)
[![Version](https://img.shields.io/badge/Version-v1.3.1-purple.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Never lose track of time on YouTube again.**
> Cross-browser (Chrome, Firefox, Edge, Brave) extension that dynamically filters Home, Search, and Watch recommendations so you only see videos you actually have time to finish before your break ends.

Originally developed as **TimeFit**, **TimeTube** has evolved into a complete, in-page session management tool featuring real-time YouTube header integration, intelligent recommendation pruning, smart Shorts guardrails, video overrun protection, and automatic session reset.

---

## Table of Contents

- [Overview](#timetube)
- [Key Features](#key-features)
  - [1. In-Page YouTube Top-Bar Menu and Live Badges](#1-in-page-youtube-top-bar-menu-and-live-badges)
  - [2. Flexible Budget Modes](#2-flexible-budget-modes)
  - [3. Active Watch-Sidebar and Feed Pruning](#3-active-watch-sidebar-and-feed-pruning)
  - [4. Overrun Guard and Dynamic Playback Speed](#4-overrun-guard-and-dynamic-playback-speed)
  - [5. Smart Shorts and Navigation Guardrails](#5-smart-shorts-and-navigation-guardrails)
  - [6. Silent Autoplay Verification](#6-silent-autoplay-verification)
  - [7. Clean Takeover and Lifecycle Auto-Reset](#7-clean-takeover-and-lifecycle-auto-reset)
  - [8. Weekly YouTube Schedules](#8-weekly-youtube-schedules)
- [Installation Guide](#installation-guide)
  - [Official Web Stores](#official-web-stores)
  - [Step 1: Download or Clone the Repository](#step-1-download-or-clone-the-repository)
  - [Step 2: Load the Extension into Your Browser](#step-2-load-the-extension-into-your-browser)
    - [Google Chrome and Chromium](#google-chrome-and-chromium)
    - [Brave Browser](#brave-browser)
    - [Microsoft Edge](#microsoft-edge)
    - [Mozilla Firefox (Desktop)](#mozilla-firefox-desktop)
    - [Mozilla Firefox (Android / Nightly)](#mozilla-firefox-android--nightly)
    - [Opera and Vivaldi](#opera-and-vivaldi)
  - [Step 3: Verify the Installation](#step-3-verify-the-installation)
  - [Troubleshooting and Updating](#troubleshooting-and-updating)
- [Architecture and Codebase Structure](#architecture-and-codebase-structure)
- [Development and Testing](#development-and-testing)
  - [Prerequisites](#prerequisites)
  - [Development Commands](#development-commands)
  - [Automated Unit Tests](#automated-unit-tests)
- [Continuous Integration (GitHub Actions)](#continuous-integration-github-actions)
- [Contributing Guidelines](#contributing-guidelines)
  - [1. Code of Conduct and Etiquette](#1-code-of-conduct-and-etiquette)
  - [2. Getting Started and Git Workflow](#2-getting-started-and-git-workflow)
  - [3. Commit Message Standards (Conventional Commits)](#3-commit-message-standards-conventional-commits)
  - [4. Mandatory Quality Gates: Testing and Verification](#4-mandatory-quality-gates-testing-and-verification)
  - [5. Architectural and Cross-Browser Principles](#5-architectural-and-cross-browser-principles)
  - [6. Submitting Pull Requests](#6-submitting-pull-requests)
  - [7. Reporting Bugs and Requesting Features](#7-reporting-bugs-and-requesting-features)
- [Permissions Justification](#permissions-justification)
- [License](#license)

---

## Key Features

### 1. In-Page YouTube Top-Bar Menu and Live Badges
- **Seamless Header Integration:** Injected directly into the YouTube top navigation bar, right beside the **+ Create** button.
- **Dynamic Remaining Time Badge:** High-visibility pill showing live remaining time (`1.5hr`, `1hr`, `30m`, `2m`, `53s`, `42s`, `3s`).
- **Quick-Access Popover:** Adjust your timer, pause countdowns, switch modes, or view current session status right from the YouTube page without opening the browser toolbar popup.

### 2. Flexible Budget Modes
- **Countdown Timer:** Set quick presets (`15m`, `25m`, `45m`) or choose any custom duration.
- **Clock End Time ("Until HH:MM"):** Pick an exact finish time (e.g., "until 17:30"); automatically handles rollover past midnight.
- **Max Video Duration:** Cap individual recommendation durations while keeping timer active.

### 3. Active Watch-Sidebar and Feed Pruning
- **Live 4-Second Sweeps:** While watching, the extension re-evaluates the Watch sidebar every 4 seconds. As time slips away, unfinishable videos are gracefully hidden or dimmed.
- **Sparse Feed Nudging:** Automatically prompts YouTube's infinite scroll loader when strict filtering makes the feed sparse, ensuring you always have eligible options to watch.

### 4. Overrun Guard and Dynamic Playback Speed
- **Overrun Detection:** If you start or seek into a video longer than your remaining time, TimeTube immediately calculates the deficit.
- **Dynamic Speed Scaling (<= 2x):** Automatically adjusts playback speed so the video concludes exactly as your timer finishes.
- **Early-Cutoff Progress Indicator:** Displays a high-contrast red indicator on the progress bar showing where the video will cut off if kept at standard speed.
- **Exact Time Addition:** Easily add the exact overrun difference to your budget with one click.

### 5. Smart Shorts and Navigation Guardrails
- **Keep Thumbnails, Hide Navigation:** Keeps Shorts thumbnails on Home and Search feeds so you don't miss good creators, but hides the dedicated Shorts navigation button to prevent endless doomscrolling.
- **Duration Pill Resolution:** Lazily inspects and overlays duration pills onto Short thumbnails.
- **Graduated 3-Stage Escalation:** Optional nudge at 50% elapsed, warning at 25% remaining, and mandatory redirection to the standard `/watch?v=` player when under 5 to 10 minutes remain.

### 6. Silent Autoplay Verification
- Runs silent background checks while playing; only prompts you if YouTube Autoplay is actively switched ON, preventing accidental runaway sessions.

### 7. Clean Takeover and Lifecycle Auto-Reset
- **Clean Takeover:** When the timer hits zero, TimeTube smoothly cleans up the active page, stops playback, and redirects to `youtube.com/` with a friendly "Time's up :)" message.
- **10-Second Cooldown Auto-Reset:** Monitors tab lifecycle. When you close all YouTube tabs for at least 10 seconds after a session expires, TimeTube automatically resets itself so your next visit starts fresh.

### 8. Weekly YouTube Schedules

1. Open the schedule row at the bottom of the toolbar popup. Turn on **Enable schedule** to draft your first rule. Enforcement begins when you save it.
2. Select individual days or use a day preset. Choose **Access window**, **Daily limit**, or both. An access window can run overnight.
3. For a daily limit, choose the number of minutes, counting mode, and local reset time. **Time on YouTube** counts visible tab time. **Active playback** counts while video plays. Simultaneous usage counts once. A Monday budget resetting at 4 AM runs until Tuesday at 4 AM.
4. Save the schedule. Disabling it immediately suspends enforcement and discards pending edits. Re-enabling it resumes your saved rules.

The strip above the manual timer shows the daily allowance and reset time, the progress of the access window, or both. When access is restricted, the popup shows when it resumes.

You can still use **Timer**, **End time**, and **Max length** when the schedule allows access. If a Timer or End time session would exceed the remaining allowance or run past closing, the toolbar popup offers **Shorten session** or **Add extra time**. Extra time applies only to that occurrence. Stopping a manual session or letting it auto-reset leaves the schedule in effect.

---

## Installation Guide

TimeTube runs on any Chromium-based or Gecko-based modern browser.

### Official Web Stores

TimeTube is distributed through official browser extension stores as well as manual unpacked loading from source. Store availability and review statuses are tracked below:

| Browser Store | Supported Browsers | Status | Download Link |
| :--- | :--- | :--- | :--- |
| Firefox Add-ons (AMO) | Firefox Desktop & Android | Pending Review | Direct link available upon approval |
| Opera Addons | Opera & Opera GX | Pending Review | Direct link available upon approval |
| Chrome Web Store | Chrome, Brave, Edge, Vivaldi | Planned | Direct link coming soon |
| Microsoft Edge Add-ons | Microsoft Edge | Planned | Direct link coming soon |

While store submissions are being finalized, or to run the latest development build from source, follow the unpacked installation instructions below.

---

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

*(Note: Pre-compiled distribution bundles in `dist/` are already included in the repository. If you modify source code, see [Development and Testing](#development-and-testing) to rebuild).*

---

### Step 2: Load the Extension into Your Browser

#### Google Chrome and Chromium
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
1. In Firefox Nightly on Android, go to **Settings** -> **About Firefox Nightly**.
2. Tap the Firefox logo 5 times to enable developer options.
3. Use `web-ext` on your desktop (`npx web-ext run --target=firefox-android`) or add TimeTube to a custom add-on collection in your Mozilla Add-ons profile to load it onto your device.

#### Opera and Vivaldi
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

### Troubleshooting and Updating

- **Updated code not reflecting?**
  Navigate back to your browser's extensions page (`chrome://extensions` or `about:debugging`), find **TimeTube**, and click the **Reload** button or icon.
- **Rebuilding after TypeScript edits:**
  If you edit files in `src/`, run:
  ```bash
  npm run build
  ```
  and then click the reload icon in your browser's extension manager.

---

## Architecture and Codebase Structure

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
│   │   ├── schedule.ts      # Weekly windows, usage accounting, and conflict decisions
│   │   └── types.ts         # Shared state interfaces, message contracts, action schemas
│   ├── content/             # In-page scripts running on youtube.com
│   │   ├── index.ts         # Mutation observer, sidebar pruner, takeover screens, video guards
│   │   ├── topbar.ts        # Header injection, popover controller, real-time badge updates
│   │   └── styles.css       # Scoped stylesheet with design tokens for YouTube integration
│   ├── background/          # Background Service Worker
│   │   ├── index.ts         # Alarms, tab tracking, cross-tab state broadcast, storage sync
│   │   └── schedule.ts      # Schedule persistence and usage samples from YouTube tabs
│   ├── options/             # Weekly schedule settings controller
│   ├── popup/               # Browser action popup UI
│   │   ├── index.ts         # Controller for extension toolbar popup
│   │   └── schedule.ts      # Schedule status and manual-session conflict dialog
│   └── shared/              # Shared utilities
│       └── webext.ts        # Unified cross-browser runtime & storage polyfill
├── popup/                   # Toolbar popup and schedule settings HTML and CSS
├── scripts/
│   ├── build.mjs            # Production bundle pipeline with esbuild
│   └── build-tests.mjs      # Test suite bundling pipeline
├── dist/                    # Bundled extension outputs
└── tests/                   # Node.js native test suite
    ├── policy.test.ts       # Timer, playback, and filtering behavior
    └── schedule.test.ts     # Weekly windows, usage, and manual-session conflicts
```

---

## Development and Testing

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

Run the test suite using:

```bash
npm test
```

> [!NOTE]
> Always execute tests using `npm test`. Do not run bare `node --test` directly from the terminal, because source files use standard TypeScript extensionless imports that must be bundled by `esbuild` (`scripts/build-tests.mjs`) into `dist-tests/*.test.cjs` before Node's test runner executes them.

The test suite validates:
- [x] Parsing of `MM:SS`, `HH:MM:SS`, and spoken ARIA duration labels (ignoring relative "ago" labels, LIVE, and New badges)
- [x] Badge formatting (`1.5hr`, `1hr`, `30m`, `2m`, `53s`, etc.)
- [x] Countdown and midnight-rollover budget bounds
- [x] Active dynamic Watch-sidebar pruning
- [x] Shorts duration inspection & graduated 3-stage escalation
- [x] Silent Autoplay detection rules
- [x] Overrun calculations (dynamic playback speed <= 2x and cutoff percentages)
- [x] Paused countdown state persistence
- [x] YouTube tab closure lifecycle tracking & 10s cooldown auto-reset
- [x] Weekly access windows, overnight rollover, and the next available access time
- [x] Daily usage across tabs, allowance exhaustion, and one-time exceptions

---

## Continuous Integration (GitHub Actions)

This repository includes an automated GitHub Actions CI pipeline located at [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

On every `push` and `pull_request` to the `main` branch, the workflow:
1. **Checks out the repository** on Ubuntu latest.
2. **Sets up Node.js 22** with automated `npm` dependency caching.
3. **Installs exact dependencies** via `npm ci`.
4. **Runs TypeScript typechecking** (`tsc --noEmit`).
5. **Runs the automated unit tests** (`npm test`).
6. **Compiles production bundles** (`npm run build`).
7. **Packages and uploads the extension artifact** (`timetube-extension-build`), generating a ready-to-download `.zip` on every build run.

---

## Contributing Guidelines

We welcome contributions to **TimeTube**! Whether you are fixing a bug, adding support for a new YouTube UI layout, improving accessibility, or writing tests, your help is appreciated.

To ensure stability, cross-browser compatibility, and maintainability, all contributors must follow these guidelines.

---

### 1. Code of Conduct and Etiquette
- Be respectful, constructive, and inclusive in issues, PR discussions, and code reviews.
- Focus on productivity and digital wellbeing: features that encourage dark patterns, engagement-traps, or endless scrolling are strictly anti-goals.

---

### 2. Getting Started and Git Workflow
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
  - `refactor`: Internal code reorganization that does not fix a bug or add a feature
  - `test`: Adding missing tests or refactoring test suites
  - `style`: Formatting, whitespace, or CSS token tweaks
  - `chore`: Build tooling, dependency bumps, or repository configuration
- **Examples:**
  - `feat(topbar): add custom snooze button in quick popover`
  - `fix(parser): support localized Portuguese ARIA duration formats`
  - `test(policy): add test case for midnight timer rollover`
  - `docs(readme): clarify unpacked loading steps for Firefox Nightly`

---

### 4. Mandatory Quality Gates: Testing and Verification

Before opening a Pull Request, ensure that every verification step passes locally.

#### Running the Test Suite
Always run the test suite with:

```bash
npm test
```

Under the hood, this compiles test files via `scripts/build-tests.mjs` with `esbuild` and executes `node --test dist-tests/*.test.cjs`.

> [!NOTE]
> Do not run bare `node --test` directly from the terminal without building. Node's native module loader requires exact file extensions for relative imports and cannot resolve extensionless TypeScript imports (`../src/core/duration`) without bundling. Running `npm test` handles compilation and testing automatically.

#### Requirement to Include Tests for New Features & Bugfixes
- **Mandatory Test Coverage:** Any Pull Request that introduces a **new feature**, modifies **duration parsing**, changes **budgeting calculations**, alters **recommendation pruning**, or resolves a **bug** **MUST include new test cases** in `tests/policy.test.ts`.
- **Zero Failures Allowed:** All existing test scenarios plus your newly added test cases must pass with 100% success rate. PRs with missing tests or broken tests will not be accepted.
- **Example Test Structure:**
  ```typescript
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import { myNewFunction } from '../src/core/policy';

  test('myNewFunction correctly handles edge-case input', () => {
    const output = myNewFunction({ input: 'example' });
    assert.equal(output.isValid, true);
  });
  ```

#### Pre-PR Verification Commands
Run these three commands in your terminal before submitting:

```bash
# 1. Typecheck: Zero TypeScript errors
npm run typecheck

# 2. Automated Tests: All unit tests pass
npm test

# 3. Production Build: Bundles compile cleanly into dist/
npm run build
```

- **Automated CI Check:** Every PR automatically triggers the GitHub Actions CI pipeline. PRs will only be merged once all checks succeed.

---

### 5. Architectural and Cross-Browser Principles

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
- **4. Scoped CSS and Design Tokens:**
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
4. Respond promptly to review feedback. Keep PRs focused and small: smaller PRs are reviewed and merged much faster!

---

### 7. Reporting Bugs and Requesting Features

To ensure fast triage and high-quality investigation, blank issues are disabled. All issues are filed using structured GitHub Issue Forms:
- **[Choose an Issue Template](https://github.com/17Arigato-jwd/TimeTube/issues/new/choose)**
- **[Submit a Bug Report](https://github.com/17Arigato-jwd/TimeTube/issues/new?template=bug_report.yml)**
- **[Submit a Feature Request](https://github.com/17Arigato-jwd/TimeTube/issues/new?template=feature_request.yml)**

#### Bug Reports
Before filing a bug report:
1. Review the [Troubleshooting and Updating](#troubleshooting-and-updating) guide to reload the extension after updates or rebuilds.
2. Search open and closed issues to confirm it is not a duplicate.
3. Confirm the issue persists when conflicting YouTube extensions (e.g., ad blockers or enhancers) are disabled.

When completing the [Bug Report form](https://github.com/17Arigato-jwd/TimeTube/issues/new?template=bug_report.yml), provide:
- **Installation Source**: Firefox Add-ons (AMO), Chrome Web Store, Edge Add-ons, Opera Addons, unpacked source, or downloaded release ZIP.
- **TimeTube & Browser Versions**: Extension version (`v1.3.1` or commit) and browser exact version (e.g., Chrome 131.0, Firefox 133.0).
- **Operating System**: OS name and version (Windows 11, macOS Sequoia, Ubuntu 24.04, Android 15).
- **Affected Feature & YouTube Page**: Select the functional component (Topbar Menu, Recommendation Pruning, Budget Modes, Overrun Guard, Shorts Guardrails, Silent Autoplay, Clean Takeover, Popup) and page location (Watch, Home, Search, Shorts, Mobile, or Global).
- **Active Timer State**: Countdown, Clock End Time ("Until HH:MM"), Max Duration Cap, Paused, or Clean Takeover.
- **Reproduction Steps**: Step-by-step instructions with expected vs. actual behavior.
- **Screenshots / Recordings**: Required for UI glitches, misalignment, or badge errors (or enter `N/A - Non-visual issue`).
- **Console Logs**: Red error logs from DevTools Console (`F12` -> Console tab, or enter `None`).
- **Pre-submission Checklist**: Please read every item carefully before checking.

#### Feature Requests
Feature suggestions must align with TimeTube's core philosophy: promoting intentional viewing and digital wellbeing.
> **Scope Boundary:** Features that encourage endless scrolling, engagement traps, or dark patterns are strictly out of scope.

When completing the [Feature Request form](https://github.com/17Arigato-jwd/TimeTube/issues/new?template=feature_request.yml), provide:
- **Target Component or Feature Area**: Topbar Menu, Recommendation Pruning, Budget Modes, Overrun Guard, Smart Shorts, Silent Autoplay, Clean Takeover, Popup, Localization / Duration Parser, or Cross-browser Support.
- **Problem or Use Case**: Friction or limitation encountered during your YouTube session.
- **Proposed Solution**: Desired behavior, visual presentation, or interaction model.
- **Suggested Implementation / Architectural Notes (Optional)**: Codebase pointers (e.g., `src/core/` policy resolution and `tests/policy.test.ts` unit tests).
- **Contribution Willingness**: Indicate if you want to implement it and submit a PR (auto-tagged with `pr-welcome` and `good first issue`).

---

## Permissions Justification

- **`storage`**: Persists your active budget, timer countdown, preferences, weekly schedule, and usage totals across tabs and browser restarts.
- **`alarms`**: Powers accurate background countdown ticks and scheduled expiration checks in Manifest V3.
- **Host Permissions (`*://*.youtube.com/*`)**: Injects content scripts, displays the topbar menu, and filters unfinishable video recommendations.

---

## License

[MIT License](LICENSE) © 2026 17Arigato.jwd
