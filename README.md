# TimeTube v1.2.2 (`timetube@vchs.com`)

A cross-browser (Chrome & Firefox MV3) YouTube extension that dynamically filters Home, Search, and Watch sidebar recommendations so you only see videos you have time to finish before your break ends.

## What's Included

- **YouTube Top-Bar Quick Menu:** Appears right next to YouTube's **+ Create** button with live remaining-time badges (`1.5hr`, `1hr`, `30m`, `2m`, `53s`, `42s`, `3s`).
- **Dynamic Sidebar & Feed Pruning:** Re-evaluates every 4 seconds while watching; hides or dims unfinishable videos and nudges infinite scroll when feeds get sparse.
- **Pause, Seek & Direct-Link Overrun Guard:** Prompts to pause/continue countdown on pause, locks shortcuts (`k`, `Space`, etc.) while a prompt is active, and handles video overruns with exact time add, dynamic playback speed (`≤ 2×`), or a red progress-bar early-cutoff indicator.
- **Smart Shorts & Silent Autoplay Check:** Shows duration pills on Short thumbnails, hides only the Shorts nav button, supports 3-stage Shorts escalation or direct standard-player redirect, and checks Autoplay silently in the background while playing (only prompting if Autoplay is actually ON).
- **Clean "Time's up :)" Takeover:** Clears YouTube and resets the URL to `youtube.com/` the instant your timer hits zero.

## Load Unpacked

- **Firefox:** Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on...** → select `manifest.json`.
- **Chrome / Edge / Brave:** Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder.
