# AI Coach Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the AI Coach chat feature with structured JSON segment rendering, modal backdrop blur, response length cap, and auto-scroll fix.

**Architecture:** Switch the coach API from SSE streaming to a single non-streaming JSON call with `jsonMode: true`. The model returns `{"segments":[{type, value}]}` which a new `SegmentRenderer` component maps to styled React elements. A full-screen backdrop overlay blurs the page when the coach is open.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS, shadcn/ui, Groq (`qwen/qwen3-32b`), Firebase Firestore

**Spec:** `docs/superpowers/specs/2026-03-18-ai-coach-improvements-design.md`

---

## File Map

| File | Change |
|------|--------|
| `src/lib/ai/chat-prompts.ts` | Remove word-count + emoji lines; add KNOWN EXERCISES block + JSON format instruction to both prompts |
| `src/app/api/coach/chat/route.ts` | Switch `chatStream` → `chat`, `jsonMode: true`, `maxTokens: 400`, return `NextResponse.json` |
| `src/hooks/use-coach-chat.ts` | Add `extractTextFromContent`; replace SSE reader with `fetch` + `res.json()`; keep empty-bubble loading pattern |
| `src/components/coach/CoachChatSheet.tsx` | Add `SegmentRenderer`; remove `stripThinkingBlocks`; add backdrop overlay; fix auto-scroll with sentinel `<div>` |

> No new files. No type changes. No test framework — validate with `npm run typecheck` and `npm run lint` after every task.

---

## Task 1: Update System Prompts

**Files:**
- Modify: `src/lib/ai/chat-prompts.ts`

This task is standalone — it only touches prompt text. The app continues to work throughout.

- [ ] **Step 1: Remove word-count and emoji lines from `buildLogDaySystemPrompt`**

In `src/lib/ai/chat-prompts.ts`, find the end of `buildLogDaySystemPrompt` (around line 64–65). Remove these two lines from the template string:

```
- Keep responses under 200 words unless the user asks for more detail.
- Use motivational gym emojis naturally (💪 🏋️ 🔥 ✅ 📈) to keep the tone energetic.
```

- [ ] **Step 2: Add KNOWN EXERCISES block + JSON format instruction to `buildLogDaySystemPrompt`**

Replace the removed lines with (appended at the end of the return string, after the RULES block):

```ts
const knownExercises = context.exercises.map((ex) => ex.name).join(', ');

// At the end of the template string, add:
`
KNOWN EXERCISES: ${knownExercises}

OUTPUT FORMAT: Respond ONLY with a valid JSON object:
{"segments":[{"type":"text"|"exercise"|"heading","value":"..."}]}
- "heading": a section title. Never use ### or --- in values.
- "exercise": an exercise name from KNOWN EXERCISES above.
- "text": all other content.
Always complete your final sentence before stopping. Never cut off mid-thought.
Keep responses concise — this app is used on a phone.`
```

Note: the `knownExercises` const must be declared inside `buildLogDaySystemPrompt` before the return statement.

- [ ] **Step 3: Remove word-count and emoji lines from `buildRoutineReviewSystemPrompt`**

Find the end of `buildRoutineReviewSystemPrompt` (around lines 145–146). Remove:

```
- Keep responses under 250 words unless the user asks for more detail.
- Use motivational gym emojis naturally (💪 🏋️ 🔥 ✅ 📈) to keep the tone energetic.
```

- [ ] **Step 4: Add KNOWN EXERCISES block + JSON format instruction to `buildRoutineReviewSystemPrompt`**

```ts
const knownExercises = context.routines
  .flatMap((r) => r.exercises.map((ex) => ex.name))
  .join(', ');

// At the end of the template string, add:
`
KNOWN EXERCISES: ${knownExercises}

OUTPUT FORMAT: Respond ONLY with a valid JSON object:
{"segments":[{"type":"text"|"exercise"|"heading","value":"..."}]}
- "heading": a section title. Never use ### or --- in values.
- "exercise": an exercise name from KNOWN EXERCISES above.
- "text": all other content.
Always complete your final sentence before stopping. Never cut off mid-thought.
Keep responses concise — this app is used on a phone.`
```

- [ ] **Step 5: Verify**

```bash
npm run typecheck
```

Expected: no errors related to `chat-prompts.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/chat-prompts.ts
git commit -m "feat(coach): add JSON output format + KNOWN EXERCISES to system prompts"
```

---

## Task 2: Switch API Route to Non-Streaming JSON

**Files:**
- Modify: `src/app/api/coach/chat/route.ts`

> ⚠️ After this task the API returns `{ content: string }` JSON instead of SSE. The hook (Task 3) must follow immediately — do not leave these two tasks separated by other work, as the app will be broken between them.

- [ ] **Step 1: Replace `chatStream` with `chat` in the route**

Open `src/app/api/coach/chat/route.ts`. Replace lines 45–58 (the stream call and its response) with:

```ts
// Non-streaming JSON response
const provider = createLLMProvider();
const result = await provider.chat(fullMessages, {
  temperature: 0.4,
  maxTokens: 400,
  jsonMode: true,
});

return NextResponse.json({ content: result.content });
```

Remove the SSE response headers block and the old `return new Response(stream, { headers: ... })`.

Also update/remove the stale `// Stream response` comment on the line above.

- [ ] **Step 2: Verify**

```bash
npm run typecheck
```

Expected: no errors. Note: the `provider.chat` method and `jsonMode` option already exist in `llm-provider.ts` — no changes needed there.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/coach/chat/route.ts
git commit -m "feat(coach): switch API route to non-streaming JSON with jsonMode"
```

---

## Task 3: Update Hook to Handle JSON Response

**Files:**
- Modify: `src/hooks/use-coach-chat.ts`

This task must follow Task 2 immediately. After this task the app is fully working again.

- [ ] **Step 1: Add `extractTextFromContent` helper**

At the top of `src/hooks/use-coach-chat.ts`, after the existing `stripThinking` function, add:

```ts
/** Extract plain text from a JSON segments string (for conversation history sent to the API). */
function extractTextFromContent(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (parsed?.segments) {
      return parsed.segments.map((s: { value?: string }) => s.value ?? '').join(' ');
    }
  } catch {
    /* not JSON — pass through */
  }
  return content;
}
```

- [ ] **Step 2: Replace the SSE reader in `sendMessage` with `fetch` + `res.json()`**

In the `sendMessage` function, replace everything from the `try {` block (after `setIsStreaming(true)`) through the closing `}` of the `finally` block (inclusive) with:

> Note: The empty bubble is inserted as the very first statement inside `try` — before the `await fetch(...)`. This is intentional: it keeps it inside the same error-boundary so the abort/error handlers can clean it up. The `finally` block is required to reset loading state; without it the UI stays permanently disabled.

```ts
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

  const data = await res.json();
  const content = data.content ?? '';

  // Replace the empty bubble with actual content
  persistMessages((prev) => {
    const updated = [...prev];
    updated[updated.length - 1] = {
      role: 'assistant',
      content: content || 'No se recibio respuesta del coach. Intenta de nuevo.',
    };
    return updated;
  });
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
```

- [ ] **Step 3: Remove the now-unused `stripThinking` function**

Delete the `stripThinking` function at the top of the file (lines 17–24). It is no longer called anywhere in the hook after the SSE reader is removed.

- [ ] **Step 4: Verify**

```bash
npm run typecheck
```

Expected: no errors. The app should now be functional end-to-end (API returns JSON, hook reads it).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-coach-chat.ts
git commit -m "feat(coach): replace SSE reader with JSON fetch, add extractTextFromContent"
```

---

## Task 4: Update UI — SegmentRenderer, Backdrop, Auto-scroll

**Files:**
- Modify: `src/components/coach/CoachChatSheet.tsx`

This task is purely UI. The hook and API are already wired correctly after Task 3.

- [ ] **Step 1: Add the `SegmentRenderer` component**

At the bottom of `src/components/coach/CoachChatSheet.tsx`, after `renderMarkdown`, add:

```tsx
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
    // Convert ### headings to plain text (renderMarkdown handles the heading style)
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
```

- [ ] **Step 2: Update `MessageBubble` to use `SegmentRenderer`**

In the `MessageBubble` component, replace the assistant message render block:

```tsx
// Before:
<div className="prose-sm space-y-1">
  {renderMarkdown(stripThinkingBlocks(message.content))}
  {isLast && isStreaming && message.content && (
    <span className="inline-block w-1 h-4 bg-foreground/60 animate-pulse ml-0.5 align-text-bottom" />
  )}
</div>

// After:
<div className="prose-sm space-y-1">
  <SegmentRenderer content={message.content} />
</div>
```

The streaming cursor (`animate-pulse` span) is removed — responses arrive complete, no in-progress stream to indicate.

- [ ] **Step 3: Remove `stripThinkingBlocks` from `CoachChatSheet.tsx`**

Delete the `stripThinkingBlocks` function (lines 225–232). It is no longer called — json_object mode suppresses thinking tokens server-side, and the `SegmentRenderer` fallback handles any plain text responses defensively.

- [ ] **Step 4: Add backdrop overlay**

In the JSX return, wrap the existing `{open && (...)}` block so that when open, a backdrop renders first:

```tsx
{open && (
  <>
    {/* Backdrop — covers page content including mobile action bar */}
    <div
      className="fixed inset-0 z-[49] bg-black/30 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    />

    {/* Chat panel */}
    <div
      className="fixed bottom-44 right-4 md:bottom-20 md:right-6 z-50 flex flex-col rounded-2xl border bg-background shadow-2xl"
      style={{ width: 'min(360px, calc(100vw - 2rem))', height: 'min(520px, calc(100dvh - 12rem))' }}
    >
      {/* ... existing chat panel content unchanged ... */}
    </div>
  </>
)}
```

- [ ] **Step 5: Fix auto-scroll with sentinel**

a) Replace `const scrollRef = useRef<HTMLDivElement>(null);` with `const bottomRef = useRef<HTMLDivElement>(null);`

b) Remove the existing auto-scroll effect:
```ts
// Remove this:
useEffect(() => {
  if (scrollRef.current) {
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }
}, [messages]);
```

c) Add the new sentinel-based effect:
```ts
useEffect(() => {
  bottomRef.current?.scrollIntoView({ behavior: 'instant' });
}, [messages, open]);
```

d) Remove `ref={scrollRef}` from `<ScrollArea>`.

e) Inside `<ScrollArea>`, find `<div className="space-y-4 py-4">` and add the sentinel as its **last child**:
```tsx
<div className="space-y-4 py-4">
  {/* ... existing message rendering ... */}
  <div ref={bottomRef} />   {/* sentinel — must be last child inside this div */}
</div>
```

- [ ] **Step 6: Verify**

```bash
npm run typecheck && npm run lint
```

Expected: no errors, no lint warnings.

- [ ] **Step 7: Commit**

```bash
git add src/components/coach/CoachChatSheet.tsx
git commit -m "feat(coach): add SegmentRenderer, backdrop overlay, fix auto-scroll sentinel"
```

---

## Task 5: Final Verification

- [ ] **Step 1: Full typecheck + lint**

```bash
npm run typecheck && npm run lint
```

Expected: clean pass on both.

- [ ] **Step 2: Manual smoke test checklist**

Start the dev server (`npm run dev`) and verify:

1. **Log page** — open AI Coach, type a message → response renders as styled segments (headings, exercise names in primary color, text blocks). No raw JSON visible.
2. **Fallback** — if the model ever returns plain text (can force by temporarily breaking the JSON instruction), it renders via markdown, not as an error.
3. **Loading state** — during the HTTP round-trip, the `<Loader2>` spinner is visible inside the chat window.
4. **Stop button** — tap the stop (`■`) button while a request is in-flight → request cancels, empty bubble is removed.
5. **Backdrop** — when the coach panel is open, the page behind it is blurred and the Delete/Save buttons in the mobile action bar are not tappable.
6. **Clicking backdrop** — clicking outside the panel closes it.
7. **Auto-scroll** — close the coach after a long conversation, reopen → chat scrolls to the most recent message.
8. **History persistence** — navigate away from `/log` and back → conversation for today is restored.
9. **Routine page** — AI Coach in routine-review mode works the same way.

- [ ] **Step 3: Commit final verification**

If any issues were found and fixed in the smoke test, commit the fixes. Otherwise:

```bash
git log --oneline -5
```

Confirm the four feature commits are present and the branch is clean.
