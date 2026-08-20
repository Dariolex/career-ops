# Custom Instructions -- career-ops

<!-- ============================================================
     THIS FILE IS YOURS. It will NEVER be auto-updated.

     Put your own house rules, custom workflows, and automations
     here -- anything you want the agent to ALWAYS do (or never do).

     This is for PROCEDURAL rules ("HOW I want things done").
     For WHO you are (archetypes, narrative, comp, negotiation),
     use modes/_profile.md instead. Keeping the two separate keeps
     each one readable.

     The agent reads this file alongside the system instructions;
     your rules here take precedence over the defaults, as long as
     they don't break the Data Contract (your files are never
     touched, and we never auto-submit an application for you).

     Because this is a user-layer file, anything you write here
     survives `node update-system.mjs`. Put customizations HERE,
     not in CLAUDE.md / modes/_shared.md / other system files --
     those get overwritten on update.
     ============================================================ -->

## House Rules

(none yet -- add yours above)

## Custom Workflows

(none yet -- add yours above)

## Output Preferences

- **Report header as a table, score as stars.** The report header block
  (Date, URL, Via, Archetype, Score, Legitimacy, Work Auth, PDF — as
  specified in the report format) must be rendered as a two-column
  markdown table (`| Campo | Valore |`), not a bullet list.
  - The **Score** row shows a 5-star rating instead of `X/5`: render
    exactly 5 star characters, `★` (filled) for each full point of the
    score rounded to the nearest whole number, `☆` (empty/outline) for
    the rest. Keep the raw number in parentheses right after, e.g. a
    score of 2.0/5 → `★★☆☆☆ (2.0/5)`; a score of 3.6/5 → `★★★★☆ (3.6/5)`.
  - This table replaces only the human-readable header. It never
    replaces, reorders, or reformats the `## Machine Summary` YAML
    fence, `---SCORE_SUMMARY---`, or `---CAREER_SCORE---` blocks —
    those stay in their exact documented machine-parseable format,
    untouched.

## Off-Limits

(none yet -- add yours above)
