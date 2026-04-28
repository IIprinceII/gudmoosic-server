// GudMoosic — YouTube MP3 Server

const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { PERSONAS } = require('./personas');

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

// ── Deity chat ────────────────────────────────────────────────────────────────
const anthropic = new Anthropic();

app.post('/chat', async (req, res) => {
  const { topic, deities, turns = 8 } = req.body || {};

  if (!topic || typeof topic !== 'string') {
    return res.status(400).json({ error: 'Missing topic (string)' });
  }
  if (!Array.isArray(deities) || deities.length === 0) {
    return res.status(400).json({ error: 'deities must be a non-empty array' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server' });
  }

  const unknown = deities.filter((d) => !PERSONAS[d]);
  if (unknown.length) {
    return res.status(400).json({
      error: `Unknown deities: ${unknown.join(', ')}`,
      known: Object.keys(PERSONAS),
    });
  }

  const turnCount = Math.max(1, Math.min(40, Number(turns) || 8));
  const transcript = [];

  try {
    for (let i = 0; i < turnCount; i++) {
      const name = deities[i % deities.length];
      const persona = PERSONAS[name];

      const conversationSoFar = transcript.length
        ? transcript.map((t) => `${t.deity}: ${t.text}`).join('\n\n')
        : '(The discussion has not yet begun. You speak first.)';

      const userMsg = [
        `Topic the mortals have brought before the gods: ${topic}`,
        '',
        'Conversation so far:',
        conversationSoFar,
        '',
        `Now reply in 2 to 4 sentences as ${name}. Do not prefix your reply with your name or any "says:" tag — just speak.`,
      ].join('\n');

      const reply = await anthropic.messages.create({
        model: 'claude-opus-4-7',
        max_tokens: 400,
        output_config: { effort: 'low' },
        system: buildSystemPrompt(name, persona),
        messages: [{ role: 'user', content: userMsg }],
      });

      const text = (reply.content.find((b) => b.type === 'text')?.text || '').trim();
      transcript.push({ deity: name, text });
    }

    res.json({ topic, transcript });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return res
        .status(err.status || 500)
        .json({ error: 'Claude API error', detail: err.message });
    }
    res.status(500).json({ error: 'Chat failed', detail: err.message });
  }
});

function buildSystemPrompt(name, persona) {
  return [
    `You are ${name}, ${persona.domain}.`,
    '',
    `Background: ${persona.notes}`,
    '',
    'You are speaking in a roundtable dialogue with other Egyptian deities about a topic mortals have brought before you.',
    '',
    'Style rules:',
    '- Reply in 2 to 4 sentences.',
    `- Stay strictly in character as ${name}. Do not narrate, do not break the fourth wall, do not address "the user".`,
    '- Reference your domain, symbols, or mythology when it fits naturally.',
    '- Address other gods present in the discussion when fitting.',
    '- Speak with mythic dignity. Do not use profanity, slurs, sexual content, or modern crude slang.',
    '- Do not preface your reply with your own name or any "says:" tag.',
  ].join('\n');
}

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
