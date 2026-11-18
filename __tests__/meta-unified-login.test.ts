import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  exchangeCodeForToken,
  getAuthorizationUrl,
} from "../lib/meta/oauth";
import {
  getAssignedInstagramAccounts,
  getUserInfo,
} from "../lib/meta/client";

const fetchMock = vi.fn();

function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("INSTAGRAM_APP_ID", "1234567890");
  vi.stubEnv("INSTAGRAM_APP_SECRET", "app-secret");
  vi.stubEnv("INSTAGRAM_CONFIG_ID", "987654321");
});

describe("Unified Login authorization URL", () => {
  it("targets the Facebook dialog with the configuration ID and no scope", () => {
    const url = new URL(
      getAuthorizationUrl("https://example.com/api/instagram/callback", "state123")
    );

    expect(url.origin + url.pathname).toBe("https://www.facebook.com/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("1234567890");
    expect(url.searchParams.get("config_id")).toBe("987654321");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://example.com/api/instagram/callback"
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("prompt")).toBe("login");
    expect(url.searchParams.get("state")).toBe("state123");
    // Permissions and assets come from the configuration, never from a
    // scope parameter.
    expect(url.searchParams.has("scope")).toBe(false);
  });
});

describe("Unified Login code exchange", () => {
  it("exchanges the code on graph.facebook.com and reads a token lifetime", async () => {
    respond({ access_token: "bisu-token", expires_in: 3600 });

    await expect(
      exchangeCodeForToken("the-code", "https://example.com/api/instagram/callback")
    ).resolves.toEqual({ accessToken: "bisu-token", expiresIn: 3600 });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.origin).toBe("https://graph.facebook.com");
    expect(calledUrl.pathname).toBe("/v25.0/oauth/access_token");
    expect(calledUrl.searchParams.get("client_id")).toBe("1234567890");
    expect(calledUrl.searchParams.get("client_secret")).toBe("app-secret");
    expect(calledUrl.searchParams.get("code")).toBe("the-code");
    expect(calledUrl.searchParams.get("redirect_uri")).toBe(
      "https://example.com/api/instagram/callback"
    );
  });

  it("treats a missing expires_in as a non-expiring token", async () => {
    respond({ access_token: "bisu-token" });

    await expect(
      exchangeCodeForToken("the-code", "https://example.com/callback")
    ).resolves.toEqual({ accessToken: "bisu-token", expiresIn: null });
  });

  it("throws Meta's error message when the exchange is rejected", async () => {
    respond(
      { error: { message: "Invalid verification code format", code: 100 } },
      400
    );

    await expect(
      exchangeCodeForToken("bad-code", "https://example.com/callback")
    ).rejects.toThrow("Invalid verification code format");
  });
});

describe("Unified Login account discovery", () => {
  it("returns the accounts from assigned_instagram_accounts", async () => {
    respond({ data: [{ id: "17841400008460056", username: "weareanga" }] });

    await expect(getAssignedInstagramAccounts("bisu-token")).resolves.toEqual([
      { id: "17841400008460056", username: "weareanga" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain(
      "graph.facebook.com/v25.0/me/assigned_instagram_accounts"
    );
  });

  it("falls back to the business portfolio edges when assigned is empty", async () => {
    respond({ data: [] }); // assigned_instagram_accounts
    respond({ client_business_id: "555", id: "999" }); // /me
    respond({ data: [{ id: "17841400008460056", username: "weareanga" }] }); // owned
    respond({ data: [] }); // client

    await expect(getAssignedInstagramAccounts("bisu-token")).resolves.toEqual([
      { id: "17841400008460056", username: "weareanga" },
    ]);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls[1]).toContain("/me?");
    expect(urls[1]).toContain("fields=client_business_id");
    expect(urls[2]).toContain("/555/owned_instagram_accounts");
    expect(urls[3]).toContain("/555/client_instagram_accounts");
  });

  it("returns an empty list when no source has an account", async () => {
    respond({ data: [] });
    respond({ client_business_id: "555", id: "999" });
    respond({ data: [] });
    respond({ data: [] });

    await expect(getAssignedInstagramAccounts("bisu-token")).resolves.toEqual([]);
  });
});

describe("Unified Login profile reads", () => {
  it("reads the profile from the account node, not /me", async () => {
    respond({ id: "17841400008460056", username: "weareanga", name: "ANGA" });

    await expect(getUserInfo("bisu-token", "17841400008460056")).resolves.toEqual({
      id: "17841400008460056",
      username: "weareanga",
      name: "ANGA",
    });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.origin).toBe("https://graph.facebook.com");
    expect(calledUrl.pathname).toBe("/v25.0/17841400008460056");
    // This host has no user_id field; asking for it would fail the read.
    expect(calledUrl.searchParams.get("fields")).not.toContain("user_id");
  });
});
