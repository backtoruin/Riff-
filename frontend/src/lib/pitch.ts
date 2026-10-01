// Simple cross-platform pitch detector.
// Web: Web Audio API + autocorrelation.
// Native: no-op (returns a static state) — the Studio screen falls back to tap-tempo there.

import { Platform } from "react-native";

export type PitchState = {
  frequency: number | null; // Hz
  note: string | null;
  cents: number; // -50..+50 offset from nearest note
  rms: number; // 0..1 loudness
};

export type Unsubscribe = () => void;

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function freqToNote(freq: number): { note: string; cents: number } {
  // A4 = 440 Hz => midi 69
  const midi = 69 + 12 * Math.log2(freq / 440);
  const rounded = Math.round(midi);
  const name = NOTES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  const cents = Math.round((midi - rounded) * 100);
  return { note: `${name}${octave}`, cents };
}

function autocorrelate(buf: Float32Array, sampleRate: number): number {
  // Returns fundamental frequency or -1
  const SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;

  let r1 = 0;
  let r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++)
    if (Math.abs(buf[i]) < thres) {
      r1 = i;
      break;
    }
  for (let i = 1; i < SIZE / 2; i++)
    if (Math.abs(buf[SIZE - i]) < thres) {
      r2 = SIZE - i;
      break;
    }

  const trimmed = buf.subarray(r1, r2);
  const n = trimmed.length;
  const c = new Array(n).fill(0);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n - i; j++) c[i] += trimmed[j] * trimmed[j + i];

  let d = 0;
  while (c[d] > c[d + 1]) d++;
  let maxval = -1;
  let maxpos = -1;
  for (let i = d; i < n; i++) {
    if (c[i] > maxval) {
      maxval = c[i];
      maxpos = i;
    }
  }
  if (maxpos <= 0) return -1;
  let T0 = maxpos;
  const x1 = c[T0 - 1];
  const x2 = c[T0];
  const x3 = c[T0 + 1] ?? x2;
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  if (a) T0 = T0 - b / (2 * a);
  return sampleRate / T0;
}

export async function startPitchDetection(
  onUpdate: (s: PitchState) => void,
): Promise<Unsubscribe> {
  if (Platform.OS !== "web") {
    // No-op on native; return an unsubscribe that does nothing
    onUpdate({ frequency: null, note: null, cents: 0, rms: 0 });
    return () => {};
  }
  try {
    // @ts-ignore
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // @ts-ignore
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let raf = 0;
    const loop = () => {
      analyser.getFloatTimeDomainData(buf);
      let rms = 0;
      for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
      rms = Math.sqrt(rms / buf.length);
      const freq = autocorrelate(buf, ctx.sampleRate);
      if (freq > 50 && freq < 2000) {
        const { note, cents } = freqToNote(freq);
        onUpdate({ frequency: freq, note, cents, rms });
      } else {
        onUpdate({ frequency: null, note: null, cents: 0, rms });
      }
      raf = (globalThis as any).requestAnimationFrame(loop);
    };
    loop();
    return () => {
      (globalThis as any).cancelAnimationFrame(raf);
      source.disconnect();
      stream.getTracks().forEach((t: any) => t.stop());
      ctx.close().catch(() => {});
    };
  } catch (e) {
    onUpdate({ frequency: null, note: null, cents: 0, rms: 0 });
    return () => {};
  }
}
