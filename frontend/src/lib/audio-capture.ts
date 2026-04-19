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

export type WebSocketResolver = WebSocket | (() => WebSocket | null);

export class AudioCapturePipeline {
  private context: AudioContext | null = null;
  private ownsContext = false;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  // Resolver (not a snapshot) so the pipeline survives a CactusWSClient
  // reconnect — otherwise we'd keep sending audio to the old, closed socket
  // and transcription would silently go dark after ~60s of network idleness.
  private wsResolver: (() => WebSocket | null) | null = null;
  private channel: 'local' | 'remote';
  private _active = false;

  constructor(channel: 'local' | 'remote' = 'local') {
    this.channel = channel;
  }

  get active(): boolean {
    return this._active;
  }

  async start(
    stream: MediaStream,
    ws: WebSocketResolver,
    context?: AudioContext,
  ): Promise<void> {
    this.wsResolver = typeof ws === 'function' ? ws : () => ws;
    if (context) {
      this.context = context;
      this.ownsContext = false;
    } else {
      this.context = new AudioContext({ sampleRate: 16000 });
      this.ownsContext = true;
    }
    await ensureWorkletRegistered(this.context);

    // AudioContext starts 'suspended' if the originating user gesture has
    // expired (e.g. after awaited network calls in the start flow). Without
    // resuming, the worklet's process() is never called and no PCM is ever
    // produced. Callers should ideally hand us a pre-primed context created
    // inside a click handler.
    if (this.context.state === 'suspended') {
      try {
        await this.context.resume();
      } catch {
        /* if resume fails, the graph stays silent — caller will see no audio */
      }
    }

    const audioTracks = stream.getAudioTracks();
    console.log(
      `[AudioCapture:${this.channel}] start — ctx.state=${this.context.state}, audioTracks=${audioTracks.length}, tracks=`,
      audioTracks.map((t) => ({
        label: t.label,
        enabled: t.enabled,
        muted: t.muted,
        readyState: t.readyState,
      })),
    );

    this.sourceNode = this.context.createMediaStreamSource(stream);
    this.workletNode = new AudioWorkletNode(this.context, WORKLET_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    });

    const channelByte = this.channel === 'local' ? 0 : 1;
    let framesSent = 0;
    let framesDropped = 0;

    this.workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      const ws = this.wsResolver?.() ?? null;
      if (!this._active || !ws || ws.readyState !== WebSocket.OPEN) {
        framesDropped++;
        if (framesDropped === 1 || framesDropped % 25 === 0) {
          console.warn(
            `[AudioCapture:${this.channel}] dropped frame #${framesDropped} — active=${this._active}, ws=${ws?.readyState}`,
          );
        }
        return;
      }
      const pcm16 = event.data;
      const packet = new Uint8Array(1 + pcm16.byteLength);
      packet[0] = channelByte;
      packet.set(new Uint8Array(pcm16), 1);
      ws.send(packet.buffer);
      framesSent++;
      if (framesSent === 1 || framesSent % 25 === 0) {
        console.log(
          `[AudioCapture:${this.channel}] sent frame #${framesSent} (${packet.byteLength} bytes)`,
        );
      }
    };

    this.sourceNode.connect(this.workletNode);
    this._active = true;
    console.log(`[AudioCapture:${this.channel}] pipeline active`);
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
    if (this.context && this.ownsContext) {
      void this.context.close();
    }
    this.context = null;
    this.ownsContext = false;
    this.wsResolver = null;
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
