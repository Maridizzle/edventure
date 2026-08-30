import { del, get, set } from 'idb-keyval';
import type { AudioEngine } from './AudioEngine';

/**
 * A cheer recorded in your own voice, played when he finishes a room.
 *
 * Nothing else in this game will land the way that does, and it is the one
 * sound in here that isn't synthesised.
 *
 * IT NEVER LEAVES THE PHONE. Stored in IndexedDB on the device, read back by
 * this file, played through the local audio graph. There is no upload, no
 * network call and no server in this feature at all — which is the only
 * acceptable shape for a recording of a family, made inside a child's app.
 *
 * The fallback matters as much as the recording. No recording yet, microphone
 * refused, a browser that will not record at all: the celebration must be
 * exactly as good, so every failure here returns false and the animals cheer
 * instead. Nothing about a finished room may depend on this working.
 */

const KEY = 'edventure.voice.cheer';
/** Long enough for a proper "WELL DONE!", short enough to never be a monologue. */
export const MAX_RECORD_MS = 5000;

interface Stored {
  mime: string;
  data: ArrayBuffer;
}

/** Whichever container this browser will actually give us. */
function pickMime(): string {
  const R = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (!R?.isTypeSupported) return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (R.isTypeSupported(m)) return m;
  }
  return '';
}

export class VoiceStore {
  private stored: Stored | null = null;
  private buffer: AudioBuffer | null = null;
  private recorder: MediaRecorder | null = null;

  /** True once a recording exists on this device. */
  get has(): boolean {
    return this.stored !== null;
  }

  get recording(): boolean {
    return this.recorder !== null;
  }

  /** Can this device record at all? Drives whether the panel offers it. */
  static get supported(): boolean {
    const n = navigator as Navigator & { mediaDevices?: MediaDevices };
    return (
      typeof MediaRecorder !== 'undefined' &&
      n.mediaDevices?.getUserMedia !== undefined
    );
  }

  /** Read whatever is already on the device. Safe to call before any gesture. */
  async load(): Promise<void> {
    try {
      const v = (await get(KEY)) as Stored | undefined;
      if (v && v.data && v.data.byteLength > 0) this.stored = v;
    } catch {
      /* private mode, storage denied, or a first run. Not a problem. */
    }
  }

  /**
   * Record until `stop()` or `MAX_RECORD_MS`, whichever comes first.
   *
   * Resolves true if something was captured and saved. The microphone track is
   * stopped explicitly on every path — leaving it live would sit a recording
   * indicator on the phone for the rest of the session.
   */
  async record(): Promise<boolean> {
    if (this.recorder) return false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return false; // refused, or no microphone. The animals will cheer instead.
    }

    const mime = pickMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      for (const t of stream.getTracks()) t.stop();
      return false;
    }

    this.recorder = rec;
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const done = new Promise<boolean>((resolve) => {
      rec.onstop = () => {
        for (const t of stream.getTracks()) t.stop();
        this.recorder = null;
        clearTimeout(timer);
        void this.save(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' })).then(
          resolve,
        );
      };
    });

    const timer = setTimeout(() => this.stop(), MAX_RECORD_MS);
    rec.start();
    return done;
  }

  stop(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
  }

  private async save(blob: Blob): Promise<boolean> {
    if (blob.size === 0) return false;
    const data = await blob.arrayBuffer();
    const stored: Stored = { mime: blob.type, data };
    this.stored = stored;
    this.buffer = null; // force a re-decode of the new recording
    try {
      await set(KEY, stored);
    } catch {
      // It will still play this session; it just will not survive a reload.
    }
    return true;
  }

  async clear(): Promise<void> {
    this.stored = null;
    this.buffer = null;
    try {
      await del(KEY);
    } catch {
      /* nothing to delete */
    }
  }

  /**
   * Play it, decoding on first use.
   *
   * Returns false for every failure — nothing recorded, audio not unlocked yet,
   * a container this browser cannot decode — and the caller cheers instead.
   * Decoding is async, so the answer here is "will it play", not "has it".
   */
  play(audio: AudioEngine): boolean {
    if (!this.stored || !audio.ready) return false;
    if (this.buffer) return audio.playBuffer(this.buffer, 0.9);
    void this.decodeThenPlay(audio);
    return true;
  }

  private async decodeThenPlay(audio: AudioEngine): Promise<void> {
    const stored = this.stored;
    if (!stored) return;
    const buf = await audio.decode(stored.data);
    if (!buf) {
      this.stored = null; // undecodable; stop pretending we have one
      return;
    }
    this.buffer = buf;
    audio.playBuffer(buf, 0.9);
  }

  /** Warm the decode so the first cheer is not late. Called after unlock. */
  async prime(audio: AudioEngine): Promise<void> {
    if (!this.stored || this.buffer || !audio.ready) return;
    const buf = await audio.decode(this.stored.data);
    if (buf) this.buffer = buf;
  }
}
