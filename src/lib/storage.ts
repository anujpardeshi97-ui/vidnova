/* ============================================================================
 * storage.ts - a tiny synchronous "database" on top of window.localStorage.
 *
 * The whole platform (users, subscriptions, payments, downloads, audit logs,
 * mails, watch progress) is persisted here so the demo runs with zero backend
 * while still behaving like a real database: atomic writes, namespaced
 * collections, versioned schema and JSON serialisation.
 * ==========================================================================*/

const NAMESPACE = 'nexstream';
const SCHEMA_VERSION = 1;

/** Every logical table of our mini-database. */
export interface Tables {
  users: unknown[];
  subscriptions: unknown[];
  transactions: unknown[];
  orders: unknown[];
  downloads: unknown[];
  downloadAudit: unknown[];
  quotas: unknown[];
  loginRecords: unknown[];
  otpCodes: unknown[];
  mails: unknown[];
  watchProgress: unknown[];
  watchEvents: unknown[];
  comments: unknown[];
  sessions: unknown[];
  callRooms: unknown[];
  callChat: unknown[];
  callLogs: unknown[];
  recordings: unknown[];
}

type TableName = keyof Tables;

function key(table: TableName): string {
  return `${NAMESPACE}:${SCHEMA_VERSION}:${table}`;
}

/** Read + parse one table. Never throws: corrupt data degrades to []. */
export function readTable<T>(table: TableName): T[] {
  try {
    const raw = localStorage.getItem(key(table));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** Overwrite one table atomically (single localStorage.setItem call). */
export function writeTable<T>(table: TableName, rows: T[]): void {
  try {
    localStorage.setItem(key(table), JSON.stringify(rows));
  } catch (err) {
    // Quota exceeded or private-mode storage: surface loudly, never crash.
    console.error(`[db] failed to write table "${table}"`, err);
  }
}

/** Insert or update a row by its `id` field. Returns the stored row. */
export function upsert<T extends { id: string }>(table: TableName, row: T): T {
  const rows = readTable<T>(table);
  const index = rows.findIndex((r) => r.id === row.id);
  if (index >= 0) rows[index] = { ...rows[index], ...row };
  else rows.push(row);
  writeTable(table, rows);
  return row;
}

/** Patch a row in place (partial update). */
export function patch<T extends { id: string }>(
  table: TableName,
  id: string,
  changes: Partial<T>,
): T | null {
  const rows = readTable<T>(table);
  const index = rows.findIndex((r) => r.id === id);
  if (index < 0) return null;
  rows[index] = { ...rows[index], ...changes };
  writeTable(table, rows);
  return rows[index];
}

export function findById<T extends { id: string }>(table: TableName, id: string): T | undefined {
  return readTable<T>(table).find((r) => r.id === id);
}

export function remove(table: TableName, id: string): void {
  writeTable(table, readTable<{ id: string }>(table).filter((r) => r.id !== id));
}

/** Remove every row matching a predicate. */
export function removeWhere<T>(table: TableName, predicate: (row: T) => boolean): number {
  const rows = readTable<T>(table);
  const kept = rows.filter((r) => !predicate(r));
  writeTable(table, kept);
  return rows.length - kept.length;
}

/** Convenience query helper: first match. */
export function findOne<T>(table: TableName, predicate: (row: T) => boolean): T | undefined {
  return readTable<T>(table).find(predicate);
}

/** Convenience query helper: all matches. */
export function filter<T>(table: TableName, predicate: (row: T) => boolean): T[] {
  return readTable<T>(table).filter(predicate);
}

/** Wrap a callback so it only executes once per (key, time-window). Used for
 *  throttling noisy audit writes. */
const throttleMap = new Map<string, number>();
export function throttle(keyName: string, windowMs: number): boolean {
  const now = Date.now();
  const last = throttleMap.get(keyName) ?? 0;
  if (now - last < windowMs) return false;
  throttleMap.set(keyName, now);
  return true;
}

/** Wipe the entire namespace (used by "reset demo data"). */
export function resetDatabase(): void {
  (Object.keys({
    users: [], subscriptions: [], transactions: [], orders: [], downloads: [],
    downloadAudit: [], quotas: [], loginRecords: [], otpCodes: [], mails: [],
    watchProgress: [], watchEvents: [], comments: [], sessions: [], callRooms: [], callChat: [],
    callLogs: [], recordings: [],
  }) as TableName[]).forEach((t) => localStorage.removeItem(key(t)));
}

export const TABLES = {
  USERS: 'users' as const,
  SUBSCRIPTIONS: 'subscriptions' as const,
  TRANSACTIONS: 'transactions' as const,
  ORDERS: 'orders' as const,
  DOWNLOADS: 'downloads' as const,
  DOWNLOAD_AUDIT: 'downloadAudit' as const,
  QUOTAS: 'quotas' as const,
  LOGIN_RECORDS: 'loginRecords' as const,
  OTP_CODES: 'otpCodes' as const,
  MAILS: 'mails' as const,
  WATCH_PROGRESS: 'watchProgress' as const,
  WATCH_EVENTS: 'watchEvents' as const,
  COMMENTS: 'comments' as const,
  SESSIONS: 'sessions' as const,
  CALL_ROOMS: 'callRooms' as const,
  CALL_CHAT: 'callChat' as const,
  CALL_LOGS: 'callLogs' as const,
  RECORDINGS: 'recordings' as const,
};

/** Reasonably unique id generator (time-ordered + random suffix). */
export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
