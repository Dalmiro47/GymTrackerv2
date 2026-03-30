import { NextResponse } from 'next/server';
import { createLLMProvider, type ChatMessage } from '@/lib/ai/llm-provider';
import { buildLogDaySystemPrompt, buildRoutineReviewSystemPrompt } from '@/lib/ai/chat-prompts';
import type { LogDayContext, RoutineReviewContext } from '@/lib/ai/context-builders';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ChatMode = 'log-day' | 'routine-review';

const MAX_HISTORY_MESSAGES = 20;

/**
 * Wraps the raw Groq SSE stream and strips <think>...</think> tokens before forwarding.
 * Re-emits chunks as `data: {"v":"<delta>"}\n\n` — simpler than the full OpenAI format.
 */
function filterThinkingStream(raw: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let sseBuffer = '';
  let contentBuffer = '';
  let thinkDone = false;

  return raw.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        sseBuffer += dec.decode(chunk, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();

          if (data === '[DONE]') {
            controller.enqueue(enc.encode('data: [DONE]\n\n'));
            continue;
          }

          let delta = '';
          try {
            delta = JSON.parse(data).choices?.[0]?.delta?.content ?? '';
          } catch {
            continue;
          }
          if (!delta) continue;

          if (thinkDone) {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ v: delta })}\n\n`));
            continue;
          }

          contentBuffer += delta;

          // No <think> opening after 7 chars → no thinking block, stream directly
          if (contentBuffer.length >= 7 && !contentBuffer.startsWith('<think>')) {
            thinkDone = true;
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ v: contentBuffer })}\n\n`));
            contentBuffer = '';
            continue;
          }

          // Found closing </think> → start streaming the real response
          const endIdx = contentBuffer.indexOf('</think>');
          if (endIdx !== -1) {
            thinkDone = true;
            const rest = contentBuffer.slice(endIdx + 8).replace(/^\n+/, '');
            contentBuffer = '';
            if (rest) controller.enqueue(enc.encode(`data: ${JSON.stringify({ v: rest })}\n\n`));
          }
        }
      },
    }),
  );
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { mode, messages, context } = body as {
      mode: ChatMode;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      context: LogDayContext | RoutineReviewContext;
    };

    if (!mode || !messages?.length || !context) {
      return NextResponse.json(
        { error: 'Faltan campos requeridos (mode, messages, context).' },
        { status: 400 },
      );
    }

    const systemPrompt =
      mode === 'log-day'
        ? buildLogDaySystemPrompt(context as LogDayContext)
        : buildRoutineReviewSystemPrompt(context as RoutineReviewContext);

    const trimmedHistory = messages.slice(-MAX_HISTORY_MESSAGES);
    const fullMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...trimmedHistory.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    const provider = createLLMProvider();
    const rawStream = await provider.chatStream(fullMessages, {
      temperature: 0.4,
      maxTokens: 1500,
    });

    return new Response(filterThinkingStream(rawStream), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error: unknown) {
    console.error('Coach chat error:', error);
    const message = error instanceof Error ? error.message : 'Error interno del servidor.';

    if (message.includes('MISSING_GROQ_API_KEY')) {
      return NextResponse.json(
        { error: 'El servicio de AI no está configurado. Contacta al administrador.' },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: `No se pudo conectar con el coach. ${message}` },
      { status: 500 },
    );
  }
}
