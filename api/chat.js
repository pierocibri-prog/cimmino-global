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

      // Clean conversation for analysis
      const cleanConvo = (messages || []).map(m => {
        const role = m.role === 'user' ? 'Client' : 'Advisor';
        const content = (m.content || '')
          .replace(/\[OPTIONS:\[.*?\]\]/gs, '')
          .replace(/\[EMAIL_CAPTURED\]/g, '')
          .trim();
        return content ? `${role}: ${content}` : null;
      }).filter(Boolean).join('\n');

      // Ask Claude to extract lead data and draft client email
      const analysisRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 1500,
          messages: [{
            role: 'user',
            content: `You are an assistant for Cimmino Global, a global sourcing and manufacturing advisory firm.

Analyze this intake conversation and return a JSON object with exactly this structure (no markdown, no explanation, just raw JSON):

{
  "lead": {
    "name": "client name or Unknown",
    "email": "client email",
    "product": "product description",
    "market": "target market",
    "volume": "order quantity",
    "budget": "budget or target cost",
    "timeline": "timeline",
    "certifications": "certification needs",
    "china_experience": "Yes / No / Has had challenges",
    "pain_point": "main challenge in one sentence",
    "specs_available": "Yes / Partial / No",
    "priority": "High / Medium / Low"
  },
  "draft_email": {
    "subject": "email subject line",
    "body": "professional but warm email body in English, addressing the client by name, referencing their specific product, and including this Calendly link to book a call: https://calendly.com/cimminoglobal/30min — keep it under 120 words, no placeholders"
  }
}

Conversation:
${cleanConvo}`
          }]
        })
      });

      const analysisData = await analysisRes.json();
      const rawText = (analysisData.content || []).map(b => b.text || '').join('');

      let lead = {};
      let draftEmail = {};
      try {
        const cleaned = rawText.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        lead = parsed.lead || {};
        draftEmail = parsed.draft_email || {};
      } catch(e) {
        lead = { email: clientEmail };
        draftEmail = { subject: 'New project inquiry', body: rawText };
      }

      // Priority color
      const priorityColor = lead.priority === 'High' ? '#16a34a' : lead.priority === 'Low' ? '#dc2626' : '#d97706';

      const emailHtml = `
<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:32px 24px;background:#ffffff;">

  <div style="border-bottom:2px solid #1E6FD9;padding-bottom:20px;margin-bottom:28px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;color:#1E6FD9;text-transform:uppercase;margin-bottom:6px;">CIMMINO.GLOBAL</div>
    <div style="font-size:22px;font-weight:700;color:#111;">New Lead</div>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:32px;">
    <tr><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#888;width:40%;">Product</td><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#111;font-weight:500;">${lead.product || '-'}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#888;">Market</td><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#111;font-weight:500;">${lead.market || '-'}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#888;">Volume</td><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#111;font-weight:500;">${lead.volume || '-'}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#888;">Budget</td><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#111;font-weight:500;">${lead.budget || '-'}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#888;">Timeline</td><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#111;font-weight:500;">${lead.timeline || '-'}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#888;">Certifications</td><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#111;font-weight:500;">${lead.certifications || '-'}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#888;">China experience</td><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#111;font-weight:500;">${lead.china_experience || '-'}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#888;">Pain point</td><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#111;font-weight:500;">${lead.pain_point || '-'}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#888;">Specs available</td><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#111;font-weight:500;">${lead.specs_available || '-'}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#888;">Priority</td><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;"><span style="background:${priorityColor};color:#fff;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:600;">${lead.priority || '-'}</span></td></tr>
    <tr><td style="padding:8px 0;font-size:13px;color:#888;">Contact</td><td style="padding:8px 0;font-size:13px;color:#1E6FD9;font-weight:600;">${lead.name || ''} — ${lead.email || clientEmail}</td></tr>
  </table>

  <div style="background:#f8f9fb;border-radius:8px;padding:20px;margin-bottom:12px;border-left:3px solid #1E6FD9;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#1E6FD9;text-transform:uppercase;margin-bottom:12px;">Draft Email to Client</div>
    <div style="font-size:12px;color:#888;margin-bottom:6px;"><strong style="color:#555;">Subject:</strong> ${draftEmail.subject || ''}</div>
    <div style="font-size:13px;color:#333;line-height:1.7;white-space:pre-wrap;">${draftEmail.body || ''}</div>
  </div>

  <div style="font-size:11px;color:#bbb;text-align:center;margin-top:24px;">Cimmino Global - hello@cimminoglobal.com</div>
</div>`;

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
        },
        body: JSON.stringify({
          from: 'Cimmino Global <hello@cimminoglobal.com>',
          to: ['cimminoglobal@gmail.com'],
          subject: `New lead: ${lead.product || 'project'} - ${lead.priority || ''} priority`,
          html: emailHtml
        })
      });

      const emailData = await emailRes.json();
      return res.status(200).json({ success: true });
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
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
};
