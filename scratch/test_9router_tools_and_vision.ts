async function testToolsAndVision() {
  const url = "http://127.0.0.1:20128/v1/chat/completions";
  const apiKey = process.env.NINEROUTER_API_KEY || "";

  console.log("=== 1. TEST TOOL CALLING ===");
  const toolPayload = {
    model: "ag/gemini-3-flash",
    stream: false,
    messages: [
      {
        role: "system",
        content: "Anda adalah asisten AI. Jika pengguna meminta data akun terbanyak, panggil tool query_aggregate.",
      },
      {
        role: "user",
        content: "Siapa 5 akun teratas yang paling banyak di-repost?",
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "query_aggregate",
          description: "Mendapatkan agregasi statistik data",
          parameters: {
            type: "object",
            properties: {
              metric: {
                type: "string",
                enum: ["top_accounts", "trending_hashtags", "summary"],
              },
              limit: { type: "number" },
            },
            required: ["metric"],
          },
        },
      },
    ],
    tool_choice: "auto",
  };

  const resTool = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(toolPayload),
  });

  console.log("Tool test status:", resTool.status);
  const toolJson = await resTool.json();
  console.log("Tool test response message:", JSON.stringify(toolJson.choices?.[0]?.message, null, 2));

  console.log("\n=== 2. TEST VISION (BASE64 & IMAGE_URL) ===");
  // 1x1 transparent PNG base64
  const samplePngBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  const visionPayload = {
    model: "ag/gemini-3-flash",
    stream: false,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Apa warna dan detail dari gambar ini? Jawab dalam 1 kalimat singkat." },
          {
            type: "image_url",
            image_url: {
              url: samplePngBase64,
            },
          },
        ],
      },
    ],
  };

  const resVision = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(visionPayload),
  });

  console.log("Vision test status:", resVision.status);
  const visionJson = await resVision.json();
  console.log("Vision response:", JSON.stringify(visionJson.choices?.[0]?.message, null, 2));
}

testToolsAndVision().catch(console.error);
