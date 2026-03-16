'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkles, Send, Trash2, Square, Loader2 } from 'lucide-react';
import { useCoachChat, type ChatMessage } from '@/hooks/use-coach-chat';
import type { LogDayContext, RoutineReviewContext } from '@/lib/ai/context-builders';

type ChatMode = 'log-day' | 'routine-review';

type CoachChatSheetProps = {
  mode: ChatMode;
  /** Static context (log-day) or null if using loadContext */
  context?: LogDayContext | RoutineReviewContext | null;
  /** Lazy context loader (routine-review) */
  loadContext?: () => Promise<RoutineReviewContext>;
  trigger?: React.ReactNode;
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

export function CoachChatSheet({ mode, context, loadContext, trigger }: CoachChatSheetProps) {
  const [open, setOpen] = useState(false);
  const [resolvedContext, setResolvedContext] = useState<LogDayContext | RoutineReviewContext | null>(
    context ?? null,
  );
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [input, setInput] = useState('');
  const { messages, isStreaming, error, sendMessage, clearChat, stopStreaming } = useCoachChat(mode);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const config = MODE_CONFIG[mode];

  // Update resolved context when prop changes
  useEffect(() => {
    if (context) setResolvedContext(context);
  }, [context]);

  // Lazy-load context when sheet opens
  useEffect(() => {
    if (open && !resolvedContext && loadContext) {
      setIsLoadingContext(true);
      loadContext()
        .then((ctx) => setResolvedContext(ctx))
        .catch((err) => console.error('Failed to load coach context:', err))
        .finally(() => setIsLoadingContext(false));
    }
  }, [open, resolvedContext, loadContext]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus textarea when sheet opens
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
    <Sheet open={open} onOpenChange={setOpen}>
      {trigger ? (
        <div onClick={() => setOpen(true)} className="cursor-pointer">
          {trigger}
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Sparkles className="mr-2 h-4 w-4" />
          AI Coach
        </Button>
      )}

      <SheetContent side="right" className="flex flex-col w-full sm:max-w-md p-0">
        {/* Header */}
        <SheetHeader className="px-4 pt-4 pb-2 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <SheetTitle className="text-base">{config.title}</SheetTitle>
            </div>
            {messages.length > 0 && (
              <Button variant="ghost" size="icon" onClick={handleClear} className="h-8 w-8">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <SheetDescription className="text-xs">{config.description}</SheetDescription>
        </SheetHeader>

        {/* Messages */}
        <ScrollArea className="flex-1 px-4" ref={scrollRef}>
          <div className="py-4 space-y-4">
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
              className="min-h-[40px] max-h-[120px] resize-none text-sm"
              rows={1}
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
      </SheetContent>
    </Sheet>
  );
}

// ─── Message Bubble ─────────────────────────────────────────────────

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
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground'
        }`}
      >
        {!isUser && !message.content && isLast && isStreaming && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
        {message.content}
        {!isUser && isLast && isStreaming && message.content && (
          <span className="inline-block w-1 h-4 bg-foreground/60 animate-pulse ml-0.5 align-text-bottom" />
        )}
      </div>
    </div>
  );
}
