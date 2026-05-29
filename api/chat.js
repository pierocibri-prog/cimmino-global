module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const rawBody = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });

    const body = JSON.parse(rawBody);

    // If it's an email send request
    if (body.type === 'send_email') {
      const { clientName, clientEmail, summary } = body;

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
        },
        body: JSON.stringify({
          from: 'Cimmino Global Chatbot <hello@cimminoglobal.com>',
          to: ['cimminoglobal@gmail.com'],
          subject: `New project inquiry from ${clientName}`,
          html: `
            <h2>New Project Inquiry</h2>
            <p><strong>Name:</strong> ${clientName}</p>
            <p><strong>Email:</strong> ${clientEmail}</p>
            <hr>
            <h3>Conversation Summary</h3>
            <pre style="background:#f5f5f5;padding:16px;border-radius:8px;white-space:pre-wrap;">${summary}</pre>
          `
        })
      });

      const emailData = await emailRes.json();
      return res.status(200).json({ success: true, email: emailData });
    }

    // Normal Claude API call
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    res.status(response.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
