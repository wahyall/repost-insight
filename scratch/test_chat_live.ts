import { NextRequest } from "next/server";
import { POST } from "../apps/web/app/api/chat/route";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

async function testLiveChat() {
  console.log("Menguji endpoint POST /api/chat dengan data live...");
  const req = new NextRequest("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "apa repost yang paling banyak dibahas?" }),
  });

  const res = await POST(req);
  const data = await res.json();
  console.log("\nStatus Response:", res.status);
  console.log("Chatbot Reply:\n", data.reply);
  console.log("\nChart to Render:", data.chart ? "Yes" : "None");
  console.log("Tools Executed:", data.toolCalls?.map((t: any) => t.name));
}

testLiveChat().catch(console.error);
