## TalkBack Voice Agent (`agent/`)

Python worker that runs the TalkBack voice assistant on LiveKit Cloud, with optional local STT/TTS models and a RAG backend for knowledge-base augmented replies.

### Tech stack

- **Language**: Python 3.12+
- **Realtime infra**: `livekit-agents` (worker running on LiveKit Cloud / LiveKit server)
- **LLM / cloud models**: OpenAI via `livekit.plugins.openai`
- **RAG backend**: HTTP search API at `BACKEND_URL` (e.g. the TalkBack web/backend)
- **Speech-to-text (STT)**:
  - Cloud: OpenAI STT via `livekit.plugins.openai.STT`
  - Local (optional): `faster-whisper` via `LocalWhisperSTT`
- **Text-to-speech (TTS)**:
  - Cloud: OpenAI TTS via `livekit.plugins.openai.TTS`
  - Local (optional): `piper-tts` via `LocalPiperTTS`
- **Turn detection / VAD**:
  - Silero VAD (`livekit-agents[silero]`)
  - Multilingual turn detector (`livekit.plugins.turn_detector.multilingual`)
- **Config & env**: `python-dotenv`, environment variables in `.env`

### What this worker does

- Connects to a LiveKit room as agent **`talkback-agent`**.
- Listens to the user’s audio, detects turns, and transcribes speech (STT).
- Before answering, calls the backend RAG search API (`/api/search`) to fetch relevant knowledge-base context.
- Streams a spoken reply back to the user (TTS) while also sending RAG source metadata to the room as data packets so the frontend can display which chunks were used.

### LiveKit Cloud / LiveKit setup

- **LIVEKIT_URL**: should point to your LiveKit deployment, for example:
  - `wss://your-project.livekit.cloud` (LiveKit Cloud)
  - or `ws(s)://<host>:<port>` for self-hosted.
- **Worker registration**:
  - This script runs a `livekit-agents` worker via `cli.run_app(...)`.
  - The worker name is defined as:
    - `AGENT_NAME = "talkback-agent"`
  - Your backend must issue access tokens whose **`room_config`** dispatch targets this worker name so that incoming jobs land here.
- **Token metadata contract**:
  - The backend sets metadata on the participant when issuing the token (JSON string).
  - This worker reads:
    - `system_prompt`: overrides the default system prompt.
    - `kb_id`: selects which knowledge base to query for RAG.
  - If absent, it falls back to `config.default_system_prompt` and `config.default_kb_id`.

### Configuration

Configuration is driven by environment variables, typically stored in `agent/.env` (see `.env.example`):

- **LiveKit** (must match backend / web configuration):
  - `LIVEKIT_URL` – e.g. `wss://your-project.livekit.cloud`
  - `LIVEKIT_API_KEY`
  - `LIVEKIT_API_SECRET`
- **OpenAI (cloud models)**:
  - `OPENAI_API_KEY` – used for LLM, STT, and TTS via `livekit.plugins.openai`.
- **Backend / RAG**:
  - `BACKEND_URL` – base URL of the TalkBack backend (default `http://localhost:3000`).
    - The agent calls `GET {BACKEND_URL}/api/search?q=...&kb_id=...&top_k=5`.
- **Local model toggles**:
  - `USE_LOCAL_STT` – set to `1` / `true` / `yes` to use `faster-whisper` instead of OpenAI STT.
  - `USE_LOCAL_TTS` – set to `1` / `true` / `yes` to use `piper-tts` instead of OpenAI TTS.
- **Local model settings**:
  - `LOCAL_WHISPER_MODEL` – whisper model size (e.g. `base`, `small`, `medium`).
  - `PIPER_MODEL_PATH` – path to your Piper `.onnx` model file (e.g. `./en_US-lessac-medium.onnx`).

See `config.py` and `.env.example` for the exact defaults.

### Installation

From the `agent/` directory:

```bash
cd agent

# Using uv (recommended)
uv sync

# OR using pip (if you prefer)
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e .
```

This uses `pyproject.toml` to install the agent and its dependencies:

- `livekit-agents[silero,turn-detector]`
- `livekit-plugins-noise-cancellation`
- `faster-whisper`
- `piper-tts`
- `numpy`, `scipy`, `python-dotenv`, etc.

### Environment setup

1. **Create your env file**:

   ```bash
   cd agent
   cp .env.example .env
   ```

2. **Fill in required values** in `.env`:

   - `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
   - `OPENAI_API_KEY`
   - `BACKEND_URL` (if your backend is not on `http://localhost:3000`)
   - Optional: `USE_LOCAL_STT`, `USE_LOCAL_TTS`, `LOCAL_WHISPER_MODEL`, `PIPER_MODEL_PATH`

3. Make sure your **backend** and **web frontend** are configured to talk to the same LiveKit project and to dispatch jobs to the `talkback-agent` worker.

### Running the agent locally

From the repo root (or from `agent/` directly):

```bash
cd agent

# Ensure env is active (uv or venv) and .env is configured
python main.py
```

This will:

- Start a `livekit-agents` worker named `talkback-agent`.
- Pre-warm Silero VAD.
- Wait for a participant to join a LiveKit room that dispatches to this worker.

### Running as a LiveKit Cloud worker

There are multiple ways to deploy this worker to LiveKit Cloud; the typical flow is:

- **Build a container image** for the `agent/` app (using `pyproject.toml` and `main.py` as entrypoint).
- Configure a **LiveKit Cloud worker deployment** that runs this image and exposes the `talkback-agent` worker.
- Make sure your backend issues tokens that:
  - Target the correct agent name in the `room_config`.
  - Pass `system_prompt` and `kb_id` in participant metadata if you want to control behavior per-session.

> **Note**: Deployment specifics (Dockerfile, CI, LiveKit Cloud configuration) live outside this `agent/` README and should be documented in the repo root or infra docs.

### RAG integration details

- The agent calls `rag_lookup(query, kb_id)` in `services/llm.py` on each completed user turn.
- `rag_lookup`:
  - Sends a GET request to `{BACKEND_URL}/api/search`.
  - Expects a JSON response with a `results` list of `{ content, metadata }`.
  - Returns:
    - A single concatenated context string that is injected into the chat as an assistant message.
    - A list of `sources` (each with `content` and `metadata`) that is sent back to the room as a data packet.
- The frontend can subscribe to these data packets to render “sources used for this answer”.

### Local vs cloud STT/TTS behavior

- **Cloud-only (default)**:
  - If `USE_LOCAL_STT` / `USE_LOCAL_TTS` are not set or are `0`:
    - `STTService` returns `openai.STT()`.
    - `TTSService` returns `openai.TTS()`.
- **Hybrid / local**:
  - If `USE_LOCAL_STT=1`, `STTService` returns `LocalWhisperSTT` using `LOCAL_WHISPER_MODEL`.
  - If `USE_LOCAL_TTS=1` and `PIPER_MODEL_PATH` is set, `TTSService` returns `LocalPiperTTS`.

This lets you choose between:

- Lower latency / cost with local models.
- Simpler setup with fully cloud-based OpenAI models.
