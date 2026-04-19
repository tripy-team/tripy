/**
 * WebSocket client for the Cactus live-call inference server.
 *
 * Manages the connection, streams audio, and dispatches events
 * for transcripts, extractions, and generated questions.
 */

export interface TranscriptChunk {
  type: 'transcript';
  speaker: 'advisor' | 'client' | 'both' | 'unknown' | 'silence';
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  timestamp: number;
}

export interface ExtractionEvent {
  type: 'extraction';
  data: ProfileExtraction[];
}

export interface ProfileExtraction {
  targetField: string;
  suggestedValue: unknown;
  confidence: number;
  evidence: string;
}

export interface QuestionEvent {
  type: 'questions';
  data: ReactiveQuestion[];
}

export interface ReactiveQuestion {
  questionText: string;
  category: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  targetFields: string[];
  triggerPhrase: string;
}

export interface FinalEvent {
  type: 'final';
  transcript: TranscriptChunk[];
  learned: Record<string, unknown>;
  confidenceMap: Record<string, number>;
  evidenceMap: Record<string, string[]>;
  contradictions: Array<{
    field: string;
    previous: unknown;
    new: unknown;
    evidence: string;
  }>;
  commitReady: Array<{
    targetField: string;
    suggestedValue: unknown;
    confidence: number;
    evidence: string;
    status: string;
  }>;
}

export interface StatusEvent {
  type: 'status';
  status: string;
}

export interface VisualInsightEvent {
  type: 'visualInsight';
  insight: string;
  timestamp: number;
}

export interface PartialTranscriptEvent {
  type: 'partial';
  speaker: TranscriptChunk['speaker'];
  text: string;
  timestamp: number;
}

export type CactusEvent =
  | TranscriptChunk
  | ExtractionEvent
  | QuestionEvent
  | FinalEvent
  | StatusEvent
  | VisualInsightEvent
  | PartialTranscriptEvent;

export interface CactusWSConfig {
  url: string;
  clientName: string;
  existingPreferences: Record<string, unknown>;
  tripContext?: {
    destinations: string;
    travelDates: string;
    travelerNames: string;
    status: string;
  } | null;
  onTranscript: (chunk: TranscriptChunk) => void;
  onPartial?: (partial: PartialTranscriptEvent) => void;
  onExtraction: (extractions: ProfileExtraction[]) => void;
  onQuestions: (questions: ReactiveQuestion[]) => void;
  onFinal: (data: FinalEvent) => void;
  onStatus: (status: string) => void;
  onError: (error: string) => void;
  onClose: () => void;
  onVisualInsight?: (insight: string) => void;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;

export class CactusWSClient {
  private ws: WebSocket | null = null;
  private config: CactusWSConfig;
  private _connected = false;
  private _intentionallyClosed = false;
  private _reconnectAttempts = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: CactusWSConfig) {
    this.config = config;
  }

  get connected(): boolean {
    return this._connected;
  }

  get socket(): WebSocket | null {
    return this.ws;
  }

  connect(): void {
    this._intentionallyClosed = false;
    this.openSocket();
  }

  private openSocket(): void {
    this.ws = new WebSocket(this.config.url);

    this.ws.onopen = () => {
      this._reconnectAttempts = 0;
      // Send config as first message
      this.ws!.send(
        JSON.stringify({
          clientName: this.config.clientName,
          existingPreferences: this.config.existingPreferences,
          tripContext: this.config.tripContext || null,
        }),
      );
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: CactusEvent = JSON.parse(event.data);
        switch (msg.type) {
          case 'transcript':
            this.config.onTranscript(msg as TranscriptChunk);
            break;
          case 'partial':
            this.config.onPartial?.(msg as PartialTranscriptEvent);
            break;
          case 'extraction':
            this.config.onExtraction((msg as ExtractionEvent).data);
            break;
          case 'questions':
            this.config.onQuestions((msg as QuestionEvent).data);
            break;
          case 'final':
            this.config.onFinal(msg as FinalEvent);
            break;
          case 'status':
            if ((msg as StatusEvent).status === 'ready') {
              this._connected = true;
            }
            this.config.onStatus((msg as StatusEvent).status);
            break;
          case 'visualInsight':
            this.config.onVisualInsight?.(
              (msg as VisualInsightEvent).insight,
            );
            break;
        }
      } catch {
        console.error('Failed to parse Cactus WS message');
      }
    };

    this.ws.onerror = () => {
      this.config.onError('WebSocket connection error');
    };

    this.ws.onclose = () => {
      this._connected = false;
      if (this._intentionallyClosed) {
        this.config.onClose();
        return;
      }
      if (this._reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        this.config.onStatus('disconnected');
        this.config.onClose();
        return;
      }
      const delay = Math.min(
        MAX_BACKOFF_MS,
        BASE_BACKOFF_MS * 2 ** this._reconnectAttempts,
      );
      this._reconnectAttempts += 1;
      this.config.onStatus('reconnecting');
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        this.openSocket();
      }, delay);
    };
  }

  sendStop(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'stop' }));
    }
  }

  sendVideoFrame(frameDataUrl: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'video_frame', frame: frameDataUrl }));
    }
  }

  disconnect(): void {
    this._intentionallyClosed = true;
    this._connected = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
