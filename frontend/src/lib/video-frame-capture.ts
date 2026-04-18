/**
 * Periodic video frame capture for Gemma 4 vision analysis.
 *
 * Grabs a downscaled JPEG from a <video> element every `intervalMs` and
 * forwards it via `onFrame` (typically the Cactus WebSocket client).
 */

export interface VideoFrameCaptureOptions {
  intervalMs?: number;
  maxWidth?: number;
  quality?: number;
}

export class VideoFrameCapture {
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private onFrame: (dataUrl: string) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private intervalMs: number;
  private maxWidth: number;
  private quality: number;

  constructor(
    video: HTMLVideoElement,
    onFrame: (dataUrl: string) => void,
    options: VideoFrameCaptureOptions = {},
  ) {
    this.video = video;
    this.onFrame = onFrame;
    this.intervalMs = options.intervalMs ?? 5000;
    this.maxWidth = options.maxWidth ?? 512;
    this.quality = options.quality ?? 0.7;
    this.canvas = document.createElement('canvas');
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.captureOnce(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private captureOnce(): void {
    const { videoWidth, videoHeight } = this.video;
    if (!videoWidth || !videoHeight) return;

    const scale = Math.min(1, this.maxWidth / videoWidth);
    const w = Math.round(videoWidth * scale);
    const h = Math.round(videoHeight * scale);
    this.canvas.width = w;
    this.canvas.height = h;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(this.video, 0, 0, w, h);

    try {
      const dataUrl = this.canvas.toDataURL('image/jpeg', this.quality);
      this.onFrame(dataUrl);
    } catch {
      // Tainted canvas or encoding failure — skip this tick silently.
    }
  }
}
