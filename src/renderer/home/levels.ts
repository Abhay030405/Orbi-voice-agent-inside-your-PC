// Loudness getters, read every animation frame (never stored in React state).
export interface Levels {
  mic(): number // your microphone, 0..1 (0 while it's closed)
  voice(): number // Dreamwalker's voice, 0..1
  active(): number // whichever matters now: mic while listening, voice while speaking
}
