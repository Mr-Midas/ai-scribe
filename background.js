// Keep the Service Worker alive during long generations
let keepAliveInterval;
const CLOUD_PROXY_URL = "https://note-scribe-ai.yourdomain.workers.dev/api/cloud-proxy"; // REPLACE with your actual Cloudflare worker URL

function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 20000);
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

async function handleOllamaStream(request, port, attempt = 1) {
  const OLLAMA_ENDPOINT = "http://localhost:11434/api/generate";
  const MODEL = "phi3";

  try {
    const response = await fetch(OLLAMA_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        system: request.systemPrompt,
        prompt: request.prompt,
        options: { temperature: 0.3, top_p: 0.9, num_predict: 1024 }
      })
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Model '${MODEL}' not found. Please run 'ollama pull ${MODEL}' in your terminal.`);
      }
      if (response.status === 500 && attempt < 2) {
        console.log(`Ollama 500. Retrying attempt ${attempt + 1}...`);
        await new Promise(r => setTimeout(r, 1500));
        return handleOllamaStream(request, port, attempt + 1);
      }
      if (response.status === 500 || response.status === 503) {
        port.postMessage({ type: "REQUEST_CLOUD_FALLBACK", error: "Local AI is temporarily overloaded." });
        return;
      }
      throw new Error(`Ollama Error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const json = JSON.parse(line);
        if (json.response) port.postMessage({ type: "CHUNK", text: json.response });
        if (json.done) port.postMessage({ type: "DONE" });
      }
    }
  } catch (error) {
    if (attempt < 2) {
      return handleOllamaStream(request, port, attempt + 1);
    }
    if (error.message.includes("Failed to fetch")) {
      port.postMessage({ type: "REQUEST_CLOUD_FALLBACK", error: "Cannot connect to Local AI." });
      return;
    }
    port.postMessage({ type: "ERROR", error: error.message });
  } finally {
    stopKeepAlive();
  }
}

async function handleCloudStream(request, port) {
  try {
    const response = await fetch(CLOUD_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemPrompt: request.systemPrompt,
        prompt: request.prompt
      })
    });

    if (!response.ok) {
      throw new Error(`Cloud proxy responded with status ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            port.postMessage({ type: "DONE" });
            continue;
          }
          try {
            const json = JSON.parse(data);
            const content = json.choices[0].delta.content;
            if (content) port.postMessage({ type: "CHUNK", text: content });
          } catch (e) {}
        }
      }
    }
  } catch (error) {
    port.postMessage({ type: "ERROR", error: `Cloud backup failed: ${error.message}` });
  } finally {
    stopKeepAlive();
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ollama-stream") return;

  port.onMessage.addListener(async (request) => {
    startKeepAlive();
    if (request.type === "GENERATE_NOTE") {
      await handleOllamaStream(request, port);
    } else if (request.type === "GENERATE_CLOUD") {
      await handleCloudStream(request, port);
    }
  });
});

