# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` — install Node deps (Express + CORS).
- `npm start` / `node index.js` — run the server (defaults to port 3000, override with `PORT`).
- `docker build -t gudmoosic . && docker run -p 3000:3000 gudmoosic` — build/run with the bundled `yt-dlp` + `ffmpeg`.

There is no test suite, linter, or build step configured. Manual smoke tests:

```
curl "http://localhost:3000/"
curl "http://localhost:3000/info?url=https://www.youtube.com/watch?v=VIDEO_ID"
curl -o out.mp3 "http://localhost:3000/download?url=https://www.youtube.com/watch?v=VIDEO_ID"
```

## Architecture

Single-file Express app (`index.js`) that wraps the `yt-dlp` CLI to expose two HTTP endpoints:

- `GET /info` — runs `yt-dlp --dump-json` and returns title/uploader/duration/thumbnail/id.
- `GET /download` — runs `yt-dlp --extract-audio --audio-format mp3`, streams the resulting file back as `audio/mpeg`, and unlinks it on stream end/error.

Key pieces that span the file:

- **System dependencies are not in `package.json`.** `yt-dlp` and `ffmpeg` must be on `PATH` at runtime. They are installed by both deployment manifests:
  - `Dockerfile` — apt installs `ffmpeg` + `python3`, then downloads the latest `yt-dlp` release binary to `/usr/local/bin`.
  - `nixpacks.toml` — declares `nodejs_20`, `yt-dlp`, `ffmpeg` as nix packages (used by Render/Railway-style hosts).
  Any change to how `yt-dlp` is invoked needs to keep both manifests in sync.

- **Ephemeral filesystem assumption.** Everything writes to `TMP = /tmp/gudmoosic` (created at boot). Downloaded MP3s use a `Date.now()`-based id and are deleted after the response stream closes. The cookies file is rewritten on every request that needs it (see commit `e24502a` — Render wipes `/tmp` between requests, so cookies cannot be cached at boot).

- **YouTube cookies via env var.** Set `YT_COOKIES_B64` to a base64-encoded Netscape cookies.txt. `cookiesArg()` decodes it, writes `yt_cookies.txt`, and returns the `--cookies` flag fragment that gets concatenated into the shell command. If the env var is unset, the function returns an empty string and `yt-dlp` runs without cookies. This is the main lever for bypassing YouTube bot detection — recent commits also experimented with `--extractor-args` player clients (`ios`, `web_creator`); reintroduce those via the same string-concat pattern if needed.

- **Shell command construction.** `yt-dlp` is invoked via `child_process.exec` with the URL interpolated into a string. `sanitize()` strips `;&|\`$<>\\` from the URL before interpolation. When adding flags, follow the same `cmd = [...].join(' ')` pattern used in `/download` and never pass un-sanitized user input into the command string.

- **Timeouts.** `/info` uses 60s, `/download` uses 180s (commit `80b4687` raised these). Long videos can still hit the cap; bump the per-route `timeout` rather than adding a global one.

## Conventions

- Keep the server single-file unless a change genuinely warrants splitting. Helpers (`sanitize`, `cleanup`, `cookiesArg`) live at the bottom of `index.js`.
- Error responses are always JSON with `{ error, detail? }` and an appropriate 4xx/5xx status.
- After any failed download, call `cleanup(outPath)` before responding so partial files don't accumulate in `/tmp`.
