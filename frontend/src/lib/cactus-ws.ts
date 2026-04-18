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

export type CactusEvent =
  | TranscriptChunk
  | ExtractionEvent
  | QuestionEvent
  | FinalEvent
  | StatusEvent;

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
  onExtraction: (extractions: ProfileExtraction[]) => void;
  onQuestions: (questions: ReactiveQuestion[]) => void;
  onFinal: (data: FinalEvent) => void;
  onStatus: (status: string) => void;
  onError: (error: string) => void;
  onClose: () => void;
}

export class CactusWSClient {
  private ws: WebSocket | null = null;
  private config: CactusWSConfig;
  private _connected = false;

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
    this.ws = new WebSocket(this.config.url);

    this.ws.onopen = () => {
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
      this.config.onClose();
    };
  }

  sendStop(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'stop' }));
    }
  }

  disconnect(): void {
    this._connected = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
