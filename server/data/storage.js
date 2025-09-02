let storage = {
    users: [
        {
            id: '1',
            username: 'super',
            email: 'super@admin.com',
            password: '123',
            roles: ['super-admin'],
            groups: []
        }
    ],
    groups: [],
    channels: [],
    messages: []
};

module.exports = {
    getUsers: () => storage.users,
    getGroups: () => storage.groups,
    getChannels: () => storage.channels,
    getMessages: () => storage.messages,
    
    addUser: (user) => {
        storage.users.push(user);
        return user;
    },
    
    updateUser: (id, updates) => {
        const index = storage.users.findIndex(u => u.id === id);
        if (index !== -1) {
            storage.users[index] = { ...storage.users[index], ...updates };
            return storage.users[index];
        }
        return null;
    },
    
    deleteUser: (id) => {
        const index = storage.users.findIndex(u => u.id === id);
        if (index !== -1) {
            storage.users.splice(index, 1);
            return true;
        }
        return false;
    },
    
    addGroup: (group) => {
        storage.groups.push(group);
        return group;
    },
    
    updateGroup: (id, updates) => {
        const index = storage.groups.findIndex(g => g.id === id);
        if (index !== -1) {
            storage.groups[index] = { ...storage.groups[index], ...updates };
            return storage.groups[index];
        }
        return null;
    },
    
    deleteGroup: (id) => {
        const index = storage.groups.findIndex(g => g.id === id);
        if (index !== -1) {
            storage.groups.splice(index, 1);
            storage.channels = storage.channels.filter(c => c.groupId !== id);
            return true;
        }
        return false;
    },
    
    addChannel: (channel) => {
        storage.channels.push(channel);
        return channel;
    },
    
    deleteChannel: (id) => {
        const index = storage.channels.findIndex(c => c.id === id);
        if (index !== -1) {
            storage.channels.splice(index, 1);
            return true;
        }
        return false;
    }
};