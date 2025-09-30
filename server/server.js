const http = require('http');
const express = require('express');
const cors = require('cors');
const { initDb } = require('./lib/db');
const { initSocketServer } = require('./lib/socket');

const app = express();
const PORT = process.env.PORT || 3000;
let httpServer;

app.use(cors());
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/channels', require('./routes/channels'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/admin', require('./routes/admin'));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ success: false, message: 'Internal server error' });
});

async function start() {
  try {
    await initDb();
    if (!httpServer) {
      httpServer = http.createServer(app);
      initSocketServer(httpServer);
    }
    if (!httpServer.listening) {
      httpServer.listen(PORT, () => {
        console.log(`API listening on http://localhost:${PORT}/api`);
      });
    }
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
