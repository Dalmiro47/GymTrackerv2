'use client';

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkles, Send, Trash2, Square, Loader2, X, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { useVisualViewport } from '@/hooks/use-visual-viewport';
import { useCoachChat, type ChatMessage } from '@/hooks/use-coach-chat';
import type { LogDayContext, RoutineReviewContext, DashboardContext } from '@/lib/ai/context-builders';

type ChatMode = 'log-day' | 'routine-review' | 'dashboard';

type CoachContext = LogDayContext | RoutineReviewContext | DashboardContext;

type CoachChatSheetProps = {
  mode: ChatMode;
  /** Static context (log-day / dashboard) or null if using loadContext */
  context?: CoachContext | null;
  /** Lazy context loader (routine-review) */
  loadContext?: () => Promise<RoutineReviewContext>;
  /** Optional starter chips shown in the empty state; tapping sends the text. */
  suggestedPrompts?: string[];
  /** log-day only: selected log date (`yyyy-MM-dd`) so chat history is scoped to that day */
  logDate?: string;
};

const MODE_CONFIG = {
  'log-day': {
    title: 'Coach de Entrenamiento',
    description: 'Pregunta sobre tu entrenamiento de hoy',
    placeholder: 'Ej: "Que peso deberia usar hoy?"',
    emptyText: 'Preguntale al coach sobre tu entrenamiento de hoy',
  },
  'routine-review': {
    title: 'Coach de Programacion',
    description: 'Analisis de tu programa de entrenamiento',
    placeholder: 'Ej: "Como puedo mejorar mi rutina?"',
    emptyText: 'Preguntale al coach sobre tu programacion y rutinas',
  },
  dashboard: {
    title: 'Coach Semanal',
    description: 'Tu panorama de entrenamiento semanal',
    placeholder: 'Ej: "En que me enfoco esta semana?"',
    emptyText: 'Preguntale al coach sobre tu progreso semanal',
  },
};

/** Composer grows line by line up to this, then scrolls inside itself (LinkedIn-style). */
const COMPOSER_MAX_HEIGHT = 140;
/** Inset of the mobile panel from the edges of the visible viewport. */
const MOBILE_GAP = 8;
/** Gap above the mobile panel so the page header stays visible behind it. */
const MOBILE_TOP_GAP = 64;

export function CoachChatSheet({ mode, context, loadContext, suggestedPrompts, logDate }: CoachChatSheetProps) {
  const [open, setOpen] = useState(false);
  const [resolvedContext, setResolvedContext] = useState<CoachContext | null>(
    context ?? null,
  );
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [input, setInput] = useState('');
  const [composerExpanded, setComposerExpanded] = useState(false);
  const { messages, isStreaming, error, sendMessage, clearChat, stopStreaming } = useCoachChat(mode, logDate);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const config = MODE_CONFIG[mode];

  const isMobile = useIsMobile();
  const viewport = useVisualViewport(open && isMobile);

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

  // Auto-scroll to bottom on new content (including each streaming chunk), when
  // the panel opens, and when the keyboard resizes the visible area.
  const lastMsgContent = messages[messages.length - 1]?.content ?? '';
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
  }, [lastMsgContent, open, viewport?.height]);

  // Freeze the page behind the chat. `overflow: hidden` alone does not hold on
  // iOS Safari (touch scroll still chains to the document), so the body is
  // pinned and its scroll offset restored on close.
  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    return () => {
      Object.assign(body.style, prev);
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  // Pinning the body does NOT stop iOS from panning the visual viewport while
  // the keyboard is open (that pan is not a document scroll), so gestures on
  // the frozen page still moved everything and resized the panel. Block them:
  // a touchmove is only allowed when the finger is over an element inside the
  // panel that can actually scroll (message list, overflowing textarea) — that
  // scroller consumes it and `overscroll-contain` stops the chain.
  useEffect(() => {
    if (!open || !isMobile) return;
    const canScroll = (el: HTMLElement) => {
      const overflowY = window.getComputedStyle(el).overflowY;
      return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!e.cancelable) return;
      const panel = panelRef.current;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (!panel || !target || !panel.contains(target)) {
        e.preventDefault();
        return;
      }
      for (let el: HTMLElement | null = target; el && el !== panel; el = el.parentElement) {
        if (canScroll(el)) return;
      }
      e.preventDefault();
    };
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => document.removeEventListener('touchmove', onTouchMove);
  }, [open, isMobile]);

  // Focus textarea when chat opens
  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open]);

  // Auto-grow the composer: one line by default, taller with every wrapped or
  // typed line, capped so the conversation stays visible. Expanded mode hands
  // the whole panel body to the textarea instead.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el || !open) return;
    if (composerExpanded) {
      el.style.height = '100%';
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, [input, composerExpanded, open]);

  const handleSend = useCallback(() => {
    if (!input.trim() || !resolvedContext || isStreaming) return;
    sendMessage(input, resolvedContext);
    setInput('');
    setComposerExpanded(false);
  }, [input, resolvedContext, isStreaming, sendMessage]);

  const handleClear = useCallback(() => {
    clearChat();
    setInput('');
    setComposerExpanded(false);
  }, [clearChat]);

  const handleSuggested = useCallback(
    (text: string) => {
      if (!resolvedContext || isStreaming) return;
      sendMessage(text, resolvedContext);
    },
    [resolvedContext, isStreaming, sendMessage],
  );

  const handleClose = useCallback(() => {
    setOpen(false);
    setComposerExpanded(false);
  }, []);

  const noContext = !resolvedContext && !isLoadingContext;

  // Mobile: the panel is bounded by top+bottom and never given a `height`, so
  // opening the keyboard only lifts its BOTTOM edge -- the header stays exactly
  // where it was and the message list is what shrinks (LinkedIn-style).
  // `bottom` is offset by the keyboard because `position: fixed` resolves
  // against the layout viewport, which iOS never shrinks. Both edges add
  // `offsetTop`: on input focus iOS PANS the visual viewport (not a document
  // scroll — the body pin can't stop it), which slides fixed elements up and
  // ran the header off-screen; adding the pan back glues the panel to the
  // visible area, and it is 0 whenever nothing panned. (`keyboardHeight`
  // already subtracts `offsetTop`, so `bottom` tracks the pan on its own.)
  // Desktop: anchored window, bottom-right.
  const panelStyle: React.CSSProperties = isMobile
    ? {
        left: MOBILE_GAP,
        right: MOBILE_GAP,
        top: MOBILE_TOP_GAP + (viewport?.offsetTop ?? 0),
        bottom: viewport?.keyboardOpen
          ? viewport.keyboardHeight + MOBILE_GAP
          : `calc(${MOBILE_GAP}px + env(safe-area-inset-bottom, 0px))`,
      }
    : {
        right: '1.5rem',
        bottom: '5rem',
        width: 'min(360px, calc(100vw - 2rem))',
        height: 'min(680px, calc(100dvh - 7rem))',
      };

  const sendButton = isStreaming ? (
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
  );

  return (
    <>
      {/* Floating trigger button. Icon-only on mobile so it covers as little
          of the page as possible (it sits over set rows / badges otherwise).
          Only the log page has a sticky action bar to clear — elsewhere the
          button hugs the bottom edge instead of floating 7rem up over content. */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="AI Coach"
        className={cn(
          "fixed right-4 md:right-6 z-50 flex items-center justify-center gap-2 bg-foreground text-background rounded-full shadow-lg hover:opacity-90 transition-opacity font-medium text-sm",
          "h-12 w-12 md:h-auto md:w-auto md:px-4 md:py-2.5",
          mode === 'log-day' ? "bottom-24 md:bottom-24" : "bottom-6 md:bottom-6",
        )}
      >
        <Sparkles className="h-5 w-5 md:h-4 md:w-4" />
        <span className="hidden md:inline">AI Coach</span>
      </button>

      {open && (
        <>
          {/* Backdrop — covers page content including mobile action bar (z-40), blurs background */}
          <div
            className="fixed inset-0 z-[49] touch-none bg-black/30 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Floating chat window */}
          <div
            ref={panelRef}
            className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
            style={panelStyle}
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
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
                <Button variant="ghost" size="icon" onClick={handleClose} className="h-8 w-8">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Body — messages + composer. The expanded composer overlays this
                region only, so the header stays reachable. */}
            <div className="relative flex min-h-0 flex-1 flex-col">
              {/* Messages — the only scrollable surface; `overscroll-contain`
                  stops the frozen page behind from taking over at the edges. */}
              <ScrollArea className="min-h-0 flex-1 px-4 [&>[data-radix-scroll-area-viewport]]:overscroll-contain">
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
                          No data available for the coach.
                        </p>
                      )}
                      {resolvedContext && suggestedPrompts && suggestedPrompts.length > 0 && (
                        <div className="mt-5 flex w-full flex-col gap-2">
                          {suggestedPrompts.map((prompt, i) => (
                            <button
                              key={i}
                              onClick={() => handleSuggested(prompt)}
                              disabled={isStreaming}
                              className="rounded-full border px-3 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                            >
                              {prompt}
                            </button>
                          ))}
                        </div>
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
              {error && !composerExpanded && (
                <div className="shrink-0 px-4 pb-2">
                  <Alert variant="destructive">
                    <AlertDescription className="text-xs">{error}</AlertDescription>
                  </Alert>
                </div>
              )}

              {/* Composer. Same element in both states — toggling classes rather
                  than swapping trees keeps focus and the caret in place. */}
              <div
                className={cn(
                  'bg-background',
                  composerExpanded ? 'absolute inset-0 z-10 flex flex-col' : 'shrink-0 border-t',
                )}
              >
                <div
                  className={cn(
                    'flex gap-2 px-3',
                    composerExpanded ? 'min-h-0 flex-1 flex-col pt-3' : 'items-end py-3',
                  )}
                >
                  <div className="relative min-h-0 w-full flex-1">
                    <Textarea
                      ref={textareaRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={config.placeholder}
                      disabled={isStreaming || noContext || isLoadingContext}
                      className={cn(
                        'resize-none overflow-y-auto overscroll-contain pr-10',
                        composerExpanded ? 'h-full min-h-0' : 'min-h-[44px]',
                      )}
                      rows={1}
                      style={composerExpanded ? undefined : { maxHeight: COMPOSER_MAX_HEIGHT }}
                    />
                    <button
                      type="button"
                      onClick={() => setComposerExpanded((v) => !v)}
                      aria-label={composerExpanded ? 'Reducir el cuadro de texto' : 'Ampliar el cuadro de texto'}
                      className="absolute right-1.5 top-1.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {composerExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </button>
                  </div>
                  {!composerExpanded && sendButton}
                </div>

                {composerExpanded && (
                  <div className="flex shrink-0 items-center justify-end border-t px-3 py-2">
                    {sendButton}
                  </div>
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
        {!isUser && !message.content && isLast && isStreaming ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : isUser ? (
          <span className="whitespace-pre-wrap">{message.content}</span>
        ) : (
          <SegmentRenderer content={message.content} />
        )}
      </div>
    </div>
  );
}

// ─── Markdown Renderer ───────────────────────────────────────────────

function stripThinking(text: string): string {
  let result = text.replace(/<think>[\s\S]*?<\/think>\n?/g, '');
  const openIdx = result.indexOf('<think>');
  if (openIdx !== -1) result = result.slice(0, openIdx);
  return result.trim() || "Couldn't generate a reply. Please try again.";
}

function SegmentRenderer({ content }: { content: string }) {
  if (!content) {
    return <span className="text-xl animate-pulse">🤔</span>;
  }
  return <div className="space-y-1">{renderMarkdown(stripThinking(content))}</div>;
}

function renderInline(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  // Match **bold** (non-greedy) or *italic* (no nested *)
  const re = /\*\*(.+?)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      // **bold** — recurse so *italic* inside bold also renders
      nodes.push(<strong key={m.index}>{renderInline(m[1])}</strong>);
    } else {
      // *italic*
      nodes.push(<em key={m.index}>{m[2]}</em>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let listType: 'ul' | 'ol' = 'ul';

  const flushList = (key: number) => {
    if (listItems.length > 0) {
      const Tag = listType;
      result.push(
        <Tag key={`list-${key}`} className={`${listType === 'ol' ? 'list-decimal' : 'list-disc'} list-inside space-y-1 my-1.5`}>
          {listItems}
        </Tag>,
      );
      listItems = [];
    }
  };

  lines.forEach((line, i) => {
    const t = line.trimStart(); // strip leading indent so indented bullets/headings match

    // Skip dividers
    if (t === '---') return;

    // ### Heading (any number of #)
    const headingMatch = t.match(/^#{1,6}\s+(.+)/);
    if (headingMatch) {
      flushList(i);
      result.push(
        <p key={i} className="font-semibold text-sm mt-2 pb-0.5 border-b border-primary/30">
          {renderInline(headingMatch[1].trim())}
        </p>,
      );
      return;
    }

    // Numbered list: 1. 2. 3.
    const numberedMatch = t.match(/^\d+\.\s+(.+)/);
    if (numberedMatch) {
      if (listType !== 'ol' && listItems.length > 0) flushList(i);
      listType = 'ol';
      listItems.push(<li key={i}>{renderInline(numberedMatch[1])}</li>);
      return;
    }

    // Bullet list: - or *
    const bulletMatch = t.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      if (listType !== 'ul' && listItems.length > 0) flushList(i);
      listType = 'ul';
      listItems.push(<li key={i}>{renderInline(bulletMatch[1])}</li>);
      return;
    }

    flushList(i);
    if (t !== '') {
      result.push(<span key={i} className="block leading-normal mb-0.5">{renderInline(t)}</span>);
    }
  });

  flushList(lines.length);
  return <>{result}</>;
}
