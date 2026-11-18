import { KokoroTTS } from "kokoro-js";
import fs from "node:fs";
const steps = JSON.parse(fs.readFileSync("timeline.json", "utf8"));
fs.mkdirSync("audio", { recursive: true });
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
const out = [];
for (let i = 0; i < steps.length; i++) {
  const text = steps[i].say;
  const audio = await tts.generate(text, { voice: "af_heart", speed: 1.1 });
  const file = `audio/${String(i).padStart(2, "0")}.wav`;
  await audio.save(file);
  out.push({ file, duration: audio.audio.length / audio.sampling_rate, rate: audio.sampling_rate });
  console.log(i, out.at(-1).duration.toFixed(2));
}
fs.writeFileSync("audio.json", JSON.stringify(out, null, 2));
