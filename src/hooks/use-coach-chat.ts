'use client';

import { useState, useCallback, useRef } from 'react';
import type { LogDayContext, RoutineReviewContext } from '@/lib/ai/context-builders';

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatMode = 'log-day' | 'routine-review';

const SESSION_KEY = (mode: ChatMode) => `coach-chat-${mode}`;

function loadFromSession(mode: ChatMode): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY(mode));
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function saveToSession(mode: ChatMode, messages: ChatMessage[]) {
  try {
    sessionStorage.setItem(SESSION_KEY(mode), JSON.stringify(messages));
  } catch {
    // sessionStorage full or unavailable — fail silently
  }
}

export function useCoachChat(mode: ChatMode) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadFromSession(mode));
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const persistMessages = useCallback(
    (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      setMessages((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        saveToSession(mode, next);
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
        const res = await fetch('/api/coach/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, messages: updatedMessages, context }),
          signal: abort.signal,
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => null);
          throw new Error(errBody?.error || `Error ${res.status}`);
        }

        if (!res.body) throw new Error('No response stream');

        // Read SSE stream
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let assistantContent = '';
        let buffer = '';

        // Add empty assistant message that we'll fill progressively
        persistMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process SSE lines
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;
            if (!trimmed.startsWith('data: ')) continue;

            try {
              const json = JSON.parse(trimmed.slice(6));
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                assistantContent += delta;
                persistMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: 'assistant',
                    content: assistantContent,
                  };
                  return updated;
                });
              }
            } catch {
              // Skip malformed SSE lines
            }
          }
        }

        // If no content was received, show a fallback
        if (!assistantContent) {
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
        if (err instanceof DOMException && err.name === 'AbortError') return;

        const msg = err instanceof Error ? err.message : 'Error desconocido.';
        setError(msg);
        // Remove the empty assistant message if it was added
        persistMessages((prev) => {
          if (prev.length > 0 && prev[prev.length - 1].role === 'assistant' && !prev[prev.length - 1].content) {
            return prev.slice(0, -1);
          }
          return prev;
        });
      } finally {
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
