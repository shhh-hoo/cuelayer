import { readFile } from "node:fs/promises";
import { RealtimeClient } from "@speechmatics/real-time-client";

type WavPcm = { sampleRate: number; samples: Float32Array };

function readAscii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** Reads a non-personal, mono IEEE-float WAV fixture without converting or cleaning its samples. */
export function readFloatWav(bytes: Uint8Array): WavPcm {
  if (readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE") throw new Error("Expected a RIFF/WAVE file.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format: { code: number; channels: number; sampleRate: number; bitsPerSample: number } | undefined;
  let dataOffset: number | undefined;
  let dataLength: number | undefined;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const name = readAscii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const content = offset + 8;
    if (content + length > bytes.length) throw new Error("WAV chunk exceeds file length.");
    if (name === "fmt ") format = { code: view.getUint16(content, true), channels: view.getUint16(content + 2, true), sampleRate: view.getUint32(content + 4, true), bitsPerSample: view.getUint16(content + 14, true) };
    if (name === "data") { dataOffset = content; dataLength = length; }
    offset = content + length + (length % 2);
  }
  if (!format || dataOffset === undefined || dataLength === undefined) throw new Error("WAV needs fmt and data chunks.");
  if (format.code !== 3 || format.channels !== 1 || format.bitsPerSample !== 32 || dataLength % 4) throw new Error("Fixture must be mono 32-bit IEEE-float WAV (pcm_f32le).");
  return { sampleRate: format.sampleRate, samples: new Float32Array(bytes.buffer, bytes.byteOffset + dataOffset, dataLength / 4) };
}

async function main() {
  const path = process.argv[2];
  const token = process.env.SPEECHMATICS_REALTIME_TOKEN;
  if (!path || !token) throw new Error("Usage: SPEECHMATICS_REALTIME_TOKEN=<temporary token> npm run speechmatics:conformance -- /absolute/path/to/non-personal-mono-f32le.wav");
  const { sampleRate, samples } = readFloatWav(new Uint8Array(await readFile(path)));
  const client = new RealtimeClient({ url: "wss://global.rt.speechmatics.com/v2" });
  let partials = 0;
  let finals = 0;
  client.addEventListener("receiveMessage", ({ data }) => {
    if (data.message === "AddPartialTranscript" && data.metadata.transcript.trim()) partials += 1;
    if (data.message === "AddTranscript" && data.metadata.transcript.trim()) finals += 1;
    if (data.message !== "AudioAdded") console.log(JSON.stringify(data));
  });
  await client.start(token, { transcription_config: { language: "cmn_en", model: "enhanced", max_delay: 1.5, max_delay_mode: "flexible", enable_partials: true }, audio_format: { type: "raw", encoding: "pcm_f32le", sample_rate: sampleRate } });
  for (let offset = 0; offset < samples.length; offset += 128) {
    const chunk = samples.subarray(offset, Math.min(samples.length, offset + 128));
    client.sendAudio(chunk);
    await new Promise((resolve) => setTimeout(resolve, chunk.length / sampleRate * 1_000));
  }
  await client.stopRecognition();
  console.log(JSON.stringify({ sampleRate, sampleCount: samples.length, durationSeconds: samples.length / sampleRate, nonEmptyPartials: partials, nonEmptyFinals: finals }));
}

if (process.argv[1] && import.meta.filename === process.argv[1]) void main();
