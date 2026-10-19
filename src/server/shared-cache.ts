/**
 * A small key-value store shared by every instance of your server (Redis,
 * Workers KV, a database table...), where it can remember what it has learned.
 *
 * Serverless instances start cold all the time, and with only their own memory
 * each one would look a review app's PR up from scratch, which takes seconds.
 * With a shared cache, the first lookup serves them all. Entries expire on
 * their own (`ttlSeconds`); nothing in it is secret.
 */
export type SharedCache = {
  /** the value, or null if there's none (or it expired) */
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
};
