/**
 * Parses YouTube duration badges ("4:32", "1:05:20", "0:45") or
 * ARIA duration labels ("12 minutes, 30 seconds", "45 seconds") into seconds.
 * Ignores relative upload times like "2 hours ago" or non-numeric badges like "New" / "LIVE".
 */
export function parseDurationText(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;

  // Standard colon-separated format: MM:SS or HH:MM:SS (exact or embedded)
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

  // Spoken ARIA label fallback: e.g., "1 hour, 5 minutes, 20 seconds" (excluding "2 hours ago")
  const hoursMatch = cleaned.match(/(\d+)\s+hours?(?!\s+ago\b)/i);
  const minsMatch = cleaned.match(/(\d+)\s+minutes?(?!\s+ago\b)/i);
  const secsMatch = cleaned.match(/(\d+)\s+seconds?(?!\s+ago\b)/i);

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
