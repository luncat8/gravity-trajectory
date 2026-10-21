# UI visit feedback — 2026-10-21

Reviewed the previous worklog and existing help / visit rendering. The visited branch took priority over predictions, preventing revisited systems from receiving the current prediction highlight; corrected that priority.

- Hover previews help and pointer leave dismisses it; click pins/toggles the drawer. Close and keyboard controls retain their existing behavior.
- Dimmed historical visit rings; current predicted visits (including revisits) use bright green rings.
- Predicted system exits tint the launch button red and add an explicit warning label/title. Warning resets when the prediction or aim state changes; launching remains permitted.
- Validation: JavaScript syntax check, DOM smoke suite (including new hover / pin assertions), and git diff whitespace check passed.

Next step: visually check contrast at different zoom levels in the browser.
