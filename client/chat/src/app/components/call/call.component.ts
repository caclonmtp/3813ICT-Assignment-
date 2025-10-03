import { CommonModule } from '@angular/common';
import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  signal
} from '@angular/core';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { MediaStreamDirective } from '../../directives/media-stream.directive';
import { AuthService } from '../../services/auth.service';
import { NotifyService } from '../../services/notify.service';
import {
  CallSessionEvent,
  CallSignalEvent,
  CallUserEvent,
  SocketService
} from '../../services/socket.service';
import { User } from '../../models/user.model';
import { Group } from '../../models/group.model';
import { HttpClient } from '@angular/common/http';

interface RemoteParticipant {
  userId: string;
  username: string;
  stream: MediaStream | null;
}

@Component({
  selector: 'app-call',
  standalone: true,
  imports: [CommonModule, FormsModule, MediaStreamDirective],
  templateUrl: './call.component.html',
  styleUrls: ['./call.component.css']
})
export class CallComponent implements OnInit, OnDestroy {
  currentUser: User | null = null;
  groupId = '';
  channelId = '';
  groupName = '';
  channelName = '';
  group: Group | null = null;

  private destroy$ = new Subject<void>();
  private peerConnections = new Map<string, RTCPeerConnection>();
  private remoteParticipantsMap = new Map<string, RemoteParticipant>();
  private audioCtx: AudioContext | null = null;
  private readonly analyserNodes = new Map<string, { analyser: AnalyserNode; source: MediaStreamAudioSourceNode; rafId: number }>();
  private readonly LOCAL_PARTICIPANT_ID = '__local_speaker__';
  private speakingParticipants = signal(new Set<string>());

  readonly inCall = signal(false);
  readonly isCallLoading = signal(false);
  readonly callError = signal<string | null>(null);
  readonly localStream = signal<MediaStream | null>(null);
  readonly screenStream = signal<MediaStream | null>(null);
  readonly remoteParticipants = signal<RemoteParticipant[]>([]);
  readonly callActive = signal(false);
  readonly callHost = signal<string | null>(null);
  readonly micMuted = signal(false);
  readonly cameraOff = signal(false);

  readonly isScreenSharing = computed(() => !!this.screenStream());
  readonly isLocalSpeaking = computed(() => this.speakingParticipants().has(this.LOCAL_PARTICIPANT_ID));

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly authService: AuthService,
    private readonly socketService: SocketService,
    private readonly notify: NotifyService,
    private readonly http: HttpClient
  ) {}

  // Initialises socket subscriptions and evaluates query params.
  ngOnInit(): void {
    this.currentUser = this.authService.currentUserValue;
    if (!this.currentUser) {
      this.router.navigate(['/login']);
      return;
    }

    try {
      this.socketService.ensureConnection(this.currentUser.id);
    } catch (err) {
      console.error('Failed to initialise socket connection', err);
    }

    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      void this.handleRouteChange(params);
    });

    this.socketService.callUserJoined$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => this.handleCallUserJoined(event));

    this.socketService.callUserLeft$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => this.handleCallUserLeft(event));

    this.socketService.callSignal$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => void this.handleCallSignal(event));

    this.socketService.callStarted$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => this.handleCallStarted(event));

    this.socketService.callEnded$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => this.handleCallEnded(event));
  }

  // Cleans up streams and socket state when the view is destroyed.
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    void this.endCall(false, false);
    this.stopMonitoringAll();
  }

  // Responds to router parameter changes and joins/starts calls accordingly.
  private async handleRouteChange(params: Params): Promise<void> {
    const newGroupId = params['groupId'];
    const newChannelId = params['channelId'];
    if (!newGroupId || !newChannelId || !this.currentUser) {
      return;
    }

    if (this.channelId && this.channelId !== newChannelId) {
      await this.endCall(false, false);
    }

    this.groupId = newGroupId;
    this.channelId = newChannelId;
    this.remoteParticipantsMap.clear();
    this.remoteParticipants.set([]);

    this.loadChannelInfo();

    const queryParams = this.route.snapshot.queryParamMap;
    const mode = queryParams.get('mode');
    const host = queryParams.get('host');
    if (host) {
      this.callHost.set(host);
    }

    if (mode === 'start') {
      void this.startCall();
    } else if (mode === 'join') {
      void this.joinCall();
    }
  }

  // Starts a new call as host after ensuring media support.
  async startCall(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.callError.set('Video calling is not supported in this browser.');
      return;
    }

    await this.enterCall(true);
  }

  // Joins an existing call after validating media support.
  async joinCall(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.callError.set('Video calling is not supported in this browser.');
      return;
    }

    await this.enterCall(false);
  }

  // Provides a fallback initial for group avatars.
  groupInitial(): string {
    if (this.groupName) {
      return this.groupName.charAt(0).toUpperCase();
    }
    return '#';
  }

  // Human-readable status label for the current call state.
  callStatusLabel(): string {
    if (this.inCall()) {
      return 'In Call';
    }
    if (this.isCallLoading()) {
      return 'Connecting';
    }
    if (this.callActive()) {
      return 'Live Call';
    }
    return 'Ready';
  }

  // Leaves the active call and returns to the chat view.
  async leaveCall(): Promise<void> {
    await this.endCall(true, true);
  }

  // Toggles the local microphone track on/off.
  toggleMic(): void {
    const stream = this.localStream();
    if (!stream) {
      this.notify.error('Microphone unavailable. Join the call first.');
      return;
    }
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      this.notify.error('No microphone detected.');
      return;
    }
    const newMuted = !this.micMuted();
    audioTracks.forEach(track => (track.enabled = !newMuted));
    this.micMuted.set(newMuted);
    this.notify.info(newMuted ? 'Microphone muted' : 'Microphone unmuted');
    if (newMuted) {
      this.setSpeaking(this.LOCAL_PARTICIPANT_ID, false);
    } else {
      this.monitorStreamLevel(this.LOCAL_PARTICIPANT_ID, stream);
    }
  }

  // Toggles the local camera track on/off.
  toggleCamera(): void {
    const stream = this.localStream();
    if (!stream) {
      this.notify.error('Camera unavailable. Join the call first.');
      return;
    }
    const videoTracks = stream.getVideoTracks();
    if (!videoTracks.length) {
      this.notify.error('No camera detected.');
      return;
    }
    const newOff = !this.cameraOff();
    videoTracks.forEach(track => (track.enabled = !newOff));
    this.cameraOff.set(newOff);
    this.notify.info(newOff ? 'Camera turned off' : 'Camera enabled');
    // Restart analyser so voice detection keeps working even after toggling camera
    this.monitorStreamLevel(this.LOCAL_PARTICIPANT_ID, stream);
  }

  // Starts or stops screen sharing depending on current state.
  async toggleScreenShare(): Promise<void> {
    if (!this.inCall()) {
      this.callError.set('Join the call before sharing your screen.');
      return;
    }
    if (this.isScreenSharing()) {
      this.stopScreenShare();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      this.callError.set('Screen sharing is not supported in this browser.');
      return;
    }

    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const [track] = screen.getVideoTracks();
      if (!track) {
        throw new Error('No video track available from screen capture.');
      }
      track.onended = () => this.stopScreenShare();
      this.screenStream.set(screen);
      this.replaceVideoTrack(track);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to start screen share.';
      this.callError.set(message);
    }
  }

  // Navigates back to the chat view without altering call state.
  backToChat(): void {
    this.router.navigate(['/chat', this.groupId, this.channelId]);
  }

  // Performs the handshake required to join a call and attach local media.
  private async enterCall(asHost: boolean): Promise<void> {
    if (this.inCall() || this.isCallLoading()) {
      return;
    }

    this.isCallLoading.set(true);
    this.callError.set(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      this.localStream.set(stream);
      this.micMuted.set(false);
      this.cameraOff.set(false);
      stream.getAudioTracks().forEach(track => (track.enabled = true));
      stream.getVideoTracks().forEach(track => (track.enabled = true));
      this.monitorStreamLevel(this.LOCAL_PARTICIPANT_ID, stream);

      const { participants } = await this.socketService.joinCall(this.groupId, this.channelId);
      participants
        .filter(id => id !== this.currentUser!.id)
        .forEach(id => this.ensureRemoteParticipant(id));

      if (asHost) {
        this.callHost.set(this.currentUser?.username ?? null);
        this.callActive.set(true);
      }

      this.inCall.set(true);
      this.addLocalTracksToPeers();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to join the call.';
      this.callError.set(message);
      this.cleanupLocalStream();
    } finally {
      this.isCallLoading.set(false);
    }
  }

  // Tears down call state, media, and peer connections.
  private async endCall(showToast: boolean, navigateBack: boolean): Promise<void> {
    if (this.inCall() && this.channelId) {
      try {
        const result = await this.socketService.leaveCall(this.channelId);
        if (result?.callEnded) {
          this.callActive.set(false);
          this.callHost.set(null);
        }
      } catch (err) {
        console.warn('Failed to leave call cleanly', err);
      }
    }

    this.inCall.set(false);
    this.callError.set(null);
    this.screenStream.update(stream => {
      stream?.getTracks().forEach(track => track.stop());
      return null;
    });
    this.cleanupLocalStream();
    this.micMuted.set(false);
    this.cameraOff.set(false);

    this.peerConnections.forEach(pc => {
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.close();
      } catch (_) {
        // ignore cleanup errors
      }
    });
    this.peerConnections.clear();
    this.remoteParticipantsMap.forEach(participant => {
      participant.stream?.getTracks().forEach(track => track.stop());
    });
    this.remoteParticipantsMap.clear();
    this.remoteParticipants.set([]);

    if (showToast) {
      this.notify.info('You left the call.');
    }

    if (navigateBack) {
      this.router.navigate(['/chat', this.groupId, this.channelId]);
    }
  }

  // Ensures a peer connection exists when another participant joins.
  private handleCallUserJoined(event: CallUserEvent): void {
    if (!this.inCall() || event.channelId !== this.channelId || !this.currentUser) {
      return;
    }
    if (event.userId === this.currentUser.id) {
      return;
    }
    this.ensurePeerConnection(event.userId, event.username);
    void this.createAndSendOffer(event.userId);
  }

  // Removes peer state when other participants leave.
  private handleCallUserLeft(event: CallUserEvent): void {
    if (event.channelId !== this.channelId) {
      return;
    }
    this.removeRemoteParticipant(event.userId);
  }

  // Processes WebRTC signalling messages (offer/answer/ICE).
  private async handleCallSignal(event: CallSignalEvent): Promise<void> {
    if (!this.inCall() || event.channelId !== this.channelId || !this.currentUser) {
      return;
    }
    if (event.from === this.currentUser.id) {
      return;
    }

    const targetId = event.data?.targetId;
    if (targetId && targetId !== this.currentUser.id) {
      return;
    }

    try {
      if (event.type === 'offer' && event.data?.sdp) {
        await this.handleOffer(event.from, event.data.sdp, event.data?.username);
      } else if (event.type === 'answer' && event.data?.sdp) {
        await this.handleAnswer(event.from, event.data.sdp);
      } else if (event.type === 'ice-candidate' && event.data?.candidate) {
        await this.handleIceCandidate(event.from, event.data.candidate);
      }
    } catch (err) {
      console.error('Failed to process call signal', err);
      this.callError.set('A call error occurred. You may need to rejoin the call.');
    }
  }

  // Updates local state when the server reports a call start.
  private handleCallStarted(event: CallSessionEvent): void {
    if (!event || event.channelId !== this.channelId) {
      return;
    }
    this.callActive.set(true);
    if (event.username) {
      this.callHost.set(event.username);
    }
  }

  // Updates local state and returns to chat when the server reports call end.
  private handleCallEnded(event: { channelId: string }): void {
    if (!event || event.channelId !== this.channelId) {
      return;
    }
    this.callActive.set(false);
    this.callHost.set(null);
    if (this.inCall()) {
      this.notify.info('Call ended.');
      void this.endCall(false, true);
    }
  }

  // Creates or retrieves the peer connection for the specified user.
  private ensurePeerConnection(userId: string, username?: string): RTCPeerConnection {
    let pc = this.peerConnections.get(userId);
    if (!pc) {
      pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      pc.onicecandidate = event => {
        if (event.candidate) {
          this.socketService.sendCallSignal(this.channelId, 'ice-candidate', {
            targetId: userId,
            candidate: event.candidate
          });
        }
      };

      pc.ontrack = event => {
        const participant = this.ensureRemoteParticipant(userId, username);
        const [stream] = event.streams;
        participant.stream = stream;
        this.updateRemoteParticipants();
        if (stream) {
          this.monitorStreamLevel(userId, stream);
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) {
          this.removeRemoteParticipant(userId);
        }
      };

      this.peerConnections.set(userId, pc);
    }

    this.ensureRemoteParticipant(userId, username);
    this.addLocalTracksToPeer(pc);
    return pc;
  }

  // Creates or updates the remote participant record.
  private ensureRemoteParticipant(userId: string, username?: string): RemoteParticipant {
    let participant = this.remoteParticipantsMap.get(userId);
    if (!participant) {
      participant = {
        userId,
        username: username || this.lookupDisplayName(userId),
        stream: null
      };
      this.remoteParticipantsMap.set(userId, participant);
      this.updateRemoteParticipants();
    } else if (username && participant.username !== username) {
      participant.username = username;
      this.updateRemoteParticipants();
    }
    return participant;
  }

  // Pushes the latest remote participant list to the template signal.
  private updateRemoteParticipants(): void {
    this.remoteParticipants.set(Array.from(this.remoteParticipantsMap.values()));
  }

  // Cleans up peer state and media for a departing participant.
  private removeRemoteParticipant(userId: string): void {
    const pc = this.peerConnections.get(userId);
    if (pc) {
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.close();
      } catch (_) {
        // ignore cleanup errors
      }
      this.peerConnections.delete(userId);
    }

    const participant = this.remoteParticipantsMap.get(userId);
    if (participant?.stream) {
      participant.stream.getTracks().forEach(track => track.stop());
    }
    if (participant) {
      this.remoteParticipantsMap.delete(userId);
      this.updateRemoteParticipants();
      this.stopMonitoring(userId);
    }
  }

  // Adds local media tracks to every active peer connection.
  private addLocalTracksToPeers(): void {
    const stream = this.localStream();
    if (!stream) return;
    this.peerConnections.forEach(pc => this.addLocalTracksToPeer(pc));
  }

  // Ensures all local tracks are present on a given peer connection.
  private addLocalTracksToPeer(pc: RTCPeerConnection): void {
    const stream = this.localStream();
    if (!stream) {
      return;
    }
    const existingTrackIds = pc.getSenders().map(sender => sender.track?.id);
    stream.getTracks().forEach(track => {
      if (!existingTrackIds.includes(track.id)) {
        pc.addTrack(track, stream);
      }
    });
  }

  // Replaces the outbound video track across all peer connections.
  private replaceVideoTrack(track: MediaStreamTrack): void {
    this.peerConnections.forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(track).catch(err => {
          console.warn('Failed to replace video track', err);
        });
      }
    });
  }

  // Stops screen sharing and optionally restores the camera track.
  private stopScreenShare(restoreCamera = true): void {
    const screen = this.screenStream();
    if (!screen) return;
    screen.getTracks().forEach(track => track.stop());
    this.screenStream.set(null);
    if (restoreCamera) {
      const cameraStream = this.localStream();
      const [videoTrack] = cameraStream?.getVideoTracks() ?? [];
      if (videoTrack) {
        this.replaceVideoTrack(videoTrack);
      }
    }
  }

  // Stops local media tracks and clears associated monitoring.
  private cleanupLocalStream(): void {
    const stream = this.localStream();
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      this.localStream.set(null);
      this.stopMonitoring(this.LOCAL_PARTICIPANT_ID);
    }
  }

  // Monitors audio levels to drive speaking indicators.
  private monitorStreamLevel(id: string, stream: MediaStream): void {
    const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtor) {
      return;
    }

    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      try {
        this.audioCtx = new AudioCtor();
      } catch (err) {
        console.warn('Failed to create audio context', err);
        this.audioCtx = null;
        return;
      }
    }

    if (!stream.getAudioTracks().length) {
      this.setSpeaking(id, false);
      this.stopMonitoring(id);
      return;
    }

    this.stopMonitoring(id);

    try {
      const source = this.audioCtx!.createMediaStreamSource(stream);
      const analyser = this.audioCtx!.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);

      const detect = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const sample = (data[i] - 128) / 128;
          sum += sample * sample;
        }
        const rms = Math.sqrt(sum / data.length);
        const speaking = rms > 0.015 && this.tracksEnabled(stream.getAudioTracks());
        this.setSpeaking(id, speaking);
        const entry = this.analyserNodes.get(id);
        if (entry) {
          entry.rafId = requestAnimationFrame(detect);
        }
      };

      const rafId = requestAnimationFrame(detect);
      this.analyserNodes.set(id, { analyser, source, rafId });
    } catch (err) {
      console.warn('Unable to monitor audio stream', err);
    }
  }

  // Stops monitoring a specific participant's audio levels.
  private stopMonitoring(id: string): void {
    const entry = this.analyserNodes.get(id);
    if (!entry) {
      return;
    }
    cancelAnimationFrame(entry.rafId);
    try {
      entry.source.disconnect();
    } catch (_) {
      // ignore disconnect errors
    }
    this.analyserNodes.delete(id);
    this.setSpeaking(id, false);
  }

  // Removes all audio analysers and closes the audio context.
  private stopMonitoringAll(): void {
    Array.from(this.analyserNodes.keys()).forEach(id => this.stopMonitoring(id));
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
    }
    this.audioCtx = null;
    this.speakingParticipants.set(new Set());
  }

  // Updates the reactive set tracking who is currently speaking.
  private setSpeaking(id: string, speaking: boolean): void {
    this.speakingParticipants.update(current => {
      const next = new Set(current);
      if (speaking) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  // Determines whether any track in the collection remains enabled.
  private tracksEnabled(tracks: MediaStreamTrack[]): boolean {
    if (!tracks.length) {
      return false;
    }
    return tracks.some(track => track.enabled);
  }

  // Returns whether all audio tracks for a remote participant are muted.
  isParticipantMuted(userId: string): boolean {
    const stream = this.remoteParticipantsMap.get(userId)?.stream;
    if (!stream) {
      return false;
    }
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      return true;
    }
    return audioTracks.every(track => !track.enabled);
  }

  // Checks if the participant is currently flagged as speaking.
  isParticipantSpeaking(userId: string): boolean {
    return this.speakingParticipants().has(userId);
  }

  // Accepts a remote offer and responds with an answer.
  private async handleOffer(remoteUserId: string, sdp: RTCSessionDescriptionInit, username?: string): Promise<void> {
    const pc = this.ensurePeerConnection(remoteUserId, username);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.socketService.sendCallSignal(this.channelId, 'answer', {
      targetId: remoteUserId,
      sdp: answer
    });
  }

  // Applies a remote answer to an existing peer connection.
  private async handleAnswer(remoteUserId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peerConnections.get(remoteUserId);
    if (!pc) {
      return;
    }
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  // Adds an ICE candidate to the relevant peer connection.
  private async handleIceCandidate(remoteUserId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peerConnections.get(remoteUserId);
    if (!pc) {
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('Failed to add ICE candidate', err);
    }
  }

  // Creates an offer for a remote participant and sends it via sockets.
  private createAndSendOffer(remoteUserId: string): Promise<void> {
    const pc = this.peerConnections.get(remoteUserId);
    if (!pc) {
      return Promise.resolve();
    }
    return pc
      .createOffer()
      .then(offer => pc.setLocalDescription(offer).then(() => offer))
      .then(offer => {
        this.socketService.sendCallSignal(this.channelId, 'offer', {
          targetId: remoteUserId,
          sdp: offer,
          username: this.currentUser?.username
        });
      })
      .catch(err => {
        console.warn('Failed to create/send offer', err);
      });
  }

  // Loads metadata for the current channel and group.
  private loadChannelInfo(): void {
    this.http
      .get<any>(`http://localhost:3000/api/channels/group/${this.groupId}`)
      .subscribe(channels => {
        const channel = channels.find((c: any) => c.id === this.channelId);
        if (channel) {
          this.channelName = channel.name;
        }
      });

    this.http.get<any>(`http://localhost:3000/api/groups`).subscribe(groups => {
      const group = groups.find((g: any) => g.id === this.groupId);
      if (group) {
        this.groupName = group.name;
        this.group = group as Group;
      }
    });
  }

  // Attempts to resolve a friendly display name for a user id.
  private lookupDisplayName(userId: string): string {
    const member = this.group?.members?.includes(userId)
      ? this.groupMembersCache(userId)
      : null;
    const remote = this.remoteParticipantsMap.get(userId);
    if (remote?.username) {
      return remote.username;
    }
    return member ?? `User ${userId.slice(-4)}`;
  }

  // Looks up cached group member names for display fallback.
  private groupMembersCache(userId: string): string | null {
    if (!this.group || !Array.isArray(this.group.members)) {
      return null;
    }
    if (this.groupMembersLookup.size === 0) {
      (this.groupMembers || []).forEach(member => {
        this.groupMembersLookup.set(member.id, member.username);
      });
    }
    return this.groupMembersLookup.get(userId) || null;
  }

  private groupMembers: User[] = [];
  private groupMembersLookup = new Map<string, string>();
}
