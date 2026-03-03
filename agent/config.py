import os

from dotenv import load_dotenv


load_dotenv()


def _get_bool_env(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes")


class AgentConfig:
    """Configuration for the TalkBack voice agent, sourced from environment variables."""

    def __init__(self) -> None:
        # RAG / knowledge base defaults
        self.default_kb_id: str = "default"
        self.default_system_prompt: str = (
            "You are a helpful voice assistant. Use short, clear answers. "
            "Use the provided context from the knowledge base when relevant."
        )

        # Local model toggles
        self.use_local_stt: bool = _get_bool_env("USE_LOCAL_STT")
        self.use_local_tts: bool = _get_bool_env("USE_LOCAL_TTS")

        # Local model configuration
        self.piper_model_path: str = os.getenv(
            "PIPER_MODEL_PATH",
            "./en_US-lessac-medium.onnx",
        )
        self.local_whisper_model: str = os.getenv(
            "LOCAL_WHISPER_MODEL",
            "base",
        )

        # Backend API
        self.backend_url: str = os.getenv(
            "BACKEND_URL",
            "http://localhost:3000",
        )


config = AgentConfig()

