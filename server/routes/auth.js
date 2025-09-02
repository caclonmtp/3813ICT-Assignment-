const express = require('express');
const router = express.Router();
const storage = require('../data/storage');

// Login endpoint
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    const users = storage.getUsers();
    const user = users.find(u => u.username === username && u.password === password);
    
    if (user) {
        const { password, ...userWithoutPassword } = user;
        res.json({ success: true, user: userWithoutPassword });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

// Register endpoint
router.post('/register', (req, res) => {
    const { username, email, password } = req.body;
    
    const users = storage.getUsers();
    const existingUser = users.find(u => u.username === username);
    
    if (existingUser) {
        return res.status(400).json({ success: false, message: 'Username already exists' });
    }
    
    const newUser = {
        id: Date.now().toString(),
        username,
        email,
        password,
        roles: ['user'],
        groups: []
    };
    
    storage.addUser(newUser);
    const { password: pwd, ...userWithoutPassword } = newUser;
    res.json({ success: true, user: userWithoutPassword });
});

module.exports = router;