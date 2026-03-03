import { NextRequest, NextResponse } from "next/server";
import { AccessToken, AgentDispatchClient } from "livekit-server-sdk";

export const runtime = "nodejs";

type LiveKitTokenRequest = {
  room_name?: string;
  participant_identity?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as LiveKitTokenRequest;

  const roomName = (body.room_name || "talkback-room").trim() || "talkback-room";
  const participantIdentity =
    (body.participant_identity && body.participant_identity.trim()) ||
    cryptoRandomId();
  const metadataObj = body.metadata ?? {};
  const metadataStr = JSON.stringify(metadataObj);

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl =
    process.env.LIVEKIT_URL || "wss://your-project.livekit.cloud";

  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { detail: "LIVEKIT_API_KEY and LIVEKIT_API_SECRET required" },
      { status: 500 },
    );
  }

  const token = new AccessToken(apiKey, apiSecret, {
    identity: participantIdentity,
    name: participantIdentity,
    metadata: metadataStr,
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
  });

  const jwt = await token.toJwt();

  // Explicitly dispatch the talkback-agent worker for this room, mirroring the previous
  // Python backend's RoomConfiguration + RoomAgentDispatch behavior.
  try {
    const dispatchClient = new AgentDispatchClient(
      livekitUrl,
      apiKey,
      apiSecret,
    );
    await dispatchClient.createDispatch(roomName, "talkback-agent", {
      metadata: metadataStr,
    });
  } catch (e) {
    // If dispatch fails, still return a token so the user can connect;
    // the agent just won't join. Errors will be visible in server logs.
    console.error("Failed to dispatch agent", e);
  }

  return NextResponse.json({
    token: jwt,
    url: livekitUrl,
    room_name: roomName,
  });
}

function cryptoRandomId(): string {
  // Simple helper; avoids importing crypto directly in route file
  return Math.random().toString(36).slice(2, 10);
}

