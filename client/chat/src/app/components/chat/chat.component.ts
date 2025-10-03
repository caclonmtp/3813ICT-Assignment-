import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router } from '@angular/router';
import {
  animate,
  style,
  transition,
  trigger
} from '@angular/animations';
import { Subject, takeUntil, firstValueFrom } from 'rxjs';
import { Group } from '../../models/group.model';
import { User } from '../../models/user.model';
import { AuthService } from '../../services/auth.service';
import { NotifyService } from '../../services/notify.service';
import {
  CallEndedEvent,
  CallSessionEvent,
  ChannelPresenceEvent,
  JoinChannelResponse,
  ServerMessage,
  SocketService
} from '../../services/socket.service';

interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  content: string;
  timestamp: Date;
  channelId: string;
  avatarUrl?: string | null;
  imageUrl?: string | null;
}


@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css'],
  animations: [
    trigger('messageFade', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(8px)' }),
        animate('150ms ease-out', style({ opacity: 1, transform: 'translateY(0)' }))
      ])
    ])
  ]
})
export class ChatComponent implements OnInit, OnDestroy {
  currentUser: User | null = null;
  groupId = '';
  channelId = '';
  channelName = '';
  groupName = '';
  group: Group | null = null;
  groupMembers: User[] = [];
  canManageGroup = false;

  private destroy$ = new Subject<void>();
  private messageIds = new Set<string>();
  private lastSentAt = 0;
  private audioCtx?: AudioContext;
  private callToneInterval: number | null = null;
  private activeOscillator?: OscillatorNode;

  readonly messages = signal<ChatMessage[]>([]);
  readonly channelError = signal<string | null>(null);
  readonly newMessage = signal('');
  readonly callActive = signal(false);
  readonly callHost = signal<string | null>(null);
  readonly pendingImage = signal<File | null>(null);
  readonly pendingImagePreviewUrl = signal<string | null>(null);
  readonly imageUploading = signal(false);
  readonly onlineMembers = signal<ChannelPresenceEvent[]>([]);
  readonly showInfoPanel = signal(false);
  readonly mediaBaseUrl = 'http://localhost:3000';

  readonly disableSend = computed(() => {
    const hasText = !!this.newMessage().trim();
    const hasImage = !!this.pendingImage();
    return (!hasText && !hasImage) || !!this.channelError() || this.imageUploading();
  });

  @ViewChild('imagePicker') imagePicker?: ElementRef<HTMLInputElement>;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly authService: AuthService,
    private readonly http: HttpClient,
    private readonly socketService: SocketService,
    private readonly notify: NotifyService
  ) {}

  // Derives a display initial for the current group name.
  groupInitial(): string {
    if (this.groupName) {
      return this.groupName.charAt(0).toUpperCase();
    }
    return '#';
  }

  // Provides two-way binding access to the new message input.
  get newMessageValue(): string {
    return this.newMessage();
  }

  // Updates the reactive new message value from the template.
  set newMessageValue(value: string) {
    this.newMessage.set(value);
  }

  // Establishes socket subscriptions and loads initial channel state.
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

    this.socketService.messages$
      .pipe(takeUntil(this.destroy$))
      .subscribe(message => this.handleIncomingMessage(message));

    this.socketService.callStarted$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => this.handleCallStarted(event));

    this.socketService.callEnded$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => this.handleCallEnded(event));

    this.socketService.channelUserJoined$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => this.handleChannelUserJoined(event));

    this.socketService.channelUserLeft$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => this.handleChannelUserLeft(event));
  }

  // Cleans up subscriptions, uploads, and socket memberships.
  ngOnDestroy(): void {
    this.clearPendingImage();
    this.destroy$.next();
    this.destroy$.complete();
    this.stopCallTone();
    if (this.channelId) {
      this.socketService.leaveChannel(this.channelId);
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
    }
  }

  // Navigates back to the dashboard view.
  backToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  // Navigates to the group admin area.
  goToGroupAdmin(): void {
    this.router.navigate(['/group-admin']);
  }

  // Toggles the member/info sidebar visibility.
  toggleInfoPanel(): void {
    this.showInfoPanel.update(current => !current);
  }

  // Explicitly hides the member/info sidebar.
  closeInfoPanel(): void {
    this.showInfoPanel.set(false);
  }

  // Routes to the call component as the initiator.
  startCall(): void {
    this.router.navigate(['/call', this.groupId, this.channelId], {
      queryParams: { mode: 'start', host: this.currentUser?.username || '' }
    });
  }

  // Routes to the call component to join an in-progress call.
  joinCall(): void {
    this.stopCallTone();
    this.router.navigate(['/call', this.groupId, this.channelId], {
      queryParams: { mode: 'join', host: this.callHost() || '' }
    });
  }

  // Brings up the hidden file input for image attachments.
  openImagePicker(): void {
    this.imagePicker?.nativeElement?.click();
  }

  // Normalises media URLs coming from messages or avatars.
  mediaUrl(url: string | null | undefined): string | null {
    if (!url) {
      return null;
    }
    if (/^https?:\/\//i.test(url)) {
      return url;
    }
    if (url.startsWith('//')) {
      return `${typeof window !== 'undefined' ? window.location.protocol : 'http:'}${url}`;
    }
    if (url.startsWith('/')) {
      return `${this.mediaBaseUrl}${url}`;
    }
    return `${this.mediaBaseUrl}/${url}`;
  }

  // Formats message timestamps for display.
  formatTimestamp(timestamp: Date): string {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // Handles enter presses for quick send behaviour.
  handleKeyPress(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === 'Enter' && !keyboardEvent.shiftKey) {
      if (keyboardEvent.repeat) {
        keyboardEvent.preventDefault();
        return;
      }
      keyboardEvent.preventDefault();
      void this.sendMessage();
    }
  }

  // Clears any pending image attachment and releases object URLs.
  clearPendingImage(): void {
    const previewUrl = this.pendingImagePreviewUrl();
    if (previewUrl && typeof URL !== 'undefined') {
      URL.revokeObjectURL(previewUrl);
    }
    this.pendingImage.set(null);
    this.pendingImagePreviewUrl.set(null);
    if (this.imagePicker?.nativeElement) {
      this.imagePicker.nativeElement.value = '';
    }
  }

  // Sends either a text message or delegates to the image upload flow.
  async sendMessage(): Promise<void> {
    if (!this.currentUser) return;
    const hasImage = !!this.pendingImage();
    const rawContent = this.newMessage();
    const trimmed = rawContent.trim();
    if (!hasImage && !trimmed) {
      return;
    }

    if (hasImage) {
      if (this.imageUploading()) {
        return;
      }
      await this.sendImageMessage();
      return;
    }

    const now = Date.now();
    if (now - this.lastSentAt < 300) {
      return;
    }
    this.lastSentAt = now;

    const content = rawContent;
    this.newMessage.set('');

    try {
      await this.socketService.sendMessage(this.groupId, this.channelId, trimmed);
    } catch (err) {
      console.error('Failed to send message', err);
      this.newMessage.set(content);
    }
  }

  // Validates and stages an image selected via the composer.
  handleMessageImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files && input.files.length ? input.files[0] : null;
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.notify.error('Only image files are allowed');
      if (input) {
        input.value = '';
      }
      return;
    }

    this.clearPendingImage();
    this.pendingImage.set(file);
    if (typeof URL !== 'undefined') {
      const previewUrl = URL.createObjectURL(file);
      this.pendingImagePreviewUrl.set(previewUrl);
    }

    if (input) {
      input.value = '';
    }
  }

  // Keeps the timeline pinned to the newest content when media loads.
  onMessageMediaLoad(): void {
    this.scrollMessagesToBottom();
  }

  // Uploads the staged image (and optional text) to the server.
  private async sendImageMessage(): Promise<void> {
    const file = this.pendingImage();
    if (!this.currentUser || !file) {
      return;
    }
    if (!this.groupId || !this.channelId) {
      return;
    }

    const formData = new FormData();
    formData.append('groupId', this.groupId);
    formData.append('channelId', this.channelId);
    formData.append('image', file);
    const trimmed = this.newMessage().trim();
    if (trimmed) {
      formData.append('content', trimmed);
    }

    this.imageUploading.set(true);

    try {
      const response = await firstValueFrom(
        this.http.post<{ success?: boolean; message?: any; error?: string }>(
          'http://localhost:3000/api/messages/upload',
          formData
        )
      );
      if (!response || response.success === false) {
        const errorMessage = response?.error || (response as any)?.message || 'Failed to send image message';
        throw new Error(errorMessage);
      }
      this.newMessage.set('');
      this.clearPendingImage();
      this.lastSentAt = Date.now();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send image message';
      this.notify.error(message);
    } finally {
      this.imageUploading.set(false);
    }
  }

  // Responds to route parameter changes by rejoining the appropriate channel.
  private async handleRouteChange(params: Params): Promise<void> {
    const newGroupId = params['groupId'];
    const newChannelId = params['channelId'];
    if (!newGroupId || !newChannelId || !this.currentUser) {
      return;
    }

    if (this.channelId && this.channelId !== newChannelId) {
      this.socketService.leaveChannel(this.channelId);
    }

    this.groupId = newGroupId;
    this.channelId = newChannelId;
    this.messages.set([]);
    this.messageIds.clear();
    this.channelError.set(null);
    this.callActive.set(false);
    this.callHost.set(null);
    this.stopCallTone();
    this.newMessage.set('');
    this.clearPendingImage();
    this.onlineMembers.set([]);
    this.showInfoPanel.set(false);

    try {
      const joinInfo: JoinChannelResponse = await this.socketService.joinChannel(
        this.groupId,
        this.channelId
      );
      const mapped = joinInfo.messages.map(message => this.normalizeMessage(message));
      this.messages.set(mapped);
      this.messageIds = new Set(mapped.map(message => message.id));
      this.scrollMessagesToBottom();

      const presence = Array.isArray(joinInfo.channelMembers)
        ? joinInfo.channelMembers.map(member => ({
            channelId: member.channelId || this.channelId,
            userId: member.userId,
            username: member.username,
            avatarUrl: member.avatarUrl ?? null
          }))
        : [];
      this.onlineMembers.set(presence);

      if (joinInfo.callActive) {
        this.callActive.set(true);
        if (joinInfo.callStartedBy?.username) {
          this.callHost.set(joinInfo.callStartedBy.username);
        }
        if (
          this.currentUser &&
          !joinInfo.callParticipants.includes(this.currentUser.id)
        ) {
          this.notifyIncomingCall(joinInfo.callStartedBy?.username || null);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to join channel.';
      this.channelError.set(message);
    }

    this.loadChannelInfo();
    this.loadGroupMembers();
  }

  // Inserts incoming chat messages into local state if they target this channel.
  private handleIncomingMessage(message: ServerMessage): void {
    if (!message || message.channelId !== this.channelId) {
      return;
    }
    if (this.messageIds.has(message.id)) {
      return;
    }
    const normalized = this.normalizeMessage(message);
    this.messageIds.add(normalized.id);
    this.messages.update(current => [...current, normalized]);
    this.scrollMessagesToBottom();
  }

  // Reacts to a call start event and surfaces notifications.
  private handleCallStarted(event: CallSessionEvent): void {
    if (!event || event.channelId !== this.channelId) {
      return;
    }
    this.callActive.set(true);
    if (event.username) {
      this.callHost.set(event.username);
    }
    if (!this.currentUser || event.userId === this.currentUser.id) {
      return;
    }
    this.notifyIncomingCall(event.username || null);
  }

  // Clears call state when the server signals completion.
  private handleCallEnded(event: CallEndedEvent): void {
    if (!event || event.channelId !== this.channelId) {
      return;
    }
    this.callActive.set(false);
    this.callHost.set(null);
    this.stopCallTone();
  }

  // Adds presence entries when other members join the channel.
  private handleChannelUserJoined(event: ChannelPresenceEvent): void {
    if (!event || event.channelId !== this.channelId) {
      return;
    }

    let added = false;
    this.onlineMembers.update(current => {
      if (current.some(member => member.userId === event.userId)) {
        return current;
      }
      added = true;
      return [
        ...current,
        {
          channelId: this.channelId,
          userId: event.userId,
          username: event.username,
          avatarUrl: event.avatarUrl ?? null
        }
      ];
    });

    if (added && event.userId !== this.currentUser?.id) {
      this.notify.info(`${event.username} joined the channel.`);
    }
  }

  // Removes presence entries when members leave the channel.
  private handleChannelUserLeft(event: ChannelPresenceEvent): void {
    if (!event || event.channelId !== this.channelId) {
      return;
    }

    let removed = false;
    this.onlineMembers.update(current => {
      if (!current.some(member => member.userId === event.userId)) {
        return current;
      }
      removed = true;
      return current.filter(member => member.userId !== event.userId);
    });

    if (removed && event.userId !== this.currentUser?.id) {
      this.notify.info(`${event.username} left the channel.`);
    }
  }

  // Shows a toast and plays an alert tone for incoming calls.
  private notifyIncomingCall(hostname: string | null): void {
    const message = hostname ? `${hostname} started a call.` : 'A call just started in this channel.';
    this.notify.info(message);
    this.playCallTone();
  }

  // Maps socket messages into the view model format.
  private normalizeMessage(message: ServerMessage): ChatMessage {
    return {
      id: message.id,
      channelId: message.channelId,
      content: message.content ?? '',
      timestamp: new Date(message.timestamp),
      userId: message.userId,
      username: message.username,
      avatarUrl: message.avatarUrl ?? null,
      imageUrl: message.imageUrl ?? null
    };
  }

  // Scrolls the message list to the most recent entry.
  private scrollMessagesToBottom(): void {
    setTimeout(() => {
      const container = document.querySelector('.messages-container');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 50);
  }

  // Fetches metadata for the active channel and group.
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
        const meId = this.currentUser?.id || '';
        this.canManageGroup =
          this.authService.isSuperAdmin() ||
          group.createdBy === meId ||
          (group.admins || []).includes(meId);
      }
    });
  }

  // Loads the member list for the active group to populate the sidebar.
  private loadGroupMembers(): void {
    this.http.get<User[]>(`http://localhost:3000/api/users`).subscribe(users => {
      this.groupMembers = users.filter(user =>
        this.group?.members?.includes(user.id)
      );
    });
  }

  // Plays a repeating audio indicator for incoming calls.
  private playCallTone(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const AudioContextCtor = (window.AudioContext || (window as any).webkitAudioContext) as
      | typeof AudioContext
      | undefined;
    if (!AudioContextCtor) {
      return;
    }
    if (!this.audioCtx) {
      try {
        this.audioCtx = new AudioContextCtor();
      } catch (err) {
        console.warn('Unable to create audio context for call tone', err);
        return;
      }
    }
    const ctx = this.audioCtx;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    if (this.callToneInterval !== null) {
      return;
    }
    this.triggerCallTone();
    this.callToneInterval = window.setInterval(() => this.triggerCallTone(), 2500);
  }

  // Plays a single tone burst used by the repeating call indicator.
  private triggerCallTone(): void {
    if (!this.audioCtx) {
      return;
    }
    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      this.activeOscillator = osc;
      window.setTimeout(() => {
        try {
          osc.stop();
          osc.disconnect();
          gain.disconnect();
          if (this.activeOscillator === osc) {
            this.activeOscillator = undefined;
          }
        } catch (_) {
          // ignore stop errors
        }
      }, 350);
    } catch (err) {
      console.warn('Failed to play call tone', err);
    }
  }

  // Stops any active call tone playback and clears timers.
  private stopCallTone(): void {
    if (this.callToneInterval !== null) {
      window.clearInterval(this.callToneInterval);
      this.callToneInterval = null;
    }
    if (this.activeOscillator) {
      try {
        this.activeOscillator.stop();
      } catch (_) {
        // ignore stop errors
      }
      try {
        this.activeOscillator.disconnect();
      } catch (_) {
        // ignore disconnect errors
      }
      this.activeOscillator = undefined;
    }
  }
}
