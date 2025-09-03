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
    const code = err?.responseCode || err?.status || err?.statusCode || 500;

    // Friendly messages for common SMTP/transport errors
    const friendlyByCode = {
      421: 'Service not available from the mail server.',
      450: 'Mailbox unavailable (temporary). Try again later.',
      451: 'Local error in processing. Try again later.',
      452: 'Insufficient system storage on the server.',
      454: 'Temporary auth failure. Try again later.',
      500: 'Mail server rejected the request.',
      501: 'Invalid address or parameters in the request.',
      502: 'Bad gateway from the mail server.',
      503: 'Bad sequence of commands. Check message formatting.',
      504: 'Command not implemented by the server.',
      530: 'Authentication required. Please provide Gmail address and App Password.',
      534: 'Authentication mechanism not supported.',
      535: 'Authentication failed. Check Gmail address or App Password.',
      550: 'Recipient address rejected by the mail server.',
      551: 'User not local. Check the recipient address.',
      552: 'Mailbox full or message too large.',
      553: 'Mailbox name not allowed. Check the recipient address.',
      554: 'Message rejected (spam/policy).',
    };

    const details = [
      err?.message,
      err?.response,
      err?.command && `command=${err.command}`,
    ].filter(Boolean).join(' | ');

    const friendly = friendlyByCode[code] || 'Unexpected error while sending mail.';

    return res.status(code).json({
      status: code,
      message: 'error',
      data: {
        error: friendly,
        details,
        code
      }
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
