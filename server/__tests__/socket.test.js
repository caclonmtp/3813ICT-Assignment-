const assert = require('assert');
const http = require('http');
const path = require('path');

const socketModulePath = path.join(__dirname, '..', 'lib', 'socket.js');
const socketIoPath = require.resolve('socket.io');

let originalSocketIoCache;
let originalApplyMessageMedia;
let socketLib;
let fakeInstance;
let applyMessageCalls;

class FakeBroadcast {
  constructor(server, room) {
    this.server = server;
    this.room = room;
  }

  emit(event, payload) {
    this.server.emitted.push({ room: this.room, event, payload });
  }
}

class FakeServer {
  constructor(httpServer, options) {
    this.httpServer = httpServer;
    this.options = options;
    this.middlewares = [];
    this.eventHandlers = new Map();
    this.emitted = [];
    fakeInstance = this;
  }

  use(fn) {
    this.middlewares.push(fn);
  }

  on(event, handler) {
    this.eventHandlers.set(event, handler);
  }

  to(room) {
    return new FakeBroadcast(this, room);
  }
}

describe('socket library exports', () => {
  beforeEach(() => {
    delete require.cache[socketModulePath];
    originalSocketIoCache = require.cache[socketIoPath];
    require.cache[socketIoPath] = { exports: { Server: FakeServer } };

    const mediaPath = require.resolve('../lib/media.js');
    const media = require(mediaPath);
    originalApplyMessageMedia = media.applyMessageMedia;
    applyMessageCalls = [];
    media.applyMessageMedia = message => {
      applyMessageCalls.push(message);
      return { ...message, touched: true };
    };

    socketLib = require(socketModulePath);
  });

  afterEach(() => {
    delete require.cache[socketModulePath];
    if (originalSocketIoCache) {
      require.cache[socketIoPath] = originalSocketIoCache;
    } else {
      delete require.cache[socketIoPath];
    }
    const media = require('../lib/media');
    media.applyMessageMedia = originalApplyMessageMedia;
    fakeInstance = undefined;
  });

  it('channelRoom returns the expected namespace', () => {
    assert.strictEqual(socketLib.channelRoom('abc'), 'channel:abc');
  });

  it('callRoom returns the expected namespace', () => {
    assert.strictEqual(socketLib.callRoom('xyz'), 'call:xyz');
  });

  it('getIo throws before init and returns instance after init', () => {
    assert.throws(() => socketLib.getIo(), /Socket\.io not initialized/);
    const httpServer = http.createServer(() => {});
    const instance = socketLib.initSocketServer(httpServer);
    assert.strictEqual(socketLib.getIo(), instance);
  });

  it('initSocketServer initialises socket server once and reuses existing instance', () => {
    const httpServer = http.createServer(() => {});
    const first = socketLib.initSocketServer(httpServer);
    assert.ok(first instanceof FakeServer);
    assert.deepStrictEqual(first.options.cors, { origin: '*', methods: ['GET', 'POST'] });
    const second = socketLib.initSocketServer(httpServer);
    assert.strictEqual(second, first);
    assert.strictEqual(socketLib.getIo(), first);
  });

  it('emitNewMessage no-ops without a valid channel id', () => {
    const httpServer = http.createServer(() => {});
    socketLib.initSocketServer(httpServer);
    socketLib.emitNewMessage(null);
    socketLib.emitNewMessage({ id: 'm1' });
    assert.strictEqual(applyMessageCalls.length, 0);
    assert.strictEqual(fakeInstance.emitted.length, 0);
  });

  it('emitNewMessage decorates payload and broadcasts to channel listeners', () => {
    const httpServer = http.createServer(() => {});
    socketLib.initSocketServer(httpServer);
    socketLib.emitNewMessage({ id: 'm42', channelId: 'c99', content: 'hello' });
    assert.strictEqual(applyMessageCalls.length, 1);
    assert.strictEqual(fakeInstance.emitted.length, 1);
    const broadcast = fakeInstance.emitted[0];
    assert.deepStrictEqual(broadcast, {
      room: 'channel:c99',
      event: 'chat:message',
      payload: { id: 'm42', channelId: 'c99', content: 'hello', touched: true }
    });
  });
});
