const express = require('express');
const nodemailer = require('nodemailer');

const app = express();

// Serve static files (index.html + script.js)
app.use(express.static('public'));

// Parse JSON bodies
app.use(express.json({ limit: '25mb' }));

// Hard-coded SMTP config
const smtpHost = 'smtp.gmail.com';
const smtpPort = 465;
const secure = true;

app.post('/send', async (req, res) => {
  try {
    const {
      user, pass, to, cc, bcc, subject, text, html, attachments
    } = req.body || {};

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure,
      auth: (user || pass) ? { user, pass } : undefined
    });

    const info = await transporter.sendMail({
      from: user, to, cc, bcc, subject, text, html, attachments
    });

    return res.status(200).json({
      status: 200,
      message: 'ok',
      data: {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        envelope: info.envelope,
        response: info.response
      }
    });
  } catch (err) {
    const code = (err && (err.responseCode || err.status || err.statusCode)) || 500;
    return res.status(code).json({
      status: code,
      message: 'error',
      data: { error: (err && err.message) ? err.message : String(err) }
    });
  }
});

// 404 for /send only
app.use('/send', (req, res) => {
  res.status(404).json({
    status: 404,
    message: 'error',
    data: { error: 'Not Found' }
  });
});

const PORT = process.env.PORT || 3000;
const ENDPOINT = process.env.ENDPOINT || 'http://localhost';
app.listen(PORT, () => console.log(`Listening on ${ENDPOINT}:${PORT}`));
