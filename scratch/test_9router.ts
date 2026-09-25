async function main() {
  const url = "http://127.0.0.1:20128/v1/chat/completions";
  const apiKey = process.env.NINEROUTER_API_KEY || "";

  console.log("Testing stream: false with 9router...");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "ag/gemini-3-flash",
      messages: [
        { role: "user", content: "Halo, jawab hanya kata 'Online' tanpa format lain." }
      ],
      stream: false,
    }),
  });

  console.log("Status:", res.status);
  const json = await res.json();
  console.log("Response JSON:", JSON.stringify(json, null, 2));
}

main().catch(console.error);
