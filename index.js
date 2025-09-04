// index.js
const path = require('path');
const express = require('express');

const app = express();

// Serve static files from ./public (index.html + script.js)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'api')));

// Parse JSON bodies (for local calls to /api/send)
app.use(express.json({ limit: '25mb' }));

// Mount the same handler used by Vercel
const sendHandler = require('./api/send.js');
const receipentsHandler = require('./api/receipents.js');

app.post('/api/send', (req, res) => sendHandler(req, res));
app.post('/api/count', (req, res) => receipentsHandler(req, res));

// Optional: 404 for /api/send with other methods
app.all('/api/send', (req, res) => {
  res.status(405).json({
    status: 405,
    message: 'error',
    data: { error: 'Method Not Allowed' }
  });
});

// Fallback 404 for other routes (static will have already matched if exists)
app.use((req, res) => {
  res.status(404).json({
    status: 404,
    message: 'error',
    data: { error: 'Not Found' }
  });
});

const PORT = process.env.PORT || 3000;
const ENDPOINT = process.env.ENDPOINT || 'http://localhost';
app.listen(PORT, () => console.log(`Listening on ${ENDPOINT}:${PORT}`));
