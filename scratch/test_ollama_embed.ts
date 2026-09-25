async function testEmbed() {
  try {
    const res = await fetch("http://localhost:11434/api/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3-embedding:0.6b",
        input: "Halo dunia riset RepostInsight",
        options: {
          num_gpu: 0,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("HTTP Error:", res.status, text);
      return;
    }

    const data = await res.json();
    console.log("Success!");
    console.log("Model:", data.model);
    console.log("Embeddings count:", data.embeddings?.length);
    console.log("Vector dimension:", data.embeddings?.[0]?.length);
  } catch (err) {
    console.error("Fetch error:", err);
  }
}

testEmbed();
