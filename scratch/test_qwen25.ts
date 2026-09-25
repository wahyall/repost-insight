import { CHATBOT_TOOLS } from "../apps/web/lib/tools";

async function testChat() {
  console.log("=== TEST QWEN2.5:3B DI OLLAMA LOCAL ===");
  const baseUrl = "http://localhost:11434";
  const model = "qwen2.5:3b";

  // 1. Uji Text Chat Completion
  console.log("\n[Test 1] Uji Chat Completion biasa...");
  const chatRes = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "Anda adalah asisten cerdas riset RepostInsight dalam Bahasa Indonesia.",
        },
        {
          role: "user",
          content: "Halo! Jelaskan secara singkat dalam 1 kalimat apa fungsi dari RepostInsight.",
        },
      ],
      max_tokens: 60,
      options: { num_gpu: 0 },
    }),
  });

  if (!chatRes.ok) {
    const err = await chatRes.text();
    throw new Error(`Chat error [${chatRes.status}]: ${err}`);
  }

  const chatJson = await chatRes.json();
  const reply = chatJson.choices?.[0]?.message?.content;
  console.log("Respon Chat:", reply);

  // 2. Uji Tool Calling
  console.log("\n[Test 2] Uji Tool Calling (Function Calling)...");
  const toolRes = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: "Tolong carikan postingan tentang kajian sabar di Surabaya.",
        },
      ],
      tools: CHATBOT_TOOLS,
      tool_choice: "auto",
      max_tokens: 150,
      options: { num_gpu: 0 },
    }),
  });

  if (!toolRes.ok) {
    const err = await toolRes.text();
    throw new Error(`Tool call error [${toolRes.status}]: ${err}`);
  }

  const toolJson = await toolRes.json();
  const toolMessage = toolJson.choices?.[0]?.message;
  console.log("Tool Calls Message:", JSON.stringify(toolMessage, null, 2));

  console.log("\nSemua pengujian Qwen3-VL 4B selesai!");
}

testChat().catch((err) => {
  console.error("GAGAL:", err);
  process.exit(1);
});
