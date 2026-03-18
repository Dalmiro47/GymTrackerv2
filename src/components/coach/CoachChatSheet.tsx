'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkles, Send, Trash2, Square, Loader2, X } from 'lucide-react';
import { useCoachChat, type ChatMessage } from '@/hooks/use-coach-chat';
import type { LogDayContext, RoutineReviewContext } from '@/lib/ai/context-builders';

type ChatMode = 'log-day' | 'routine-review';

type CoachChatSheetProps = {
  mode: ChatMode;
  /** Static context (log-day) or null if using loadContext */
  context?: LogDayContext | RoutineReviewContext | null;
  /** Lazy context loader (routine-review) */
  loadContext?: () => Promise<RoutineReviewContext>;
};

const MODE_CONFIG = {
  'log-day': {
    title: 'Coach de Entrenamiento',
    description: 'Pregunta sobre tu entrenamiento de hoy',
    placeholder: 'Ej: "Como voy con el press banca?" o "Que peso deberia usar?"',
    emptyText: 'Preguntale al coach sobre tu entrenamiento de hoy',
  },
  'routine-review': {
    title: 'Coach de Programacion',
    description: 'Analisis de tu programa de entrenamiento',
    placeholder: 'Ej: "Como puedo mejorar mi rutina?" o "Tengo algun desbalance muscular?"',
    emptyText: 'Preguntale al coach sobre tu programacion y rutinas',
  },
};

export function CoachChatSheet({ mode, context, loadContext }: CoachChatSheetProps) {
  const [open, setOpen] = useState(false);
  const [resolvedContext, setResolvedContext] = useState<LogDayContext | RoutineReviewContext | null>(
    context ?? null,
  );
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [input, setInput] = useState('');
  const { messages, isStreaming, error, sendMessage, clearChat, stopStreaming } = useCoachChat(mode);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const config = MODE_CONFIG[mode];

  // Update resolved context when prop changes
  useEffect(() => {
    if (context) setResolvedContext(context);
  }, [context]);

  // Lazy-load context when chat opens
  useEffect(() => {
    if (open && !resolvedContext && loadContext) {
      setIsLoadingContext(true);
      loadContext()
        .then((ctx) => setResolvedContext(ctx))
        .catch((err) => console.error('Failed to load coach context:', err))
        .finally(() => setIsLoadingContext(false));
    }
  }, [open, resolvedContext, loadContext]);

  // Auto-scroll to bottom on new messages or when panel opens
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [messages, open]);

  // Lock body scroll when chat is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Focus textarea when chat opens
  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open]);

  const handleSend = useCallback(() => {
    if (!input.trim() || !resolvedContext || isStreaming) return;
    sendMessage(input, resolvedContext);
    setInput('');
  }, [input, resolvedContext, isStreaming, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleClear = useCallback(() => {
    clearChat();
    setInput('');
  }, [clearChat]);

  const noContext = !resolvedContext && !isLoadingContext;

  return (
    <>
      {/* Floating trigger button — bottom-28 on mobile to clear the log page action bar + safe area */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-28 right-4 md:bottom-6 md:right-6 z-50 flex items-center gap-2 bg-foreground text-background px-4 py-2.5 rounded-full shadow-lg hover:opacity-90 transition-opacity font-medium text-sm"
      >
        <Sparkles className="h-4 w-4" />
        AI Coach
      </button>

      {open && (
        <>
          {/* Backdrop — covers page content including mobile action bar (z-40), blurs background */}
          <div
            className="fixed inset-0 z-[49] bg-black/30 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Floating chat window */}
          <div
            className="fixed bottom-44 right-4 md:bottom-20 md:right-6 z-50 flex flex-col rounded-2xl border bg-background shadow-2xl"
            style={{ width: 'min(360px, calc(100vw - 2rem))', height: 'min(520px, calc(100dvh - 12rem))' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-semibold leading-tight">{config.title}</p>
                  <p className="text-xs text-muted-foreground">{config.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <Button variant="ghost" size="icon" onClick={handleClear} className="h-8 w-8">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={() => setOpen(false)} className="h-8 w-8">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 px-4">
              <div className="space-y-4 py-4">
                {isLoadingContext && (
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-2/3" />
                    <p className="text-xs text-muted-foreground text-center mt-2">
                      Cargando datos de entrenamiento...
                    </p>
                  </div>
                )}

                {!isLoadingContext && messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Sparkles className="h-10 w-10 text-muted-foreground/40 mb-3" />
                    <p className="text-sm text-muted-foreground">{config.emptyText}</p>
                    {noContext && (
                      <p className="text-xs text-muted-foreground/60 mt-2">
                        No hay datos disponibles para el coach.
                      </p>
                    )}
                  </div>
                )}

                {messages.map((msg, i) => (
                  <MessageBubble key={i} message={msg} isLast={i === messages.length - 1} isStreaming={isStreaming} />
                ))}

                {/* Sentinel — must be last child; scrollIntoView targets this */}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            {/* Error */}
            {error && (
              <div className="px-4 pb-2">
                <Alert variant="destructive">
                  <AlertDescription className="text-xs">{error}</AlertDescription>
                </Alert>
              </div>
            )}

            {/* Input */}
            <div className="border-t px-4 py-3">
              <div className="flex gap-2 items-end">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={config.placeholder}
                  disabled={isStreaming || noContext || isLoadingContext}
                  className="min-h-[80px] max-h-[160px] resize-none text-sm"
                  rows={3}
                />
                {isStreaming ? (
                  <Button size="icon" variant="outline" onClick={stopStreaming} className="shrink-0">
                    <Square className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    onClick={handleSend}
                    disabled={!input.trim() || noContext || isLoadingContext}
                    className="shrink-0"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ─── Message Bubble ──────────────────────────────────────────────────

function MessageBubble({
  message,
  isLast,
  isStreaming,
}: {
  message: ChatMessage;
  isLast: boolean;
  isStreaming: boolean;
}) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
        }`}
      >
        {!isUser && !message.content && isLast && isStreaming && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
        {isUser ? (
          <span className="whitespace-pre-wrap">{message.content}</span>
        ) : (
          <SegmentRenderer content={message.content} />
        )}
      </div>
    </div>
  );
}

// ─── Segment Renderer ────────────────────────────────────────────────

type Segment = { type: 'text' | 'exercise' | 'heading'; value: string };

function sanitizeFallback(text: string): string {
  // Strip <think>...</think> blocks defensively (in case model emits them in fallback path)
  let result = text.replace(/<think>[\s\S]*?<\/think>\n?/g, '');
  const openIdx = result.indexOf('<think>');
  if (openIdx !== -1) result = result.slice(0, openIdx);

  return result
    .split('\n')
    .filter((line) => line.trim() !== '---')
    // Convert ### headings to plain text (renderMarkdown handles heading style via bold)
    .map((line) => line.replace(/^###\s+/, ''))
    .join('\n');
}

function SegmentRenderer({ content }: { content: string }) {
  try {
    const parsed = JSON.parse(content) as { segments?: Segment[] };
    if (parsed?.segments?.length) {
      return (
        <div className="space-y-1">
          {parsed.segments.map((seg, i) => {
            if (seg.type === 'heading') {
              return (
                <p key={i} className="font-semibold text-sm mt-2 pb-0.5 border-b border-primary/30 text-foreground">
                  {seg.value}
                </p>
              );
            }
            if (seg.type === 'exercise') {
              return (
                <span key={i} className="italic text-primary font-medium block">
                  {seg.value}
                </span>
              );
            }
            // "text"
            return (
              <span key={i} className="block leading-snug">
                {seg.value}
              </span>
            );
          })}
        </div>
      );
    }
  } catch {
    /* not valid JSON — fall through to markdown */
  }
  // Fallback: sanitize then render as markdown
  return <div className="prose-sm space-y-1">{renderMarkdown(sanitizeFallback(content))}</div>;
}

// ─── Lightweight Markdown Renderer ──────────────────────────────────

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        return part;
      })}
    </>
  );
}

function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];

  const flushList = (key: number) => {
    if (listItems.length > 0) {
      result.push(
        <ul key={`list-${key}`} className="list-disc list-inside space-y-0.5 my-1">
          {listItems}
        </ul>,
      );
      listItems = [];
    }
  };

  lines.forEach((line, i) => {
    const bulletMatch = line.match(/^[\*\-] (.+)/);
    if (bulletMatch) {
      listItems.push(<li key={i}>{renderInline(bulletMatch[1])}</li>);
    } else {
      flushList(i);
      if (line === '') {
        result.push(<br key={i} />);
      } else {
        result.push(<span key={i} className="block">{renderInline(line)}</span>);
      }
    }
  });

  flushList(lines.length);
  return <>{result}</>;
}
