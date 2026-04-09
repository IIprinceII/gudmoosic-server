// GudMoosic — YouTube MP3 Server

const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const TMP = '/tmp/gudmoosic';
const COOKIES_FILE = path.join(TMP, 'yt_cookies.txt');

app.use(cors());
app.use(express.json());

// Ensure temp dir exists
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

function cookiesArg() {
  if (!process.env.YT_COOKIES_B64) return '';
  const decoded = Buffer.from(process.env.YT_COOKIES_B64, 'base64').toString('utf8');
  fs.writeFileSync(COOKIES_FILE, decoded);
  return `--cookies "${COOKIES_FILE}"`;
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'GudMoosic Server running 🎵', version: '1.0.0' });
});

// ── Get video info (title, duration, thumbnail) ───────────────────────────────
app.get('/info', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  const cmd = `yt-dlp --dump-json --no-playlist ${cookiesArg()} "${sanitize(url)}"`;

  exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: 'Could not fetch video info', detail: stderr || err.message });
    try {
      const info = JSON.parse(stdout);
      res.json({
        title:     info.title,
        artist:    info.uploader,
        duration:  info.duration,
        thumbnail: info.thumbnail,
        id:        info.id,
      });
    } catch {
      res.status(500).json({ error: 'Failed to parse video info' });
    }
  });
});

// ── Download as MP3 ───────────────────────────────────────────────────────────
app.get('/download', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  const id       = Date.now().toString();
  const outPath  = path.join(TMP, `${id}.mp3`);
  const template = path.join(TMP, `${id}.%(ext)s`);

  const cmd = [
    'yt-dlp',
    '--no-playlist',
    '--extract-audio',
    '--audio-format mp3',
    '--audio-quality 0',
    cookiesArg(),
    `--output "${template}"`,
    `"${sanitize(url)}"`,
  ].join(' ');

  exec(cmd, { timeout: 180000 }, (err, stdout, stderr) => {
    if (err) {
      cleanup(outPath);
      return res.status(500).json({ error: 'Download failed', detail: stderr || err.message });
    }

    if (!fs.existsSync(outPath)) {
      return res.status(500).json({ error: 'MP3 file not found after download' });
    }

    const stat = fs.statSync(outPath);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${id}.mp3"`);

    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on('end', () => cleanup(outPath));
    stream.on('error', () => cleanup(outPath));
  });
});

function sanitize(url) {
  // Strip shell injection characters
  return url.replace(/[;&|`$<>\\]/g, '');
}

function cleanup(filePath) {
  try { fs.unlinkSync(filePath); } catch {}
}

app.listen(PORT, () => {
  console.log(`GudMoosic Server listening on port ${PORT}`);
});
