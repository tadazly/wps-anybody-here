# Decisions

This document records product and technical decisions for `表里有人`.

The goal is to prevent future agents or contributors from reversing decisions without understanding why they were made.

## 1. Product Name And Slogan

Decision:

- Chinese name: `表里有人`
- English name: `Anybody Here`
- Slogan: `看看表里谁在配，谁在改，谁在和你撞格子`

Reason:

- The target users are mainly game designers editing WPS configuration spreadsheets.
- The Chinese name and slogan directly explain the pain: not knowing who else is editing the same table and where conflicts may happen.

Implications:

- User-facing Chinese UI should prefer `表里有人`.
- Ribbon may show `Anybody Here` in non-Chinese environments.
- Main panel subtitle is `WPS 配表协作房间`.

## 2. First Run Uses A Settings Modal

Decision:

- Server socket URL, spreadsheet repository URL, local repository root, and user name live in a settings modal.
- The settings modal opens automatically only on first run.
- After saving once, the modal does not auto-open on later WPS starts.
- Users can manually reopen settings.

Reason:

- The main collaboration panel should not be cluttered with configuration fields.
- Non-programmer users should get a guided first-run flow.
- Repeated popups after setup would be annoying during daily WPS use.

Implications:

- Keep a persisted `settingsSaved` marker.
- Do not auto-join collaboration until required settings are saved.
- Changing settings after joining should reconnect or rejoin rooms as needed.

## 3. No Project-Specific Repository URL Defaults

Decision:

- The public project must not include any private/internal repository URL as a default value.
- The spreadsheet repository URL must be filled by the user/team during setup.

Reason:

- This project is intended to be public.
- Hard-coded internal GitLab/GitHub URLs leak private team structure.

Implications:

- It is acceptable to default the server socket URL to local development: `ws://127.0.0.1:18080`.
- It is not acceptable to default the spreadsheet repository URL to a real team repository.
- Example repository URLs in docs/placeholders must be generic, such as `https://git.example.com/team/table`.

## 4. Room Identity Uses Repo URL Plus Repo-Relative Path

Decision:

Room identity should be:

```txt
<spreadsheet repository URL>::<repo-relative workbook path>
```

Example:

```txt
https://git.example.com/team/table::version/military.xlsx
```

Reason:

- Different users clone the same Git repository to different local directories.
- Local absolute paths cannot reliably identify the same spreadsheet across computers.
- File name alone is insufficient because two directories may contain same-name spreadsheets.
- Repository URL prevents different projects with same relative paths from sharing a room by accident.

Implications:

- The plugin needs both spreadsheet repository URL and local repository root.
- The plugin computes repo-relative paths from the workbook full path.
- Dashboard should display the repo-relative path, not the full room ID unless needed for debugging.

## 5. Do Not Show Local Absolute Paths In Dashboard

Decision:

- Server dashboard should not show local absolute paths such as `D:/...` or `C:/Users/...`.
- Dashboard should show workbook file name and, when available, repo-relative path.

Reason:

- Local paths are noisy and differ between users.
- Local paths may expose user names, workspace structure, or private directories.
- The useful operational identity is the spreadsheet's repo-relative path.

Implications:

- If the server receives a local absolute path fallback, hide it from normal dashboard display.
- WPS panel may show only file name; a local tooltip is acceptable for the current user, but not for shared server dashboard.

## 6. Auto Join And Auto Leave

Decision:

- No manual join/leave buttons in the main panel.
- After settings are saved, opening WPS/the add-in should auto-join.
- Closing/unloading should auto-leave.
- Socket disconnection should show reconnect countdown and retry every 10 seconds.

Reason:

- The plugin should be a quiet safety layer, not another workflow users must remember.
- Designers should not have to click "join" every time they open a table.

Implications:

- Reconnect behavior is part of core UX.
- Manual controls should focus on settings and reconnect, not room membership.

## 7. One WPS Instance May Open Multiple Workbooks

Decision:

- The plugin scans all open workbooks.
- It maintains one room/socket per open workbook.
- The currently active workbook controls the visible panel state.

Reason:

- WPS users often open several configuration tables at once.
- Counting only the active workbook misses rooms.
- Multiple open workbooks should not inflate unique online user count.

Implications:

- Server needs to distinguish unique users from raw connections.
- Dashboard should show room count and unique online user count separately.
- Switching active workbook in WPS should switch panel context.

## 8. Stable User ID, Mutable Display Name

Decision:

- Each user gets a stable local UID.
- Changing display name does not change UID.
- Name changes should update server and other clients without looking like a new user joined.

Reason:

- Users may adjust names during setup.
- Online count and contribution stats should follow the person, not the current display string.

Implications:

- Persist user identity in localStorage.
- Use UID for color assignment and user identity.

## 9. Conflict Detection Is Address-Based For Now

Decision:

Current conflict detection uses:

```txt
sheetName + address
```

Reason:

- It is simple and useful for a first working version.
- It directly detects two users editing the same visible cell.

Known limitation:

- Sorting, inserting rows, or moving data may make address-based conflicts noisy or incomplete.

Future direction:

Use:

```txt
sheetName + rowId + fieldName
```

or another stable game-config identity.

## 10. Highlighting Uses Cell Interior Color For First Version

Decision:

- Remote selections and conflicts are highlighted by changing cell fill color.
- Original colors are tracked and restored best-effort.

Reason:

- This is the easiest WPS API path for a first usable version.

Known limitation:

- Complex workbook styles may be affected.
- Future versions should consider borders, comments, overlays, or a separate visual layer if WPS supports it.

## 11. Server State Is In Memory

Decision:

- Current server keeps rooms, presence, conflicts, and contribution counts in memory.
- Restarting the server clears runtime state.

Reason:

- Expected early team size is around 20 people.
- The server is a coordination service, not the source of truth.
- In-memory state keeps deployment simple.

Future direction:

- Add persistence only if users need historical analytics or restart continuity.

## 12. Dashboard Is Operational, Not A Management Console

Decision:

Dashboard should show:

- unique online users,
- open spreadsheets,
- users per spreadsheet,
- edit contribution counts,
- conflicts.

Reason:

- The dashboard is mainly for the release machine/operator to understand current usage.
- It should be simple and safe to expose internally.

Implications:

- Avoid showing sensitive local details.
- Do not make dashboard the primary user workflow.

## 13. GitHub Publishing State

Decision:

- Do not assume upload is complete without a successful push.

Current known state:

- The project has been reorganized as a root monorepo.
- `packages/addin/` contains the WPS add-in.
- `packages/server/` contains the collaboration server.
- `packages/shared/` contains shared protocol types and utilities.
- The intended public GitHub repository name is `wps-anybody-here`.
- Remote creation/push may still need to be completed by a later agent if the current toolset cannot create GitHub repositories.

Recommendation:

- Keep one public GitHub repository at the workspace root.
- Push root-level docs, add-in, server, and shared package together.

## 14. Monorepo With npm Workspace

Decision:

- Use one repository with npm workspaces.
- Package layout:
  - `@wps-anybody-here/addin`
  - `@wps-anybody-here/server`
  - `@wps-anybody-here/shared`

Reason:

- The add-in and server protocol are tightly coupled.
- Early iterations frequently change both sides together.
- A shared package prevents protocol type drift.
- npm has a lower setup burden for public users because it ships with Node.js.

Implications:

- Prefer root commands:
  - `npm run dev:server`
  - `npm run dev:addin`
  - `npm run build`
  - `npm run typecheck`
- Put new protocol fields in `packages/shared/src/protocol.ts` first.
