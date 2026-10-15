# Jimmy voice service

Microphone → Silero VAD → Moonshine Streaming Small → partial transcripts → final
transcript → command handling / Ollama → Kokoro.

The browser sends 16 kHz mono PCM16 over a ticket-authenticated WebSocket.
Silero and Moonshine run on CPU. Each sample enters the native stream once;
the final call flushes it and disconnects reset it. Only finals execute commands.
Jimmy waits for 2 seconds of silence before ending a turn. Adjust
`VOICE_ENDPOINT_SILENCE_MS` in `.env.local` (500–5000 ms), then recreate the voice
container. Longer waits allow longer pauses but delay the response after speech.

Kokoro-82M runs in a separate CPU service and speaks sentences at 24 kHz. Select
any of 28 English voices in the gear menu. Voice and playback speed persist in
the browser. The default voice is `am_michael`.

## Start

For a fresh Windows checkout, use `npm run setup` from the repository root first.
It downloads the required Silero model, creates the cache volume, builds both
voice images, and downloads/checks their default models. See [SETUP.md](../SETUP.md).

1. Set `VOICE_SERVICE_SECRET` to at least 32 random characters in `.env.local`.
2. Run `npm run voice:up`, start Ollama, then run `npm run dev`.
3. Wait for `asr_status.state` / `status.state` to be `ready` at
   `http://127.0.0.1:8765/health` and `http://127.0.0.1:8766/health`.
4. Open or reload Jimmy and enable the microphone.

Whisper, Parakeet, browser VAD, and browser speech fallback are removed. Service
failures display an error; typed commands remain available. Reload to reconnect.

Native English SMALL_STREAMING assets are cached in `/cache/moonshine` in the
existing `johnny-voice-models` volume. No separate HF checkpoint is required.
On a fresh install run `docker volume create johnny-voice-models` first.
Silero uses one inference thread; Compose sets OpenMP/MKL thread pools to two
threads per service. Ollama's model still affects total memory use substantially.

Services bind to loopback. For HTTPS/LAN, terminate TLS in front of the voice
service and set `VOICE_SERVICE_PUBLIC_WS_URL` to its `wss://` address.
