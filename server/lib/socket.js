const { Server } = require('socket.io');
const {
  getUserById,
  getChannelById,
  getGroupById,
  listMessages,
  createMessage
} = require('./db');

let ioInstance;
// Map of channelId -> { participants: Set<string>, startedBy: { id: string, username: string }, startedAt: number }
const activeCalls = new Map();

function channelRoom(channelId) {
  return `channel:${channelId}`;
}

function callRoom(channelId) {
  return `call:${channelId}`;
}

function safeAck(ack, payload) {
  if (typeof ack === 'function') {
    try {
      ack(payload);
    } catch (err) {
      // ignore consumer ack errors
    }
  }
}

async function ensureChannelAccess({ channelId, groupId, userId }) {
  if (!channelId) {
    throw new Error('channelId required');
  }

  const channel = await getChannelById(channelId);
  if (!channel) {
    throw new Error('Channel not found');
  }

  if (groupId && groupId !== channel.groupId) {
    throw new Error('Channel not in specified group');
  }

  const group = await getGroupById(channel.groupId);
  if (!group) {
    throw new Error('Group not found');
  }

  const isGroupMember =
    group.createdBy === userId || group.admins.includes(userId) || group.members.includes(userId);
  if (!isGroupMember) {
    throw new Error('Access denied');
  }

  if (Array.isArray(channel.bannedUserIds) && channel.bannedUserIds.includes(userId)) {
    throw new Error('You are banned in this channel');
  }

  return { channel, group };
}

function getIo() {
  if (!ioInstance) {
    throw new Error('Socket.io not initialized');
  }
  return ioInstance;
}

function emitNewMessage(message) {
  if (!ioInstance || !message || !message.channelId) {
    return;
  }
  ioInstance.to(channelRoom(message.channelId)).emit('chat:message', message);
}

function broadcastCallEvent(channelId, event, payload, exceptSocket) {
  if (!ioInstance) return;
  const room = callRoom(channelId);
  if (exceptSocket) {
    exceptSocket.to(room).emit(event, payload);
  } else {
    ioInstance.to(room).emit(event, payload);
  }
}

function initSocketServer(httpServer) {
  if (ioInstance) {
    return ioInstance;
  }

  ioInstance = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  ioInstance.use(async (socket, next) => {
    try {
      const auth = socket.handshake.auth || {};
      const query = socket.handshake.query || {};
      const headers = socket.handshake.headers || {};
      const userId = auth.userId || query.userId || headers['x-user-id'];
      if (!userId) {
        return next(new Error('Unauthorized'));
      }

      const user = await getUserById(String(userId));
      if (!user) {
        return next(new Error('Unauthorized'));
      }

      socket.data.user = {
        id: user.id,
        username: user.username,
        roles: Array.isArray(user.roles) ? user.roles : []
      };
      socket.data.joinedChannels = new Set();
      socket.data.callChannels = new Set();
      next();
    } catch (err) {
      next(err);
    }
  });

  ioInstance.on('connection', socket => {
    const { user } = socket.data;

    socket.on('joinChannel', async (payload = {}, ack) => {
      try {
        const { channelId, groupId } = payload;
        const { channel } = await ensureChannelAccess({
          channelId,
          groupId,
          userId: user.id
        });

        socket.join(channelRoom(channel.id));
        socket.data.joinedChannels.add(channel.id);
        const messages = await listMessages({ channelId: channel.id });

        const callState = activeCalls.get(channel.id);
        const callActive = !!callState && callState.participants.size > 0;
        const callParticipants = callActive ? Array.from(callState.participants) : [];
        const callStartedBy = callActive ? callState.startedBy : null;

        safeAck(ack, {
          success: true,
          channelId: channel.id,
          messages,
          callActive,
          callParticipants,
          callStartedBy
        });
      } catch (err) {
        safeAck(ack, { success: false, message: err.message || 'Failed to join channel' });
      }
    });

    socket.on('leaveChannel', (payload = {}, ack) => {
      const { channelId } = payload;
      if (channelId && socket.data.joinedChannels.has(channelId)) {
        socket.leave(channelRoom(channelId));
        socket.data.joinedChannels.delete(channelId);
      }
      safeAck(ack, { success: true, channelId });
    });

    socket.on('chat:message', async (payload = {}, ack) => {
      try {
        const { channelId, groupId, content } = payload;
        if (!socket.data.joinedChannels.has(channelId)) {
          throw new Error('Join channel before sending messages');
        }
        const trimmed = typeof content === 'string' ? content.trim() : '';
        if (!trimmed) {
          throw new Error('Message content required');
        }

        const { channel } = await ensureChannelAccess({
          channelId,
          groupId,
          userId: user.id
        });

        const message = await createMessage({
          groupId: channel.groupId,
          channelId: channel.id,
          userId: user.id,
          username: user.username,
          content: trimmed
        });

        emitNewMessage(message);
        safeAck(ack, { success: true, message });
      } catch (err) {
        safeAck(ack, { success: false, message: err.message || 'Failed to send message' });
      }
    });

    socket.on('call:join', async (payload = {}, ack) => {
      try {
        const { channelId, groupId } = payload;
        if (!channelId) throw new Error('channelId required');

        await ensureChannelAccess({ channelId, groupId, userId: user.id });

        socket.join(callRoom(channelId));
        socket.data.callChannels.add(channelId);

        let callState = activeCalls.get(channelId);
        let isNewCall = false;
        if (!callState) {
          callState = {
            participants: new Set(),
            startedBy: { id: user.id, username: user.username },
            startedAt: Date.now()
          };
          activeCalls.set(channelId, callState);
          isNewCall = true;
        }
        callState.participants.add(user.id);

        const others = Array.from(callState.participants).filter(id => id !== user.id);
        broadcastCallEvent(channelId, 'call:user-joined', {
          channelId,
          userId: user.id,
          username: user.username
        }, socket);

        if (isNewCall && ioInstance) {
          ioInstance.to(channelRoom(channelId)).emit('call:started', {
            channelId,
            userId: user.id,
            username: user.username,
            startedAt: callState.startedAt
          });
        }

        safeAck(ack, { success: true, participants: others });
      } catch (err) {
        safeAck(ack, { success: false, message: err.message || 'Failed to join call' });
      }
    });

    socket.on('call:leave', (payload = {}, ack) => {
      const { channelId } = payload;
      if (!channelId) {
        safeAck(ack, { success: true, callEnded: false });
        return;
      }
      const ended = handleCallLeave(socket, channelId);
      safeAck(ack, { success: true, callEnded: ended });
    });

    socket.on('call:signal', (payload = {}) => {
      const { channelId, type, data } = payload;
      if (!channelId || !type) {
        return;
      }
      if (!socket.data.callChannels.has(channelId)) {
        return;
      }
      broadcastCallEvent(channelId, 'call:signal', { channelId, from: user.id, type, data }, socket);
    });

    socket.on('disconnect', () => {
      for (const channelId of Array.from(socket.data.callChannels)) {
        handleCallLeave(socket, channelId);
      }
    });
  });

  function handleCallLeave(socket, channelId) {
    if (!socket.data.callChannels.has(channelId)) {
      return false;
    }
    socket.leave(callRoom(channelId));
    socket.data.callChannels.delete(channelId);

    const callState = activeCalls.get(channelId);
    let ended = false;
    if (callState) {
      callState.participants.delete(socket.data.user.id);
      if (!callState.participants.size) {
        activeCalls.delete(channelId);
        ended = true;
      }
    }

    broadcastCallEvent(channelId, 'call:user-left', {
      channelId,
      userId: socket.data.user.id
    }, socket);

    if (ended && ioInstance) {
      ioInstance.to(channelRoom(channelId)).emit('call:ended', { channelId });
    }

    return ended;
  }

  return ioInstance;
}

module.exports = {
  initSocketServer,
  getIo,
  emitNewMessage,
  channelRoom,
  callRoom
};
