'use client';

import { useEffect, useMemo, useState } from "react";
import {
  LiveKitRoom,
  useVoiceAssistant,
  useTranscriptions,
  RoomAudioRenderer,
  VoiceAssistantControlBar,
  useRoomContext,
} from "@livekit/components-react";
import type { TokenRequest } from "@/lib/clientApi";
import { getLiveKitToken } from "@/lib/clientApi";

const ROOM_NAME = "talkback-room";

interface CallProps {
  systemPrompt: string;
  kbId: string;
}

type RagResult = {
  content: string;
  metadata?: {
    doc_id?: string;
    filename?: string;
    chunk_index?: number;
    [key: string]: unknown;
  };
};

function CallInner({ kbId, userIdentity }: { kbId: string; userIdentity: string | null }) {
  const { state } = useVoiceAssistant();
  const transcriptions = useTranscriptions();
  const [ragResults, setRagResults] = useState<RagResult[]>([]);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [loadingRag, setLoadingRag] = useState(false);

  const userTranscriptions = useMemo(
    () =>
      transcriptions.filter(
        (t) => userIdentity && t.participantInfo?.identity === userIdentity,
      ),
    [transcriptions, userIdentity],
  );

  const room = useRoomContext();
  useEffect(() => {
    if (!room) return;
    const handler = (payload: Uint8Array) => {
      const decoded = new TextDecoder().decode(payload);
      let data: unknown;
      try {
        data = JSON.parse(decoded);
      } catch {
        console.warn("Received non-JSON data packet", decoded);
        return;
      }

      if (typeof data === "object" && data && (data as any).type === "rag_sources") {
        const sources = (data as { sources?: RagResult[] }).sources ?? [];
        console.log("rag_sources", sources);
        setRagResults(sources);
        setLoadingRag(false);
      }
    };
    room.on("dataReceived", handler);
    return () => {
      room.off("dataReceived", handler);
    };
  }, [room]);


  useEffect(() => {
    if (userTranscriptions.length === 0) return;
    const last = userTranscriptions[userTranscriptions.length - 1];
    const q = (last.text || "").trim();
    if (!q || q === lastQuery) return;

    setLastQuery(q);
    setLoadingRag(true);
    setRagResults([]);
  }, [kbId, lastQuery, userTranscriptions]);

  return (
    <div className="mt-4 flex flex-col gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-800 shadow-sm">
      <RoomAudioRenderer />
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        Voice assistant {state}
      </p>
      <VoiceAssistantControlBar />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Transcript
          </h3>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 text-xs">
            {transcriptions.length === 0 && (
              <p className="text-zinc-400">Speak into your microphone to start the conversation.</p>
            )}
            {transcriptions.map((t, idx) => {
              const isUser = userIdentity && t.participantInfo?.identity === userIdentity;
              return (
                <p
                  key={idx}
                  className={isUser ? "text-blue-700" : "text-zinc-700"}
                >
                  <span className={isUser ? "font-semibold text-blue-800" : "font-semibold text-zinc-900"}>
                    {isUser ? "You:" : "Agent:"}
                  </span>{" "}
                  {t.text}
                </p>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            RAG context used
          </h3>
          <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 text-xs">
            {loadingRag && <p className="text-zinc-400">Looking up relevant context…</p>}
            {!loadingRag && ragResults.length === 0 && (
              <p className="text-zinc-400">
                No relevant context found for the latest question, or you haven&apos;t uploaded any
                documents yet.
              </p>
            )}
            {ragResults.map((r, idx) => {
              const meta = (r.metadata ?? {}) as {
                filename?: string;
                doc_id?: string;
                chunk_index?: number;
              };
              return (
                <div key={idx} className="rounded-md bg-zinc-50 p-2">
                  <p className="mb-1 text-[11px] font-medium text-zinc-600">
                    Source {idx + 1}
                    {meta.filename && ` – ${meta.filename}`}
                    {typeof meta.chunk_index === "number" && ` (chunk ${meta.chunk_index})`}
                  </p>
                  <p className="text-[11px] leading-snug text-zinc-800 line-clamp-4">
                    {r.content}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Call({ systemPrompt, kbId }: CallProps) {
  const [tokenInfo, setTokenInfo] = useState<{ token: string; serverUrl: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [userIdentity, setUserIdentity] = useState<string | null>(null);

  const handleStartCall = async () => {
    setErr(null);
    setConnecting(true);
    try {
      const identity = `user-${Date.now()}`;
      const req: TokenRequest = {
        room_name: ROOM_NAME,
        participant_identity: identity,
        metadata: { system_prompt: systemPrompt, kb_id: kbId },
      };
      const data = await getLiveKitToken(req);
      setTokenInfo({ token: data.token, serverUrl: data.url });
      setUserIdentity(identity);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setConnecting(false);
    }
  };

  if (tokenInfo && userIdentity) {
    return (
      <LiveKitRoom
        serverUrl={tokenInfo.serverUrl}
        token={tokenInfo.token}
        connect
        onDisconnected={() => setTokenInfo(null)}
        audio
        video={false}
        onError={(e) => setErr(e?.message ?? "Room error")}
        connectOptions={{ autoSubscribe: true }}
        options={{ publishDefaults: { simulcast: false } }}
      >
        <CallInner kbId={kbId} userIdentity={userIdentity} />
      </LiveKitRoom>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">Voice call</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Connect to the LiveKit room to talk to the agent. The agent will use your system prompt
          and knowledge base.
        </p>
      </div>
      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <div className="mt-2">
        <button
          type="button"
          onClick={handleStartCall}
          disabled={connecting}
          className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {connecting ? "Connecting…" : "Start call"}
        </button>
      </div>
    </section>
  );
}

