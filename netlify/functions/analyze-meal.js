exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const { imageBase64, notes = '' } = JSON.parse(event.body || '{}');
    if (!imageBase64) return json({ error: 'Missing imageBase64' }, 400);
    if (!process.env.OPENAI_API_KEY) return json({ error: 'Missing OPENAI_API_KEY' }, 500);

    const prompt = `Estimate calories and macros from this food image. Return strict JSON only with: meal_name, calories, protein_g, carbs_g, fat_g, fiber_g, confidence, items array with name portion calories protein_g carbs_g fat_g fiber_g, coach_note. Notes: ${notes}`;

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5.5',
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: imageBase64 }] }],
        text: { format: { type: 'json_object' } }
      })
    });
    const data = await response.json();
    if (!response.ok) return json({ error: data.error?.message || 'OpenAI request failed' }, response.status);
    const text = data.output_text || data.output?.flatMap(o=>o.content||[]).find(c=>c.text)?.text || '{}';
    return json(JSON.parse(text));
  } catch (err) {
    return json({ error: err.message || 'Server error' }, 500);
  }
};
function json(body, statusCode=200){ return { statusCode, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }; }
