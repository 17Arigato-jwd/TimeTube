# TimeFit for YouTube (Chrome & Firefox MV3 Extension)

A lightweight, cross-browser YouTube extension that dynamically filters Home, Search, and Watch sidebar recommendations so you only see videos you have time to finish before your break ends.

## Key Features

- **Three budget modes:** Countdown timer (`15m / 25m / 45m` or custom), clock end time (`Until HH:MM`), or static max video length.
- **Active Watch-sidebar pruning:** Re-evaluates every 4 seconds while you watch; if switching to a sidebar video *now* won't leave enough time to finish it, that card is non-destructively hidden (or dimmed).
- **Autoplay onboarding & verification:** Prompts you at initial setup to disable YouTube Autoplay (*Highlight toggle / How to disable*, *I've already done it*, or *Not now*). Clicking *Not now* snoozes the extension until page reload or opening the toolbar popup; clicking *I've already done it* verifies the player toggle whenever a video opens and pauses playback if Autoplay is still on.
- **Smart Shorts handling:** Keeps Shorts thumbnails in Home and Search, hides only the Shorts navigation button (desktop sidebar + mobile bottom bar), lazily resolves and displays each Short's duration pill on its thumbnail, and supports either opening all Shorts in the standard `/watch?v=` player or running a 3-stage escalation (50% elapsed nudge → 25% remaining nudge → mandatory switch to `/watch?v=<id>&t=<sec>` and session lock at 5 or 10 minutes left).

## Build & Test

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Load Unpacked

### Chrome / Edge / Brave
1. Run `npm run build` (pre-built `dist/` files are already included in this archive).
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select this folder.

### Firefox (Desktop)
1. Swap `manifest.firefox.json` into `manifest.json` (e.g., `cp manifest.firefox.json manifest.json`).
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...** and select `manifest.json`.
