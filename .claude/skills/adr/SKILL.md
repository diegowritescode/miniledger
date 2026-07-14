---
name: adr
description: Create the next Architecture Decision Record in the current project's docs/adr/, numbered sequentially and formatted from the template. Use when a meaningful technical decision needs recording (architecture style, DB choice, auth strategy, an important trade-off).
argument-hint: <decision title>
allowed-tools: Bash, Read, Write, Glob
---

Create a new ADR. `$ARGUMENTS` = the decision title.

1. Locate the `docs/adr/` folder for the project you're in (current dir, or the project the user names). If it doesn't exist, create it and seed `000-template.md` from `_template/docs/adr/000-template.md`.
2. Find the highest existing `NNN-*.md` (ignore `000-template.md`) and use the next number, zero-padded to 3 digits.
3. Create `docs/adr/<NNN>-<kebab-title>.md` from the `000-template.md` structure:
   - Heading `ADR-<NNN>: <title>`
   - Status: `Proposed`
   - Date: today's date (`date +%Y-%m-%d`)
   - Context / Decision / Consequences / Alternatives.
4. If the conversation already makes the decision clear, draft the content (including the alternatives you rejected and why). Otherwise leave the scaffold and tell the user exactly what to fill.
5. Report the path created.
