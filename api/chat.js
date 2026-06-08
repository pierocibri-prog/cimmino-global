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

      // Ask Claude to extract lead data, draft email and anteproyecto
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);

      let analysisData;
      try {
        const analysisRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
            max_tokens: 2500,
            messages: [{
              role: 'user',
              content: `You are an assistant for Cimmino Global, a global sourcing and manufacturing advisory firm.

Analyze this intake conversation and return a JSON object with exactly this structure (no markdown, no explanation, just raw JSON):

{
  "lead": {
    "name": "client name or Unknown",
    "email": "client email",
    "product": "product description",
    "proyecto_nuevo": "TRUE or FALSE",
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
    "body": "professional but warm email body in English, written in first person from Piero. Address the client by name, reference their specific product and key details from the conversation, keep it under 120 words, no placeholders. Do NOT include the Calendly link in the body. End with: Best regards, Piero"
  },
  "anteproyecto": {
    "resumen": "2-3 sentence executive summary of what the client wants to achieve",
    "viabilidad": "High / Medium / Low",
    "riesgo": "High / Medium / Low",
    "tipo_sourcing": "e.g. Direct factory, Verified trader, OEM, Private label",
    "certificaciones_requeridas": "specific certifications needed based on product and market",
    "fee_sugerido": "estimated fee range in euros based on project complexity",
    "preguntas_clave": ["question 1", "question 2", "question 3", "question 4", "question 5"],
    "proximos_pasos": ["step 1", "step 2", "step 3"]
  }
}

Conversation:
${cleanConvo}`
            }]
          })
        });
        analysisData = await analysisRes.json();
      } finally {
        clearTimeout(timeout);
      }

      const rawText = (analysisData.content || []).map(b => b.text || '').join('');

      let lead = {};
      let draftEmail = {};
      let anteproyecto = {};
      try {
        const cleaned = rawText.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        lead = parsed.lead || {};
        draftEmail = parsed.draft_email || {};
        anteproyecto = parsed.anteproyecto || {};
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
    <tr><td style="padding:8px 0;font-size:13px;color:#888;">Contact</td><td style="padding:8px 0;font-size:13px;color:#1E6FD9;font-weight:600;">${lead.name || ''} - ${lead.email || clientEmail}</td></tr>
  </table>

  <div style="background:#f8f9fb;border-radius:8px;padding:20px;margin-bottom:12px;border-left:3px solid #1E6FD9;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#1E6FD9;text-transform:uppercase;margin-bottom:12px;">Draft Email to Client</div>
    <div style="font-size:12px;color:#888;margin-bottom:6px;"><strong style="color:#555;">Subject:</strong> ${draftEmail.subject || ''}</div>
    <div style="font-size:13px;color:#333;line-height:1.7;white-space:pre-wrap;">${draftEmail.body || ''}</div>
    <div style="margin-top:16px;">
      <a href="https://calendly.com/cimminoglobal/30min" style="display:inline-block;background:#1E6FD9;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:13px;font-weight:600;letter-spacing:0.02em;">Book a call</a>
    </div>
  </div>

  <!-- ANTEPROYECTO -->
  <div style="margin-top:28px;border-radius:8px;overflow:hidden;border:1px solid #e0e7f0;">
    <div style="background:#0D1B2A;padding:14px 20px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;color:#1E6FD9;text-transform:uppercase;margin-bottom:2px;">Anteproyecto</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.7);">Guia para la llamada de 30 minutos</div>
    </div>
    <div style="padding:20px;background:#f8f9fb;">

      <p style="font-size:13px;color:#333;line-height:1.7;margin:0 0 20px;">${anteproyecto.resumen || ''}</p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <tr>
          <td style="padding:8px 12px;background:#fff;border:0.5px solid #e0e7f0;font-size:12px;color:#888;width:40%;">Viabilidad</td>
          <td style="padding:8px 12px;background:#fff;border:0.5px solid #e0e7f0;font-size:13px;font-weight:600;color:#111;">${anteproyecto.viabilidad || '-'}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;background:#f8f9fb;border:0.5px solid #e0e7f0;font-size:12px;color:#888;">Riesgo comercial</td>
          <td style="padding:8px 12px;background:#f8f9fb;border:0.5px solid #e0e7f0;font-size:13px;font-weight:600;color:#111;">${anteproyecto.riesgo || '-'}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;background:#fff;border:0.5px solid #e0e7f0;font-size:12px;color:#888;">Tipo de sourcing</td>
          <td style="padding:8px 12px;background:#fff;border:0.5px solid #e0e7f0;font-size:13px;font-weight:600;color:#111;">${anteproyecto.tipo_sourcing || '-'}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;background:#f8f9fb;border:0.5px solid #e0e7f0;font-size:12px;color:#888;">Certificaciones requeridas</td>
          <td style="padding:8px 12px;background:#f8f9fb;border:0.5px solid #e0e7f0;font-size:13px;font-weight:600;color:#111;">${anteproyecto.certificaciones_requeridas || '-'}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;background:#fff;border:0.5px solid #e0e7f0;font-size:12px;color:#888;">Fee sugerido</td>
          <td style="padding:8px 12px;background:#fff;border:0.5px solid #e0e7f0;font-size:13px;font-weight:600;color:#1E6FD9;">${anteproyecto.fee_sugerido || '-'}</td>
        </tr>
      </table>

      <div style="margin-bottom:16px;">
        <div style="font-size:11px;font-weight:700;color:#0D1B2A;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Preguntas clave para la llamada</div>
        ${(anteproyecto.preguntas_clave || []).map((q, i) => `<div style="padding:8px 12px;background:#fff;border-left:3px solid #1E6FD9;margin-bottom:6px;font-size:13px;color:#333;border-radius:0 4px 4px 0;">${i+1}. ${q}</div>`).join('')}
      </div>

      <div>
        <div style="font-size:11px;font-weight:700;color:#0D1B2A;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Proximos pasos</div>
        ${(anteproyecto.proximos_pasos || []).map((s, i) => `<div style="padding:8px 12px;background:#fff;border-left:3px solid #0D1B2A;margin-bottom:6px;font-size:13px;color:#333;border-radius:0 4px 4px 0;">${i+1}. ${s}</div>`).join('')}
      </div>

    </div>
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
          subject: `New lead: ${lead.name || 'Unknown'} - ${lead.product || 'project'} - ${lead.priority || ''} priority`,
          html: emailHtml
        })
      });

      // Send to Google Sheets
      try {
        await fetch('https://script.google.com/macros/s/AKfycbzyK1TFnq0gtYOSkm480SxQu_81K7ac3me5w10C-7PZ8nKc2CAXYwby4BC1DaMVwLov8A/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...lead,
            notas_clave: anteproyecto.resumen || ''
          })
        });
      } catch(e) {
        console.error('Sheets error:', e.message);
      }

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
