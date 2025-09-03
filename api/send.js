// api/send.js (CommonJS so it works in both Vercel and local Express)
const nodemailer = require('nodemailer');

// Ensure Node runtime on Vercel (not Edge)
module.exports.config = {
  runtime: 'nodejs18.x',
  regions: ['bom1', 'iad1', 'hnd1', 'sfo1'] // optional: pick regions
};

// Safely read JSON body (Vercel serverless doesn't auto-parse)
async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body; // Express path
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const str = Buffer.concat(chunks).toString('utf8') || '';
  try { return str ? JSON.parse(str) : {}; } catch { return {}; }
}

async function sendHandler(req, res) {
  if (req.method && req.method !== 'POST') {
    res.status(405).json({
      status: 405,
      message: 'error',
      data: { error: 'Method Not Allowed' }
    });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const {
      user, pass, to, cc, bcc, subject, text, html, attachments
    } = body || {};

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: (user || pass) ? { user, pass } : undefined
    });

    const info = await transporter.sendMail({
      from: user, to, cc, bcc, subject, text, html, attachments
    });

    res.status(200).json({
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
      554: 'Message rejected (spam/policy).'
    };

    const details = [
      err?.message,
      err?.response,
      err?.command && `command=${err.command}`,
    ].filter(Boolean).join(' | ');

    const friendly = friendlyByCode[code] || 'Unexpected error while sending mail.';

    res.status(code).json({
      status: code,
      message: 'error',
      data: {
        error: friendly,
        details,
        code
      }
    });
  }
}

// Export for Vercel (default) and for local Express (require)
module.exports = sendHandler;
