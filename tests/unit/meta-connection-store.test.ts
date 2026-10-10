import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MetaConnectionStore } from "../../src/services/meta-connection-store.js";

const temporaryDirectories: string[] = [];

function createStore(): MetaConnectionStore {
  const directory = mkdtempSync(join(tmpdir(), "meta-token-store-test-"));
  temporaryDirectories.push(directory);
  return new MetaConnectionStore(join(directory, "connections.sqlite"), randomBytes(32));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Meta connection storage", () => {
  it("encrypts credentials at rest and isolates connections by MCP subject", () => {
    const store = createStore();
    const token = "sensitive-meta-access-token-value";
    try {
      store.saveConnection("owner-a", "graph", { accessToken: token, expiresAt: null, scopes: ["pages_show_list"], accountId: "meta-user-a" });
      store.saveConnection("owner-b", "graph", { accessToken: "other-user-token", expiresAt: null, scopes: [], accountId: "meta-user-b" });
      expect(store.getConnection("owner-a", "graph")?.accessToken).toBe(token);
      expect(store.getConnection("owner-b", "graph")?.accountId).toBe("meta-user-b");
      const databaseText = readFileSync(join(temporaryDirectories[0], "connections.sqlite")).toString("utf8");
      expect(databaseText).not.toContain(token);
    } finally {
      store.close();
    }
  });

  it("consumes authorization state once and removes cached Page credentials on disconnect", () => {
    const store = createStore();
    try {
      store.createAuthorizationState("high-entropy-state", { provider: "graph", scopes: [], createdAt: Date.now() });
      expect(store.consumeAuthorizationState("high-entropy-state")?.provider).toBe("graph");
      expect(store.consumeAuthorizationState("high-entropy-state")).toBeUndefined();

      store.saveConnection("owner-a", "graph", { accessToken: "graph-secret", expiresAt: null, scopes: [], accountId: "account" });
      store.saveConnection("owner-b", "graph", { accessToken: "other-graph-secret", expiresAt: null, scopes: [], accountId: "other-account" });
      store.savePageToken("owner-a", "page-1", "page-secret");
      store.savePageToken("owner-b", "page-1", "another-page-secret");
      store.deleteConnection("owner-a", "graph");
      expect(store.getConnection("owner-a", "graph")).toBeUndefined();
      expect(store.getPageTokens("owner-a")).toEqual([]);
      expect(store.getPageTokens("owner-b")).toEqual([["page-1", "another-page-secret"]]);
    } finally {
      store.close();
    }
  });
});
