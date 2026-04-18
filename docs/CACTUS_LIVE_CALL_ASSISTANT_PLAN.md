# Cactus Live Call Assistant — End-to-End Implementation Plan

## Overview

Build a real-time, AI-powered call assistant that helps travel advisors learn about their clients during live video/audio calls. The system uses **Cactus** (on-device inference engine) for low-latency speech-to-text transcription and local LLM inference, integrated into the existing Tripy meeting copilot and trips pages.

### Core Value Proposition

During a live video call with a client, the system:
1. **Transcribes** the conversation in real-time using Cactus speech models (Whisper/Parakeet)
2. **Extracts** client preferences, travel details, and profile data from the transcript automatically
3. **Generates follow-up questions** dynamically when the client answers a question — surfacing deeper discovery opportunities the advisor might miss
4. **Updates the client profile** with learned preferences so future trip planning is informed by every conversation
5. **Provides a live sidebar** with suggested questions, extracted insights, and profile completeness tracking

### Why Cactus

- **Low latency**: Parakeet achieves 300k+ tokens/sec for transcription; LFM 1.2B runs at 48 decode tokens/sec on mobile hardware
- **Privacy**: Client PII (passport numbers, payment details, personal preferences) stays on-device — never leaves the advisor's machine
- **Offline-capable**: Works without internet for transcription + basic inference; cloud fallback for complex queries
- **Cost**: No per-minute transcription API costs after initial setup

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Next.js)                        │
│                                                                 │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────┐ │
│  │  Video Call   │  │  Transcript      │  │  AI Copilot       │ │
│  │  (WebRTC)     │  │  Feed Panel      │  │  Sidebar          │ │
│  │              │  │  - live captions  │  │  - questions      │ │
│  │  Local +     │  │  - speaker labels │  │  - extractions    │ │
│  │  Remote      │  │  - timestamps     │  │  - profile meter  │ │
│  │  video       │  │                   │  │  - recap          │ │
│  └──────┬───────┘  └────────▲─────────┘  └────────▲───────────┘ │
│         │                   │                      │             │
│         │ audio stream      │ transcript chunks    │ suggestions │
│         ▼                   │                      │             │
│  ┌──────────────────────────┴──────────────────────┴───────────┐ │
│  │              Cactus Bridge (WebSocket client)               │ │
│  └──────────────────────────┬──────────────────────────────────┘ │
└─────────────────────────────┼───────────────────────────────────┘
                              │ audio via WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Cactus Inference Server (Python)                   │
│                                                                 │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────┐ │
│  │  Whisper /    │  │  LLM (LFM 1.2B  │  │  WebSocket        │ │
│  │  Parakeet     │  │  / Gemma 3)      │  │  Server           │ │
│  │  STT Engine   │  │                  │  │  (FastAPI)        │ │
│  │              │  │  - extraction    │  │                   │ │
│  │  Real-time   │  │  - question gen  │  │  Streams:         │ │
│  │  transcribe  │  │  - classification│  │  - transcripts    │ │
│  └──────┬───────┘  └────────▲─────────┘  │  - suggestions    │ │
│         │                   │             │  - extractions    │ │
│         │ text chunks       │ prompt      └───────────────────┘ │
│         └───────────────────┘                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP (persist results)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Tripy Backend (Next.js API + FastAPI)              │
│                                                                 │
│  Existing meeting API routes:                                   │
│  POST /api/clients/:id/meetings/:mid/entries                   │
│  POST /api/clients/:id/meetings/:mid/questions                 │
│  POST /api/clients/:id/meetings/:mid/extract                   │
│  POST /api/clients/:id/meetings/:mid/commit                    │
│  POST /api/clients/:id/meetings/:mid/recap                     │
│                                                                 │
│  New routes:                                                    │
│  POST /api/clients/:id/meetings/:mid/live/start                │
│  POST /api/clients/:id/meetings/:mid/live/stop                 │
│  WS   /api/clients/:id/meetings/:mid/live/stream               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema Changes

### New Models

```prisma
// Add to schema.prisma

model LiveCallSession {
  id                String                  @id @default(cuid())
  meetingSessionId  String                  @map("meeting_session_id")
  status            LiveCallStatus          @default(waiting)
  videoProvider     String                  @default("webrtc") @map("video_provider")
  startedAt         DateTime?               @map("started_at")
  endedAt           DateTime?               @map("ended_at")
  duration          Int?                    // seconds
  createdAt         DateTime                @default(now()) @map("created_at")
  updatedAt         DateTime                @updatedAt @map("updated_at")

  meetingSession    DiscoveryMeetingSession  @relation(fields: [meetingSessionId], references: [id], onDelete: Cascade)
  transcriptChunks  TranscriptChunk[]

  @@index([meetingSessionId])
  @@map("live_call_sessions")
}

model TranscriptChunk {
  id              String          @id @default(cuid())
  liveCallId      String          @map("live_call_id")
  speaker         String          // "advisor" | "client" | "unknown"
  text            String
  startMs         Int             @map("start_ms")
  endMs           Int             @map("end_ms")
  confidence      Float           @default(0)
  processed       Boolean         @default(false) // has AI extracted from this chunk?
  createdAt       DateTime        @default(now()) @map("created_at")

  liveCall        LiveCallSession @relation(fields: [liveCallId], references: [id], onDelete: Cascade)

  @@index([liveCallId])
  @@index([liveCallId, processed])
  @@map("transcript_chunks")
}

enum LiveCallStatus {
  waiting
  connecting
  active
  paused
  ended
}
```

### Modify Existing Models

```prisma
// Add to DiscoveryMeetingSession:
model DiscoveryMeetingSession {
  // ... existing fields ...
  liveCallSessions  LiveCallSession[]
}

// Add new MeetingEntryRole variant:
enum MeetingEntryRole {
  advisor_note
  question_answer
  system
  live_transcript    // NEW — auto-generated from live call
}
```

---

## Implementation Phases

### Phase 1: Cactus Inference Server

**Goal**: Standalone Python service that accepts audio via WebSocket and returns real-time transcription + AI analysis.

#### 1.1 — Cactus Python SDK Setup

**File**: `backend/cactus_server/setup.py`

```bash
# Clone and build Cactus with Python support
git clone https://github.com/cactus-compute/cactus && cd cactus
source ./setup
cactus build --python

# Download models
cactus download openai/whisper-small        # STT model
cactus download LiquidAI/LFM2-1.2B         # LLM for extraction + question gen
```

#### 1.2 — WebSocket Transcription Server

**File**: `backend/cactus_server/server.py`

Core responsibilities:
- Accept WebSocket connections from the browser
- Receive raw audio chunks (PCM 16-bit, 16kHz)
- Run Cactus Whisper for real-time transcription
- Buffer transcript text and periodically run LLM analysis
- Stream results back: `{ type: "transcript" | "extraction" | "question", data: ... }`

```python
# Pseudocode structure

import asyncio
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from cactus import CactusModel

app = FastAPI()

# Load models at startup
stt_model = CactusModel("whisper-small")
llm_model = CactusModel("lfm-1.2b-int4")

class LiveTranscriptionSession:
    def __init__(self, ws: WebSocket, client_context: dict):
        self.ws = ws
        self.client_context = client_context  # existing preferences, name, etc.
        self.transcript_buffer = []
        self.full_transcript = []
        self.unprocessed_text = ""
        self.last_extraction_idx = 0

    async def process_audio(self, audio_chunk: bytes):
        """Transcribe audio chunk and stream result back."""
        result = stt_model.transcribe(audio_chunk, language="en")
        if result and result.text.strip():
            chunk = {
                "type": "transcript",
                "speaker": self.detect_speaker(audio_chunk),
                "text": result.text,
                "start_ms": result.start_ms,
                "end_ms": result.end_ms,
                "confidence": result.confidence,
            }
            self.full_transcript.append(chunk)
            self.unprocessed_text += f" {result.text}"
            await self.ws.send_json(chunk)

            # Trigger AI analysis every ~3 sentences or when client finishes speaking
            if self.should_analyze():
                await self.run_analysis()

    async def run_analysis(self):
        """Extract preferences and generate questions from recent transcript."""
        recent_text = self.unprocessed_text.strip()
        if not recent_text:
            return

        # 1. Extract profile suggestions
        extraction_prompt = self.build_extraction_prompt(recent_text)
        extraction_result = llm_model.complete(extraction_prompt, max_tokens=500)
        extractions = self.parse_extractions(extraction_result)

        if extractions:
            await self.ws.send_json({
                "type": "extraction",
                "data": extractions,
            })

        # 2. Generate follow-up questions based on what client just said
        question_prompt = self.build_question_prompt(recent_text, extractions)
        question_result = llm_model.complete(question_prompt, max_tokens=300)
        questions = self.parse_questions(question_result)

        if questions:
            await self.ws.send_json({
                "type": "questions",
                "data": questions,
            })

        self.unprocessed_text = ""

    def should_analyze(self) -> bool:
        """Analyze after ~3 sentences or 15 seconds of new text."""
        sentence_count = self.unprocessed_text.count('.') + self.unprocessed_text.count('?')
        return sentence_count >= 3 or len(self.unprocessed_text) > 400

    def detect_speaker(self, audio_chunk: bytes) -> str:
        """Basic speaker diarization — advisor vs client."""
        # For hackathon: use channel-based detection (left = advisor, right = client)
        # or voice activity detection with registered voice profiles
        return "unknown"


@app.websocket("/ws/live-transcribe")
async def live_transcribe(ws: WebSocket):
    await ws.accept()
    config = await ws.receive_json()  # { clientId, meetingId, clientContext }

    session = LiveTranscriptionSession(ws, config.get("clientContext", {}))

    try:
        while True:
            audio_data = await ws.receive_bytes()
            await session.process_audio(audio_data)
    except WebSocketDisconnect:
        # Return final transcript
        pass
```

#### 1.3 — Intelligent Question Generation Engine

This is the core differentiator. When the client responds to a question, the system:

1. **Classifies** what the client said (preference, constraint, aspiration, concern)
2. **Extracts** structured data (e.g., "prefers window seats" → `seatPreference: "window"`)
3. **Identifies gaps** — what related information is still missing
4. **Generates targeted follow-ups** that feel natural, not interrogative

**File**: `backend/cactus_server/question_engine.py`

```python
REACTIVE_QUESTION_PROMPT = """
You are an AI assistant helping a travel advisor during a live client call.

The client just said: "{client_utterance}"

What we already know about this client:
{existing_profile}

What we just learned from this statement:
{new_extractions}

Profile fields still empty:
{missing_fields}

Generate 1-3 natural follow-up questions that:
1. DIG DEEPER into what the client just mentioned (not random topic changes)
2. Feel conversational — the advisor should be able to ask these naturally
3. Target specific empty profile fields when possible
4. Prioritize questions that reveal preferences with high trip-planning value

RULES:
- If the client mentioned a destination, ask about their travel style THERE
- If the client mentioned a budget concern, ask about their flexibility/tradeoffs
- If the client mentioned a past trip, ask what they loved/hated about it
- If the client mentioned family, ask about ages/needs/preferences of family members
- Never repeat a question already asked in this conversation
- Never ask about information we already have

Return JSON array:
[{
  "questionText": "...",
  "category": "travel_style|budget|logistics|preferences|family|loyalty",
  "reason": "why this question matters right now",
  "priority": "high|medium|low",
  "targetFields": ["field1", "field2"],
  "triggerPhrase": "what the client said that prompted this"
}]
"""
```

#### 1.4 — Profile Learning Pipeline

When the client speaks, the system continuously updates a **session learning state** that tracks:

```python
class SessionLearningState:
    """Tracks what we've learned during this live call."""

    def __init__(self, existing_preferences: dict):
        self.existing = existing_preferences
        self.learned = {}          # field -> value learned this session
        self.confidence_map = {}   # field -> confidence score
        self.evidence_map = {}     # field -> list of quotes
        self.contradictions = []   # cases where client said something conflicting

    def ingest(self, extractions: list[dict]):
        for ext in extractions:
            field = ext["targetField"]
            value = ext["suggestedValue"]
            confidence = ext["confidence"]
            evidence = ext["evidence"]

            if field in self.learned and self.learned[field] != value:
                self.contradictions.append({
                    "field": field,
                    "previous": self.learned[field],
                    "new": value,
                    "evidence": evidence,
                })
                # Keep higher confidence value
                if confidence > self.confidence_map.get(field, 0):
                    self.learned[field] = value
                    self.confidence_map[field] = confidence
            else:
                self.learned[field] = value
                self.confidence_map[field] = max(
                    confidence, self.confidence_map.get(field, 0)
                )

            self.evidence_map.setdefault(field, []).append(evidence)

    def get_commit_ready(self) -> list[dict]:
        """Return high-confidence extractions ready to commit to profile."""
        return [
            {
                "targetField": field,
                "suggestedValue": value,
                "confidence": self.confidence_map[field],
                "evidence": "; ".join(self.evidence_map[field]),
                "status": "pending",
            }
            for field, value in self.learned.items()
            if self.confidence_map[field] >= 0.7
        ]
```

---

### Phase 2: Video Call Infrastructure (WebRTC)

**Goal**: Peer-to-peer video calling in the browser, with local audio capture routed to Cactus.

#### 2.1 — WebRTC Signaling Server

For the hackathon, use a lightweight signaling approach via the existing Next.js API.

**File**: `frontend/src/app/api/clients/[id]/meetings/[meetingId]/live/signal/route.ts`

```typescript
// Simple signaling via polling (hackathon-appropriate)
// Production would use WebSocket or a service like Daily.co / LiveKit

// POST — send SDP offer/answer/ICE candidate
// GET  — poll for pending signals
```

#### 2.2 — Video Call Component

**File**: `frontend/src/components/live-call/LiveCallView.tsx`

Core responsibilities:
- Initialize WebRTC peer connection
- Display local + remote video streams
- Capture local audio via `MediaRecorder` / `AudioWorklet`
- Stream audio to Cactus WebSocket server
- Display connection status, call duration, controls (mute, camera, end call)

```typescript
// Component structure (pseudocode)

interface LiveCallViewProps {
  clientId: string;
  meetingId: string;
  clientContext: {
    clientName: string;
    existingPreferences: Record<string, unknown>;
  };
  onTranscriptChunk: (chunk: TranscriptChunk) => void;
  onExtraction: (extractions: ProfileExtraction[]) => void;
  onQuestionSuggested: (questions: GeneratedQuestion[]) => void;
  onCallEnd: (transcript: TranscriptChunk[]) => void;
}

// Key implementation details:
// 1. Use getUserMedia({ video: true, audio: true }) for local stream
// 2. Create AudioWorklet to capture raw PCM audio at 16kHz
// 3. Open WebSocket to Cactus server, stream audio chunks every 250ms
// 4. Receive transcript/extraction/question events from WebSocket
// 5. Route events to parent via callbacks
```

#### 2.3 — Audio Capture Pipeline

**File**: `frontend/src/lib/audio-capture.ts`

```typescript
export class AudioCaptureWorklet {
  private context: AudioContext;
  private workletNode: AudioWorkletNode;
  private ws: WebSocket;

  constructor(stream: MediaStream, wsUrl: string) {
    this.context = new AudioContext({ sampleRate: 16000 });
    // ... setup AudioWorklet that buffers PCM and sends to WebSocket
  }

  // Captures audio from both local mic AND remote stream (if stereo separation needed)
  // Sends as raw PCM Int16 chunks to Cactus server
}
```

#### 2.4 — Speaker Diarization Strategy

For the hackathon, use **channel-based separation**:
- **Left channel**: Advisor's microphone (local `getUserMedia`)
- **Right channel**: Client's audio (remote WebRTC stream)
- Both streams are tagged before sending to Cactus

This avoids the complexity of voice-based diarization and is reliable.

---

### Phase 3: Frontend — Meeting Page Integration

**Goal**: Extend the existing meeting copilot page to support live video calls with real-time AI assistance.

#### 3.1 — Updated Meeting Page Layout

**File**: `frontend/src/app/(app)/clients/[clientId]/meeting/[meetingId]/page.tsx`

New layout when a live call is active:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back to Client    Meeting: Discovery Call with John    ● LIVE   │
├─────────────────────────┬───────────────────────────────────────────┤
│                         │                                           │
│   ┌─────────────────┐   │   AI Copilot Sidebar                     │
│   │                 │   │                                           │
│   │  Remote Video   │   │   ┌─ Suggested Questions ──────────────┐ │
│   │  (Client)       │   │   │ ▸ "What destinations are you       │ │
│   │                 │   │   │    considering for summer?"         │ │
│   ├─────────────────┤   │   │ ▸ "Do you have airline loyalty     │ │
│   │  Local Video    │   │   │    memberships?"                   │ │
│   │  (Advisor)      │   │   │ ● NEW: "You mentioned Italy —     │ │
│   │  [small]        │   │   │   what kind of experiences are     │ │
│   ├─────────────────┤   │   │   you hoping for there?"          │ │
│   │ 🔇 📷 📞 End   │   │   └────────────────────────────────────┘ │
│   └─────────────────┘   │                                           │
│                         │   ┌─ Live Extractions ─────────────────┐ │
│   ┌─ Live Transcript ─┐ │   │ ✓ preferredCabin: "business"       │ │
│   │ [14:32] Client:   │ │   │   "I always fly business class"    │ │
│   │ "We usually fly   │ │   │ ✓ activityPreferences: ["cultural",│ │
│   │ business class    │ │   │   "food tours"]                    │ │
│   │ when going to     │ │   │   "We love exploring local food"   │ │
│   │ Europe..."        │ │   │ ◐ budgetSensitivity: "comfort_     │ │
│   │                   │ │   │   first" (0.65 confidence)         │ │
│   │ [14:33] Advisor:  │ │   └────────────────────────────────────┘ │
│   │ "Great, and what  │ │                                           │
│   │ kind of hotels..."│ │   ┌─ Profile Completeness ────────────┐ │
│   └───────────────────┘ │   │ ████████░░░░░░ 58% (+12% today)   │ │
│                         │   └────────────────────────────────────┘ │
├─────────────────────────┴───────────────────────────────────────────┤
│  Notes input: [Type advisor notes here...]              [Send]     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 3.2 — New Components

| Component | File | Purpose |
|-----------|------|---------|
| `LiveCallView` | `components/live-call/LiveCallView.tsx` | WebRTC video + audio capture |
| `LiveTranscript` | `components/live-call/LiveTranscript.tsx` | Scrolling transcript with speaker labels |
| `LiveExtractions` | `components/live-call/LiveExtractions.tsx` | Real-time profile extractions with confidence |
| `ReactiveQuestions` | `components/live-call/ReactiveQuestions.tsx` | Questions that update based on what client says |
| `CallControls` | `components/live-call/CallControls.tsx` | Mute, camera toggle, end call, pause transcription |
| `SpeakerIndicator` | `components/live-call/SpeakerIndicator.tsx` | Shows who is currently speaking |
| `ProfileDelta` | `components/live-call/ProfileDelta.tsx` | Before/after view of profile changes from this call |

#### 3.3 — Reactive Question Flow (Key Feature)

This is the interaction loop that makes the system valuable:

```
Client says something
        │
        ▼
┌─────────────────────┐
│ Cactus transcribes  │
│ the utterance       │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐     ┌──────────────────────┐
│ LLM extracts        │────▸│ Update session        │
│ preferences from    │     │ learning state        │
│ what client said    │     │ (confidence, evidence)│
└─────────┬───────────┘     └──────────────────────┘
          │
          ▼
┌─────────────────────┐
│ LLM generates       │
│ follow-up questions  │
│ based on:           │
│ - what client said  │
│ - what we extracted │
│ - what's still      │
│   missing           │
│ - conversation flow │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Questions appear in │
│ sidebar with        │
│ "triggered by"      │
│ indicator           │
└─────────────────────┘
          │
          ▼
  Advisor asks one of the questions
          │
          ▼
  Client responds → loop repeats
```

**Frontend state management for reactive questions:**

```typescript
// In the meeting page component

interface ReactiveQuestion extends GeneratedQuestion {
  triggerPhrase: string;      // what the client said that prompted this
  isNew: boolean;             // animation flag for newly appeared questions
  timestamp: number;
}

const [reactiveQuestions, setReactiveQuestions] = useState<ReactiveQuestion[]>([]);
const [learningState, setLearningState] = useState<SessionLearningState>({
  learned: {},
  confidenceMap: {},
  evidenceMap: {},
  contradictions: [],
});

// When WebSocket sends new questions triggered by client speech:
function handleReactiveQuestions(questions: ReactiveQuestion[]) {
  setReactiveQuestions(prev => {
    // Deduplicate against existing questions
    const newQs = questions
      .filter(q => !prev.some(p => p.questionText === q.questionText))
      .map(q => ({ ...q, isNew: true, timestamp: Date.now() }));

    // Put new questions at the top, mark them with animation
    return [...newQs, ...prev.map(q => ({ ...q, isNew: false }))];
  });
}
```

#### 3.4 — Integration with Existing Meeting Copilot

The live call extends (not replaces) the existing meeting copilot. Key integration points:

1. **MeetingEntry persistence**: When the call ends, transcript chunks are consolidated into `MeetingEntry` records with `role: "live_transcript"`. This means the existing extraction, question generation, and recap flows all work on live call data.

2. **ProfileSuggestion flow**: Live extractions are saved as `MeetingProfileSuggestion` records with the same `pending → approved → committed` workflow. The advisor reviews and commits after the call.

3. **Question deduplication**: The existing `generateMeetingQuestions` API already deduplicates. Reactive questions from the live call are merged into the same pool.

4. **Recap generation**: After ending the call, the existing `generateMeetingRecap` endpoint works on the full transcript to produce the summary.

---

### Phase 4: Trips Page Integration

**Goal**: Allow advisors to start a live call with a client directly from a trip's page, with the conversation contextualized to that specific trip.

#### 4.1 — Trip Context for Calls

When starting a call from the trips page, the system pre-loads trip-specific context:

```typescript
interface TripCallContext {
  tripId: string;
  tripTitle: string;
  destinations: string[];
  travelDates: { start: string; end: string };
  travelers: { name: string; preferences: Record<string, unknown> }[];
  currentStatus: string;
  existingItinerary?: any;
}
```

This context is injected into the Cactus LLM prompts so that:
- Questions are trip-specific ("You mentioned Rome — have you thought about day trips to the Amalfi Coast?")
- Extractions are tagged with the trip they relate to
- The sidebar shows trip-relevant information

#### 4.2 — Trips Page UI Addition

**File**: `frontend/src/app/(app)/trips/page.tsx`

Add a "Call Client" action to each trip card/row:

```typescript
// In the trip actions dropdown or toolbar:
<button onClick={() => startTripCall(trip.id, trip.clientId)}>
  <Video className="w-4 h-4" />
  Call Client
</button>
```

This opens the meeting copilot page in a new layout with the trip context pre-loaded. Alternatively, it can open an inline call panel within the trips page.

#### 4.3 — Trip-Specific Question Generation

When a call is started from a trip context, the question engine prioritizes:

1. **Unresolved trip details**: missing hotel preferences for the destination, activity preferences, dietary needs for the specific location
2. **Trip-specific logistics**: layover tolerance for the specific routing, schedule flexibility, budget for this trip vs. general budget
3. **Destination knowledge**: what the client already knows about the destination, what experiences they're hoping for, concerns about the destination

```python
TRIP_CONTEXT_QUESTION_PROMPT = """
You are helping a travel advisor during a live call about a specific trip.

Trip details:
- Destination: {destinations}
- Dates: {travel_dates}
- Travelers: {traveler_names}
- Current status: {status}

The client just said: "{client_utterance}"

Generate follow-up questions that are SPECIFIC to this trip, not generic travel questions.
Focus on details that will directly improve this trip's planning.
"""
```

#### 4.4 — Post-Call Trip Updates

After a call from the trips page, the system:
1. Commits learned preferences to the client profile (same flow as meetings)
2. Creates a `MeetingEntry` linked to both the meeting session AND the trip
3. Surfaces any trip-specific decisions in the trip's activity feed
4. Updates the trip brief if key details were decided during the call

---

### Phase 5: End-of-Call Processing

#### 5.1 — Call End Flow

When the advisor clicks "End Call":

```
1. Stop audio streaming to Cactus
2. Close WebRTC connection gracefully
3. Flush any remaining transcript buffer
4. Show "Processing call..." state
5. Run post-call pipeline:
   a. Consolidate transcript chunks into MeetingEntry records
   b. Run full-transcript extraction (catches things real-time missed)
   c. Generate meeting recap
   d. Show ProfileDelta component (what we learned)
   e. Prompt advisor to review + commit profile suggestions
6. Save LiveCallSession with duration and metadata
```

#### 5.2 — Post-Call Review Screen

After the call ends, the meeting page transitions to a review mode:

```
┌─────────────────────────────────────────────────────────────┐
│  Call Ended — 32 minutes with John Smith                    │
├─────────────────────────┬───────────────────────────────────┤
│                         │                                   │
│  Meeting Recap          │  Profile Updates (12 new fields)  │
│                         │                                   │
│  Summary:               │  ✓ preferredCabin: business       │
│  John is planning a     │  ✓ activityPreferences: [...]     │
│  2-week Italy trip      │  ✓ budgetSensitivity: comfort_    │
│  for his anniversary.   │    first                          │
│  He values cultural     │  ✓ specialOccasions: anniversary  │
│  experiences and fine   │  ◐ maxLayoverMinutes: 120         │
│  dining...              │    (medium confidence)            │
│                         │                                   │
│  Unresolved:            │  [Approve All] [Review Each]      │
│  - Hotel style          │                                   │
│  - Specific dates       │  ┌─ Contradictions ─────────────┐ │
│  - Budget ceiling       │  │ ⚠ budgetSensitivity was      │ │
│                         │  │   "moderate" but client said  │ │
│  [View Full Transcript] │  │   "money isn't an issue"      │ │
│                         │  └───────────────────────────────┘ │
└─────────────────────────┴───────────────────────────────────┘
```

---

## File-by-File Implementation Checklist

### Backend — Cactus Server (NEW)

| # | File | Description |
|---|------|-------------|
| 1 | `backend/cactus_server/__init__.py` | Package init |
| 2 | `backend/cactus_server/server.py` | FastAPI WebSocket server for audio streaming + transcription |
| 3 | `backend/cactus_server/transcription.py` | Cactus STT wrapper — audio chunk → text |
| 4 | `backend/cactus_server/question_engine.py` | Reactive question generation from client speech |
| 5 | `backend/cactus_server/extraction_engine.py` | Real-time profile extraction from transcript |
| 6 | `backend/cactus_server/learning_state.py` | Session learning state manager |
| 7 | `backend/cactus_server/speaker_detection.py` | Channel-based speaker diarization |
| 8 | `backend/cactus_server/prompts.py` | All LLM prompt templates |
| 9 | `backend/cactus_server/requirements.txt` | `fastapi`, `uvicorn`, `websockets`, `pydantic` |

### Frontend — New Components

| # | File | Description |
|---|------|-------------|
| 10 | `frontend/src/components/live-call/LiveCallView.tsx` | WebRTC video + audio capture component |
| 11 | `frontend/src/components/live-call/LiveTranscript.tsx` | Real-time transcript display |
| 12 | `frontend/src/components/live-call/LiveExtractions.tsx` | Live preference extraction cards |
| 13 | `frontend/src/components/live-call/ReactiveQuestions.tsx` | Dynamic follow-up question suggestions |
| 14 | `frontend/src/components/live-call/CallControls.tsx` | Mute, camera, end call buttons |
| 15 | `frontend/src/components/live-call/SpeakerIndicator.tsx` | Active speaker visual indicator |
| 16 | `frontend/src/components/live-call/ProfileDelta.tsx` | Before/after profile changes view |
| 17 | `frontend/src/components/live-call/PostCallReview.tsx` | End-of-call review + commit screen |

### Frontend — Modified Files

| # | File | Changes |
|---|------|---------|
| 18 | `frontend/src/app/(app)/clients/[clientId]/meeting/[meetingId]/page.tsx` | Add live call mode with video + transcript + reactive sidebar |
| 19 | `frontend/src/app/(app)/clients/[clientId]/page.tsx` | Add "Start Live Call" button in meetings section |
| 20 | `frontend/src/app/(app)/trips/page.tsx` | Add "Call Client" action per trip |
| 21 | `frontend/src/lib/api-client.ts` | Add live call API functions + types |
| 22 | `frontend/src/lib/audio-capture.ts` | AudioWorklet for PCM capture at 16kHz (NEW) |
| 23 | `frontend/src/lib/webrtc.ts` | WebRTC peer connection manager (NEW) |
| 24 | `frontend/src/lib/cactus-ws.ts` | WebSocket client for Cactus server (NEW) |

### API Routes — New

| # | File | Description |
|---|------|---------|
| 25 | `frontend/src/app/api/clients/[id]/meetings/[meetingId]/live/start/route.ts` | Create LiveCallSession, return signaling info |
| 26 | `frontend/src/app/api/clients/[id]/meetings/[meetingId]/live/stop/route.ts` | End call, trigger post-processing |
| 27 | `frontend/src/app/api/clients/[id]/meetings/[meetingId]/live/signal/route.ts` | WebRTC signaling relay |
| 28 | `frontend/src/app/api/clients/[id]/meetings/[meetingId]/live/transcript/route.ts` | Persist transcript chunks |

### Database

| # | File | Changes |
|---|------|---------|
| 29 | `frontend/prisma/schema.prisma` | Add `LiveCallSession`, `TranscriptChunk` models, `live_transcript` enum value |
| 30 | Migration | `npx prisma migrate dev --name add_live_call_models` |

---

## Hackathon Prioritization

For a hackathon, build in this order to maximize demo impact:

### Must Have (Demo-Critical)
1. **Cactus transcription server** — get audio → text working first
2. **Basic video call** — even a simple `getUserMedia` display with local audio capture
3. **Live transcript panel** — shows real-time captions
4. **Reactive question generation** — the "wow" feature: client says something, questions appear
5. **Live extraction cards** — preferences populating in real-time

### Should Have (Polished Demo)
6. Post-call review screen with profile delta
7. Profile completeness meter updating live
8. Trip page integration (call from trip context)
9. Commit flow (persist learned preferences)

### Nice to Have (If Time Permits)
10. Actual peer-to-peer WebRTC (can fake with two browser tabs for demo)
11. Speaker diarization beyond channel-based
12. Contradiction detection UI
13. Full transcript search/export

---

## Environment & Configuration

```bash
# .env additions

# Cactus server
CACTUS_WS_URL=ws://localhost:8765/ws/live-transcribe
CACTUS_MODEL_PATH=/path/to/models
CACTUS_STT_MODEL=whisper-small
CACTUS_LLM_MODEL=lfm-1.2b-int4

# WebRTC (for production — hackathon can skip)
WEBRTC_STUN_SERVER=stun:stun.l.google.com:19302
WEBRTC_TURN_SERVER=  # needed for NAT traversal in production
```

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Transcription model | Whisper-small | Best accuracy/speed balance; 461MB is fine for laptop demo |
| LLM for extraction | LFM 1.2B INT4 | Fast enough for real-time analysis between utterances |
| Video | WebRTC peer-to-peer | No media server needed; browser-native |
| Audio to Cactus | WebSocket + PCM chunks | Lowest latency path; Cactus expects raw PCM |
| Speaker detection | Channel separation | Reliable for hackathon; no ML diarization needed |
| Analysis trigger | Every 3 sentences | Balances latency vs. context quality |
| Question style | Reactive (triggered by client speech) | Main differentiator — questions feel contextual, not canned |
| Profile persistence | Existing MeetingProfileSuggestion flow | Reuses proven approve/commit workflow |
| Cloud fallback | Cactus built-in | Complex extractions route to cloud automatically |

---

## Demo Script (Hackathon Presentation)

1. **Open client page** → Show existing (sparse) client profile
2. **Start live call** → Video appears, "Connecting to AI..." indicator
3. **Advisor asks**: "Tell me about your ideal vacation"
4. **Client responds**: "We love going to Italy, usually fly business class, and we're celebrating our 10th anniversary this summer"
5. **Demo the magic**:
   - Transcript appears in real-time
   - Extraction cards pop up: `preferredCabin: business`, `specialOccasions: anniversary`, `activityPreferences: cultural`
   - Reactive questions appear: "What part of Italy are you most drawn to?", "Have you been to Italy before — what did you love most?", "For your anniversary, are you thinking romantic dinners or adventurous experiences?"
6. **Client answers follow-up** → More extractions + new questions appear
7. **End call** → Show profile delta: "12 new preferences learned in one call"
8. **Commit to profile** → Client profile is now rich and complete
9. **Show trips page** → "Now when we plan their Italy trip, we know everything we need"
