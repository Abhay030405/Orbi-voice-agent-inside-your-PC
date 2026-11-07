// HONESTY CHECK: did the assistant just claim it DID something, in a request where no tool ran?
// The PS says it must never claim an action it didn't take. Live (2026-10-20), after the audio of a
// YouTube ad leaked into the conversation, Gemini said "I've successfully skipped the ad" with no tool
// call at all. A prompt rule didn't change anything in a clean A/B (it already behaved there), so this
// is checked in code: main/index.ts sends a correction right after such a reply.
//
// Pure: unit-tested in honesty.test.ts.

// "I've skipped", "I have opened", "I just paused", "I successfully closed", "Done, I set"...
const CLAIM =
  /\b(i'?ve|i have|i just|i successfully|i've now|i have now|i went ahead and)\s+(successfully\s+|now\s+|just\s+)?(skipped|paused|played|opened|closed|clicked|tapped|typed|set|turned|muted|unmuted|sent|deleted|moved|created|saved|installed|changed|started|stopped|switched|scrolled|pressed|launched|called|texted|copied|pasted|renamed|enabled|disabled|increased|decreased|lowered|raised)\b/i

// "I've ALREADY opened it" refers to something done earlier in the conversation (true, and no tool is
// needed again): not a claim about this request.
export function claimsAction(reply: string): boolean {
  return reply.split(/(?<=[.!?])\s+/).some((sentence) => CLAIM.test(sentence) && !/\balready\b/i.test(sentence))
}

// The note Gemini gets (not shown to the user as something they said).
export const HONESTY_NOTE =
  '(System note, not from the user: you just said you did something, but you called no tool in this request, ' +
  "so nothing was actually done. Tell the user plainly that you haven't done it yet, then do it now with a tool " +
  'if it is still wanted.)'
