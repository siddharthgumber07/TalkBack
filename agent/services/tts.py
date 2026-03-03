from __future__ import annotations

from typing import Optional
import asyncio
import io
import wave

from config import AgentConfig, config
from livekit.agents import tts
from livekit.agents.types import APIConnectOptions, DEFAULT_API_CONNECT_OPTIONS
from livekit.plugins import openai

DEFAULT_SAMPLE_RATE = 22050
NUM_CHANNELS = 1


class LocalPiperTTS(tts.TTS):
    """
    TTS that loads and runs a Piper ONNX model locally.
    No API calls; model runs on CPU (or GPU if use_cuda=True).
    """

    def __init__(
        self,
        *,
        model_path: str,
        use_cuda: bool = False,
        sample_rate: int = DEFAULT_SAMPLE_RATE,
    ):
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=sample_rate,
            num_channels=NUM_CHANNELS,
        )
        self._model_path = model_path
        self._use_cuda = use_cuda
        self._voice = None

    @property
    def model(self) -> str:
        return f"piper-{self._model_path}"

    @property
    def provider(self) -> str:
        return "local"

    def _get_voice(self):
        if self._voice is None:
            from piper import PiperVoice
            self._voice = PiperVoice.load(self._model_path, use_cuda=self._use_cuda)
        return self._voice

    def synthesize(
        self, text: str, *, conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS
    ) -> tts.ChunkedStream:
        return _PiperChunkedStream(tts=self, input_text=text, conn_options=conn_options)


class _PiperChunkedStream(tts.ChunkedStream):
    """ChunkedStream that runs Piper synthesis and pushes WAV bytes to the emitter."""

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        text = self._input_text.strip()
        if not text:
            output_emitter.initialize(
                request_id="piper",
                sample_rate=self._tts.sample_rate,
                num_channels=self._tts.num_channels,
                mime_type="audio/wav",
            )
            output_emitter.flush()
            return

        def _synthesize() -> bytes:
            voice = self._tts._get_voice()
            buf = io.BytesIO()
            # Piper expects a wave.Wave_write object, not a raw BytesIO buffer
            with wave.open(buf, "wb") as wav_file:
                voice.synthesize_wav(text, wav_file)
            return buf.getvalue()

        loop = asyncio.get_event_loop()
        wav_bytes = await loop.run_in_executor(None, _synthesize)

        if not wav_bytes:
            output_emitter.initialize(
                request_id="piper",
                sample_rate=self._tts.sample_rate,
                num_channels=self._tts.num_channels,
                mime_type="audio/wav",
            )
            output_emitter.flush()
            return

        # Parse WAV header for sample_rate if we want to be precise; Piper WAV is typically 22050
        try:
            with io.BytesIO(wav_bytes) as f:
                with wave.open(f, "rb") as wav:
                    sample_rate = wav.getframerate()
                    nch = wav.getnchannels()
        except Exception:
            sample_rate = self._tts.sample_rate
            nch = self._tts.num_channels

        output_emitter.initialize(
            request_id="piper",
            sample_rate=sample_rate,
            num_channels=nch,
            mime_type="audio/wav",
        )
        output_emitter.push(wav_bytes)
        output_emitter.flush()



class TTSService:
    """Factory/service for creating the TTS implementation based on configuration."""

    def __init__(self, cfg: Optional[AgentConfig] = None) -> None:
        self._config = cfg or config

    def create(self) -> tts.TTS:
        """
        Return a TTS instance based on the current configuration.

        - If USE_LOCAL_TTS is enabled and a Piper model path is configured,
          use the local Piper backend.
        - Otherwise, fall back to the OpenAI-based TTS implementation.
        """
        if self._config.use_local_tts and self._config.piper_model_path:
            return LocalPiperTTS(model_path=self._config.piper_model_path)
        return openai.TTS()

