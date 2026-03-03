'use client';

import { useState } from "react";
import Call from "@/components/Call";
import KBUpload from "@/components/KBUpload";

const DEFAULT_PROMPT = `You are a helpful voice assistant. Answer questions concisely.
When the user asks about something, use the relevant context from the knowledge base if it was provided.
Keep responses short and natural for voice.`;

export default function TalkBackApp() {
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT);
  const kbId = "default";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          TalkBack – Voice AI with RAG
        </h1>
        <p className="max-w-2xl text-sm text-zinc-500">
          Talk to the agent over WebRTC. Edit the system prompt and upload documents for the
          knowledge base. The Python LiveKit worker stays separate; this Next.js app handles UI and
          APIs.
        </p>
      </header>

      <main className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)]">
        <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-900">System prompt</h2>
          <p className="text-sm text-zinc-500">
            This prompt is sent to the agent when you start a call. Tweak it to change the agent’s
            behavior.
          </p>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={8}
            className="mt-2 w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 shadow-inner focus:border-zinc-400 focus:outline-none"
            placeholder="Agent instructions…"
          />
        </section>

        <Call systemPrompt={systemPrompt} kbId={kbId} />
      </main>

      <KBUpload />
    </div>
  );
}

