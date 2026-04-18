/**
 * Audio capture pipeline for live call transcription.
 *
 * Captures audio from a MediaStream, downsamples to 16 kHz mono PCM via an
 * AudioWorklet, and forwards the PCM chunks (with a channel-id prefix byte)
 * over a WebSocket to the Cactus server.
 */

const WORKLET_MODULE_URL = '/worklets/pcm-capture-worklet.js';
const WORKLET_PROCESSOR_NAME = 'pcm-capture-processor';

const registeredContexts = new WeakSet<AudioContext>();

async function ensureWorkletRegistered(context: AudioContext): Promise<void> {
  if (registeredContexts.has(context)) return;
  await context.audioWorklet.addModule(WORKLET_MODULE_URL);
  registeredContexts.add(context);
}

export class AudioCapturePipeline {
  private context: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
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
    await ensureWorkletRegistered(this.context);

    this.sourceNode = this.context.createMediaStreamSource(stream);
    this.workletNode = new AudioWorkletNode(this.context, WORKLET_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    });

    const channelByte = this.channel === 'local' ? 0 : 1;

    this.workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (!this._active || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const pcm16 = event.data;
      const packet = new Uint8Array(1 + pcm16.byteLength);
      packet[0] = channelByte;
      packet.set(new Uint8Array(pcm16), 1);
      this.ws.send(packet.buffer);
    };

    this.sourceNode.connect(this.workletNode);
    this._active = true;
  }

  stop(): void {
    this._active = false;
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.context) {
      void this.context.close();
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
 * Capture audio from a remote MediaStream (the other participant).
 */
export class RemoteAudioCapture extends AudioCapturePipeline {
  constructor() {
    super('remote');
  }
}
