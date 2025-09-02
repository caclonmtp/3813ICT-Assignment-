const express = require('express');
const router = express.Router();
const storage = require('../data/storage');

// Get all groups
router.get('/', (req, res) => {
    res.json(storage.getGroups());
});

// Get groups for a specific user
router.get('/user/:userId', (req, res) => {
    const user = storage.getUsers().find(u => u.id === req.params.userId);
    if (user) {
        const userGroups = storage.getGroups().filter(g => 
            user.groups.includes(g.id) || 
            user.roles.includes('super-admin')
        );
        res.json(userGroups);
    } else {
        res.status(404).json({ message: 'User not found' });
    }
});

// Create new group
router.post('/', (req, res) => {
    const { name, createdBy } = req.body;
    
    const newGroup = {
        id: Date.now().toString(),
        name,
        createdBy,
        admins: [createdBy],
        members: [createdBy],
        createdAt: new Date()
    };
    
    storage.addGroup(newGroup);
    
    // Add group to creator's groups
    const user = storage.getUsers().find(u => u.id === createdBy);
    if (user) {
        user.groups.push(newGroup.id);
        storage.updateUser(createdBy, { groups: user.groups });
    }
    
    res.json(newGroup);
});

// Add user to group
router.post('/:groupId/members', (req, res) => {
    const { userId } = req.body;
    const group = storage.getGroups().find(g => g.id === req.params.groupId);
    
    if (group) {
        if (!group.members.includes(userId)) {
            group.members.push(userId);
            storage.updateGroup(req.params.groupId, { members: group.members });
            
            // Update user's groups
            const user = storage.getUsers().find(u => u.id === userId);
            if (user && !user.groups.includes(req.params.groupId)) {
                user.groups.push(req.params.groupId);
                storage.updateUser(userId, { groups: user.groups });
            }
        }
        res.json(group);
    } else {
        res.status(404).json({ message: 'Group not found' });
    }
});

// Remove user from group
router.delete('/:groupId/members/:userId', (req, res) => {
    const group = storage.getGroups().find(g => g.id === req.params.groupId);
    
    if (group) {
        group.members = group.members.filter(m => m !== req.params.userId);
        storage.updateGroup(req.params.groupId, { members: group.members });
        
        // Update user's groups
        const user = storage.getUsers().find(u => u.id === req.params.userId);
        if (user) {
            user.groups = user.groups.filter(g => g !== req.params.groupId);
            storage.updateUser(req.params.userId, { groups: user.groups });
        }
        
        res.json(group);
    } else {
        res.status(404).json({ message: 'Group not found' });
    }
});

// Delete group
router.delete('/:id', (req, res) => {
    const success = storage.deleteGroup(req.params.id);
    
    if (success) {
        // Remove group from all users
        const users = storage.getUsers();
        users.forEach(user => {
            user.groups = user.groups.filter(g => g !== req.params.id);
            storage.updateUser(user.id, { groups: user.groups });
        });
        
        res.json({ message: 'Group deleted successfully' });
    } else {
        res.status(404).json({ message: 'Group not found' });
    }
});

module.exports = router;