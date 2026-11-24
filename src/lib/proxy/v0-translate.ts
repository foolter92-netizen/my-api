/**
 * Protocol translation between OpenAI Chat Completions and the official
 * v0.dev Platform API (https://api.v0.dev).
 *
 * The v0 API is NOT OpenAI-compatible:
 *   POST /v1/chats   { "message": "<one prompt>", "modelConfiguration": { "modelId": "creator/model" } }
 *   → 200 { id, object: "chat", messages: [{ role, content }, ...], text, ... }
 *
 * Key facts verified against the live API (2026-11-24):
 *   - Auth: Authorization: Bearer v1:team_...:vcp_...
 *   - modelId MUST use "creator/model" format (e.g. "v0/v0-1.5-md",
 *     "openai/gpt-4o-mini") — bare IDs like "v0-1.5-md" return 422.
 *   - The POST is SYNCHRONOUS: the response already contains the final
 *     assistant message (native v0 model ~25s, LLM models ~8s).
 *   - "stream": true is NOT supported (HTTP 500) — when the client asks for
 *     streaming we emit a synthetic single-chunk OpenAI SSE stream instead.
 *   - No token usage is returned; usage is reported as zeros.
 */

interface OpenAIMessage {
  role: string;
  content?: unknown;
}

interface OpenAIChatBody {
  model?: string;
  messages?: OpenAIMessage[];
  stream?: boolean;
  [key: string]: unknown;
}

interface V0RequestBody {
  message: string;
  modelConfiguration?: { modelId: string; imageGenerations?: boolean; thinking?: boolean };
  [key: string]: unknown;
}

/** Client-facing aliases → real upstream "creator/model" IDs. */
const V0_MODEL_ALIASES: Record<string, string> = {
  "v0": "v0/v0-1.5-md",
  "v0-mini": "v0/v0-1.5-md",
  "v0-md": "v0/v0-1.5-md",
  "v0-lg": "v0/v0-1.5-lg",
};

/**
 * Resolve the gateway model name to an upstream v0 modelId.
 * - "creator/model" names are passed through untouched.
 * - Known aliases (v0-mini, ...) map to native v0 models.
 * - Unknown names → null → request omits modelConfiguration entirely and v0
 *   uses its own default model.
 */
export function resolveV0ModelId(model?: string | null): string | null {
  if (!model || typeof model !== "string") return null;
  const trimmed = model.trim();
  if (trimmed.includes("/")) return trimmed;
  return V0_MODEL_ALIASES[trimmed.toLowerCase()] ?? null;
}

/** Extract plain text from an OpenAI message content (string or parts array). */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text);
        }
        return "";
      })
      .join("");
  }
  return "";
}

/**
 * Flatten an OpenAI messages array into the single prompt string the v0 chat
 * API expects. Multi-turn context is preserved as a labelled transcript so
 * stateless gateway calls keep conversation coherence.
 */
function flattenMessages(messages: OpenAIMessage[] | undefined): string {
  const chat = (messages ?? []).filter((m) => m.role !== "system" || extractText(m.content).trim());
  // Fast path: a single user message (the overwhelmingly common case) → send it verbatim.
  const nonSystem = chat.filter((m) => m.role !== "system");
  if (nonSystem.length === 1 && nonSystem[0].role === "user" && !chat.some((m) => m.role === "system")) {
    return extractText(nonSystem[0].content).trim();
  }

  const parts: string[] = [];
  for (const m of chat) {
    const text = extractText(m.content).trim();
    if (!text) continue;
    const label =
      m.role === "system" ? "[System instructions]" :
      m.role === "assistant" ? "[Assistant]" :
      "[User]";
    parts.push(`${label}:\n${text}`);
  }
  return parts.join("\n\n");
}

/** Convert an OpenAI Chat Completions request body to a v0 POST /v1/chats body. */
export function openaiToV0Request(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const src = body as OpenAIChatBody;

  const out: V0RequestBody = {
    message: flattenMessages(src.messages),
  };

  const modelId = resolveV0ModelId(src.model);
  if (modelId) {
    out.modelConfiguration = { modelId };
  }

  return out;
}

/** Pull the assistant's reply out of a v0 chat response object. */
function extractV0AssistantText(src: Record<string, unknown>): string {
  const messages = Array.isArray(src.messages) ? (src.messages as Array<Record<string, unknown>>) : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "assistant") {
      const text = extractText(m.content).trim();
      if (text) return text;
    }
  }
  return typeof src.text === "string" ? src.text : "";
}

/** Convert a v0 chat response to OpenAI Chat Completions format. */
export function v0ToOpenAIResponse(body: unknown, requestModel?: string | null): unknown {
  if (!body || typeof body !== "object") {
    return {
      id: `chatcmpl-v0-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: requestModel ?? "v0",
      choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }
  const src = body as Record<string, unknown>;
  const text = extractV0AssistantText(src);
  const upstreamId = typeof src.id === "string" ? src.id : "v0";

  return {
    id: `chatcmpl-${upstreamId}`,
    object: "chat.completion",
    created: Math.floor(Date.parse(String(src.updatedAt ?? src.createdAt ?? "")) / 1000) || Math.floor(Date.now() / 1000),
    model: requestModel ?? "v0",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/**
 * v0 has no SSE streaming, so when the client requests stream=true we
 * synthesize a minimal valid OpenAI SSE stream: role chunk → full content
 * chunk → finish chunk → [DONE]. OpenAI SDKs and most clients accept this.
 */
export function v0ToOpenAIStreamBody(text: string, requestModel?: string | null): string {
  const base = {
    id: `chatcmpl-v0-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: requestModel ?? "v0",
  };
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

  return (
    chunk({ role: "assistant", content: "" }, null) +
    chunk({ content: text }, null) +
    chunk({}, "stop") +
    "data: [DONE]\n\n"
  );
}
