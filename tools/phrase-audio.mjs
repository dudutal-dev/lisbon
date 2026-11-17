// Records the Portuguese phrases (PHRASES in data.js) into audio/pt/<n>.mp3 with ElevenLabs.
// Voice: "Beatriz", a native European Portuguese (Lisbon accent) female voice from the ElevenLabs voice library.
// Run: ELEVEN_KEY=... node tools/greek-audio.mjs [n n ...]   (no numbers = all phrases)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const VOICE = 'IOntNi3WhlrGbqLWGi61';
const PHRASES = new Function(readFileSync('data.js', 'utf8') + '; return PHRASES;')();
const only = process.argv.slice(2).map(Number);
mkdirSync('audio/pt', { recursive: true });
let ok = 0; const bad = [];
for (const p of PHRASES) {
  const n = p[3]; if (only.length && !only.includes(n)) continue;
  const text = /[.!;]$/.test(p[1]) ? p[1] : p[1] + '.';
  const body = JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.6, similarity_boost: 0.8, speed: 0.9 } });
  const out = `audio/pt/${n}.mp3`;
  // curl is used so the request goes through the same proxy and credentials as the rest of the tooling
  const code = execFileSync('curl', ['-sS', '-o', out, '-w', '%{http_code}', '-X', 'POST', `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_64`,
    '-H', `xi-api-key: ${process.env.ELEVEN_KEY || 'dummy'}`, '-H', 'content-type: application/json', '-d', body]).toString().trim();
  if (code === '200' && readFileSync(out).length > 3000) ok++; else bad.push([n, code]);
}
console.log('recorded', ok, 'failed', JSON.stringify(bad));
