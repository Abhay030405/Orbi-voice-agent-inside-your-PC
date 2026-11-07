# Demo script (about 8 minutes)

Every line was run live against real Gemini before it went in here (docs/build-log/13-live-testing.md).
Say **"Hey Orbi"**, then the request in one breath (a short pause after the name is fine). If the wake
word doesn't catch it, click **Talk to Orbi** on Home and say just the request.

**Before you start**
- A quiet spot: Orbi ignores speech that isn't meant for it, but people talking nearby can still cut into
  a request. Pause music and videos.
- Speakers at 50-70% (it works at 100%, but interrupting it by name is more reliable a bit lower).
- Phone on the same Wi-Fi with wireless debugging on (Phone page says "Connected").
- Settings: "Interrupt by just talking" OFF (the default): you interrupt by saying its name.

| # | Say | What happens | What it shows |
|---|---|---|---|
| 1 | "Hey Orbi, what's the weather in Rudrapur today?" | Searches the web, answers in °C (~15 s) | Wake word, voice, live web search |
| 2 | "Hey Orbi, research the best phones in India under twenty thousand rupees, by camera, battery and gaming, and make a Word document." | "I've started researching… I'll let you know" | A long job handed to a **background research agent**; Orbi stays free |
| 3 | "Hey Orbi, play lofi hip hop on YouTube." | Opens the top video, playing (one step) | Doing, not just searching |
| 4 | "Hey Orbi, pause the video." | Presses the media pause key | Works whatever window is in front |
| 5 | "Hey Orbi, make a PowerPoint with three slides about Dreamwalker and open it when it's ready." | Starts in the background, opens the deck ~15 s later | Office files; it knows what Dreamwalker is |
| 6 | "Hey Orbi, how is the research going?" | Says the agent's current step ("searching for gaming benchmarks") | Progress of background work |
| 7 | "Hey Orbi, open Calculator and work out twelve times seven by pressing the buttons." → "Yes, go ahead." | **One** question (confirmation window, amber face), clicks, checks the screen, says 84 | Sees and clicks any app; spoken yes recognised on the laptop |
| 8 | "Hey Orbi, what's my phone's battery?" | Reads it from the phone | Phone control over Wi-Fi (adb) |
| 9 | "Hey Orbi, tell me a long story about a robot who learns to paint." → while it talks: "Hey Orbi, stop. What's two plus two?" | Stops at once, "Two plus two is four" | Interrupting by name, no stale audio |
| 10 | (when it says the research is done) "Hey Orbi, open the phone research document." | Word opens the report, with sources | The background job finished on its own |
| 11 | "Hey Orbi, what did you do in the last few minutes?" | Lists its actions from the Ledger | Every action is logged |
| 12 | "Hey Orbi, close PowerPoint and Calculator." → "Yes, go ahead." | **One** question naming both windows, then closes them | Asks before anything that could lose work |

**If something goes wrong**
- It didn't wake: click **Talk to Orbi**, or press and hold Space.
- It answered something nobody asked: someone nearby was heard; say "Hey Orbi" again for the real request.
- A question timed out: ask again; it says plainly that you didn't confirm.
- It seems stuck: Settings → Diagnostics → Retry, or restart the app (it resumes the conversation).
