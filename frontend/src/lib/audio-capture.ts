/**
 * Audio capture pipeline for live call transcription.
 *
 * Captures audio from getUserMedia, downsamples to 16kHz mono PCM,
 * and sends chunks to the Cactus WebSocket server.
 */

export class AudioCapturePipeline {
  private context: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: ScriptProcessorNode | null = null;
  private ws: WebSocket | null = null;
  private channel: 'local' | 'remote';
  private _active = false;

  constructor(channel: 'local' | 'remote' = 'local') {
    this.channel = channel;
  }

  get active(): boolean {
    return this._active;
  }

  async start(stream: MediaStream, ws: WebSocket): Promise<void> {
    this.ws = ws;
    this.context = new AudioContext({ sampleRate: 16000 });
    this.sourceNode = this.context.createMediaStreamSource(stream);

    // Use ScriptProcessorNode for broad compatibility (AudioWorklet requires HTTPS)
    const bufferSize = 4096;
    this.workletNode = this.context.createScriptProcessor(bufferSize, 1, 1);

    this.workletNode.onaudioprocess = (event: AudioProcessingEvent) => {
      if (!this._active || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      const inputData = event.inputBuffer.getChannelData(0);
      const pcm16 = float32ToPCM16(inputData);

      // Prepend channel byte: 0 = advisor (local), 1 = client (remote)
      const channelByte = this.channel === 'local' ? 0 : 1;
      const packet = new Uint8Array(1 + pcm16.byteLength);
      packet[0] = channelByte;
      packet.set(new Uint8Array(pcm16), 1);

      this.ws.send(packet.buffer);
    };

    this.sourceNode.connect(this.workletNode);
    this.workletNode.connect(this.context.destination);
    this._active = true;
  }

  stop(): void {
    this._active = false;
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.context) {
      this.context.close();
      this.context = null;
    }
  }

  pause(): void {
    this._active = false;
  }

  resume(): void {
    this._active = true;
  }
}

/**
 * Convert Float32Array audio samples to 16-bit PCM ArrayBuffer.
 */
function float32ToPCM16(float32: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/**
 * Capture audio from a remote MediaStream (the other participant).
 */
export class RemoteAudioCapture extends AudioCapturePipeline {
  constructor() {
    super('remote');
  }
}
