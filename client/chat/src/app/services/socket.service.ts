import { Injectable, OnDestroy } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable, Subject } from 'rxjs';

export interface ServerMessage {
  id: string;
  groupId: string;
  channelId: string;
  userId: string;
  username: string;
  content: string;
  avatarUrl?: string | null;
  imageUrl?: string | null;
  timestamp: number;
}

export interface ChannelPresenceEvent {
  channelId: string;
  userId: string;
  username: string;
  avatarUrl?: string | null;
}

export interface CallUserEvent {
  channelId: string;
  userId: string;
  username?: string;
}

export interface CallSignalEvent {
  channelId: string;
  from: string;
  type: string;
  data?: any;
}

export interface CallSessionEvent {
  channelId: string;
  userId?: string;
  username?: string;
  startedAt?: number;
}

export interface CallEndedEvent {
  channelId: string;
  endedAt?: number;
  endedBy?: { id: string; username: string } | null;
}

export interface JoinChannelResponse {
  messages: ServerMessage[];
  channelMembers: ChannelPresenceEvent[];
  callActive: boolean;
  callParticipants: string[];
  callStartedBy?: { id: string; username: string } | null;
  callStartedAt?: number | null;
}

@Injectable({ providedIn: 'root' })
export class SocketService implements OnDestroy {
  private socket?: Socket;
  private currentUserId?: string;

  private messageSubject = new Subject<ServerMessage>();
  private callJoinSubject = new Subject<CallUserEvent>();
  private callLeaveSubject = new Subject<CallUserEvent>();
  private callSignalSubject = new Subject<CallSignalEvent>();
  private callStartedSubject = new Subject<CallSessionEvent>();
  private callEndedSubject = new Subject<CallEndedEvent>();
  private channelUserJoinedSubject = new Subject<ChannelPresenceEvent>();
  private channelUserLeftSubject = new Subject<ChannelPresenceEvent>();

  get messages$(): Observable<ServerMessage> {
    return this.messageSubject.asObservable();
  }

  get callUserJoined$(): Observable<CallUserEvent> {
    return this.callJoinSubject.asObservable();
  }

  get callUserLeft$(): Observable<CallUserEvent> {
    return this.callLeaveSubject.asObservable();
  }

  get callSignal$(): Observable<CallSignalEvent> {
    return this.callSignalSubject.asObservable();
  }

  get callStarted$(): Observable<CallSessionEvent> {
    return this.callStartedSubject.asObservable();
  }

  get callEnded$(): Observable<CallEndedEvent> {
    return this.callEndedSubject.asObservable();
  }

  get channelUserJoined$(): Observable<ChannelPresenceEvent> {
    return this.channelUserJoinedSubject.asObservable();
  }

  get channelUserLeft$(): Observable<ChannelPresenceEvent> {
    return this.channelUserLeftSubject.asObservable();
  }

  ensureConnection(userId: string): void {
    if (!userId) {
      throw new Error('User id required for socket connection');
    }

    if (this.socket && this.currentUserId === userId) {
      return;
    }

    this.disconnect();
    this.currentUserId = userId;

    this.socket = io('http://localhost:3000', {
      transports: ['websocket'],
      auth: { userId }
    });

    this.registerHandlers();
  }

  private registerHandlers(): void {
    if (!this.socket) return;

    this.socket.on('chat:message', (message: ServerMessage) => {
      this.messageSubject.next(message);
    });

    this.socket.on('call:user-joined', (payload: CallUserEvent) => {
      this.callJoinSubject.next(payload);
    });

    this.socket.on('call:user-left', (payload: CallUserEvent) => {
      this.callLeaveSubject.next(payload);
    });

    this.socket.on('call:signal', (payload: CallSignalEvent) => {
      this.callSignalSubject.next(payload);
    });

    this.socket.on('call:started', (payload: CallSessionEvent) => {
      this.callStartedSubject.next(payload);
    });

    this.socket.on('call:ended', (payload: CallEndedEvent) => {
      this.callEndedSubject.next(payload);
    });

    this.socket.on('channel:user-joined', (payload: ChannelPresenceEvent) => {
      this.channelUserJoinedSubject.next(payload);
    });

    this.socket.on('channel:user-left', (payload: ChannelPresenceEvent) => {
      this.channelUserLeftSubject.next(payload);
    });

    this.socket.on('connect_error', (err: Error) => {
      console.error('Socket connection error:', err?.message || err);
    });
  }

  async joinChannel(groupId: string, channelId: string): Promise<JoinChannelResponse> {
    const response = await this.emitWithAck<{
      success?: boolean;
      messages?: ServerMessage[];
      message?: string;
      callActive?: boolean;
      callParticipants?: string[];
      callStartedBy?: { id: string; username: string } | null;
      callStartedAt?: number | null;
      channelMembers?: ChannelPresenceEvent[];
    }>(
      'joinChannel',
      { groupId, channelId }
    );
    if (response?.success === false) {
      throw new Error(response.message || 'Failed to join channel');
    }
    const rawParticipants = response && Array.isArray(response.callParticipants)
      ? (response.callParticipants as string[])
      : [];
    const callParticipants = [...rawParticipants];

    return {
      messages: response?.messages || [],
      channelMembers: Array.isArray(response?.channelMembers)
        ? (response?.channelMembers as ChannelPresenceEvent[])
        : [],
      callActive: !!response?.callActive,
      callParticipants,
      callStartedBy: response?.callStartedBy ?? null,
      callStartedAt: response?.callStartedAt ?? null
    };
  }

  leaveChannel(channelId: string): void {
    if (!this.socket) return;
    this.socket.emit('leaveChannel', { channelId });
  }

  async sendMessage(groupId: string, channelId: string, content: string): Promise<void> {
    const response = await this.emitWithAck<{ success?: boolean; message?: any; error?: string }>(
      'chat:message',
      { groupId, channelId, content }
    );
    if (response?.success === false) {
      throw new Error(response.message || response.error || 'Failed to send message');
    }
  }

  async joinCall(groupId: string, channelId: string): Promise<{ participants: string[] }> {
    const response = await this.emitWithAck<{ success?: boolean; participants?: string[]; message?: string }>(
      'call:join',
      { groupId, channelId }
    );
    if (response?.success === false) {
      throw new Error(response.message || 'Failed to join call');
    }
    return { participants: response?.participants || [] };
  }

  async leaveCall(channelId: string): Promise<{ success?: boolean; callEnded?: boolean }> {
    if (!this.socket) {
      return { success: false };
    }

    return this.emitWithAck<{ success?: boolean; callEnded?: boolean }>('call:leave', { channelId }).catch(
      () => ({ success: false })
    );
  }

  sendCallSignal(channelId: string, type: string, data: any): void {
    if (!this.socket) return;
    this.socket.emit('call:signal', { channelId, type, data });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = undefined;
    }
    this.currentUserId = undefined;
  }

  private emitWithAck<T>(event: string, payload: any): Promise<T> {
    if (!this.socket) {
      return Promise.reject(new Error('Socket not connected'));
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Socket request timed out'));
      }, 8000);

      const cleanup = () => clearTimeout(timer);

      this.socket!.emit(event, payload, (response: any) => {
        cleanup();
        if (response && response.success === false) {
          reject(new Error(response.message || 'Socket operation failed'));
        } else {
          resolve(response as T);
        }
      });
    });
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
