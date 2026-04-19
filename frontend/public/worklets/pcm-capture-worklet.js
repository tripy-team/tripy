// PCM capture worklet — runs on the audio rendering thread.
// Accumulates mono Float32 samples into 4096-sample chunks, applies a
// modest gain boost so normal-volume speech reaches the ASR model without
// the user having to raise their voice, converts to 16-bit little-endian
// PCM, and posts each chunk to the main thread.

const CHUNK_SIZE = 4096;
// No gain here — the browser's autoGainControl is enabled on the track
// (see livekit-room.ts createLocalTracks audio constraints). Stacking a
// fixed 3x multiplier on top of AGC caused clipping on natural peaks and
// degraded transcription. Server-side auto-gain (transcription.py) still
// handles the quiet tail if needed.
const GAIN = 1.0;

class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(CHUNK_SIZE);
    this._offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;

    let read = 0;
    while (read < channel.length) {
      const room = CHUNK_SIZE - this._offset;
      const take = Math.min(room, channel.length - read);
      this._buffer.set(channel.subarray(read, read + take), this._offset);
      this._offset += take;
      read += take;

      if (this._offset === CHUNK_SIZE) {
        const pcm16 = new Int16Array(CHUNK_SIZE);
        for (let i = 0; i < CHUNK_SIZE; i++) {
          const s = Math.max(-1, Math.min(1, this._buffer[i] * GAIN));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
        this._offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture-processor', PCMCaptureProcessor);
