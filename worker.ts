{
  "packages": [],
  "scripts": {
    "deploy": "wrangler deploy"
  },
  "compatibility_date": "2024-09-23"
}

[
  {"package": "@cloudflare/workers-rs", "version": "~3.0.0"}
]

%%{
  "bindings": [
    { "name": "GROQ_API_KEY", "type": "secret_text" },
    { "name": "GROQ_API_URL", "type": "plain_text", "value": "https://api.groq.com/openai/v1" }
  ]
}

add_event_listener!("fetch", |evt: FetchEvent| {
    let mut req = evt.request.clone();
    let api_key = CLOUDFLARE_ENV.GROQ_API_KEY;
    let api_url = CLOUDFLARE_ENV.GROQ_API_URL;

    // Set up headers for Groq API
    let mut headers = Headers::new();
    headers.set("Authorization", format!("Bearer {}", api_key));
    headers.set("Content-Type", "application/json");

    // Forward request body to Groq API
    let forward_req = Request::new(req.url(), req.init()?);
    forward_req.headers().set_raw("host", req.headers().get("host").unwrap_or_default());
    forward_req.headers().set_raw("user-agent", req.headers().get("user-agent").unwrap_or_default());
    forward_req.headers().set_raw("accept", req.headers().get("accept").unwrap_or_default());

    // Create request body for Groq
    let body = serde_json::json!({
        "model": "llama3-70b-8192",
        "messages": [{
            "role": "system",
            "content": req.headers().get_one("X-System-Prompt").unwrap_or_default()
        }, {
            "role": "user", 
            "content": req.headers().get_one("X-Prompt").unwrap_or_default()
        }],
        "stream": true,
        "temperature": 0.3
    });

    let mut forward_req = ForwardRequest::new(api_url, body)?;
    forward_req.headers_mut().set("Authorization", format!("Bearer {}", api_key));
    forward_req.headers_mut().set("Content-Type", "application/json");

    // Create response promise
    evt.respond_with(async move || {
        let response = forward_req.send().await?;
        
        // Create a transform stream to forward the response
        let stream = response.into_body().stream_to_stream()?;
        
        Ok(Response::new(stream))
    })?;
});
