const express = require('express');
const router = express.Router();
const storage = require('../data/storage');

// Get channels for a group
router.get('/group/:groupId', (req, res) => {
    const channels = storage.getChannels().filter(c => c.groupId === req.params.groupId);
    res.json(channels);
});

// Create new channel
router.post('/', (req, res) => {
    const { name, groupId, createdBy } = req.body;
    
    const newChannel = {
        id: Date.now().toString(),
        name,
        groupId,
        createdBy,
        createdAt: new Date()
    };
    
    storage.addChannel(newChannel);
    res.json(newChannel);
});

// Delete channel
router.delete('/:id', (req, res) => {
    const success = storage.deleteChannel(req.params.id);
    
    if (success) {
        res.json({ message: 'Channel deleted successfully' });
    } else {
        res.status(404).json({ message: 'Channel not found' });
    }
});

module.exports = router;