// Minimal Web MIDI handler (web only). Returns a list of recent note events.
import { Platform } from "react-native";

export type MidiEvent = {
  id: string;
  type: "on" | "off";
  note: number;
  name: string;
  velocity: number;
  at: number;
};

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export function midiToName(n: number): string {
  const name = NOTES[((n % 12) + 12) % 12];
  const octave = Math.floor(n / 12) - 1;
  return `${name}${octave}`;
}

export type MidiState = {
  supported: boolean;
  devices: string[];
  events: MidiEvent[];
};

export async function startMidi(
  onUpdate: (s: MidiState) => void,
): Promise<() => void> {
  if (Platform.OS !== "web" || !(navigator as any).requestMIDIAccess) {
    onUpdate({ supported: false, devices: [], events: [] });
    return () => {};
  }
  try {
    const access: any = await (navigator as any).requestMIDIAccess();
    let devices: string[] = [];
    let events: MidiEvent[] = [];

    const refreshDevices = () => {
      devices = [];
      const inputs = access.inputs.values();
      for (const inp of inputs) devices.push(inp.name || "MIDI In");
    };

    const bindInputs = () => {
      const inputs = access.inputs.values();
      for (const inp of inputs) {
        inp.onmidimessage = (msg: any) => {
          const [status, note, vel] = msg.data;
          const cmd = status & 0xf0;
          if (cmd === 0x90 && vel > 0) {
            const ev: MidiEvent = {
              id: `${Date.now()}-${Math.random()}`,
              type: "on",
              note,
              name: midiToName(note),
              velocity: vel,
              at: Date.now(),
            };
            events = [ev, ...events].slice(0, 20);
            onUpdate({ supported: true, devices, events });
          } else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) {
            const ev: MidiEvent = {
              id: `${Date.now()}-${Math.random()}`,
              type: "off",
              note,
              name: midiToName(note),
              velocity: vel,
              at: Date.now(),
            };
            events = [ev, ...events].slice(0, 20);
            onUpdate({ supported: true, devices, events });
          }
        };
      }
    };

    access.onstatechange = () => {
      refreshDevices();
      bindInputs();
      onUpdate({ supported: true, devices, events });
    };

    refreshDevices();
    bindInputs();
    onUpdate({ supported: true, devices, events });

    return () => {
      const inputs = access.inputs.values();
      for (const inp of inputs) inp.onmidimessage = null;
      access.onstatechange = null;
    };
  } catch {
    onUpdate({ supported: false, devices: [], events: [] });
    return () => {};
  }
}
