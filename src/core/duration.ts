/**
 * Parses YouTube duration badges ("4:32", "1:05:20", "0:45") or
 * ARIA duration labels ("12 minutes, 30 seconds", "45 seconds") into seconds.
 * Ignores relative upload times like "2 hours ago" or non-numeric badges like "New" / "LIVE".
 */
export function parseDurationText(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;

  const colonMatch = cleaned.match(/\b(\d{1,2}:)?(\d{1,2}):(\d{2})\b/);
  if (colonMatch) {
    const parts = colonMatch[0].split(':').map((p) => Number.parseInt(p, 10));
    if (parts.some((n) => Number.isNaN(n))) return null;
    if (parts.length === 2) {
      return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
    }
    if (parts.length === 3) {
      return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
    }
  }

  const hoursMatch = cleaned.match(/(\d+)\s+hours?\b(?!\s+ago\b)/i);
  const minsMatch = cleaned.match(/(\d+)\s+minutes?\b(?!\s+ago\b)/i);
  const secsMatch = cleaned.match(/(\d+)\s+seconds?\b(?!\s+ago\b)/i);

  if (hoursMatch || minsMatch || secsMatch) {
    const h = hoursMatch ? Number.parseInt(hoursMatch[1] ?? '0', 10) : 0;
    const m = minsMatch ? Number.parseInt(minsMatch[1] ?? '0', 10) : 0;
    const s = secsMatch ? Number.parseInt(secsMatch[1] ?? '0', 10) : 0;
    return h * 3600 + m * 60 + s;
  }

  return null;
}

/** Formats seconds into a compact YouTube-style badge ("0:42", "12:05", "1:02:10"). */
export function formatDurationBadge(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}

/**
 * Formats remaining break time as a compact approximation for TimeTube badges:
 * - >= 1 hour: nearest 0.5hr (e.g. "1hr", "1.5hr", "2hr")
 * - 1..59 min: whole minutes (e.g. "30m", "2m")
 * - < 1 min: exact seconds (e.g. "53s", "42s", "3s")
 */
export function formatApproxRemaining(remainingMs: number): string {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  if (totalSec === 0) return '0s';
  if (totalSec < 60) return `${totalSec}s`;

  const totalMin = totalSec / 60;
  if (totalMin < 59.5) {
    return `${Math.max(1, Math.round(totalMin))}m`;
  }

  const halfHours = Math.round((totalSec / 3600) * 2) / 2;
  const formatted = Number.isInteger(halfHours) ? String(halfHours) : halfHours.toFixed(1);
  return `${formatted}hr`;
}

/** Extracts lengthSeconds from YouTube Shorts/Watch HTML payload. */
export function extractLengthSecondsFromHtml(html: string): number | null {
  const match = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Extracts a YouTube video ID from a /shorts/<id> URL path. */
export function extractShortIdFromHref(href: string): string | null {
  const match = href.match(/\/shorts\/([a-zA-Z0-9_-]{6,})/);
  return match?.[1] ?? null;
}

/**
 * Returns the next 15-minute wall-clock boundary as local 24h "HH:MM".
 * Examples: 02:01 -> "02:15", 03:15 -> "03:30", 23:50 -> "00:00".
 */
export function getDefaultEndTime(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  const totalMinutes = d.getHours() * 60 + d.getMinutes();
  const nextQuarter = ((Math.floor(totalMinutes / 15) + 1) * 15) % (24 * 60);
  const hh = String(Math.floor(nextQuarter / 60)).padStart(2, '0');
  const mm = String(nextQuarter % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
