// Settings for the Gemini connection. None of these are secrets: auth comes from your gcloud
// login (Application Default Credentials), not from anything in this file.
// Values chosen by measurement, see docs/research/latency-probe.md.

export const GEMINI = {
  project: process.env.DREAMWALKER_GCP_PROJECT ?? 'dreamwalker-softablitz',
  location: process.env.DREAMWALKER_GCP_LOCATION ?? 'us-central1', // no Live model in Asia regions
  model: process.env.DREAMWALKER_MODEL ?? 'gemini-3.8-live', // fallback: gemini-live-2.5-flash-native-audio
  voice: process.env.DREAMWALKER_VOICE ?? 'Aoede', // light female voice (Abhay's pick); others: Despina, Sulafat, Kore
  // web_search runs a separate, normal (non-live) Gemini call with Google Search grounding.
  // Verified to work on the 'global' location (docs/research/latency-probe.md).
  searchModel: process.env.DREAMWALKER_SEARCH_MODEL ?? 'gemini-3.5-flash',
  searchLocation: 'global'
} as const

// The phone remote (main/phoneBridge.ts). The relay is ours (relay/server.ts, on a small always-on VM).
// DW_RELAY=off switches it off (or points it at another relay); DW_PORT=0 switches the local server off.
export const REMOTE = {
  relay: process.env.DW_RELAY === 'off' ? null : process.env.DW_RELAY || 'https://34-171-9-175.sslip.io',
  localPort: process.env.DW_PORT === '0' ? null : Number(process.env.DW_PORT || 8787)
} as const

// Gemini's audio formats (raw 16-bit PCM, mono).
export const AUDIO = {
  outputSampleRate: 24_000, // what Gemini speaks at
  inputSampleRate: 16_000 // what Gemini wants from the mic (slice 1b)
} as const

// Your ADC login file names Vigil as its "quota project", so Google would count our usage against
// Vigil's quota. Point it at our own project instead, for this process only.
process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= GEMINI.project
