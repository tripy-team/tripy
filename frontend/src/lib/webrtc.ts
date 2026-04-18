/**
 * WebRTC peer connection manager for live video calls.
 *
 * Handles:
 * - Creating/managing RTCPeerConnection
 * - Signaling via the Next.js API polling endpoint
 * - ICE candidate exchange
 * - Local/remote stream management
 */

export interface SignalMessage {
  type: 'offer' | 'answer' | 'candidate';
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
  from: string;
  to: string;
}

export interface WebRTCConfig {
  clientId: string;
  meetingId: string;
  liveCallId: string;
  role: 'advisor' | 'client';
  onRemoteStream: (stream: MediaStream) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  signalEndpoint: string;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private config: WebRTCConfig;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(config: WebRTCConfig) {
    this.config = config;
  }

  get peerConnection(): RTCPeerConnection | null {
    return this.pc;
  }

  get remoteStream(): MediaStream | null {
    if (!this.pc) return null;
    const receivers = this.pc.getReceivers();
    if (receivers.length === 0) return null;
    const stream = new MediaStream();
    receivers.forEach((r) => {
      if (r.track) stream.addTrack(r.track);
    });
    return stream;
  }

  async initialize(): Promise<MediaStream> {
    // Get local media
    this.localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    // Create peer connection
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Add local tracks
    this.localStream.getTracks().forEach((track) => {
      this.pc!.addTrack(track, this.localStream!);
    });

    // Handle remote tracks
    this.pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      this.config.onRemoteStream(stream);
    };

    // Handle ICE candidates
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: 'candidate',
          payload: event.candidate.toJSON(),
          from: this.config.role,
          to: this.config.role === 'advisor' ? 'client' : 'advisor',
        });
      }
    };

    // Connection state changes
    this.pc.onconnectionstatechange = () => {
      if (this.pc) {
        this.config.onConnectionStateChange(this.pc.connectionState);
      }
    };

    // Start polling for signals
    this.startPolling();

    return this.localStream;
  }

  async createOffer(): Promise<void> {
    if (!this.pc) return;
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.sendSignal({
      type: 'offer',
      payload: offer,
      from: this.config.role,
      to: this.config.role === 'advisor' ? 'client' : 'advisor',
    });
  }

  async handleSignal(signal: SignalMessage): Promise<void> {
    if (!this.pc) return;

    if (signal.type === 'offer') {
      await this.pc.setRemoteDescription(
        new RTCSessionDescription(signal.payload as RTCSessionDescriptionInit),
      );
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await this.sendSignal({
        type: 'answer',
        payload: answer,
        from: this.config.role,
        to: signal.from,
      });
      // Add any queued candidates
      for (const c of this.pendingCandidates) {
        await this.pc.addIceCandidate(new RTCIceCandidate(c));
      }
      this.pendingCandidates = [];
    } else if (signal.type === 'answer') {
      await this.pc.setRemoteDescription(
        new RTCSessionDescription(signal.payload as RTCSessionDescriptionInit),
      );
      for (const c of this.pendingCandidates) {
        await this.pc.addIceCandidate(new RTCIceCandidate(c));
      }
      this.pendingCandidates = [];
    } else if (signal.type === 'candidate') {
      if (this.pc.remoteDescription) {
        await this.pc.addIceCandidate(
          new RTCIceCandidate(signal.payload as RTCIceCandidateInit),
        );
      } else {
        this.pendingCandidates.push(signal.payload as RTCIceCandidateInit);
      }
    }
  }

  toggleMute(): boolean {
    if (!this.localStream) return false;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      return !audioTrack.enabled; // true if now muted
    }
    return false;
  }

  toggleCamera(): boolean {
    if (!this.localStream) return false;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      return !videoTrack.enabled; // true if camera off
    }
    return false;
  }

  destroy(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
  }

  private async sendSignal(signal: SignalMessage): Promise<void> {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('tripy_token') : null;
      await fetch(this.config.signalEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(signal),
      });
    } catch (err) {
      console.error('Failed to send signal:', err);
    }
  }

  private startPolling(): void {
    this.pollInterval = setInterval(async () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('tripy_token') : null;
        const res = await fetch(
          `${this.config.signalEndpoint}?role=${this.config.role}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );
        if (!res.ok) return;
        const signals: SignalMessage[] = await res.json();
        for (const signal of signals) {
          await this.handleSignal(signal);
        }
      } catch {
        // Polling failure is non-fatal
      }
    }, 1000);
  }
}
