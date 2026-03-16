import { NextResponse } from 'next/server';
import { createLLMProvider, type ChatMessage } from '@/lib/ai/llm-provider';
import { buildLogDaySystemPrompt, buildRoutineReviewSystemPrompt } from '@/lib/ai/chat-prompts';
import type { LogDayContext, RoutineReviewContext } from '@/lib/ai/context-builders';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ChatMode = 'log-day' | 'routine-review';

const MAX_HISTORY_MESSAGES = 20;

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

    // Build system prompt based on mode
    const systemPrompt =
      mode === 'log-day'
        ? buildLogDaySystemPrompt(context as LogDayContext)
        : buildRoutineReviewSystemPrompt(context as RoutineReviewContext);

    // Assemble messages: system + conversation history (capped)
    const trimmedHistory = messages.slice(-MAX_HISTORY_MESSAGES);
    const fullMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...trimmedHistory.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    // Stream response
    const provider = createLLMProvider();
    const stream = await provider.chatStream(fullMessages, {
      temperature: 0.4,
      maxTokens: 1024,
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error: unknown) {
    console.error('Coach chat error:', error);
    const message = error instanceof Error ? error.message : 'Error interno del servidor.';

    // If it's a missing API key, return 503
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
