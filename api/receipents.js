// api/receipents.js
const { ImapFlow } = require('imapflow');

// Ensure Node runtime on Vercel (not Edge)
module.exports.config = {
  runtime: 'nodejs18.x',
  regions: ['bom1', 'iad1', 'hnd1', 'sfo1'] // optional: pick regions
};

module.exports = async function receipentsHandler(req, res) {
  const { user, apppassword } = req.body || {};
  if (!user || !apppassword) {
    return res.status(400).json({ error: 'user and apppassword required' });
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, pass: apppassword },
    logger: false // 👈 disable terminal logs
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('[Gmail]/Sent Mail');

    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000; // last 24h
    const uids = await client.search({ since: new Date(cutoffMs) });

    let sentEmailCount = 0;
    let totalReceipentsCount = 0;
    const uniq = new Set();

    for await (const msg of client.fetch(uids, { envelope: true })) {
      sentEmailCount++;
      const addrs = [].concat(msg.envelope.to || [], msg.envelope.cc || [], msg.envelope.bcc || []);
      totalReceipentsCount += addrs.length;
      for (const a of addrs) if (a.address) uniq.add(a.address.toLowerCase());
    }

    lock.release();
    await client.logout();

    res.json({
      sent_email_count: sentEmailCount,
      total_receipents_count: totalReceipentsCount,
      unique_receipents_count: uniq.size
    });
  } catch (e) {
    try { await client.logout(); } catch {}
    res.status(500).json({ error: e.message });
  }
};
