import { afterEach, describe, expect, it, vi } from "vitest";
import axios, { AxiosError } from "axios";
import { MetaApiClient } from "../../src/services/api.js";
function tokenError(code = 190, error_subcode = 2069032) {
  return new AxiosError("expired", undefined, undefined, undefined, { data: { error: { code, error_subcode } }, status: 400, statusText: "Bad Request", headers: {}, config: {} as any });
}
describe("bounded page-token refresh", () => {
  afterEach(() => vi.restoreAllMocks());
  it("refreshes the matching Page then retries a GET once", async () => {
    const client = new MetaApiClient("user"); client.cachePageToken("page1", "stale");
    const get = vi.spyOn(axios, "get").mockRejectedValueOnce(tokenError()).mockResolvedValueOnce({ data: { data: [{ id: "page1", access_token: "fresh" }] } }).mockResolvedValueOnce({ data: { ok: true } });
    expect(await client.getWithToken("/post/reactions", "stale", { limit: 5 })).toEqual({ ok: true });
    expect(get.mock.calls[1][0]).toMatch(/\/me\/accounts$/);
    expect(get.mock.calls[2][1]?.params).toMatchObject({ access_token: "fresh", limit: 5 });
    expect(client.getPageToken("page1")).toBe("fresh");
  });
  it.each([[190, 1], [10, 2069032]])("does not retry unrelated error %s/%s", async (code, subcode) => {
    const client = new MetaApiClient("user"); client.cachePageToken("p", "stale");
    const error = tokenError(code, subcode); const get = vi.spyOn(axios, "get").mockRejectedValue(error);
    await expect(client.getWithToken("/p/feed", "stale")).rejects.toBe(error); expect(get).toHaveBeenCalledTimes(1);
  });
  it("never retries twice when a refreshed token still fails", async () => {
    const client = new MetaApiClient("user"); client.cachePageToken("p", "stale");
    const error = tokenError(); const get = vi.spyOn(axios, "get").mockRejectedValueOnce(error).mockResolvedValueOnce({ data: { data: [{ id: "p", access_token: "fresh" }] } }).mockRejectedValueOnce(error);
    await expect(client.getWithToken("/p/feed", "stale")).rejects.toBe(error); expect(get).toHaveBeenCalledTimes(3);
  });
  it("does not refresh tokens with no unique cached Page owner", async () => {
    const client = new MetaApiClient("user"); client.cachePageToken("p1", "same"); client.cachePageToken("p2", "same");
    const error = tokenError(); const get = vi.spyOn(axios, "get").mockRejectedValue(error);
    await expect(client.getWithToken("/post/reactions", "same")).rejects.toBe(error); expect(get).toHaveBeenCalledTimes(1);
  });
  it("uses account cursors without following arbitrary next URLs", async () => {
    const client = new MetaApiClient("user"); client.cachePageToken("p", "stale");
    const get = vi.spyOn(axios, "get").mockRejectedValueOnce(tokenError())
      .mockResolvedValueOnce({ data: { data: [], paging: { next: "https://untrusted.invalid", cursors: { after: "next" } } } })
      .mockResolvedValueOnce({ data: { data: [{ id: "p", access_token: "fresh" }] } })
      .mockResolvedValueOnce({ data: { ok: true } });
    await client.getWithToken("/p/feed", "stale");
    expect(get.mock.calls[2][0]).toMatch(/graph.facebook.com.*\/me\/accounts$/);
    expect(get.mock.calls[2][1]?.params.after).toBe("next");
  });
  it("surfaces missing grants without replacing the cache or retrying the Page", async () => {
    const client = new MetaApiClient("user"); client.cachePageToken("p", "stale");
    const get = vi.spyOn(axios, "get").mockRejectedValueOnce(tokenError()).mockResolvedValueOnce({ data: { data: [] } });
    await expect(client.getWithToken("/p/feed", "stale")).rejects.toThrow("Could not refresh access");
    expect(client.getPageToken("p")).toBe("stale"); expect(get).toHaveBeenCalledTimes(2);
  });
  it("coalesces concurrent refreshes for the same Page", async () => {
    const client = new MetaApiClient("user"); client.cachePageToken("p", "stale");
    const get = vi.spyOn(axios, "get").mockRejectedValueOnce(tokenError()).mockRejectedValueOnce(tokenError())
      .mockResolvedValueOnce({ data: { data: [{ id: "p", access_token: "fresh" }] } })
      .mockResolvedValue({ data: { ok: true } });
    await Promise.all([client.getWithToken("/p/feed", "stale"), client.getWithToken("/p/posts", "stale")]);
    expect(get.mock.calls.filter(([url]) => String(url).endsWith("/me/accounts"))).toHaveLength(1);
    expect(get).toHaveBeenCalledTimes(5);
  });
  it("does not refresh or replay writes", async () => {
    const client = new MetaApiClient("user"); client.cachePageToken("p", "stale");
    const error = tokenError(); const post = vi.spyOn(axios, "post").mockRejectedValue(error); const get = vi.spyOn(axios, "get");
    await expect(client.post("/p/feed", {}, "stale")).rejects.toBe(error); expect(post).toHaveBeenCalledTimes(1); expect(get).not.toHaveBeenCalled();
  });
});
