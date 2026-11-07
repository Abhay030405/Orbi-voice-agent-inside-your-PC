# Build log 12 — M5 part 1: controlling the PC (look-and-click, PS C1)

## The idea
Two ways to know WHERE to click:
1. **UI Automation** (Windows' accessibility system, the one screen readers use): every app built with
   standard controls tells Windows its buttons, links, text boxes… BY NAME, with exact positions. So
   Gemini says "click Install" and we press THAT button. Better still, we don't even move the mouse: we
   ask the control to act ("Invoke"), which works even when the window is half hidden.
2. **Screenshots**, for apps that don't describe themselves (games, canvases): Gemini picks a point in the
   picture, and we convert it to the real screen pixel (the picture is smaller than the screen, and a 150%
   display has two kinds of pixels: every screenshot records its own mapping, `pcmap.ts`).

## Tools
`pc_ui_elements(window)` → the list, with ids · `pc_click(element | x,y, right, double)` · `pc_type(text,
element | window, enter)` (any language: each character as a Unicode key press) · `pc_scroll(window,
direction, amount)`.

## Safety
- Looking (screenshot, element names) = outside content → caution mode → asks; ONE yes covers the task
  ('pc-control' family, incl. take_screenshot), like the phone.
- Buttons named Send / Pay / Buy / Order / Delete / Uninstall / Install / Sign out / … ALWAYS ask, with
  the name in the question, even inside an approved task (`isRiskyName`). Possible only because UI
  Automation gives us names: a pure pixel clicker couldn't know.
- Never clicks, scrolls or types into Dreamwalker's own windows (incl. the confirmation dialog): checked
  in the same step as the click, by which program owns the window under the point.
- Typing + Enter asks first (it may send something).

## Speed: one long-running helper
First version: every call started PowerShell and loaded the helper: 1.6 s per click. Now one PowerShell
starts once and stays, reading JSON requests from stdin and answering on stdout, with only our fixed
commands (values are data). Measured: a click 0.13–0.34 s (was 1.6 s); a 7 × 8 task through Gemini
14 s (was 23 s). It restarts if it dies or hangs, and stops when Dreamwalker quits.

## Measured
Calculator, by element: 7 × 8 → "Display is 56". Through Gemini ("open Calculator, work out 12 times 7"):
open_app → pc_ui_elements → 5 clicks → take_screenshot → "twelve times seven is eighty-four", display 84.
Bugs found on the way: my test runs left 4 Calculators open (identical titles → "which one?"); now
identical titles pick the one in front. The first clicks were lost because the app was still starting.

## Questions
1. Why is clicking "by element" more reliable than clicking a pixel in a screenshot?
2. What does "Invoke" do, and why does it work even when the window is behind another?
3. Why can Dreamwalker refuse to click "Pay" even inside a task you approved, but a pixel clicker can't?
4. Why was every click 1.6 s, and why does a long-running helper fix it?
