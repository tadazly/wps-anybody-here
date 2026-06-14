# AGENTS.md

This file is the standing instruction set for Codex agents working on this repository.

## Project

`表里有人` is a WPS spreadsheet add-in plus a small collaboration server.

Slogan:

> 看看表里谁在配，谁在改，谁在和你撞格子

Repository layout:

- `packages/addin/`: WPS add-in created from `wpsjs create`.
- `packages/server/`: WebSocket/HTTP collaboration server.
- `packages/shared/`: shared WebSocket protocol types and utilities.
- `docs/implementation.md`: original design outline and future ideas.
- `docs/DECISIONS.md`: product and technical decisions that should not be casually reversed.

## How To Work

- Respond to the user in Chinese unless they explicitly ask otherwise.
- Prefer small, working iterations. The user tests in real WPS, so preserve their current manual testing flow.
- Use `rg` for search.
- Use `apply_patch` for manual file edits.
- Do not remove or rewrite user changes unless explicitly asked.
- Do not add private company URLs, internal GitLab addresses, real user names, or team-specific secrets to public-facing docs or defaults.
- Keep files public-repo friendly.
- If changing WPS add-in behavior, verify with:
  - `node --check js/taskpane.js`
  - `node --check js/ribbon.js` when ribbon code changes
  - `node node_modules/vite/bin/vite.js build`
- If changing server behavior, verify with:
  - `node node_modules/typescript/bin/tsc`
- In Codex desktop, use `load_workspace_dependencies` to discover the bundled Node executable when `npm` or `node` is not on PATH.
- `npm` may not be on Codex shell PATH even though it works in the user's PowerShell.

## Git And Publishing

- The workspace root is now the intended monorepo git root.
- Historical add-in git history was promoted from the old `wps-anybody-here/` folder.
- As of the monorepo restructure, GitHub remote creation/push may still need to be completed.
- Do not claim that code has been pushed to GitHub unless a push actually succeeds.
- The desired public repo name is `wps-anybody-here`.

## Product Behavior To Preserve

- The add-in should run automatically when WPS opens/loads the add-in.
- Opening a spreadsheet should automatically join collaboration after settings have been saved.
- Closing/unloading should leave rooms automatically.
- There should be no manual `join` or `leave` buttons in the main panel.
- If the server is offline or a socket drops, show reconnect status with a 10 second countdown.
- The main panel should stay focused on collaboration status, not configuration fields.
- Configuration belongs in a settings modal.
- On first run, the settings modal must open automatically.
- After the user saves settings once, reopening WPS must not auto-open settings again.
- Users can reopen settings manually from the panel.

## Required Settings

The settings modal contains:

- Server socket URL
- Spreadsheet repository URL
- Local repository root directory
- User name

Rules:

- Server socket URL may default to `ws://127.0.0.1:18080`.
- Spreadsheet repository URL must not have a project-specific default.
- Local repository root directory must be user-provided.
- User name must be user-provided or prefilled from WPS user name when available.
- Persist settings in `localStorage`.
- Preserve stable user ID when the user changes their display name.

## Path And Privacy Rules

- Never display local absolute file paths in the server dashboard by default.
- In the WPS panel, current workbook display should show only the file name.
- The WPS panel may use a tooltip/title for the full local path when useful.
- Server room identity should be based on:
  - spreadsheet repository URL, plus
  - repo-relative workbook path.
- This avoids mixing files from different repos and distinguishes same-name files in different directories.
- If local repo root cannot produce a relative path, fall back carefully, but do not expose absolute paths in public dashboard UI.

## Branding

Chinese product name:

`表里有人`

English product name:

`Anybody Here`

WPS manifest name is static and currently uses Chinese:

`表里有人`

Ribbon labels should use language detection when possible:

- Chinese UI: `表里有人`
- Non-Chinese UI: `Anybody Here`

Main collaboration panel title:

`表里有人`

Main collaboration panel subtitle:

`WPS 配表协作房间`

## Collaboration Model

- The plugin scans open workbooks and maintains one socket/room per open workbook.
- Active workbook drives the visible panel state and selection/change routing.
- Online user count should count unique users, not open workbook connections.
- A user's UID must remain stable across display name changes.
- Renaming should notify the server and other clients without creating a fake new person.
- Current conflict detection is address-based: `sheetName + address`.
- Future conflict model should move toward stable row/entity ID plus field name.
- Shared protocol types live in `packages/shared`.

## Server Dashboard

- Server dashboard should show:
  - current unique online users,
  - open workbooks/rooms,
  - users in each workbook,
  - edit contribution counts,
  - conflict counts.
- Dashboard should show workbook file names and repo-relative paths, not local absolute paths.
- Dashboard state is in memory for now. Restarting the server clears rooms and contribution history.
- Expected team size is around 20 people; current in-memory approach is acceptable for this stage.

## Known Validation Notes

- `vite build` may print a WPS/Vite template warning about `main.js` not being a module. If build exits 0, treat it as non-blocking.
- A previous single run of Vite failed with an absolute-path emitted asset error, then passed on rerun. Re-run once before diagnosing unless the failure repeats.
- Multi-computer testing and detailed cell highlight behavior are not fully validated yet.
