module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbxyxxMULS6yTrd-brLrCSLI1kAJEMnB_LhDu4xK0Bl1_JLyaUW3AmyU4PgAcR2QIpA-/exec';
  
  try {
    const rawBody = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });

    const body = JSON.parse(rawBody);

    // ─────────────────────────────────────────────
    // FORM LEAD: fired from the mini-form on the page (alternative to chatbot).
    // Sends email to Piero + saves to Sheets as FORM type.
    // ─────────────────────────────────────────────
    if (body.type === 'lead_form') {
      const name = (body.name || '').toString().slice(0, 120);
      const email = (body.email || '').toString().slice(0, 160);
      const project = (body.project || '').toString().slice(0, 1200);
      const lang = body.lang === 'es' ? 'es' : 'en';

      const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      const formHtml = `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#ffffff;">
  <div style="border-bottom:2px solid #1E6FD9;padding-bottom:20px;margin-bottom:28px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;color:#1E6FD9;text-transform:uppercase;margin-bottom:6px;">CIMMINO.GLOBAL</div>
    <div style="font-size:22px;font-weight:700;color:#111;">New Lead (Form)</div>
    <div style="font-size:13px;color:#888;margin-top:4px;">Submitted via the website form, not the chatbot</div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <tr><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#888;width:30%;">Name</td><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#111;font-weight:500;">${esc(name) || '-'}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#888;">Email</td><td style="padding:8px 0;border-bottom:0.5px solid #f0f0f0;font-size:13px;color:#1E6FD9;font-weight:600;">${esc(email) || '-'}</td></tr>
    <tr><td style="padding:8px 0;font-size:13px;color:#888;vertical-align:top;">Project</td><td style="padding:8px 0;font-size:13px;color:#111;line-height:1.6;">${esc(project) || '-'}</td></tr>
  </table>
  <div style="background:#f8f9fb;border-radius:8px;padding:16px 20px;border-left:3px solid #1E6FD9;">
    <div style="font-size:12px;color:#555;line-height:1.6;">This lead preferred the form over the chatbot. Reach out directly to start the conversation. No anteproyecto was generated since the form only collects basic info.</div>
  </div>
  <div style="margin-top:18px;">
    <a href="https://calendly.com/cimminoglobal/30min" style="display:inline-block;background:#1E6FD9;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:13px;font-weight:600;">Open Calendly</a>
  </div>
  <div style="font-size:11px;color:#bbb;text-align:center;margin-top:24px;">Cimmino Global - hello@cimminoglobal.com</div>
</div>`;

      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
          },
          body: JSON.stringify({
            from: 'Cimmino Global <hello@cimminoglobal.com>',
            to: ['cimminoglobal@gmail.com'],
            subject: `New lead (form): ${name || 'Unknown'}`,
            html: formHtml
          })
        });
      } catch(e) {
        console.error('Form email error:', e.message);
      }

      try {
        await fetch(SHEETS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name,
            email: email,
            product: project,
            status: 'FORM',
            notas_clave: 'Lead via formulario web. Prefirio no usar el chatbot.'
          })
        });
      } catch(e) {
        console.error('Form sheets error:', e.message);
      }

      return res.status(200).json({ success: true, form: true });
    }

    // ─────────────────────────────────────────────
    // GUIDE LEAD: fired when someone requests the free guide.
    // Saves to Sheets as GUIA type. No anteproyecto, no email to Piero.
    // ─────────────────────────────────────────────
    if (body.type === 'lead_guide') {
      const { clientEmail, messages } = body;

      const cleanConvo = (messages || []).map(m => {
        const role = m.role === 'user' ? 'Client' : 'Advisor';
        const content = (m.content || '')
          .replace(/\[OPTIONS:\[.*?\]\]/gs, '')
          .replace(/\[EMAIL_CAPTURED\]/g, '')
          .replace(/\[INTAKE_COMPLETE\]/g, '')
          .replace(/\[GUIDE_SENT\]/g, '')
          .trim();
        return content ? `${role}: ${content}` : null;
      }).filter(Boolean).join('\n');

      let guide = { name: 'Unknown', email: clientEmail, product: '' };
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
          const extractRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': process.env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01'
            },
            signal: controller.signal,
            body: JSON.stringify({
              model: 'claude-sonnet-4-5',
              max_tokens: 300,
              messages: [{
                role: 'user',
                content: `Extract from this conversation and return ONLY raw JSON, no markdown:
{"name": "client name or Unknown", "email": "client email", "product": "what they want to make if mentioned, otherwise empty string"}

Conversation:
${cleanConvo}`
              }]
            })
          });
          const extractData = await extractRes.json();
          const rawText = (extractData.content || []).map(b => b.text || '').join('');
          const parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
          guide = {
            name: parsed.name || 'Unknown',
            email: parsed.email || clientEmail,
            product: parsed.product || ''
          };
        } finally {
          clearTimeout(timeout);
        }
      } catch(e) {
        console.error('Guide extraction failed, using fallback:', e.message);
      }

      try {
        await fetch(SHEETS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: guide.name,
            email: guide.email,
            product: guide.product,
            status: 'GUIA',
            notas_clave: 'Descargo la guia de los 5 errores. Lead en fase de exploracion.'
          })
        });
      } catch(e) {
        console.error('Sheets guide error:', e.message);
      }


      // ─── Send the guide to the client by email ───
      // Language: explicit body.lang first; fallback to text heuristic on convo+name.
      const reqLang = (body.lang || '').toLowerCase();
      const textForLang = (cleanConvo + ' ' + (guide.name || '') + ' ' + (guide.product || '')).toLowerCase();
      const looksSpanish = /[\u00f1\u00e1\u00e9\u00ed\u00f3\u00fa\u00bf\u00a1]/.test(textForLang) ||
        /\b(hola|gracias|por favor|necesito|quiero|gu[ií]a|fabricar|china)\b/.test(textForLang);
      const lang = reqLang === 'es' ? 'es' : (reqLang === 'en' ? 'en' : (looksSpanish ? 'es' : 'en'));

      const firstName = (guide.name && guide.name !== 'Unknown')
        ? guide.name.trim().split(/\s+/)[0].replace(/[-\u2013\u2014].*$/, '')
        : (lang === 'es' ? '' : '');

      const pdfUrl = lang === 'es'
        ? 'https://cimminoglobal.com/guia.pdf'
        : 'https://cimminoglobal.com/guide.pdf';

      const guideEmailSubject = lang === 'es'
        ? 'Tu guía Cimmino Global'
        : 'Your Cimmino Global guide';

      const greeting = lang === 'es'
        ? (firstName ? `Hola ${firstName},` : 'Hola,')
        : (firstName ? `Hi ${firstName},` : 'Hi,');

      const intro = lang === 'es'
        ? 'Aquí tienes la guía con los 5 errores más caros al fabricar en China, y cómo evitarlos. Léela con calma cuando te venga bien.'
        : "Here's the guide on the 5 most expensive mistakes when manufacturing in China, and how to avoid them. Read it at your own pace.";

      const buttonText = lang === 'es' ? 'Descargar la guía' : 'Download the guide';

      const outro = lang === 'es'
        ? 'Si más adelante quieres conversar sobre tu proyecto, estoy por aquí. Sin prisa.'
        : "If you'd like to talk about your project later on, I'm here. No rush.";

      const signoff = lang === 'es' ? 'Un saludo,' : 'Best,';

      const guideClientHtml = `<div style="font-family:Inter,Arial,sans-serif;background:#080C14;padding:32px;color:#c4ccd6;">
  <div style="max-width:560px;margin:0 auto;background:#0D1420;border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden;">
    <div style="height:4px;background:linear-gradient(to right,#1E6FD9 55%,#4A90E2 80%,#274768 100%);"></div>
    <div style="padding:32px 36px;">
      <div style="font-family:Syne,Helvetica,sans-serif;font-weight:800;color:#F4F7FB;font-size:18px;letter-spacing:0.02em;">CIMMINO<span style="color:#6FB0FF;">.</span>GLOBAL</div>
      <div style="margin-top:24px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#6FB0FF;font-family:monospace;">${lang === 'es' ? 'Tu guía gratuita' : 'Your free guide'}</div>
      <h1 style="margin:10px 0 18px;font-family:Syne,Helvetica,sans-serif;font-size:26px;color:#F4F7FB;line-height:1.2;">${lang === 'es' ? 'Aquí la tienes.' : 'Here it is.'}</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#c4ccd6;">${greeting}</p>
      <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#c4ccd6;">${intro}</p>
      <a href="${pdfUrl}" style="display:inline-block;background:#1E6FD9;color:#fff;text-decoration:none;padding:12px 26px;border-radius:9px;font-family:Syne,Helvetica,sans-serif;font-size:14px;font-weight:700;">${buttonText} &nbsp;&rarr;</a>
      <p style="margin:22px 0 0;font-size:14px;line-height:1.7;color:#c4ccd6;">${outro}</p>
      <p style="margin:18px 0 0;font-size:14px;line-height:1.7;color:#c4ccd6;">${signoff}<br>Piero</p>
      <div style="margin-top:24px;padding-top:18px;border-top:1px solid rgba(255,255,255,0.07);font-size:11px;color:#5b6675;font-family:monospace;letter-spacing:0.08em;">CIMMINO GLOBAL · cimminoglobal.com</div>
    </div>
  </div>
</div>`;

      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
          },
          body: JSON.stringify({
            from: 'Piero Cimmino <hello@cimminoglobal.com>',
            to: [guide.email],
            subject: guideEmailSubject,
            html: guideClientHtml
          })
        });
      } catch(e) {
        console.error('Guide email to client error:', e.message);
      }

      return res.status(200).json({ success: true, guide: true });
    }

    // ─────────────────────────────────────────────
    // PARTIAL LEAD: fired when email is captured early.
    // Saves the lead to Google Sheets silently. No email, no chat close.
    // ─────────────────────────────────────────────
    if (body.type === 'lead_partial') {
      const { clientEmail, messages } = body;

      const cleanConvo = (messages || []).map(m => {
        const role = m.role === 'user' ? 'Client' : 'Advisor';
        const content = (m.content || '')
          .replace(/\[OPTIONS:\[.*?\]\]/gs, '')
          .replace(/\[EMAIL_CAPTURED\]/g, '')
          .replace(/\[INTAKE_COMPLETE\]/g, '')
          .trim();
        return content ? `${role}: ${content}` : null;
      }).filter(Boolean).join('\n');

      // Minimal extraction: name, email, product only
      let partial = { name: 'Unknown', email: clientEmail, product: '' };
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
          const extractRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': process.env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01'
            },
            signal: controller.signal,
            body: JSON.stringify({
              model: 'claude-sonnet-4-5',
              max_tokens: 300,
              messages: [{
                role: 'user',
                content: `Extract from this intake conversation and return ONLY raw JSON, no markdown, no explanation:
{"name": "client name or Unknown", "email": "client email", "product": "short product description"}

Conversation:
${cleanConvo}`
              }]
            })
          });
          const extractData = await extractRes.json();
          const rawText = (extractData.content || []).map(b => b.text || '').join('');
          const parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
          partial = {
            name: parsed.name || 'Unknown',
            email: parsed.email || clientEmail,
            product: parsed.product || ''
          };
        } finally {
          clearTimeout(timeout);
        }
      } catch(e) {
        console.error('Partial extraction failed, using fallback:', e.message);
      }

      // Save to Google Sheets with PARCIAL status
      try {
        await fetch(SHEETS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: partial.name,
            email: partial.email,
            product: partial.product,
            status: 'PARCIAL',
            notas_clave: ''
          })
        });
      } catch(e) {
        console.error('Sheets partial error:', e.message);
      }

      return res.status(200).json({ success: true, partial: true });
    }

    // ─────────────────────────────────────────────
    // COMPLETE LEAD: fired when the intake finishes.
    // Full analysis, anteproyecto, email to Piero, Sheets with COMPLETO status.
    // ─────────────────────────────────────────────
    if (body.type === 'send_email') {
      const { clientEmail, messages } = body;

      // Clean conversation for analysis
      const cleanConvo = (messages || []).map(m => {
        const role = m.role === 'user' ? 'Client' : 'Advisor';
        const content = (m.content || '')
          .replace(/\[OPTIONS:\[.*?\]\]/gs, '')
          .replace(/\[EMAIL_CAPTURED\]/g, '')
          .replace(/\[INTAKE_COMPLETE\]/g, '')
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

First, detect the language of the conversation (English or Spanish).

Then analyze this intake conversation and return a JSON object with exactly this structure (no markdown, no explanation, just raw JSON). Generate ALL text fields in the detected conversation language. If Spanish, use Latin American Spanish (no vosotros).

The intake covers: product, contact, project stage, market, volume and target cost, timeline, China experience, and main challenge. Certifications, specs and priority are NOT asked in the chat. For lead fields that were not discussed, write "No discutido" (Spanish) or "Not discussed" (English). For "certificaciones_requeridas" in the anteproyecto, INFER the certifications likely required based on the product and target market using your own knowledge. IMPORTANT STRATEGY for children's products: if the product is a toy, game, flashcard or similar aimed at children, recommend adapting it for ages 3+ to avoid the much stricter certification requirements for under-3 products. For 3+ products sold in the US, the key certification is CPSC / CPC (lab tested, usually under 300 USD), which is worth obtaining even if not selling in the US yet, in case of future expansion. Frame certifications as Piero's pragmatic strategy, not an exhaustive scary list. For "priority", infer High / Medium / Low from volume, timeline and overall seriousness of the lead.

For "fee_sugerido", use Cimmino Global's REAL pricing model, never invent other numbers:
- Simple project (standard product, no complex certifications, moderate volume): 500 to 1000 EUR
- Medium project (some customization or basic certifications like CE, larger volume): 1000 to 2000 EUR
- Complex project (OEM or custom development, regulated categories like food, pharma or electronics with FDA or UL, high volume or multiple suppliers): 2000 to 4000 EUR
Pick a narrower range inside the right tier based on the specifics, and ALWAYS format fee_sugerido as: "Proyecto: X-Y EUR + 8% por pedido" (Spanish) or "Project: X-Y EUR + 8% per order" (English):

{
  "language": "english or spanish",
  "lead": {
    "name": "client name or Unknown",
    "email": "client email",
    "product": "product description",
    "proyecto_nuevo": "TRUE or FALSE",
    "market": "target market",
    "volume": "order quantity",
    "budget": "budget or target cost",
    "timeline": "timeline",
    "certifications": "certification needs if mentioned, otherwise Not discussed",
    "china_experience": "Yes / No / Has had challenges",
    "pain_point": "main challenge in one sentence",
    "specs_available": "Yes / Partial / No / Not discussed",
    "priority": "High / Medium / Low"
  },
  "draft_email": {
    "subject": "email subject line in detected language",
    "body": "professional but warm email body in the detected language, written in first person from Piero. Address the client by name, reference their specific product and key details from the conversation, keep it under 120 words, no placeholders. NEVER mention prices, fees, commissions or percentages in this email, pricing is only discussed in the call. Do NOT include the Calendly link in the body. End with: Best regards, Piero (English) or Saludos, Piero (Spanish)"
  },
  "anteproyecto": {
    "resumen": "2-3 sentence executive summary in detected language",
    "viabilidad": "High / Medium / Low",
    "riesgo": "High / Medium / Low",
    "tipo_sourcing": "e.g. Direct factory, Verified trader, OEM, Private label",
    "certificaciones_requeridas": "specific certifications needed, inferred from product and market",
    "fee_sugerido": "estimated fee range in euros",
    "preguntas_clave": ["question 1 in detected language", "question 2", "question 3", "question 4", "question 5"],
    "proximos_pasos": ["step 1 in detected language", "step 2", "step 3"]
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

      // Send to Google Sheets with COMPLETO status
      try {
        await fetch(SHEETS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...lead,
            status: 'COMPLETO',
            notas_clave: [
              anteproyecto.fee_sugerido || '',
              anteproyecto.riesgo ? `Riesgo: ${anteproyecto.riesgo}` : ''
            ].filter(Boolean).join(' | ')
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
