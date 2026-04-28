# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The repo has two pieces:

- **Server** (root) — Node/Express. Wraps `yt-dlp` for YouTube→MP3 and proxies the Anthropic SDK for the deity-chat feature.
- **Expo app** (`app/`) — single-screen React Native client for the deity-chat endpoint. Talks to the server over `POST /chat`.

## Commands

Server (run from repo root):

- `npm install` — install Node deps (Express, CORS, `@anthropic-ai/sdk`).
- `npm start` / `node index.js` — run the server (port 3000, override with `PORT`).
- `docker build -t gudmoosic . && docker run -p 3000:3000 gudmoosic` — build/run with the bundled `yt-dlp` + `ffmpeg`.

Expo app (run from `app/`):

- `npm install` — install Expo + React Native.
- `npx expo start` — start Metro; press `w` for web, `i`/`a` for simulator. On a physical device the dev URL must reach the server's host (use the LAN IP or a tunnel).

There is no test suite, linter, or build step. Manual smoke tests:

```
curl "http://localhost:3000/"
curl "http://localhost:3000/info?url=https://www.youtube.com/watch?v=VIDEO_ID"
curl -o out.mp3 "http://localhost:3000/download?url=https://www.youtube.com/watch?v=VIDEO_ID"
curl -X POST http://localhost:3000/chat -H 'Content-Type: application/json' \
  -d '{"topic":"What is justice?","deities":["Ra","Anubis","Set"],"turns":6}'
```

## Architecture

Single-file Express app (`index.js`) exposing three HTTP endpoints:

- `GET /info` — runs `yt-dlp --dump-json` and returns title/uploader/duration/thumbnail/id.
- `GET /download` — runs `yt-dlp --extract-audio --audio-format mp3`, streams the result back as `audio/mpeg`, and unlinks it on stream end/error.
- `POST /chat` — multi-turn dialogue between Egyptian deity personas (defined in `personas.js`) using the Anthropic SDK. Body: `{topic, deities[], turns}`. Validates inputs, then runs a sequential loop: round-robin over `deities`, each turn calls `claude-opus-4-7` with that deity's persona as the system prompt and the running transcript in the user message. Returns `{topic, transcript: [{deity, text}]}`. Requires `ANTHROPIC_API_KEY`.

Key pieces that span the file:

- **System dependencies are not in `package.json`.** `yt-dlp` and `ffmpeg` must be on `PATH` at runtime. They are installed by both deployment manifests:
  - `Dockerfile` — apt installs `ffmpeg` + `python3`, then downloads the latest `yt-dlp` release binary to `/usr/local/bin`.
  - `nixpacks.toml` — declares `nodejs_20`, `yt-dlp`, `ffmpeg` as nix packages (used by Render/Railway-style hosts).
  Any change to how `yt-dlp` is invoked needs to keep both manifests in sync.

- **Ephemeral filesystem assumption.** Everything writes to `TMP = /tmp/gudmoosic` (created at boot). Downloaded MP3s use a `Date.now()`-based id and are deleted after the response stream closes. The cookies file is rewritten on every request that needs it (see commit `e24502a` — Render wipes `/tmp` between requests, so cookies cannot be cached at boot).

- **YouTube cookies via env var.** Set `YT_COOKIES_B64` to a base64-encoded Netscape cookies.txt. `cookiesArg()` decodes it, writes `yt_cookies.txt`, and returns the `--cookies` flag fragment that gets concatenated into the shell command. If the env var is unset, the function returns an empty string and `yt-dlp` runs without cookies. This is the main lever for bypassing YouTube bot detection — recent commits also experimented with `--extractor-args` player clients (`ios`, `web_creator`); reintroduce those via the same string-concat pattern if needed.

- **Shell command construction.** `yt-dlp` is invoked via `child_process.exec` with the URL interpolated into a string. `sanitize()` strips `;&|\`$<>\\` from the URL before interpolation. When adding flags, follow the same `cmd = [...].join(' ')` pattern used in `/download` and never pass un-sanitized user input into the command string.

- **Timeouts.** `/info` uses 60s, `/download` uses 180s (commit `80b4687` raised these). Long videos can still hit the cap; bump the per-route `timeout` rather than adding a global one.

- **Deity chat.** `personas.js` is the single source of truth for who can be summoned and how they speak — each entry has `domain` (one-line public description, drawn from the Wikipedia "List of Egyptian deities") and `notes` (longer in-character background). `buildSystemPrompt()` in `index.js` composes those into the per-turn system prompt and includes an explicit no-profanity / stay-in-character clause; that clause is load-bearing — don't strip it. Personas use `claude-opus-4-7` with `output_config.effort: "low"` (creative dialogue, doesn't need deep reasoning) and no `thinking` (off by default on 4.7). When adding a deity, follow the same shape and keep the description grounded in the source mythology.

## Expo app (`app/`)

Single screen (`App.js`) using built-in React Native components — no router, no state library. State lives in `useState` hooks: `serverUrl`, `topic`, `turns`, `selected` (a `Set` of deity names), `transcript`, `loading`, `error`. The deity list is hard-coded at the top of `App.js` and **must be kept in sync with the keys of `PERSONAS` in `personas.js`** — the server rejects unknown names with a 400.

`startChat()` POSTs to `${serverUrl}/chat` and renders the returned `transcript` as chat bubbles. Errors from the server (missing API key, unknown deity, Claude API error) come back as `{error, detail?}` JSON and surface in the red error banner.

## Conventions

- Keep the server single-file unless a change genuinely warrants splitting. Helpers (`sanitize`, `cleanup`, `cookiesArg`, `buildSystemPrompt`) live at the bottom of `index.js`.
- Error responses are always JSON with `{ error, detail? }` and an appropriate 4xx/5xx status.
- After any failed download, call `cleanup(outPath)` before responding so partial files don't accumulate in `/tmp`.
