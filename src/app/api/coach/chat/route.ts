import { NextResponse } from 'next/server';
import { createLLMProvider, type ChatMessage } from '@/lib/ai/llm-provider';
import { buildLogDaySystemPrompt, buildRoutineReviewSystemPrompt, buildDashboardSystemPrompt } from '@/lib/ai/chat-prompts';
import type { LogDayContext, RoutineReviewContext, DashboardContext } from '@/lib/ai/context-builders';
import { isLanguage, type Language } from '@/i18n';
import { isAdminUid } from '@/lib/adminConfig';
import { DAILY_LIMIT_COACH_CALLS } from '@/lib/limits';
import { bumpCoachCall, getCoachCallsUsedToday } from '@/lib/usageQuota';
import { verifyFirebaseIdToken } from '@/lib/verifyIdToken';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ChatMode = 'log-day' | 'routine-review' | 'dashboard';

const MAX_HISTORY_MESSAGES = 20;

/**
 * Error responses carry a stable `code` the client maps to a message in the
 * user's language (see use-coach-chat.ts); `error` is a readable fallback.
 */
type CoachErrorCode =
  | 'unauthenticated'
  | 'bad_request'
  | 'not_configured'
  | 'busy'
  | 'unreachable'
  | 'limit_reached';

function errorResponse(code: CoachErrorCode, error: string, status: number) {
  return NextResponse.json({ code, error }, { status });
}

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
      flush(controller) {
        // Stream ended while still buffering: a reply shorter than 7 chars never
        // hit the "no <think> opening" branch — deliver it instead of dropping it.
        // (A buffer that starts with an unclosed <think> is thinking-only; skip.)
        if (!thinkDone && contentBuffer && !contentBuffer.startsWith('<think>')) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ v: contentBuffer })}\n\n`));
        }
      },
    }),
  );
}

export async function POST(req: Request) {
  try {
    const uid = await verifyFirebaseIdToken(req);
    if (!uid) {
      return errorResponse('unauthenticated', 'Not signed in. Sign in to talk to the coach.', 401);
    }

    // Daily quota. The admin account is exempt; when the service account is not
    // configured `getCoachCallsUsedToday` returns 0 and the limit is inert (a
    // loud warning is logged at import time) rather than blocking the coach.
    const unlimited = isAdminUid(uid);
    if (!unlimited) {
      const usedToday = await getCoachCallsUsedToday(uid);
      if (usedToday >= DAILY_LIMIT_COACH_CALLS) {
        return errorResponse(
          'limit_reached',
          `Daily AI limit reached (${DAILY_LIMIT_COACH_CALLS}/day). Come back tomorrow!`,
          429,
        );
      }
    }

    const body = await req.json();
    const { mode, messages, context, language: rawLanguage } = body as {
      mode: ChatMode;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      context: LogDayContext | RoutineReviewContext | DashboardContext;
      /** The user's profile language; the coach always replies in it. */
      language?: unknown;
    };

    if (!mode || !messages?.length || !context) {
      return errorResponse('bad_request', 'Missing required fields (mode, messages, context).', 400);
    }

    const language: Language = isLanguage(rawLanguage) ? rawLanguage : 'en';

    const systemPrompt =
      mode === 'log-day'
        ? buildLogDaySystemPrompt(context as LogDayContext, language)
        : mode === 'dashboard'
          ? buildDashboardSystemPrompt(context as DashboardContext, language)
          : buildRoutineReviewSystemPrompt(context as RoutineReviewContext, language);

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

    // Counted only once the provider has accepted the request, so a Groq outage
    // (which throws above) never costs the user one of their three calls.
    if (!unlimited) {
      try {
        await bumpCoachCall(uid);
      } catch (error) {
        // Never fail the reply over bookkeeping — worst case the user gets a
        // free call and the server log says why.
        console.error('[coach] failed to record usage:', error);
      }
    }

    return new Response(filterThinkingStream(rawStream), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error: unknown) {
    console.error('Coach chat error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error.';

    if (message.includes('MISSING_GROQ_API_KEY')) {
      return errorResponse('not_configured', "The AI service isn't configured. Contact the administrator.", 503);
    }

    // Upstream detail stays in the server log above — never forward raw provider text to the client.
    if (message.includes('GROQ_HTTP_429')) {
      return errorResponse('busy', 'The coach is busy, try again in a moment.', 429);
    }

    return errorResponse('unreachable', "Couldn't reach the coach.", 500);
  }
}
