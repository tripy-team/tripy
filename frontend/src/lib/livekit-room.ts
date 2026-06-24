/**
 * Minimal LiveKit wrapper tailored to TripsHacker's live-call flow.
 *
 * Handles: token fetch, room connect, remote track subscribe, publish of
 * local mic + camera. Exposes the first remote participant's audio and
 * video tracks so the existing Cactus audio/vision pipelines can consume
 * the *client's* media (not the advisor's mic).
 */

import {
  Room,
  RoomEvent,
  Track,
  RemoteTrack,
  RemoteParticipant,
  createLocalTracks,
  LocalTrack,
} from 'livekit-client';

export type RoomRole = 'advisor' | 'client';

export interface SignedJoinParts {
  clientId: string;
  exp: number;
  sig: string;
}

export interface AdvisorTokenResponse {
  token: string;
  identity: string;
  roomName: string;
  joinLink: SignedJoinParts;
}

export interface ClientTokenResponse {
  token: string;
  identity: string;
  roomName: string;
}

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('tripy_token');
}

export async function fetchAdvisorToken(params: {
  roomName: string;
  participantName: string;
  clientId: string;
}): Promise<AdvisorTokenResponse> {
  const authToken = getAuthToken();
  if (!authToken) {
    throw new Error('You must be signed in to start a live call.');
  }
  const res = await fetch('/api/livekit/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ ...params, role: 'advisor' }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LiveKit token request failed: ${err}`);
  }
  return res.json();
}

export async function fetchClientToken(params: {
  roomName: string;
  participantName: string;
  clientId: string;
  exp: number;
  sig: string;
}): Promise<ClientTokenResponse> {
  const res = await fetch('/api/livekit/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, role: 'client' }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || 'Join link is invalid or has expired');
  }
  return res.json();
}

export interface LiveKitCallbacks {
  onRemoteAudio?: (stream: MediaStream) => void;
  onRemoteVideo?: (videoEl: HTMLVideoElement) => void;
  onRemoteDisconnect?: () => void;
  onConnected?: () => void;
  onError?: (err: Error) => void;
}

export class LiveKitSession {
  private room: Room | null = null;
  private localTracks: LocalTrack[] = [];
  private remoteVideoEl: HTMLVideoElement | null = null;
  private remoteAudioEl: HTMLAudioElement | null = null;

  async connect(
    url: string,
    token: string,
    callbacks: LiveKitCallbacks,
  ): Promise<Room> {
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    this.room = room;

    room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      this.handleRemoteTrack(track, participant, callbacks);
    });

    room.on(RoomEvent.ParticipantDisconnected, () => {
      callbacks.onRemoteDisconnect?.();
    });

    room.on(RoomEvent.Disconnected, () => {
      callbacks.onRemoteDisconnect?.();
    });

    try {
      await room.connect(url, token);
    } catch (e) {
      callbacks.onError?.(e as Error);
      throw e;
    }

    // Acquire mic + camera BEFORE firing onConnected so the caller can read
    // the local preview stream immediately in that callback.
    try {
      this.localTracks = await createLocalTracks({
        // Browser-level audio processing feeds Parakeet a much cleaner
        // signal than raw mic input. These eliminate typing/fan noise,
        // prevent the advisor's speakers from echoing the client's voice
        // back into the transcript, and level volume so the decoder isn't
        // fighting amplitude swings.
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: { resolution: { width: 640, height: 480 } },
      });
      for (const track of this.localTracks) {
        await room.localParticipant.publishTrack(track);
      }
    } catch (e) {
      callbacks.onError?.(e as Error);
    }

    callbacks.onConnected?.();

    // If a remote participant is already in the room, surface their tracks now
    for (const participant of room.remoteParticipants.values()) {
      for (const pub of participant.trackPublications.values()) {
        if (pub.track) {
          this.handleRemoteTrack(pub.track, participant, callbacks);
        }
      }
    }

    return room;
  }

  private handleRemoteTrack(
    track: RemoteTrack | Track,
    _participant: RemoteParticipant,
    callbacks: LiveKitCallbacks,
  ): void {
    if (track.kind === Track.Kind.Audio) {
      // Chrome silently drops samples from a remote WebRTC audio track into
      // MediaStreamAudioSourceNode unless that track is also being consumed
      // by an HTMLMediaElement. Without this, the Cactus worklet sends
      // zero-filled PCM and the client's speech never gets transcribed. The
      // element also plays the client's voice so the advisor can hear them.
      if (!this.remoteAudioEl) {
        this.remoteAudioEl = document.createElement('audio');
        this.remoteAudioEl.autoplay = true;
        this.remoteAudioEl.style.display = 'none';
        document.body.appendChild(this.remoteAudioEl);
      }
      track.attach(this.remoteAudioEl);

      const mediaStream = new MediaStream([track.mediaStreamTrack]);
      callbacks.onRemoteAudio?.(mediaStream);
    } else if (track.kind === Track.Kind.Video) {
      if (!this.remoteVideoEl) {
        this.remoteVideoEl = document.createElement('video');
        this.remoteVideoEl.autoplay = true;
        this.remoteVideoEl.playsInline = true;
        this.remoteVideoEl.muted = true;
      }
      track.attach(this.remoteVideoEl);
      callbacks.onRemoteVideo?.(this.remoteVideoEl);
    }
  }

  getLocalPreviewStream(): MediaStream | null {
    const tracks = this.localTracks
      .map((t) => t.mediaStreamTrack)
      .filter(Boolean) as MediaStreamTrack[];
    if (tracks.length === 0) return null;
    return new MediaStream(tracks);
  }

  setMicEnabled(enabled: boolean): void {
    void this.room?.localParticipant.setMicrophoneEnabled(enabled);
  }

  setCameraEnabled(enabled: boolean): void {
    void this.room?.localParticipant.setCameraEnabled(enabled);
  }

  async disconnect(): Promise<void> {
    for (const t of this.localTracks) {
      t.stop();
    }
    this.localTracks = [];
    if (this.remoteAudioEl) {
      this.remoteAudioEl.srcObject = null;
      this.remoteAudioEl.remove();
      this.remoteAudioEl = null;
    }
    if (this.room) {
      await this.room.disconnect();
      this.room = null;
    }
  }
}

export function buildRoomName(clientId: string, meetingId: string): string {
  return `tripy-${clientId}-${meetingId}`.replace(/[^a-zA-Z0-9-]/g, '-');
}

export function buildJoinUrl(
  roomName: string,
  clientName: string,
  signed: SignedJoinParts,
): string {
  if (typeof window === 'undefined') return '';
  const url = new URL(`/join/${encodeURIComponent(roomName)}`, window.location.origin);
  url.searchParams.set('name', clientName);
  url.searchParams.set('clientId', signed.clientId);
  url.searchParams.set('exp', String(signed.exp));
  url.searchParams.set('sig', signed.sig);
  return url.toString();
}
