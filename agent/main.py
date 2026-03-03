import json
import logging
import re
from typing import AsyncIterable

from dotenv import load_dotenv
from config import config
from livekit.agents import (
    Agent,
    AgentSession,
    AutoSubscribe,
    JobContext,
    JobProcess,
    ModelSettings,
    WorkerOptions,
    cli,
)
from livekit.agents.llm import ChatContext, ChatMessage
from livekit.plugins import openai, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel
from services.llm import rag_lookup
from services.stt import STTService
from services.tts import TTSService

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice-agent")


def _extract_chunk_ids(text: str) -> set[int]:
    """Parse chunk IDs like [1], [2] from the LLM's answer text."""
    if not text:
        return set()

    ids: set[int] = set()
    for match in re.findall(r"\[(\d+)\]", text):
        try:
            ids.add(int(match))
        except ValueError:
            continue
    return ids


class RAGAssistant(Agent):
    """Voice agent with RAG: on_user_turn_completed injects KB context before LLM reply."""

    def __init__(
        self,
        instructions: str = config.default_system_prompt,
        kb_id: str = config.default_kb_id,
        room=None,
    ) -> None:
        # Encourage the model to explicitly cite the numbered RAG chunks it uses.
        augmented_instructions = (
            instructions
        )

        super().__init__(
            instructions=augmented_instructions,
            stt=STTService().create(),
            llm=openai.LLM(model="gpt-4o-mini"),
            tts=TTSService().create(),
            turn_detection=MultilingualModel(),
        )
        self._kb_id = kb_id
        # Keep a reference to the room so we can publish data packets
        # without relying on ChatContext.
        self._room = room
        # Per-turn RAG sources keyed by numeric id; used for citation-based filtering.
        self._last_sources: list[dict] = []

    async def on_user_turn_completed(
        self,
        turn_ctx: ChatContext,
        new_message: ChatMessage,
    ) -> None:
        # Reset per-turn sources at the start of each user turn.
        self._last_sources = []

        # text_content is a string property in current livekit-agents, not a callable
        text = (new_message.text_content or "").strip()
        if not text or not self._kb_id:
            return

        context_str, sources = await rag_lookup(text, self._kb_id)
        # Store sources for this turn so a later hook (transcription_node) can
        # publish only those chunks that are actually cited in the final answer.
        if sources:
            self._last_sources = sources

        if context_str:
            turn_ctx.add_message(
                role="assistant",
                content=f"Relevant context from the knowledge base:\n{context_str}",
            )

    async def transcription_node(
        self,
        text: AsyncIterable[str],
        model_settings: ModelSettings,
    ) -> AsyncIterable[str]:
        """Tap into the final agent transcription to publish only cited RAG sources.

        We stream out the text unchanged while buffering it locally. Once the
        stream completes, we parse for chunk IDs like [1], [2] in the answer
        and publish only those sources whose ids were cited.
        """
        buffered_segments: list[str] = []

        async for delta in Agent.default.transcription_node(self, text, model_settings):
            buffered_segments.append(delta)
            yield delta

        full_text = "".join(buffered_segments).strip()
        if not full_text:
            return

        cited_ids = _extract_chunk_ids(full_text)
        used_sources: list[dict]
        if cited_ids and self._last_sources:
            # Prefer only the cited chunks when the model includes [1], [2], etc.
            used_sources = [
                src
                for src in self._last_sources
                if isinstance(src.get("id"), int) and src["id"] in cited_ids
            ] or self._last_sources
        else:
            # If there are no citations or no RAG results, fall back to whatever
            # sources were returned by the backend (possibly an empty list).
            used_sources = self._last_sources

        room = self._room
        if room is not None and getattr(room, "local_participant", None):
            payload = json.dumps({"type": "rag_sources", "sources": used_sources})
            await room.local_participant.publish_data(
                payload.encode("utf-8"),
                reliable=True,
            )



def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()


async def entrypoint(ctx: JobContext) -> None:
    logger.info("Connecting to room %s", ctx.room.name)
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    participant = await ctx.wait_for_participant()
    logger.info("Starting voice agent for participant %s", participant.identity)

    # Read metadata set by backend when issuing token (system_prompt, kb_id)
    metadata_str = participant.metadata or "{}"
    try:
        metadata = json.loads(metadata_str)
    except json.JSONDecodeError:
        metadata = {}
    system_prompt = metadata.get("system_prompt") or config.default_system_prompt
    kb_id = metadata.get("kb_id") or config.default_kb_id

    agent = RAGAssistant(instructions=system_prompt, kb_id=kb_id, room=ctx.room)
    logger.info(
        "STT: %s (%s) | TTS: %s (%s)",
        agent.stt.model,
        agent.stt.provider,
        agent.tts.model,
        agent.tts.provider,
    )

    session = AgentSession(
        vad=ctx.proc.userdata["vad"],
        min_endpointing_delay=0.5,
        max_endpointing_delay=5.0,
    )

    await session.start(
        room=ctx.room,
        agent=agent,
    )


# Must match backend LIVEKIT_AGENT_NAME so token's room_config dispatch targets this worker
AGENT_NAME = "talkback-agent"

if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name=AGENT_NAME,
        ),
    )
