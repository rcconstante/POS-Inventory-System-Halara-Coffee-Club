// Renders compose.html frame-by-frame and encodes the final MP4 with ffmpeg.
// Usage: node compose.mjs preview t1,t2,...   |   node compose.mjs render out.mp4
import { chromium } from "playwright-core";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const FPS = 30;
const [mode = "preview", arg = ""] = process.argv.slice(2);
const timeline = JSON.parse(fs.readFileSync(path.join(ROOT, "timeline.json"), "utf8"));
const audio = JSON.parse(fs.readFileSync(path.join(ROOT, "audio.json"), "utf8"));

const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--allow-file-access-from-files"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("pageerror", e.message));
await page.goto(pathToFileURL(path.join(ROOT, "compose.html")).href);
await page.evaluate(() => document.fonts.ready);
const info = await page.evaluate(([t, a]) => window.build(t, a), [timeline, audio]);
console.log("total seconds", info.total.toFixed(1), JSON.stringify(info.starts));

const srt = (s) => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60, r = ms % 1000; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(r).padStart(3, "0")}`; };
fs.writeFileSync(path.join(ROOT, "subtitles.srt"), info.subs.map((s, i) => `${i + 1}\n${srt(s.start)} --> ${srt(s.end)}\n${s.text}\n`).join("\n"));

const cdp = await page.context().newCDPSession(page);
async function grab() { const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92 }); return Buffer.from(data, "base64"); }

if (mode === "preview") {
  fs.mkdirSync(path.join(ROOT, "preview"), { recursive: true });
  for (const t of arg.split(",").map(Number)) {
    await page.evaluate((x) => window.renderAt(x), t);
    fs.writeFileSync(path.join(ROOT, "preview", `t${t.toFixed(2)}.jpg`), await grab());
  }
  await browser.close();
  process.exit(0);
}

// 1) narration track
const out = arg || path.join(ROOT, "demo.mp4");
const narration = path.join(ROOT, "narration.wav");
{
  const inputs = audio.flatMap((a) => ["-i", path.join(ROOT, a.file)]);
  const delays = audio.map((a, i) => `[${i}]adelay=${Math.round(info.audio[i].start * 1000)}:all=1[a${i}]`).join(";");
  const filter = `${delays};${audio.map((_, i) => `[a${i}]`).join("")}amix=inputs=${audio.length}:normalize=0,apad,atrim=0:${info.total.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[out]`;
  await run([...inputs, "-filter_complex", filter, "-map", "[out]", "-ar", "48000", "-ac", "2", "-y", narration]);
}

// 2) frames -> video
const frames = Math.ceil(info.total * FPS);
const ff = spawn(ffmpegPath, ["-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-", "-i", narration,
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
  "-c:a", "aac", "-b:a", "192k", "-shortest", out], { stdio: ["pipe", "ignore", "pipe"] });
let ffErr = ""; ff.stderr.on("data", (d) => { ffErr = (ffErr + d).slice(-4000); });
const started = Date.now();
for (let f = 0; f < frames; f++) {
  await page.evaluate((x) => window.renderAt(x), f / FPS);
  const buf = await grab();
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  if (f % 300 === 0) console.log(`frame ${f}/${frames} · ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
ff.stdin.end();
const code = await new Promise((r) => ff.on("close", r));
if (code !== 0) { console.error(ffErr); process.exit(1); }
console.log("wrote", out);
await browser.close();

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = ""; p.stderr.on("data", (d) => { err = (err + d).slice(-3000); });
    p.on("close", (c) => c === 0 ? resolve() : reject(new Error(err)));
  });
}
