// Cloudflare Worker for Note Scribe AI Cloud Backup
// This worker securely proxies requests to Groq's Llama 3 70B API

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  // Only allow POST requests to our proxy endpoint
  if (request.method !== 'POST' || !request.url.includes('/api/cloud-proxy')) {
    return new Response('Not Found', { status: 404 });
  }

  const GROQ_API_KEY = CLOUDFLARE_ENV.GROQ_API_KEY;
  const GROQ_API_URL = CLOUDFLARE_ENV.GROQ_API_URL || 'https://api.groq.com/openai/v1';

  if (!GROQ_API_KEY) {
    return new Response('API key not configured', { status: 500 });
  }

  try {
    // Get request body
    const requestBody = await request.json();

    // Forward request to Groq API
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-70b-8192',
        messages: [
          {
            role: 'system',
            content: requestBody.systemPrompt || ''
          },
          {
            role: 'user',
            content: requestBody.prompt || ''
          }
        ],
        stream: true,
        temperature: 0.3,
        max_tokens: 1024
      })
    });

    // Create a transform stream to forward the response
    const stream = response.body;

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Model': 'llama3-70b-8192',
        'X-Provider': 'Groq (via Cloudflare)'
      }
    });

  } catch (error) {
    console.error('Cloud proxy error:', error);
    return new Response(JSON.stringify({
      error: 'Cloud backup failed',
      details: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}
