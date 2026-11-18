import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    trackedLink: {
      findUnique: vi.fn(),
    },
    linkClick: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/client", () => ({
  prisma: mockPrisma,
}));

import { GET } from "../app/r/[slug]/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tracked link redirect route", () => {
  it("logs a workspace-isolated click and redirects to the destination", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue({
      id: "link_123",
      workspaceId: "workspace_123",
      automationId: "automation_123",
      destinationUrl: "https://example.com/offer",
      automation: {
        instagramAccountId: "instagram_account_123",
      },
    });
    mockPrisma.linkClick.create.mockResolvedValue({});

    const response = await GET(
      new Request("https://manychat-alternative.com/r/abc123", {
        headers: {
          "user-agent": "vitest",
          referer: "https://instagram.com/",
          "x-forwarded-for": "203.0.113.10",
        },
      }) as Parameters<typeof GET>[0],
      { params: Promise.resolve({ slug: "abc123" }) }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/offer");
    expect(mockPrisma.trackedLink.findUnique).toHaveBeenCalledWith({
      where: { slug: "abc123" },
      select: expect.any(Object),
    });
    expect(mockPrisma.linkClick.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace_123",
        automationId: "automation_123",
        instagramAccountId: "instagram_account_123",
        trackedLinkId: "link_123",
        userAgent: "vitest",
        referrer: "https://instagram.com/",
      }),
    });
  });

  it("stores a valid recipient token and ignores a malformed one", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue({
      id: "link_123",
      workspaceId: "workspace_123",
      automationId: "automation_123",
      destinationUrl: "https://example.com/offer",
      automation: { instagramAccountId: "instagram_account_123" },
    });
    mockPrisma.linkClick.create.mockResolvedValue({});
    const token = "AbCdEfGhIjKlMnOpQrSt_-";

    for (const [query, expected] of [
      [`?r=${token}`, token],
      ["?r=not-a-token", null],
      ["", null],
    ] as const) {
      const response = await GET(
        new Request(`https://manychat-alternative.com/r/abc123${query}`) as Parameters<
          typeof GET
        >[0],
        { params: Promise.resolve({ slug: "abc123" }) }
      );

      expect(response.headers.get("location")).toBe("https://example.com/offer");
      expect(mockPrisma.linkClick.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ recipientHash: expected }),
      });
    }
  });

  it("redirects unknown slugs to the homepage without logging a click", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue(null);

    const response = await GET(
      new Request("https://manychat-alternative.com/r/missing") as Parameters<
        typeof GET
      >[0],
      { params: Promise.resolve({ slug: "missing" }) }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://manychat-alternative.com/");
    expect(mockPrisma.linkClick.create).not.toHaveBeenCalled();
  });

  describe("with a Brazil destination on the link", () => {
    const brazilLink = {
      id: "link_123",
      workspaceId: "workspace_123",
      automationId: "automation_123",
      destinationUrl: "https://example.com/offer",
      destinationUrlBr: "https://example.com/offer-br",
      automation: {
        instagramAccountId: "instagram_account_123",
      },
    };

    function click(headers: Record<string, string>) {
      return GET(
        new Request("https://manychat-alternative.com/r/abc123", {
          headers,
        }) as Parameters<typeof GET>[0],
        { params: Promise.resolve({ slug: "abc123" }) }
      );
    }

    beforeEach(() => {
      mockPrisma.trackedLink.findUnique.mockResolvedValue(brazilLink);
      mockPrisma.linkClick.create.mockResolvedValue({});
    });

    it("sends visitors in Brazil to the Brazil destination", async () => {
      const response = await click({ "x-vercel-ip-country": "BR" });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("https://example.com/offer-br");
      expect(mockPrisma.linkClick.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ trackedLinkId: "link_123" }),
      });
    });

    it("sends pt-BR browsers to the Brazil destination", async () => {
      const response = await click({
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      });

      expect(response.headers.get("location")).toBe("https://example.com/offer-br");
    });

    it("sends other visitors to the default destination", async () => {
      const response = await click({
        "x-vercel-ip-country": "US",
        "accept-language": "en-US,en;q=0.9",
      });

      expect(response.headers.get("location")).toBe("https://example.com/offer");
    });

    it("always uses the default destination when no Brazil destination is set", async () => {
      mockPrisma.trackedLink.findUnique.mockResolvedValue({
        ...brazilLink,
        destinationUrlBr: null,
      });

      const response = await click({ "x-vercel-ip-country": "BR" });

      expect(response.headers.get("location")).toBe("https://example.com/offer");
    });
  });
});
