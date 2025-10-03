import { TestBed } from '@angular/core/testing';
import {
  SocketService,
  ServerMessage,
  CallUserEvent,
  ChannelPresenceEvent,
  SOCKET_FACTORY,
  SocketFactory
} from './socket.service';

type ClientSocket = ReturnType<SocketFactory>;

class MockSocket {
  private handlers = new Map<string, (...args: any[]) => void>();
  private ackResponses = new Map<string, any>();
  emitCalls: Array<{ event: string; payload: any }> = [];

  on = jasmine.createSpy('on').and.callFake((event: string, handler: (...args: any[]) => void) => {
    this.handlers.set(event, handler);
    return this;
  });

  emit = jasmine.createSpy('emit').and.callFake((event: string, payload: any, ack?: (response: any) => void) => {
    this.emitCalls.push({ event, payload });
    if (typeof ack === 'function') {
      const response = this.ackResponses.has(event) ? this.ackResponses.get(event) : {};
      ack(response);
    }
  });

  removeAllListeners = jasmine.createSpy('removeAllListeners');
  disconnect = jasmine.createSpy('disconnect');

  trigger(event: string, payload: any): void {
    const handler = this.handlers.get(event);
    if (handler) {
      handler(payload);
    }
  }

  setAckResponse(event: string, response: any): void {
    this.ackResponses.set(event, response);
  }
}

describe('SocketService', () => {
  let service: SocketService;
  let socketFactorySpy: jasmine.Spy<SocketFactory>;

  beforeEach(() => {
    socketFactorySpy = jasmine.createSpy<SocketFactory>('socketFactory');

    TestBed.configureTestingModule({
      providers: [SocketService, { provide: SOCKET_FACTORY, useValue: socketFactorySpy }]
    });

    service = TestBed.inject(SocketService);
  });

  afterEach(() => {
    service.ngOnDestroy();
    socketFactorySpy.calls.reset();
  });

  it('throws if ensureConnection receives an empty user id', () => {
    expect(() => service.ensureConnection('')).toThrowError('User id required for socket connection');
  });

  it('establishes a websocket connection and registers handlers', () => {
    const socket = new MockSocket();
    socketFactorySpy.and.returnValue(socket as unknown as ClientSocket);

    service.ensureConnection('user-1');

    expect(socketFactorySpy).toHaveBeenCalledWith('http://localhost:3000', {
      transports: ['websocket'],
      auth: { userId: 'user-1' }
    });
    expect(socket.on).toHaveBeenCalledWith('chat:message', jasmine.any(Function));

    let receivedMessage: ServerMessage | undefined;
    service.messages$.subscribe(message => (receivedMessage = message));

    const message: ServerMessage = {
      id: 'm1',
      groupId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      username: 'tester',
      content: 'hello',
      timestamp: Date.now()
    };

    socket.trigger('chat:message', message);
    expect(receivedMessage).toEqual(message);
  });

  it('skips handler registration when no socket is available', () => {
    expect(() => (service as any).registerHandlers()).not.toThrow();
  });

  it('reuses the same socket when ensureConnection is called with the same user id', () => {
    const socket = new MockSocket();
    socketFactorySpy.and.returnValue(socket as unknown as ClientSocket);

    service.ensureConnection('user-2');
    socketFactorySpy.calls.reset();

    service.ensureConnection('user-2');
    expect(socketFactorySpy).not.toHaveBeenCalled();
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects the previous socket when switching users', () => {
    const sockets = [new MockSocket(), new MockSocket()];
    socketFactorySpy.and.returnValues(sockets[0] as unknown as ClientSocket, sockets[1] as unknown as ClientSocket);

    service.ensureConnection('alpha');
    service.ensureConnection('beta');

    expect(sockets[0].removeAllListeners).toHaveBeenCalled();
    expect(sockets[0].disconnect).toHaveBeenCalled();
    expect(socketFactorySpy.calls.count()).toBe(2);
  });

  it('routes user and channel presence events through dedicated streams', () => {
    const socket = new MockSocket();
    socketFactorySpy.and.returnValue(socket as unknown as ClientSocket);
    service.ensureConnection('user-3');

    let joined: CallUserEvent | undefined;
    service.callUserJoined$.subscribe(event => (joined = event));

    let channelPresence: ChannelPresenceEvent | undefined;
    service.channelUserJoined$.subscribe(event => (channelPresence = event));

    const callEvent: CallUserEvent = { channelId: 'c1', userId: 'u1', username: 'Alice' };
    const presence: ChannelPresenceEvent = { channelId: 'c1', userId: 'u2', username: 'Bob' };

    socket.trigger('call:user-joined', callEvent);
    socket.trigger('channel:user-joined', presence);

    expect(joined).toEqual(callEvent);
    expect(channelPresence).toEqual(presence);
  });

  it('sends chat messages with acknowledgement support', async () => {
    const socket = new MockSocket();
    socket.setAckResponse('chat:message', { success: true });
    socketFactorySpy.and.returnValue(socket as unknown as ClientSocket);
    service.ensureConnection('user-4');

    await service.sendMessage('g1', 'c1', 'hello world');

    expect(socket.emit).toHaveBeenCalledWith(
      'chat:message',
      { groupId: 'g1', channelId: 'c1', content: 'hello world' },
      jasmine.any(Function)
    );
  });

  it('rejects when the server reports a chat send failure', async () => {
    const socket = new MockSocket();
    socket.setAckResponse('chat:message', { success: false, message: 'denied' });
    socketFactorySpy.and.returnValue(socket as unknown as ClientSocket);
    service.ensureConnection('user-5');

    await expectAsync(service.sendMessage('g', 'c', 'nope')).toBeRejectedWithError('denied');
  });

  it('joins a channel and normalises the server payload', async () => {
    const socket = new MockSocket();
    const serverMessage: ServerMessage = {
      id: 'm1',
      groupId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      username: 'Jane',
      content: 'hello',
      timestamp: 123,
      avatarUrl: null,
      imageUrl: null
    };

    socket.setAckResponse('joinChannel', {
      messages: [serverMessage],
      channelMembers: [{ channelId: 'c1', userId: 'u1', username: 'Jane' }],
      callActive: 1,
      callParticipants: ['u1', 'u2'],
      callStartedBy: { id: 'lead', username: 'Lead' },
      callStartedAt: 123
    });
    socketFactorySpy.and.returnValue(socket as unknown as ClientSocket);
    service.ensureConnection('user-6');

    const response = await service.joinChannel('g1', 'c1');
    expect(response).toEqual({
      messages: [serverMessage],
      channelMembers: [{ channelId: 'c1', userId: 'u1', username: 'Jane' }],
      callActive: true,
      callParticipants: ['u1', 'u2'],
      callStartedBy: { id: 'lead', username: 'Lead' },
      callStartedAt: 123
    });
  });

  it('applies default values when joinChannel omits optional data', async () => {
    const socket = new MockSocket();
    socket.setAckResponse('joinChannel', {});
    socketFactorySpy.and.returnValue(socket as unknown as ClientSocket);
    service.ensureConnection('user-12');

    const response = await service.joinChannel('g3', 'c3');
    expect(response).toEqual({
      messages: [],
      channelMembers: [],
      callActive: false,
      callParticipants: [],
      callStartedBy: null,
      callStartedAt: null
    });
  });

  it('throws when the server denies channel join request', async () => {
    const socket = new MockSocket();
    socket.setAckResponse('joinChannel', { success: false, message: 'blocked' });
    socketFactorySpy.and.returnValue(socket as unknown as ClientSocket);
    service.ensureConnection('user-7');

    await expectAsync(service.joinChannel('g2', 'c2')).toBeRejectedWithError('blocked');
  });

  it('requires a socket connection for call participation', async () => {
    await expectAsync(service.joinCall('g3', 'c3')).toBeRejectedWithError('Socket not connected');
  });

  it('handles successful and failed call join acknowledgements', async () => {
    const socket = new MockSocket();
    socket.setAckResponse('call:join', { participants: ['u1'], success: true });
    socketFactorySpy.and.returnValue(socket as unknown as ClientSocket);
    service.ensureConnection('user-8');

    const result = await service.joinCall('g4', 'c4');
    expect(result).toEqual({ participants: ['u1'] });

    socket.setAckResponse('call:join', { success: false, message: 'fail' });
    await expectAsync(service.joinCall('g4', 'c4')).toBeRejectedWithError('fail');
  });

  it('returns empty participants when call join response omits them', async () => {
    const socket = new MockSocket();
    socket.setAckResponse('call:join', {});
    socketFactorySpy.and.returnValue(socket as unknown as ClientSocket);
    service.ensureConnection('user-13');

    const result = await service.joinCall('g7', 'c7');
    expect(result).toEqual({ participants: [] });
  });

  it('returns a default response when leaving a call without a socket', async () => {
    const result = await service.leaveCall('c5');
    expect(result).toEqual({ success: false });
  });

  it('resolves with server acknowledgement when leaving a call succeeds', async () => {
    const socket = new MockSocket();
    socket.setAckResponse('call:leave', { success: true, callEnded: true });
    socketFactorySpy.and.returnValue(socket as unknown as ClientSocket);
    service.ensureConnection('user-9');

    const result = await service.leaveCall('c6');
    expect(result).toEqual({ success: true, callEnded: true });
  });

  it('falls back to success false when call leave acknowledgement rejects', async () => {
    const socket = new MockSocket();
    socket.setAckResponse('call:leave', { success: false });
    socketFactorySpy.and.returnValue(socket as unknown as ClientSocket);
    service.ensureConnection('user-9');

    const result = await service.leaveCall('c6');
    expect(result).toEqual({ success: false });
  });

  it('emits leaveChannel and call signaling events when connected', () => {
    const socket = new MockSocket();
    socketFactorySpy.and.returnValue(socket as unknown as ClientSocket);
    service.ensureConnection('user-10');

    service.leaveChannel('chan-1');
    expect(socket.emit).toHaveBeenCalledWith('leaveChannel', { channelId: 'chan-1' });

    service.sendCallSignal('chan-1', 'offer', { data: true });
    expect(socket.emit).toHaveBeenCalledWith('call:signal', { channelId: 'chan-1', type: 'offer', data: { data: true } });
  });

  it('ignores leaveChannel and call signals when not connected', () => {
    service.leaveChannel('chan-2');
    service.sendCallSignal('chan-2', 'offer', {});
    expect(socketFactorySpy).not.toHaveBeenCalled();
  });

  it('disconnect tears down the active socket and clears user context', () => {
    const socket = new MockSocket();
    socketFactorySpy.and.returnValue(socket as unknown as ClientSocket);
    service.ensureConnection('user-11');

    service.disconnect();

    expect(socket.removeAllListeners).toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalled();

    // Subsequent call should create a brand new socket.
    service.ensureConnection('user-11');
    expect(socketFactorySpy.calls.count()).toBe(2);
  });
});
