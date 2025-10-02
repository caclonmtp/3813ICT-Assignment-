const { Server } = require('socket.io');
const {
  getUserById,
  getChannelById,
  getGroupById,
  listMessages,
  createMessage
} = require('./db');
const media = require('./media');

let ioInstance;
// Map of channelId -> { participants: Set<string>, startedBy: { id: string, username: string }, startedAt: number }
const activeCalls = new Map();
// Map of channelId -> Map<userId, { userId, username, avatarUrl }>
const channelMembers = new Map();

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
  const payload = media.applyMessageMedia({ ...message });
  ioInstance.to(channelRoom(message.channelId)).emit('chat:message', payload);
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

function broadcastChannelEvent(channelId, event, payload, exceptSocket) {
  if (!ioInstance) return;
  const room = channelRoom(channelId);
  if (exceptSocket) {
    exceptSocket.to(room).emit(event, payload);
  } else {
    ioInstance.to(room).emit(event, payload);
  }
}

function toPresencePayload(user) {
  return {
    userId: user.id,
    username: user.username,
    avatarUrl: media.applyUserMedia({ ...user }).avatarUrl || null
  };
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

      const decoratedUser = media.applyUserMedia(user);
      socket.data.user = {
        id: decoratedUser.id,
        username: decoratedUser.username,
        roles: Array.isArray(decoratedUser.roles) ? decoratedUser.roles : [],
        avatarUrl: decoratedUser.avatarUrl || null,
        avatarKey: decoratedUser.avatarKey || null
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

    const leaveChannel = channelId => {
      if (!channelId || !socket.data.joinedChannels.has(channelId)) {
        return { removed: false, members: null };
      }

      socket.leave(channelRoom(channelId));
      socket.data.joinedChannels.delete(channelId);

      const members = channelMembers.get(channelId);
      let removed = false;
      let memberList = null;
      if (members) {
        removed = members.delete(socket.data.user.id);
        memberList = Array.from(members.values()).map(member => ({
          ...member,
          channelId
        }));
        if (!members.size) {
          channelMembers.delete(channelId);
        }
      }

      if (removed) {
        broadcastChannelEvent(
          channelId,
          'channel:user-left',
          {
            channelId,
            userId: socket.data.user.id,
            username: socket.data.user.username,
            avatarUrl: socket.data.user.avatarUrl || null
          },
          socket
        );
      }

      return { removed, members: memberList };
    };

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
        const rawMessages = await listMessages({ channelId: channel.id });
        const messages = rawMessages.map(media.applyMessageMedia);

        const freshUser = await getUserById(user.id);
        if (freshUser) {
          const decorated = media.applyUserMedia(freshUser);
          socket.data.user.username = decorated.username;
          socket.data.user.avatarUrl = decorated.avatarUrl || null;
          socket.data.user.avatarKey = decorated.avatarKey || socket.data.user.avatarKey || null;
        }

        let members = channelMembers.get(channel.id);
        if (!members) {
          members = new Map();
          channelMembers.set(channel.id, members);
        }
        const wasMember = members.has(socket.data.user.id);
        const presencePayload = toPresencePayload(socket.data.user);
        members.set(socket.data.user.id, presencePayload);
        const memberList = Array.from(members.values()).map(member => ({
          ...member,
          channelId: channel.id
        }));

        const callState = activeCalls.get(channel.id);
        const callActive = !!callState && callState.participants.size > 0;
        const callParticipants = callActive ? Array.from(callState.participants) : [];
        const callStartedBy = callActive ? callState.startedBy : null;
        const callStartedAt = callActive ? callState.startedAt : null;

        if (!wasMember) {
          broadcastChannelEvent(
            channel.id,
            'channel:user-joined',
            {
              channelId: channel.id,
              userId: socket.data.user.id,
              username: socket.data.user.username,
              avatarUrl: socket.data.user.avatarUrl || null
            },
            socket
          );
        }

        safeAck(ack, {
          success: true,
          channelId: channel.id,
          messages,
          channelMembers: memberList,
          callActive,
          callParticipants,
          callStartedBy,
          callStartedAt
        });
      } catch (err) {
        safeAck(ack, { success: false, message: err.message || 'Failed to join channel' });
      }
    });

    socket.on('leaveChannel', (payload = {}, ack) => {
      const { channelId } = payload;
      const result = leaveChannel(channelId);
      safeAck(ack, {
        success: true,
        channelId,
        channelMembers: result.members || []
      });
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

        let decoratedAuthor = socket.data.user;
        const freshUser = await getUserById(user.id);
        if (freshUser) {
          const applied = media.applyUserMedia(freshUser);
          socket.data.user.username = applied.username;
          socket.data.user.avatarUrl = applied.avatarUrl || null;
          socket.data.user.avatarKey = applied.avatarKey || socket.data.user.avatarKey || null;
          decoratedAuthor = socket.data.user;
        }

        const message = await createMessage({
          groupId: channel.groupId,
          channelId: channel.id,
          userId: user.id,
          username: decoratedAuthor.username,
          content: trimmed,
          avatarKey: decoratedAuthor.avatarKey || null,
          imageKey: null,
          imageContentType: null,
          imageFilename: null
        });

        const decoratedMessage = media.applyMessageMedia({ ...message });
        emitNewMessage(message);
        safeAck(ack, { success: true, message: decoratedMessage });
      } catch (err) {
        safeAck(ack, { success: false, message: err.message || 'Failed to send message' });
      }
    });

    socket.on('call:join', async (payload = {}, ack) => {
      try {
        const { channelId, groupId } = payload;
        if (!channelId) throw new Error('channelId required');

        const { channel } = await ensureChannelAccess({ channelId, groupId, userId: user.id });

        socket.join(callRoom(channelId));
        socket.data.callChannels.add(channelId);

        let callState = activeCalls.get(channelId);
        let isNewCall = false;
        if (!callState) {
          callState = {
            participants: new Set(),
            startedBy: { id: user.id, username: user.username },
            startedAt: Date.now(),
            groupId: channel.groupId
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
          try {
            const systemMessage = await createMessage({
              groupId: channel.groupId,
              channelId: channel.id,
              userId: 'system',
              username: 'System',
              content: `${user.username} started a call.`,
              avatarKey: null,
              imageKey: null,
              imageContentType: null,
              imageFilename: null
            });
            emitNewMessage(systemMessage);
          } catch (err) {
            console.warn('Failed to record call start message', err);
          }
        }

        safeAck(ack, { success: true, participants: others });
      } catch (err) {
        safeAck(ack, { success: false, message: err.message || 'Failed to join call' });
      }
    });

    socket.on('call:leave', async (payload = {}, ack) => {
      const { channelId } = payload;
      if (!channelId) {
        safeAck(ack, { success: true, callEnded: false });
        return;
      }
      const { ended } = await handleCallLeave(socket, channelId);
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
      for (const channelId of Array.from(socket.data.joinedChannels)) {
        leaveChannel(channelId);
      }
      for (const channelId of Array.from(socket.data.callChannels)) {
        void handleCallLeave(socket, channelId);
      }
    });
  });

  async function handleCallLeave(socket, channelId) {
    if (!socket.data.callChannels.has(channelId)) {
      return { ended: false, endedBy: null };
    }
    socket.leave(callRoom(channelId));
    socket.data.callChannels.delete(channelId);

    const callState = activeCalls.get(channelId);
    let ended = false;
    let endedBy = null;
    if (callState) {
      callState.participants.delete(socket.data.user.id);
      if (!callState.participants.size) {
        activeCalls.delete(channelId);
        ended = true;
        endedBy = {
          id: socket.data.user.id,
          username: socket.data.user.username
        };
      }
    }

    broadcastCallEvent(channelId, 'call:user-left', {
      channelId,
      userId: socket.data.user.id
    }, socket);

    if (ended && ioInstance) {
      const endedAt = Date.now();
      ioInstance.to(channelRoom(channelId)).emit('call:ended', {
        channelId,
        endedAt,
        endedBy
      });
      try {
        const channel = await getChannelById(channelId);
        if (channel) {
          const message = await createMessage({
            groupId: channel.groupId,
            channelId: channel.id,
            userId: 'system',
            username: 'System',
            content: endedBy?.username
              ? `Call ended when ${endedBy.username} left.`
              : 'Call ended.',
            avatarKey: null,
            imageKey: null,
            imageContentType: null,
            imageFilename: null
          });
          emitNewMessage(message);
        }
      } catch (err) {
        console.warn('Failed to record call end message', err);
      }
    }

    return { ended, endedBy };
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
