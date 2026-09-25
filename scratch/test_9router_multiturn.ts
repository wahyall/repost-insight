async function testFullToolConversation() {
  const url = "http://127.0.0.1:20128/v1/chat/completions";
  const apiKey = process.env.NINEROUTER_API_KEY || "";

  const tools = [
    {
      type: "function",
      function: {
        name: "query_aggregate",
        description: "Mendapatkan agregasi statistik data repost",
        parameters: {
          type: "object",
          properties: {
            metric: { type: "string", enum: ["top_accounts", "summary"] },
            limit: { type: "number" },
          },
          required: ["metric"],
        },
      },
    },
  ];

  const messages: any[] = [
    {
      role: "system",
      content: "Anda adalah asisten AI RepostInsight. Jawab dalam Bahasa Indonesia.",
    },
    {
      role: "user",
      content: "Siapa 3 akun teratas yang paling sering di-repost?",
    },
  ];

  console.log("Step 1: Mengirim pertanyaan ke model...");
  const res1 = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "ag/gemini-3-flash",
      stream: false,
      messages,
      tools,
      tool_choice: "auto",
    }),
  });

  const data1 = await res1.json();
  const assistantMsg = data1.choices?.[0]?.message;
  console.log("Assistant response Step 1:", JSON.stringify(assistantMsg, null, 2));

  if (!assistantMsg?.tool_calls) {
    console.log("No tool calls made.");
    return;
  }

  // Push assistant tool call message
  messages.push(assistantMsg);

  // Simulate tool execution result
  for (const tc of assistantMsg.tool_calls) {
    const fakeResult = {
      metric: "top_accounts",
      data: [
        { ownerUsername: "kajian_surabaya", repostCount: 45, uniqueFollowers: 30 },
        { ownerUsername: "dakwah_pemuda", repostCount: 38, uniqueFollowers: 25 },
        { ownerUsername: "muslim_daily", repostCount: 29, uniqueFollowers: 20 },
      ],
    };

    messages.push({
      role: "tool",
      tool_call_id: tc.id,
      content: JSON.stringify(fakeResult),
    });
  }

  console.log("\nStep 2: Mengirim hasil tool kembali ke model...");
  const res2 = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "ag/gemini-3-flash",
      stream: false,
      messages,
      tools,
    }),
  });

  const data2 = await res2.json();
  const finalMsg = data2.choices?.[0]?.message;
  console.log("Assistant final response Step 2:\n", finalMsg?.content);
}

testFullToolConversation().catch(console.error);
