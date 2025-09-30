import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  Component,
  OnDestroy,
  OnInit,
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
import { Subject, takeUntil } from 'rxjs';
import { Group } from '../../models/group.model';
import { User } from '../../models/user.model';
import { AuthService } from '../../services/auth.service';
import { NotifyService } from '../../services/notify.service';
import {
  CallSessionEvent,
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

  readonly disableSend = computed(() => !this.newMessage().trim() || !!this.channelError());

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly authService: AuthService,
    private readonly http: HttpClient,
    private readonly socketService: SocketService,
    private readonly notify: NotifyService
  ) {}

  get newMessageValue(): string {
    return this.newMessage();
  }

  set newMessageValue(value: string) {
    this.newMessage.set(value);
  }

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
  }

  ngOnDestroy(): void {
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

  backToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  goToGroupAdmin(): void {
    this.router.navigate(['/group-admin']);
  }

  startCall(): void {
    this.router.navigate(['/call', this.groupId, this.channelId], {
      queryParams: { mode: 'start', host: this.currentUser?.username || '' }
    });
  }

  joinCall(): void {
    this.router.navigate(['/call', this.groupId, this.channelId], {
      queryParams: { mode: 'join', host: this.callHost() || '' }
    });
  }

  formatTime(timestamp: Date): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

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

  async sendMessage(): Promise<void> {
    if (!this.currentUser || !this.newMessage().trim()) return;
    const now = Date.now();
    if (now - this.lastSentAt < 300) {
      return;
    }
    this.lastSentAt = now;

    const content = this.newMessage();
    this.newMessage.set('');

    try {
      await this.socketService.sendMessage(this.groupId, this.channelId, content);
    } catch (err) {
      console.error('Failed to send message', err);
      this.newMessage.set(content);
    }
  }

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

    try {
      const joinInfo: JoinChannelResponse = await this.socketService.joinChannel(
        this.groupId,
        this.channelId
      );
      const mapped = joinInfo.messages.map(message => this.normalizeMessage(message));
      this.messages.set(mapped);
      this.messageIds = new Set(mapped.map(message => message.id));
      this.scrollMessagesToBottom();

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

  private handleCallEnded(event: { channelId: string }): void {
    if (!event || event.channelId !== this.channelId) {
      return;
    }
    this.callActive.set(false);
    this.callHost.set(null);
    this.stopCallTone();
  }

  private notifyIncomingCall(hostname: string | null): void {
    const message = hostname ? `${hostname} started a call.` : 'A call just started in this channel.';
    this.notify.info(message);
    this.playCallTone();
  }

  private normalizeMessage(message: ServerMessage): ChatMessage {
    return {
      id: message.id,
      channelId: message.channelId,
      content: message.content,
      timestamp: new Date(message.timestamp),
      userId: message.userId,
      username: message.username
    };
  }

  private scrollMessagesToBottom(): void {
    setTimeout(() => {
      const container = document.querySelector('.messages-container');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 50);
  }

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

  private loadGroupMembers(): void {
    this.http.get<User[]>(`http://localhost:3000/api/users`).subscribe(users => {
      this.groupMembers = users.filter(user =>
        this.group?.members?.includes(user.id)
      );
    });
  }

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
