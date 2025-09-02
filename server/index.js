
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());


app.get('/api/health', (_req, res) => res.json({ ok: true }));


app.use((_req, res) => {
  res.status(404).json({ ok: true, note: 'No static hosting in Phase-1. Use ng serve for the client.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`▶ server running at http://localhost:${PORT}`);
});
