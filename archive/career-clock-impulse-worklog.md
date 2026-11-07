# Career clock and impulse input

The previous flight HUD plan added a second pause button and a separate burn-pause flag. The flag stopped the shared game-step loop, including career time, but did not set the career clock's pause state or freeze the background pulse. The existing footer time button did set that state, but could not enable the ship's burn drag. The resulting controls looked alike but did different things.

The footer button and Space / P now toggle the same career pause, including while landed or without fuel. Burn input is available only when that clock is paused and the flying ship has a usable impulse drive; there is no independent burn clock or pause flag. Resuming cancels the aim; an armed burn consumes fuel, records its step and resumes the clock. The extra flight HUD pause button was removed. The explicit 30-minute wait remains a fast-forward action even when the clock is paused.

Validation: `career_pause_test`, `career_guidance_test`, `gravity_view_test`, `politics_gui_test`, syntax checks and `git diff --check` pass. The focused test covers the footer, keyboard, shared game and orbit time, no-drive and empty-tank pauses, cancellation and burn. `dom_smoke` reaches the existing padless commercial departure assertion; `career_departure_test` reaches the existing seed 7 P3 assertion. Both failures were reproduced on the untouched baseline and were also noted in the preceding worklog.

Next: repair the pre-existing departure affordability fixtures separately.
