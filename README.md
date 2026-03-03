## TalkBack

AI-powered LiveKit voice assistant with a Next.js web frontend and a Python LiveKit agent.

### Prerequisites

- **Node.js**: v20+ (recommended)
- **pnpm**: v10+ (project uses `pnpm` via `packageManager` in `web/package.json`)
- **Python**: 3.10+
- **LiveKit**: either a local LiveKit server or a cloud instance (e.g. `cloud.livekit.io`)

### Setup

- **Clone & install**
  - **Backend / agent (Python)**:
    - Create and activate a virtual environment.
    - Install dependencies (for example):
      - `pip install -r requirements.txt` (or your chosen dependency file/command).
  - **Web app (Next.js, in `web/`)**:
    - `cd web`
    - `pnpm install`

### Environment variables

Set environment variables in the usual places:

- **Python agent**: create a `.env` file in `agent/` (or project root) and ensure `dotenv` loads it.
- **Next.js web app**: create `web/.env.local`.

Typical variables you will need (names may differ depending on your config module and LiveKit/OpenAI setup):

- **LiveKit (shared by web + agent)**
  - `LIVEKIT_URL` – LiveKit server URL (e.g. `wss://your-livekit-host`)
  - `LIVEKIT_API_KEY` – LiveKit API key
  - `LIVEKIT_API_SECRET` – LiveKit API secret
  - `LIVEKIT_AGENT_NAME` – must match `AGENT_NAME` in `agent/main.py` (currently `talkback-agent`)

- **LLM / RAG**
  - `OPENAI_API_KEY` – for the `openai` LLM used by the agent and/or web.
  - Any additional RAG/KB configuration used by `services.llm`, such as:
    - `DEFAULT_SYSTEM_PROMPT`
    - `DEFAULT_KB_ID`
    - Vector DB / Chroma / storage credentials as required by your setup.

- **Web app specific**
  - `NEXT_PUBLIC_LIVEKIT_URL` – public WebSocket URL for clients.
  - Any other `NEXT_PUBLIC_*` variables required by your UI components.

Adjust variable names to match your existing `config.py` and Next.js configuration.

### Switching between local STT/TTS and LiveKit/OpenAI plugins

The Python agent uses factory services `STTService` and `TTSService` (`agent/services/stt.py`, `agent/services/tts.py`) that read flags from `config` / `AgentConfig`:

- **STT (`STTService`)**
  - If `config.use_local_stt` is **true**, the agent uses **local Whisper** via `LocalWhisperSTT` (faster-whisper; CPU/GPU, no external API).
  - Otherwise, it uses `openai.STT()` from the LiveKit OpenAI plugin (remote API).
  - Typical config (env or config file):
    - `USE_LOCAL_STT=true|false`
    - `LOCAL_WHISPER_MODEL=base|small|medium|large` (mapped to `local_whisper_model` in `AgentConfig`).

- **TTS (`TTSService`)**
  - If `config.use_local_tts` is **true** and `config.piper_model_path` is set, the agent uses **local Piper ONNX** via `LocalPiperTTS`.
  - Otherwise, it uses `openai.TTS()` from the LiveKit OpenAI plugin (remote API).
  - Typical config (env or config file):
    - `USE_LOCAL_TTS=true|false`
    - `PIPER_MODEL_PATH=/path/to/piper-model.onnx`

To switch:

- **Use local models (no external STT/TTS API calls)**
  - Set in your `.env` (or wherever `config` reads from):
    - `USE_LOCAL_STT=true`
    - `LOCAL_WHISPER_MODEL=base` (or your preferred size)
    - `USE_LOCAL_TTS=true`
    - `PIPER_MODEL_PATH=/absolute/or/relative/path/to/model.onnx`
  - Ensure you have installed the required local dependencies:
    - `faster-whisper`, `numpy`, `scipy` for STT.
    - `piper` for TTS and the chosen model file downloaded.

- **Use LiveKit/OpenAI plugins (hosted STT/TTS)**
  - Set:
    - `USE_LOCAL_STT=false` (or unset so it defaults to false)
    - `USE_LOCAL_TTS=false` (or unset)
  - Ensure `OPENAI_API_KEY` and any LiveKit/OpenAI configuration is present so `openai.STT()` and `openai.TTS()` can reach the APIs.

You can confirm which backend is active in logs: `agent/main.py` logs STT/TTS `model` and `provider` at startup (e.g. `faster-whisper-base` / `local` vs OpenAI-based names).

### Running the web app

From the `web/` directory:

- **Development server**
  - `pnpm dev`
  - Open `http://localhost:3000` in your browser.

- **Production build**
  - `pnpm build`
  - `pnpm start`

Make sure the relevant `NEXT_PUBLIC_*` and LiveKit environment variables are set before starting.

### Running the LiveKit agent (Python)

The agent in `agent/main.py` is a LiveKit worker application (`livekit.agents.cli.run_app`) with `AGENT_NAME = "talkback-agent"`.

Typical steps:

- **Activate your Python environment**.
- **Ensure `.env` is configured** with LiveKit and LLM credentials.
- From the `agent/` directory (or project root, depending on your module layout), run:
  - `python -m main` or `python main.py`

The worker will connect to the LiveKit server defined by your environment variables and wait for jobs with the matching `agent_name`.

### Running LiveKit locally vs cloud

- **Local LiveKit**
  - Run the official LiveKit server binary or Docker image.
  - Set:
    - `LIVEKIT_URL` (and `NEXT_PUBLIC_LIVEKIT_URL`) to your local URL, for example:
      - `wss://localhost:7880` or `ws://localhost:7880`
    - `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` to the credentials you configured for the local server.
  - Start the Python agent and the web app; both should point to the same local LiveKit instance.

- **Cloud LiveKit**
  - Create a project on your LiveKit cloud provider.
  - Set:
    - `LIVEKIT_URL` / `NEXT_PUBLIC_LIVEKIT_URL` to the cloud URL (e.g. `wss://<project>.livekit.cloud`)
    - `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` from the cloud dashboard.
  - Deploy the Python agent (e.g. on a VM/container) so it can reach the cloud URL, and deploy the web app on your preferred hosting platform.

In both cases, ensure that:

- The token generation logic in your backend (if separate) sets metadata fields (`system_prompt`, `kb_id`) expected by `agent/main.py`.
- The `LIVEKIT_AGENT_NAME` or equivalent matches `AGENT_NAME = "talkback-agent"` so dispatch routes jobs to this worker.

### Limitations & tradeoffs

- **Latency vs quality**
  - Using cloud LLMs and cloud LiveKit introduces network latency; local deployments can reduce round-trip time but require more infrastructure.
  - Higher-quality STT/LLM/TTS models improve conversation quality but may increase cost and latency.

- **Scalability**
  - A single Python worker process is suitable for development and small deployments; higher traffic requires multiple workers and more robust orchestration.
  - LiveKit cloud can simplify scaling at the cost of cloud vendor lock-in and ongoing usage fees.

- **Reliability & complexity**
  - Running LiveKit locally gives full control but moves responsibility for upgrades, monitoring, and reliability onto you.
  - RAG setup (indexing documents, keeping embeddings up to date, etc.) adds operational overhead but improves answer grounding.
