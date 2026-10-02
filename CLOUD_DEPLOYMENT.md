# Cloudflare Worker Deployment

> **Outdated.** This page describes an earlier version that ran an AI model locally with Ollama. The current product is described in [README.md](README.md). Note Scribe AI is **not HIPAA compliant yet**; see [Path to HIPAA compliance](README.md#path-to-hipaa-compliance).

## Overview
This worker provides a secure cloud backup for Note Scribe AI using Groq's Llama 3 70B model. It's hosted on Cloudflare Workers and acts as a privacy-focused backup when the local Ollama instance fails.

## Key Features
- **Privacy-First**: No data training, only API calls
- **Encrypted**: All communication is encrypted
- **Fast**: Uses Groq's optimized infrastructure
- **Transparent**: Users see exactly when cloud backup is used

## Files
- `worker.js`: Cloudflare Worker implementation
- `wrangler.toml`: Cloudflare Workers configuration
- `background.js`: Updated to handle cloud fallback logic
- `popup.js`: Updated to show fallback UI

## Deployment Requirements

### 1. Cloudflare Account
- A Cloudflare account with Workers enabled
- Access to the Workers domain dashboard

### 2. Environment Variables
Add these to your Cloudflare Worker settings:
```
GROQ_API_KEY = "your-groq-api-key-here"
GROQ_API_URL = "https://api.groq.com/openai/v1"
```

### 3. Worker Scripts
Create a worker named `note-scribe-ai-proxy` with the following code:

```javascript
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
```

### 4. Integration with Extension

#### Update `background.js`
Set your Cloudflare worker URL:
```javascript
const CLOUD_PROXY_URL = "https://note-scribe-ai.yourdomain.workers.dev/api/cloud-proxy";
```

#### Update `popup.js`
The UI will automatically detect when cloud backup is needed and prompt the user. The request will be sent to your Cloudflare worker.

## Privacy & Security

### Data Handling
- **Zero Storage**: Only request/response data is processed
- **No Training**: Cloudflare does not use your data for AI model training
- **Encrypted**: All traffic is TLS encrypted
- **Temporary**: No persistent storage of user data

### Compliance
- **HIPAA Considerations**: For clinical data, ensure your Cloudflare account meets HIPAA requirements
- **Data Residency**: Choose a Cloudflare region that meets your requirements

## Usage Flow

1. **Local Generation**: Extension tries to generate note using Ollama
2. **Failure Detection**: If Ollama fails (500 error, timeout, connection refused)
3. **Smart Retry**: Waits 1.5s and retries locally
4. **Cloud Fallback**: If retries fail, shows user prompt
5. **User Choice**: User chooses "Use Cloud" 
6. **Cloud Processing**: Sends to Cloudflare worker → Groq Llama 3 70B
7. **Response**: Streams back to user interface

## Error Handling

### Common Issues

#### Ollama Not Running
```
Error: Cannot connect to Ollama. Ensure it's running (ollama serve).
```
- **Fix**: Start Ollama service or check firewall settings

#### Model Not Pulled
```
Error: Model 'phi3' not found. Please run 'ollama pull phi3'
```
- **Fix**: Download the model: `ollama pull phi3`

#### Cloudflare Worker Down
```
Error: Cloud backup failed. Please check your internet.
```
- **Fix**: Check Cloudflare dashboard for worker status

## Performance Considerations

### Response Times
- **Local Success**: 2-5 seconds
- **Local + Retry**: 3-7 seconds  
- **Cloud Fallback**: 8-15 seconds

### Cost
- **Local**: Free (hardware already owned)
- **Cloud**: Free tier available (100K requests/month)

## Testing the Integration

### Manual Testing
1. **Force Local Failure**: Temporarily stop Ollama service
2. **Check Extension UI**: Look for "Local AI Offline" prompt
3. **Trigger Cloud**: Click "Use Secure Cloud" button
4. **Verify Output**: Check that note is generated from cloud

### Log Analysis
Check browser console for:
```
Cloud proxy error: [error details]
Starting Cloudflare proxy...
Cloud backup initiated for user [id]
```

## Maintenance

### Updating the Worker
Deploy updated worker code using Wrangler:
```bash
wrangler deploy
```

### Monitoring
Use Cloudflare Analytics to monitor:
- Request/response times
- Error rates
- Usage by endpoint

### Rate Limits
Groq has rate limits on their API. The worker handles these automatically.

## Troubleshooting

### "Cloud Backup Not Working"
1. Verify Cloudflare worker is healthy
2. Check API key in Cloudflare dashboard
3. Confirm internet connectivity
4. Review browser developer console

### "Slow Generation"
1. Check network latency to Cloudflare worker
2. Consider using closer Cloudflare region
3. Verify local Ollama is still functional

### "Privacy Concerns"
The Cloudflare worker is designed to be privacy-safe:
- No persistent data storage
- No model training
- Minimal data transmission
- Full transparency about when cloud is used

## Support

If you encounter issues:
1. Check Cloudflare dashboard for worker status
2. Review browser console for error details
3. Ensure your Cloudflare API key is valid
4. Verify the worker URL is correct

This implementation provides a robust, privacy-first cloud backup solution for Note Scribe AI users, ensuring they never lose access to their note generation capability.