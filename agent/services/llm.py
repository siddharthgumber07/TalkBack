import logging

import httpx

from config import config
from livekit.agents import llm


logger = logging.getLogger("voice-agent")


@llm.function_tool()
async def rag_lookup(query: str, kb_id: str = config.default_kb_id) -> tuple[str, list[dict]]:
    """Call backend search API; return (combined context string, list of source dicts).

    Each source dict includes:
    - id: numeric chunk identifier used for in-prompt citations (e.g. [1])
    - content: the raw chunk text
    - metadata: backend-provided metadata for the chunk
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                f"{config.backend_url.rstrip('/')}/api/search",
                params={"q": query, "kb_id": kb_id, "top_k": 5},
            )
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        logger.warning("RAG lookup failed: %s", e)
        return "", []

    results = data.get("results") or []
    if not results:
        return "", []

    chunks: list[str] = []
    sources: list[dict] = []

    for idx, item in enumerate(results, start=1):
        content = item.get("content", "") or ""
        metadata = item.get("metadata", {}) or {}

        chunks.append(f"[{idx}] {content}")
        sources.append(
            {
                "id": idx,
                "content": content,
                "metadata": metadata,
            }
        )

    combined = "\n\n".join(chunks)
    return combined, sources

