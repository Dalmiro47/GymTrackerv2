
const generationConfigDefaults = {
  temperature: 0.2,
  maxOutputTokens: 2048,
  responseMimeType: 'application/json',
};

// helper: one request to a specific model
export async function callGeminiOnce(model: string, systemText: string, userText: string, config?: any) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY}`;
    
    const { facts, ...restConfig } = config || {};

    const finalGenConfig = {
      ...generationConfigDefaults,
      ...restConfig,
    };

    const body = {
        system_instruction: { parts: [{ text: systemText }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: finalGenConfig
    };

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  
    if (r.status === 404) {
      const err = new Error('MODEL_404');
      (err as any).code = 404;
      throw err;
    }
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`HTTP_${r.status}: ${body}`);
    }
    return r.json();
}
