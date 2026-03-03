from __future__ import annotations

from typing import Optional

import asyncio
from livekit import rtc
from livekit.agents import stt
from livekit.agents.types import APIConnectOptions, NOT_GIVEN, NotGivenOr
from livekit.agents.utils import AudioBuffer
from livekit.plugins import openai

from config import AgentConfig, config

WHISPER_SAMPLE_RATE = 16000


def _audio_buffer_to_pcm(buffer: AudioBuffer) -> tuple[bytes, int, int]:
    """Return (raw int16 PCM bytes, sample_rate, num_channels) from AudioBuffer."""
    frames = buffer if isinstance(buffer, list) else [buffer]
    if not frames:
        return b"", 16000, 1
    combined = rtc.combine_audio_frames(frames)
    data = combined.data
    raw = data.tobytes() if hasattr(data, "tobytes") else bytes(data)
    return raw, combined.sample_rate, combined.num_channels


class LocalWhisperSTT(stt.STT):
    """
    STT that loads and runs the Whisper model locally via faster-whisper.
    No API calls; model runs on CPU or GPU.
    """

    def __init__(
        self,
        *,
        model_size: str = "base",
        device: str = "cpu",
        compute_type: str = "default",
        download_root: str | None = None,
    ):
        super().__init__(
            capabilities=stt.STTCapabilities(
                streaming=False,
                interim_results=False,
                aligned_transcript=False,
            )
        )
        self._model_size = model_size
        self._device = device
        self._compute_type = compute_type
        self._download_root = download_root
        self._model = None

    @property
    def model(self) -> str:
        return f"faster-whisper-{self._model_size}"

    @property
    def provider(self) -> str:
        return "local"

    def _get_model(self):
        if self._model is None:
            from faster_whisper import WhisperModel
            self._model = WhisperModel(
                self._model_size,
                device=self._device,
                compute_type=self._compute_type,
                download_root=self._download_root,
            )
        return self._model

    async def _recognize_impl(
        self,
        buffer: AudioBuffer,
        *,
        language: NotGivenOr[str] = NOT_GIVEN,
        conn_options: APIConnectOptions,
    ) -> stt.SpeechEvent:
        # Run blocking Whisper inference in a thread so we don't block the event loop
        loop = asyncio.get_event_loop()
        raw_bytes, sample_rate, num_channels = _audio_buffer_to_pcm(buffer)
        if not raw_bytes:
            return stt.SpeechEvent(
                type=stt.SpeechEventType.FINAL_TRANSCRIPT,
                alternatives=[stt.SpeechData(language="en", text="")],
            )

        def _transcribe() -> str:
            import numpy as np
            from scipy import signal

            model = self._get_model()
            # Convert bytes to int16 then float32 [-1, 1]
            audio_int16 = np.frombuffer(raw_bytes, dtype=np.int16)
            if num_channels > 1:
                audio_int16 = audio_int16.reshape(-1, num_channels).mean(axis=1).astype(np.int16)
            audio_f32 = audio_int16.astype(np.float32) / 32768.0

            if sample_rate != WHISPER_SAMPLE_RATE:
                num_out = int(len(audio_f32) * WHISPER_SAMPLE_RATE / sample_rate)
                audio_f32 = signal.resample(audio_f32, num_out).astype(np.float32)

            lang = None if language is NOT_GIVEN or not language else language
            segments, info = model.transcribe(audio_f32, language=lang)
            # each item in segments is a Segment object with a .text attribute
            text = " ".join(s.text for s in segments).strip()
            return text or ""

        text = await loop.run_in_executor(None, _transcribe)
        return stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            request_id="",
            alternatives=[stt.SpeechData(language=language if language is not NOT_GIVEN else "en", text=text or "")],
        )


class STTService:
    """Factory/service for creating the STT implementation based on configuration."""

    def __init__(self, cfg: Optional[AgentConfig] = None) -> None:
        self._config = cfg or config

    def create(self) -> stt.STT:
        """
        Return an STT instance based on the current configuration.

        - If USE_LOCAL_STT is enabled, use the local faster-whisper backend.
        - Otherwise, fall back to the OpenAI-based STT implementation.
        """
        if self._config.use_local_stt:
            return LocalWhisperSTT(model_size=self._config.local_whisper_model)
        return openai.STT()

