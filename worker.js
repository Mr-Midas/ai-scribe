// Cloudflare Worker for Note Scribe AI Cloud Backup
// Fallback chain: Local Ollama → Groq (Llama 3 70B) → OpenRouter (Llama 3 70B)

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (request.method !== 'POST' || !request.url.includes('/api/cloud-proxy')) {
    return new Response('Not Found', { status: 404 });
  }

  const requestBody = await request.json();
  const groqKey = CLOUDFLARE_ENV.GROQ_API_KEY;
  const openrouterKey = CLOUDFLARE_ENV.OPENROUTER_API_KEY;

  if (!groqKey && !openrouterKey) {
    return new Response(JSON.stringify({ error: 'No cloud API keys configured' }), { status: 500 });
  }

  if (groqKey) {
    try {
      return await tryGroq(requestBody, groqKey);
    } catch (groqError) {
      console.error('Groq failed:', groqError.message);
    }
  }

  if (openrouterKey) {
    try {
      return await tryOpenRouter(requestBody, openrouterKey);
    } catch (openrouterError) {
      console.error('OpenRouter failed:', openrouterError.message);
    }
  }

  return new Response(JSON.stringify({ error: 'All cloud providers failed' }), { status: 500 });
}

async function tryGroq(requestBody, apiKey) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama3-70b-8192',
      messages: [
        { role: 'system', content: requestBody.systemPrompt || '' },
        { role: 'user', content: requestBody.prompt || '' }
      ],
      stream: true,
      temperature: 0.3,
      max_tokens: 1024
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Groq ${response.status}: ${text}`);
  }

  return new Response(response.body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Model': 'llama3-70b-8192',
      'X-Provider': 'Groq'
    }
  });
}

async function tryOpenRouter(requestBody, apiKey) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/Mr-Midas/ai-scribe',
      'X-Title': 'Note Scribe AI'
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.1-70b-instruct',
      messages: [
        { role: 'system', content: requestBody.systemPrompt || '' },
        { role: 'user', content: requestBody.prompt || '' }
      ],
      stream: true,
      temperature: 0.3,
      max_tokens: 1024
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${text}`);
  }

  return new Response(response.body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Model': 'llama-3.1-70b-instruct',
      'X-Provider': 'OpenRouter'
    }
  });
}
