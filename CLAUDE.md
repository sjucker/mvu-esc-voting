# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Encore-voting app for the Eurovision concert of Musikverein Harmonie Urdorf: the audience votes on their phones for the encore song, a projector shows the reveal show. All user-facing text (UI, error messages, README) is in Swiss Standard German — use «ss» instead of «ß» (e.g. "schliessen", "gross") and «…» guillemets for quotes.

## Commands

```bash
npm install
npm start                                   # node server.js on http://localhost:3000
```

PowerShell with a custom password: `$env:ADMIN_PASSWORD="geheim"; npm start`

Environment variables: `PORT` (default 3000), `ADMIN_PASSWORD` (default `harmonie`), `DATA_FILE` (default `data/data.json`). Requires Node >= 18.

There is no build step, linter, or test suite. The server does not watch files: restart it after editing `server.js`; changes in `public/` only need a browser reload. To experiment without touching real data, point `DATA_FILE` at a throwaway path.

## Architecture

Deliberately minimal: a single dependency-free Node `http` server (`server.js`) plus three static, self-contained HTML pages in `public/`. No framework, no bundler, no client-side modules. Keep it that way unless asked otherwise.

- `server.js` — everything server-side: JSON persistence, domain logic, API routing, static file serving. The only npm dependency, `qrcode-generator`, is not used by the server itself; its browser file is served from `node_modules` at `/vendor/qrcode.js`.
- `public/index.html` (`/`) — voting page for phones.
- `public/leaderboard.html` (`/leaderboard`) — projector screen: QR code + live vote counter, then the animated reveal.
- `public/admin.html` (`/admin`) — song management, open/close voting, reveal, reset.
- `public/common.js` — shared globals for all pages: `esc()` (HTML escaping), `api()` (fetch wrapper that throws an `Error` with `.status`), `songLine()`.
- `public/style.css` — shared design tokens (CSS variables) and components (`.card`, `.pill`, `.btn-*`, `.toast`, `.grad-text`); page-specific CSS lives in each page's inline `<style>`.

Each page holds its JS in an inline `<script>`, renders by assigning template strings to `innerHTML`, and stays in sync by **polling** (voting 4 s, leaderboard 1.5 s, admin 2 s). There are no WebSockets/SSE. Any user-supplied value interpolated into HTML must go through `esc()`.

### State and persistence

All state is one in-memory object (shape in `defaultState()`), written to `DATA_FILE` via a debounced (250 ms) atomic write (tmp file + rename) and flushed on SIGINT/SIGTERM. Mutating handlers must call `save()`. `load()` spreads the file over `defaultState()`, so new top-level fields get defaults automatically for existing data files.

### Result secrecy (core invariant)

Per-song counts must not reach the public before the reveal. `publicState()` returns `results: null` unless `state.revealed` is true and only exposes `totalVotes`; `adminState()` always includes results. Anything added to `/api/state` must respect this.

### API

- `GET /api/state`, `POST /api/vote` — public.
- `/api/admin/*` — require the `X-Admin-Key` header to equal `ADMIN_PASSWORD` (compared timing-safe). The admin page keeps the password in `sessionStorage`. Every admin endpoint responds with the full `adminState()`, which the page uses to re-render.
- Errors are raised as `throw new HttpError(status, germanMessage)` and returned as `{ error }`; the client shows `error` in a toast.

### One vote per browser

The server issues an HttpOnly `voter` cookie (UUID) on the first vote and rejects a second vote with 409. The voting page additionally stores `{ songId, round }` in `localStorage` as a fallback for browsers that drop cookies. `state.round` is incremented by `/api/admin/reset`, which invalidates those `localStorage` entries so browsers can vote again after a rehearsal. Deleting a song also deletes its votes.

### Voting/reveal state machine

Driven by `POST /api/admin/settings`: opening voting clears `revealed`; setting `revealed: true` closes voting and increments `revealId`. The leaderboard starts the reveal animation when it sees `revealed` with a `revealId` it has not yet played (tracked in `sessionStorage`); if already played (e.g. after a reload) it shows the final state without animation. When `revealed` goes back to false it cancels a running show and returns to the QR screen.

The reveal sequence (`playReveal()` in `leaderboard.html`) is a long async function made cancellable by a `run` token: every `sleep(ms, token)` rejects once `run` has moved on. Keep new steps in the sequence on that pattern. Ties for first place are supported throughout (`ranked()` assigns shared ranks; all first-place songs are shown as winners). Sound effects are synthesized with Web Audio — there are no audio files — and need a user click first ("Ton aktivieren").
