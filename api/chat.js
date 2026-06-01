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

    if (body.type === 'send_email') {
      const { clientEmail, messages } = body;

      // Build clean HTML conversation
      const conversationHtml = messages.map(m => {
        const isUser = m.role === 'user';
        const label = isUser ? 'Client' : 'Cimmino Global';
        const color = isUser ? '#1E6FD9' : '#333';
        const bg = isUser ? '#EBF3FD' : '#F5F5F5';
        // Clean system tags from content
        const content = m.content
          .replace(/\[OPTIONS:\[.*?\]\]/gs, '')
          .replace(/\[EMAIL_CAPTURED\]/g, '')
          .trim();
        if (!content) return '';
        return `
          <div style="margin-bottom:16px;">
            <div style="font-size:11px;font-weight:600;color:${color};margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;">${label}</div>
            <div style="background:${bg};padding:12px 16px;border-radius:8px;font-size:14px;line-height:1.6;color:#222;">${content}</div>
          </div>`;
      }).filter(Boolean).join('');

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
        },
        body: JSON.stringify({
          from: 'Cimmino Global <hello@cimminoglobal.com>',
          to: ['cimminoglobal@gmail.com'],
          subject: `New project inquiry — ${clientEmail}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;">
              <div style="margin-bottom:32px;padding-bottom:24px;border-bottom:2px solid #1E6FD9;">
                <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#1E6FD9;text-transform:uppercase;margin-bottom:8px;">CIMMINO.GLOBAL</div>
                <h1 style="margin:0;font-size:22px;color:#111;">New Project Inquiry</h1>
                <p style="margin:8px 0 0;font-size:14px;color:#666;">A potential client has submitted their project details.</p>
              </div>
              <div style="background:#EBF3FD;padding:16px;border-radius:8px;margin-bottom:32px;">
                <div style="font-size:12px;font-weight:600;color:#1E6FD9;margin-bottom:4px;">CLIENT EMAIL</div>
                <div style="font-size:16px;font-weight:600;color:#111;">${clientEmail}</div>
              </div>
              <div style="margin-bottom:8px;font-size:12px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.08em;">Full Conversation</div>
              ${conversationHtml}
              <div style="margin-top:32px;padding-top:24px;border-top:1px solid #eee;font-size:12px;color:#999;text-align:center;">
                Cimmino Global · hello@cimminoglobal.com
              </div>
            </div>
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
