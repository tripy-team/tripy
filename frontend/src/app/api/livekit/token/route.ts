import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { getAuthUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { signJoinLink, verifyJoinLink } from '@/lib/livekit-signing';

export const dynamic = 'force-dynamic';

interface BaseBody {
  roomName: string;
  participantName: string;
}

interface AdvisorBody extends BaseBody {
  role: 'advisor';
  clientId: string;
}

interface ClientBody extends BaseBody {
  role: 'client';
  clientId: string;
  exp: number;
  sig: string;
}

type TokenBody = AdvisorBody | ClientBody;

export async function POST(req: NextRequest) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { error: 'LiveKit server credentials are not configured' },
      { status: 500 },
    );
  }

  let body: TokenBody;
  try {
    body = (await req.json()) as TokenBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.roomName || !body.participantName || !body.role) {
    return NextResponse.json(
      { error: 'roomName, participantName, and role are required' },
      { status: 400 },
    );
  }

  if (body.role === 'advisor') {
    return mintAdvisorToken(req, body, apiKey, apiSecret);
  }
  if (body.role === 'client') {
    return mintClientToken(body, apiKey, apiSecret);
  }
  return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
}

async function mintAdvisorToken(
  req: NextRequest,
  body: AdvisorBody,
  apiKey: string,
  apiSecret: string,
) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!body.clientId) {
    return NextResponse.json(
      { error: 'clientId is required for advisor role' },
      { status: 400 },
    );
  }

  // Verify the advisor actually has access to this client (same organisation)
  const client = await prisma.client.findFirst({
    where: { id: body.clientId, organizationId: user.organizationId },
    select: { id: true, firstName: true },
  });
  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const { token, identity } = await buildToken(
    apiKey,
    apiSecret,
    body.roomName,
    `advisor-${user.id}`,
    body.participantName,
  );

  // Issue a signed join link so the client's browser can call us back safely
  const { exp, sig } = signJoinLink(body.roomName, client.id);

  return NextResponse.json({
    token,
    identity,
    roomName: body.roomName,
    joinLink: {
      clientId: client.id,
      exp,
      sig,
    },
  });
}

async function mintClientToken(
  body: ClientBody,
  apiKey: string,
  apiSecret: string,
) {
  const check = verifyJoinLink(body.roomName, body.clientId, body.exp, body.sig);
  if (!check.ok) {
    return NextResponse.json(
      { error: `Invalid or expired join link (${check.reason})` },
      { status: 403 },
    );
  }

  const { token, identity } = await buildToken(
    apiKey,
    apiSecret,
    body.roomName,
    `client-${body.clientId}`,
    body.participantName,
  );

  return NextResponse.json({ token, identity, roomName: body.roomName });
}

async function buildToken(
  apiKey: string,
  apiSecret: string,
  roomName: string,
  identity: string,
  displayName: string,
): Promise<{ token: string; identity: string }> {
  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name: displayName,
    ttl: 60 * 60,
  });
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return { token: await at.toJwt(), identity };
}
