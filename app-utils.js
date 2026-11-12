export function localDate(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export function safeUrl(value, calendar = false) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return '#';
    if (calendar && (url.protocol !== 'https:' || url.hostname !== 'calendar.google.com' || !url.pathname.startsWith('/calendar/embed'))) return '#';
    return url.href.replace(/"/g, '%22').replace(/'/g, '%27').replace(/</g, '%3C').replace(/>/g, '%3E');
  } catch { return '#'; }
}

export function safeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#888888';
}

export function inlineValue(value) {
  return String(value ?? '').replace(/[\\'"<>&\r\n]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export async function fetchAll(query, pageSize = 500) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) return { data: rows, error: null };
  }
}

export function restoreTimer(value, now = Date.now()) {
  if (!value || !['focus', 'break'].includes(value.mode) || !Number.isFinite(value.remainingMs) || value.remainingMs < 0) return null;
  if (value.running && (!Number.isFinite(value.endsAt) || value.endsAt <= 0)) return null;
  return { mode: value.mode, running: Boolean(value.running), endsAt: value.endsAt || 0,
    remainingMs: value.running ? Math.max(0, value.endsAt - now) : value.remainingMs, intervalId: null };
}
