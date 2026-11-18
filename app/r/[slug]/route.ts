import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import {
  getRequestIp,
  hashClickIp,
  parseRecipientToken,
} from "@/lib/tracking/server";

type RedirectRouteProps = {
  params: Promise<{ slug: string }>;
};

// Whether the visitor looks like they are in Brazil: Vercel's country header
// is checked first, and a pt-BR Accept-Language is the fallback signal.
function isBrazilRequest(request: NextRequest): boolean {
  if (request.headers.get("x-vercel-ip-country") === "BR") return true;
  const language = request.headers.get("accept-language")?.toLowerCase() ?? "";
  return language.includes("pt-br");
}

export async function GET(request: NextRequest, { params }: RedirectRouteProps) {
  const { slug } = await params;
  const trackedLink = await prisma.trackedLink.findUnique({
    where: { slug },
    select: {
      id: true,
      workspaceId: true,
      automationId: true,
      destinationUrl: true,
      destinationUrlBr: true,
      automation: {
        select: {
          instagramAccountId: true,
        },
      },
    },
  });

  if (!trackedLink) {
    return NextResponse.redirect(new URL("/", request.url), { status: 302 });
  }

  await prisma.linkClick.create({
    data: {
      workspaceId: trackedLink.workspaceId,
      automationId: trackedLink.automationId,
      instagramAccountId: trackedLink.automation.instagramAccountId,
      trackedLinkId: trackedLink.id,
      ipHash: hashClickIp(getRequestIp(request)),
      recipientHash: parseRecipientToken(
        new URL(request.url).searchParams.get("r")
      ),
      userAgent: request.headers.get("user-agent"),
      referrer: request.headers.get("referer"),
    },
  });

  // A link with a Brazil destination sends Brazil visitors there; everyone
  // else follows the default destination.
  const destinationUrl =
    trackedLink.destinationUrlBr && isBrazilRequest(request)
      ? trackedLink.destinationUrlBr
      : trackedLink.destinationUrl;

  return NextResponse.redirect(destinationUrl, { status: 302 });
}
