const express = require('express');
const router = express.Router();
const storage = require('../data/storage');

// Get all users
router.get('/', (req, res) => {
    const users = storage.getUsers().map(u => {
        const { password, ...userWithoutPassword } = u;
        return userWithoutPassword;
    });
    res.json(users);
});

// Get user by ID
router.get('/:id', (req, res) => {
    const users = storage.getUsers();
    const user = users.find(u => u.id === req.params.id);
    
    if (user) {
        const { password, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    } else {
        res.status(404).json({ message: 'User not found' });
    }
});

// Update user 
router.put('/:id', (req, res) => {
    const updatedUser = storage.updateUser(req.params.id, req.body);
    
    if (updatedUser) {
        const { password, ...userWithoutPassword } = updatedUser;
        res.json(userWithoutPassword);
    } else {
        res.status(404).json({ message: 'User not found' });
    }
});

// Delete user
router.delete('/:id', (req, res) => {
    const success = storage.deleteUser(req.params.id);
    
    if (success) {
        res.json({ message: 'User deleted successfully' });
    } else {
        res.status(404).json({ message: 'User not found' });
    }
});

// Promote user to group admin
router.post('/:id/promote', (req, res) => {
    const user = storage.getUsers().find(u => u.id === req.params.id);
    
    if (user) {
        if (!user.roles.includes('group-admin')) {
            user.roles.push('group-admin');
            storage.updateUser(req.params.id, { roles: user.roles });
        }
        const { password, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    } else {
        res.status(404).json({ message: 'User not found' });
    }
});

module.exports = router;