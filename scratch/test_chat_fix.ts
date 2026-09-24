import { executeQueryAggregate, executeSemanticSearch, executeRenderChart } from "../apps/web/lib/tools";

interface ExtractedToolCall {
  id: string;
  name: string;
  args: any;
}

function extractToolCalls(assistantMessage: any): ExtractedToolCall[] {
  const calls: ExtractedToolCall[] = [];

  // 1. Native OpenAI tool calls
  if (assistantMessage?.tool_calls && Array.isArray(assistantMessage.tool_calls)) {
    for (const c of assistantMessage.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(c.function?.arguments || "{}");
      } catch {
        args = {};
      }
      calls.push({
        id: c.id || `call_${Date.now()}`,
        name: c.function?.name,
        args,
      });
    }
  }

  // 2. Text-based tool calls in content (e.g. Cohere or Qwen XML <tool_call>)
  const content = assistantMessage?.content || "";
  if (typeof content === "string" && content.includes("<tool_call>")) {
    const regex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
    let m;
    while ((m = regex.exec(content)) !== null) {
      const raw = m[1].trim();
      // Check if raw is JSON
      if (raw.startsWith("{") && raw.endsWith("}")) {
        try {
          const parsed = JSON.parse(raw);
          const name = parsed.name || parsed.tool || parsed.function;
          const args = parsed.arguments || parsed.args || parsed;
          if (name) {
            calls.push({
              id: `text_call_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              name,
              args: typeof args === "object" ? args : {},
            });
            continue;
          }
        } catch {}
      }

      // Check Cohere format:
      // function_name
      // <arg_key>...</arg_key><arg_value>...</arg_value>
      const fnMatch = raw.match(/^([a-zA-Z0-9_-]+)/);
      const fnName = fnMatch ? fnMatch[1] : "";
      const args: Record<string, any> = {};
      const pairRegex = /<arg_key>([\s\S]*?)<\/arg_key>[\s\S]*?<arg_value>([\s\S]*?)<\/arg_value>/gi;
      let pm;
      while ((pm = pairRegex.exec(raw)) !== null) {
        const k = pm[1].trim();
        let v: any = pm[2].trim();
        if (v === "true") v = true;
        else if (v === "false") v = false;
        else if (!isNaN(Number(v)) && v !== "") v = Number(v);
        else {
          try {
            v = JSON.parse(v);
          } catch {}
        }
        args[k] = v;
      }

      if (fnName) {
        calls.push({
          id: `text_call_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          name: fnName,
          args,
        });
      }
    }
  }

  return calls;
}

function cleanAssistantReply(text: string): string {
  if (!text) return "";
  let cleaned = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "").trim();
  cleaned = cleaned.replace(/<\/?(tool_call|arg_key|arg_value)>/gi, "").trim();
  return cleaned;
}

async function test() {
  const sampleMessageFromUserScreenshot = {
    role: "assistant",
    content: "<tool_call>query_aggregate\n<arg_key>metric</arg_key>\n<arg_value>summary</arg_value>\n</tool_call>",
  };

  const extracted = extractToolCalls(sampleMessageFromUserScreenshot);
  console.log("Extracted Tool Calls from Screenshot:", extracted);

  if (extracted.length > 0) {
    const res = await executeQueryAggregate(extracted[0].args.metric);
    console.log("Tool execution result:", res);
  }

  console.log("Cleaned text:", cleanAssistantReply(sampleMessageFromUserScreenshot.content));
}

test().catch(console.error);
