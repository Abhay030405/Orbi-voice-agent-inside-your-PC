# Research — Latency probe: measured, not guessed (2026-10-18)

Before writing Phase 1 we tested the riskiest assumption: **does the Gemini Live API work on our
Vertex project, and how fast is it from India?** A throwaway script opened Live sessions, sent the
text "Say exactly: Dreamwalker online." and timed everything. Connection: home Wi-Fi, Windows laptop.

## Which models work where

| Model | us-central1 | europe-west4 | asia-south1 (Mumbai) | asia-southeast1 | global |
|---|---|---|---|---|---|
| `gemini-3.8-live` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `gemini-live-2.5-flash-native-audio` | ✅ | ✅ | ❌ | ❌ | ❌ |

Surprise: no Live model is served from Asia for us, so the closest region isn't an option.

## Timings (3–4 runs each, median)

| Model + region | Connect (new client) | Connect (reused client) | Request → first audio |
|---|---|---|---|
| **`gemini-3.8-live` · us-central1** | ~3.3 s | **~1.7 s** | **~1.0 s** |
| `gemini-live-2.5-flash-native-audio` · us-central1 | ~3.4 s | — | ~1.2 s |
| `gemini-live-2.5-flash-native-audio` · europe-west4 | ~3.9 s | — | ~1.5 s |

TLS to Google finishes in ~0.1 s, because Google terminates connections at an edge server near
us. So **network distance isn't the bottleneck; the model's own processing is.**

## Decisions this gives us

1. **Primary: `gemini-3.8-live` in `us-central1`** (fastest). Fallback: `gemini-live-2.5-flash-native-audio`.
2. **Create the client once and reuse it.** A new client fetches a new login token each time, and
   that was ~1.6 s of the 3.3 s.
3. **Connect when the app starts, not on the wake word.** Even warm, connecting costs ~1.7 s. If
   we waited for "Hey Strange", the user would feel that 1.7 s on every single request. Connect early
   and that cost is paid once, invisibly. (Speed trick #3, now with proof.)
4. **Expected voice-to-voice delay ≈ 1.3–1.8 s**: ~1.0 s to first audio + the time Gemini waits
   to be sure you stopped talking. That's what we measure and push down in Phase 1.

## Viva line

*"We measured before building: the Live API isn't served from Asia, so we use us-central1. Reusing
the client halves connect time, and pre-connecting at startup hides the rest. Time to first
audio is about one second."*
