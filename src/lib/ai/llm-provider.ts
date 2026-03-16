// ─── LLM Provider Abstraction ───────────────────────────────────────
// Vendor-agnostic interface for chat completions.
// Currently implements Groq (OpenAI-compatible REST API).

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LLMResponse = {
  content: string;
  model: string;
};

export interface LLMProvider {
  /** One-shot chat completion (full response). */
  chat(
    messages: ChatMessage[],
    opts?: { temperature?: number; maxTokens?: number; jsonMode?: boolean },
  ): Promise<LLMResponse>;

  /** Streaming chat completion. Returns an SSE ReadableStream suitable for Response(). */
  chatStream(
    messages: ChatMessage[],
    opts?: { temperature?: number; maxTokens?: number },
  ): Promise<ReadableStream<Uint8Array>>;
}

// ─── Groq Implementation ────────────────────────────────────────────

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

export class GroqProvider implements LLMProvider {
  private apiKey: string;
  private model: string;

  constructor(opts: { apiKey: string; model?: string }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
  }

  async chat(
    messages: ChatMessage[],
    opts?: { temperature?: number; maxTokens?: number; jsonMode?: boolean },
  ): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: opts?.temperature ?? 0.3,
      max_completion_tokens: opts?.maxTokens ?? 1024,
      stream: false,
    };

    if (opts?.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(GROQ_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GROQ_HTTP_${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];

    if (!choice?.message?.content) {
      throw new Error('GROQ_EMPTY_RESPONSE');
    }

    return {
      content: choice.message.content,
      model: data.model ?? this.model,
    };
  }

  async chatStream(
    messages: ChatMessage[],
    opts?: { temperature?: number; maxTokens?: number },
  ): Promise<ReadableStream<Uint8Array>> {
    const body = {
      model: this.model,
      messages,
      temperature: opts?.temperature ?? 0.4,
      max_completion_tokens: opts?.maxTokens ?? 1024,
      stream: true,
    };

    const res = await fetch(GROQ_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GROQ_HTTP_${res.status}: ${text.slice(0, 300)}`);
    }

    if (!res.body) {
      throw new Error('GROQ_NO_STREAM_BODY');
    }

    // Return the raw SSE stream from Groq — it's already in OpenAI SSE format.
    // The client will parse `data: {...}` lines.
    return res.body;
  }
}

// ─── Factory ────────────────────────────────────────────────────────

export function createLLMProvider(): LLMProvider {
  const apiKey = process.env.GROQ_API_KEY ?? '';
  if (!apiKey) {
    throw new Error('MISSING_GROQ_API_KEY: Set GROQ_API_KEY in your environment variables.');
  }
  return new GroqProvider({ apiKey });
}
