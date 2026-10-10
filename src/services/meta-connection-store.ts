import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

export type MetaProvider = "graph" | "threads";

export interface StoredMetaConnection {
  accessToken: string;
  expiresAt: number | null;
  scopes: string[];
  accountId: string;
  username?: string;
}

export interface PendingMetaAuthorization {
  provider: MetaProvider;
  scopes: string[];
  createdAt: number;
}

interface EncryptedValue {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export type PageTokenRefresh = (pageId: string, staleToken: string, refresh: () => Promise<string>) => Promise<string>;

export class MetaConnectionStore {
  private readonly database: InstanceType<typeof Database>;
  private readonly pageTokenRefreshes = new Map<string, Promise<string>>();

  constructor(path: string, private readonly encryptionKey: Buffer) {
    const absolutePath = resolve(path);
    mkdirSync(dirname(absolutePath), { recursive: true, mode: 0o700 });
    this.database = new Database(absolutePath);
    chmodSync(absolutePath, 0o600);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS oauth_states (
        state_hash TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('graph', 'threads')),
        scopes_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS oauth_states_created_at ON oauth_states(created_at);
      CREATE TABLE IF NOT EXISTS connections (
        subject TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('graph', 'threads')),
        encrypted_value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (subject, provider)
      );
      CREATE TABLE IF NOT EXISTS page_tokens (
        subject TEXT NOT NULL,
        page_id TEXT NOT NULL,
        encrypted_value TEXT NOT NULL,
        PRIMARY KEY (subject, page_id)
      );
      CREATE TABLE IF NOT EXISTS pending_connections (
        code_hash TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('graph', 'threads')),
        encrypted_value TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS pending_connections_created_at ON pending_connections(created_at);
      CREATE TABLE IF NOT EXISTS data_deletion_requests (
        code_hash TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('completed')),
        created_at INTEGER NOT NULL
      );
    `);
  }

  createAuthorizationState(state: string, pending: PendingMetaAuthorization): void {
    this.database.prepare("DELETE FROM oauth_states WHERE created_at < ?").run(Date.now() - 15 * 60_000);
    this.database.prepare(`
      INSERT INTO oauth_states (state_hash, provider, scopes_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(this.hash(state), pending.provider, JSON.stringify(pending.scopes), pending.createdAt);
  }

  consumeAuthorizationState(state: string): PendingMetaAuthorization | undefined {
    const row = this.database.prepare(`
      DELETE FROM oauth_states WHERE state_hash = ?
      RETURNING provider, scopes_json, created_at
    `).get(this.hash(state)) as { provider: MetaProvider; scopes_json: string; created_at: number } | undefined;
    if (!row || Date.now() - row.created_at > 10 * 60_000) return undefined;
    return { provider: row.provider, scopes: JSON.parse(row.scopes_json) as string[], createdAt: row.created_at };
  }

  createPendingConnection(code: string, provider: MetaProvider, connection: StoredMetaConnection): void {
    const now = Date.now();
    this.database.prepare("DELETE FROM pending_connections WHERE created_at < ?").run(now - 10 * 60_000);
    this.database.prepare("INSERT INTO pending_connections (code_hash, provider, encrypted_value, created_at) VALUES (?, ?, ?, ?)")
      .run(this.hash(code), provider, this.encrypt(connection), now);
  }

  consumePendingConnection(code: string): { provider: MetaProvider; connection: StoredMetaConnection } | undefined {
    const row = this.database.prepare(`
      DELETE FROM pending_connections WHERE code_hash = ?
      RETURNING provider, encrypted_value, created_at
    `).get(this.hash(code)) as { provider: MetaProvider; encrypted_value: string; created_at: number } | undefined;
    if (!row || Date.now() - row.created_at > 10 * 60_000) return undefined;
    return { provider: row.provider, connection: this.decrypt<StoredMetaConnection>(row.encrypted_value) };
  }

  saveConnection(subject: string, provider: MetaProvider, connection: StoredMetaConnection): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO connections (subject, provider, encrypted_value, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(subject, provider) DO UPDATE SET encrypted_value = excluded.encrypted_value, updated_at = excluded.updated_at
      `).run(subject, provider, this.encrypt(connection), Date.now());
      if (provider === "graph") this.database.prepare("DELETE FROM page_tokens WHERE subject = ?").run(subject);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getConnection(subject: string, provider: MetaProvider): StoredMetaConnection | undefined {
    const row = this.database.prepare("SELECT encrypted_value FROM connections WHERE subject = ? AND provider = ?").get(subject, provider) as { encrypted_value: string } | undefined;
    return row ? this.decrypt<StoredMetaConnection>(row.encrypted_value) : undefined;
  }

  listConnections(subject: string): Array<{ provider: MetaProvider; connection: StoredMetaConnection; updatedAt: number }> {
    const rows = this.database.prepare("SELECT provider, encrypted_value, updated_at FROM connections WHERE subject = ? ORDER BY provider").all(subject) as Array<{ provider: MetaProvider; encrypted_value: string; updated_at: number }>;
    return rows.map((row) => ({ provider: row.provider, connection: this.decrypt<StoredMetaConnection>(row.encrypted_value), updatedAt: row.updated_at }));
  }

  deleteConnection(subject: string, provider: MetaProvider): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("DELETE FROM connections WHERE subject = ? AND provider = ?").run(subject, provider);
      if (provider === "graph") this.database.prepare("DELETE FROM page_tokens WHERE subject = ?").run(subject);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  deleteMetaUserConnections(provider: MetaProvider, accountId: string): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.deleteMatchingMetaUserData(provider, accountId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  completeMetaUserDataDeletion(provider: MetaProvider, accountId: string, confirmationCode: string): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.deleteMatchingMetaUserData(provider, accountId);
      this.database.prepare("INSERT INTO data_deletion_requests (code_hash, status, created_at) VALUES (?, 'completed', ?)")
        .run(this.hash(confirmationCode), Date.now());
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getDataDeletionStatus(confirmationCode: string): { status: "completed"; createdAt: number } | undefined {
    const row = this.database.prepare("SELECT status, created_at FROM data_deletion_requests WHERE code_hash = ?")
      .get(this.hash(confirmationCode)) as { status: "completed"; created_at: number } | undefined;
    return row ? { status: row.status, createdAt: row.created_at } : undefined;
  }

  getPageTokens(subject: string): Array<[string, string]> {
    const rows = this.database.prepare("SELECT page_id, encrypted_value FROM page_tokens WHERE subject = ?").all(subject) as Array<{ page_id: string; encrypted_value: string }>;
    return rows.map((row) => [row.page_id, this.decrypt<{ token: string }>(row.encrypted_value).token]);
  }

  savePageToken(subject: string, pageId: string, token: string): void {
    if (!this.getConnection(subject, "graph")) return;
    this.database.prepare(`
      INSERT INTO page_tokens (subject, page_id, encrypted_value) VALUES (?, ?, ?)
      ON CONFLICT(subject, page_id) DO UPDATE SET encrypted_value = excluded.encrypted_value
    `).run(subject, pageId, this.encrypt({ token }));
  }

  coordinatePageTokenRefresh(subject: string): PageTokenRefresh {
    return async (pageId, staleToken, refresh) => {
      const key = `${subject}:${pageId}`;
      let pending = this.pageTokenRefreshes.get(key);
      if (!pending) {
        pending = (async () => {
          const current = this.getPageTokens(subject).find(([id]) => id === pageId)?.[1];
          return current && current !== staleToken ? current : refresh();
        })().finally(() => this.pageTokenRefreshes.delete(key));
        this.pageTokenRefreshes.set(key, pending);
      }
      return pending;
    };
  }

  close(): void {
    this.database.close();
  }

  private deleteMatchingMetaUserData(provider: MetaProvider, accountId: string): void {
    const connections = this.database.prepare("SELECT subject, encrypted_value FROM connections WHERE provider = ?")
      .all(provider) as Array<{ subject: string; encrypted_value: string }>;
    const owners = connections
      .filter((row) => this.decrypt<StoredMetaConnection>(row.encrypted_value).accountId === accountId)
      .map((row) => row.subject);
    const deleteConnection = this.database.prepare("DELETE FROM connections WHERE subject = ? AND provider = ?");
    const deletePageTokens = this.database.prepare("DELETE FROM page_tokens WHERE subject = ?");
    for (const subject of owners) {
      deleteConnection.run(subject, provider);
      if (provider === "graph") deletePageTokens.run(subject);
    }

    const pending = this.database.prepare("SELECT code_hash, encrypted_value FROM pending_connections WHERE provider = ?")
      .all(provider) as Array<{ code_hash: string; encrypted_value: string }>;
    const deletePending = this.database.prepare("DELETE FROM pending_connections WHERE code_hash = ?");
    for (const row of pending) {
      if (this.decrypt<StoredMetaConnection>(row.encrypted_value).accountId === accountId) deletePending.run(row.code_hash);
    }
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private encrypt(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    const payload: EncryptedValue = { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
    return JSON.stringify(payload);
  }

  private decrypt<T>(serialized: string): T {
    const payload = JSON.parse(serialized) as EncryptedValue;
    if (payload.version !== 1) throw new Error("Unsupported encrypted Meta token record version.");
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString("utf8");
    return JSON.parse(plaintext) as T;
  }
}
