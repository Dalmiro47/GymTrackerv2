'use client';

import { useState, useCallback, useRef } from 'react';
import type { LogDayContext, RoutineReviewContext } from '@/lib/ai/context-builders';

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatMode = 'log-day' | 'routine-review';

const today = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const STORAGE_KEY = (mode: ChatMode) => `coach-chat-${mode}-${today()}`;

function stripThinking(text: string): string {
  let result = text.replace(/<think>[\s\S]*?<\/think>\n?/g, '');
  const openIdx = result.indexOf('<think>');
  if (openIdx !== -1) result = result.slice(0, openIdx);
  return result.trim();
}

/** Extract plain text from a JSON segments string (for conversation history sent to the API). */
function extractTextFromContent(content: string): string {
  try {
    const parsed = JSON.parse(stripThinking(content));
    if (parsed?.segments) {
      return parsed.segments.map((s: { value?: string }) => s.value ?? '').join(' ');
    }
  } catch {
    /* not JSON — pass through */
  }
  return stripThinking(content);
}

function loadFromStorage(mode: ChatMode): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(mode));
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function saveToStorage(mode: ChatMode, messages: ChatMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY(mode), JSON.stringify(messages));
    // Prune keys from previous days to avoid localStorage bloat
    const currentKey = STORAGE_KEY(mode);
    Object.keys(localStorage)
      .filter((k) => k.startsWith(`coach-chat-${mode}-`) && k !== currentKey)
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // localStorage full or unavailable — fail silently
  }
}

export function useCoachChat(mode: ChatMode) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadFromStorage(mode));
  const [isStreaming, setIsStreaming] = useState(false); // now means "waiting for JSON response" (tech debt: rename to isLoading)
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const persistMessages = useCallback(
    (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      setMessages((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        saveToStorage(mode, next);
        return next;
      });
    },
    [mode],
  );

  const sendMessage = useCallback(
    async (userText: string, context: LogDayContext | RoutineReviewContext) => {
      if (!userText.trim() || isStreaming) return;

      setError(null);
      const userMsg: ChatMessage = { role: 'user', content: userText.trim() };
      const updatedMessages = [...messages, userMsg];
      persistMessages(updatedMessages);
      setIsStreaming(true);

      // Abort controller for cancellation
      const abort = new AbortController();
      abortRef.current = abort;

      try {
        // Insert empty assistant bubble immediately so the Loader2 spinner shows during the request
        persistMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

        const res = await fetch('/api/coach/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            messages: updatedMessages.map((m) =>
              m.role === 'assistant'
                ? { ...m, content: extractTextFromContent(m.content) }
                : m
            ),
            context,
          }),
          signal: abort.signal,
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => null);
          throw new Error(errBody?.error || `Error ${res.status}`);
        }

        // Read the SSE stream and append deltas to the assistant bubble
        const reader = res.body!.getReader();
        const dec = new TextDecoder();
        let sseBuffer = '';
        let receivedAny = false;

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += dec.decode(value, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') break outer;

            try {
              const { v } = JSON.parse(raw) as { v?: string };
              if (v) {
                receivedAny = true;
                persistMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, content: last.content + v };
                  }
                  return updated;
                });
              }
            } catch { /* skip malformed */ }
          }
        }

        if (!receivedAny) {
          persistMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: 'assistant',
              content: 'No se recibio respuesta del coach. Intenta de nuevo.',
            };
            return updated;
          });
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // On abort: remove the empty bubble
          persistMessages((prev) =>
            prev[prev.length - 1]?.role === 'assistant' && !prev[prev.length - 1].content
              ? prev.slice(0, -1)
              : prev,
          );
          return;
        }
        const msg = err instanceof Error ? err.message : 'Error desconocido.';
        setError(msg);
        // Remove the empty bubble on error
        persistMessages((prev) =>
          prev[prev.length - 1]?.role === 'assistant' && !prev[prev.length - 1].content
            ? prev.slice(0, -1)
            : prev,
        );
      } finally {
        // Always reset loading state — without this the UI stays permanently disabled
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, isStreaming, mode, persistMessages],
  );

  const clearChat = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    persistMessages([]);
    setError(null);
    setIsStreaming(false);
  }, [persistMessages]);

  const stopStreaming = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setIsStreaming(false);
  }, []);

  return { messages, isStreaming, error, sendMessage, clearChat, stopStreaming };
}
