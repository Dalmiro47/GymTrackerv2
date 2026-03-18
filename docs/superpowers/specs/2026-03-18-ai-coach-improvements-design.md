# AI Coach Improvements — Design Spec
**Date:** 2026-03-18
**Branch:** ref/ai-coach3
**Scope:** Approach B — features 1–5 (photo input deferred to follow-up)

---

## Context

The AI Coach is a contextual chat panel embedded in `/log` (log-day mode) and `/routines` (routine-review mode). It uses Groq (`qwen/qwen3-32b`) via a vendor-agnostic `LLMProvider` interface. Responses are currently streamed via SSE and rendered with a lightweight markdown parser. The goal of this work is to improve response quality, visual rendering, and modal UX.

---

## What We Are Building

Five improvements to the AI Coach feature:

1. **Structured JSON response rendering** — model outputs typed segments, client renders them with purpose-built styles
2. **Modal UX: backdrop blur + button protection** — overlay behind chat panel, Delete/Save buttons visually obscured
3. **Section divider sanitization** — fallback strip of raw `---` / `###` when JSON parse fails
4. **Response length cap** — 400 `max_tokens`, with prompt instruction to complete sentences
5. **Auto-scroll fix** — sentinel `<div>` approach that correctly reaches the Radix ScrollArea viewport

**Out of scope (deferred):** Photo input / multimodal (feature 6).

---

## Architecture

### Files Changed

| File | Change |
|------|--------|
| `src/lib/ai/chat-prompts.ts` | Add `KNOWN EXERCISES:` block + JSON output format instruction to both system prompts |
| `src/app/api/coach/chat/route.ts` | Switch `chatStream` → `chat`, add `jsonMode: true`, `maxTokens: 400`, return `NextResponse.json({ content })` |
| `src/hooks/use-coach-chat.ts` | Replace SSE reader with `fetch` + `res.json()`, add `extractTextFromContent()` for history sanitization |
| `src/components/coach/CoachChatSheet.tsx` | Add `SegmentRenderer`, backdrop overlay, auto-scroll sentinel |

No new files. No type changes to `ChatMessage`.

---

## Section 1: API Layer

### `chat-prompts.ts`

Both `buildLogDaySystemPrompt` and `buildRoutineReviewSystemPrompt` get two additions:

**1. KNOWN EXERCISES block** (injected from context):
- Log-day mode: exercise names from `context.exercises`
- Routine-review mode: exercise names from all `context.routines[*].exercises`

```
KNOWN EXERCISES: Press Banca, Sentadillas, Peso Muerto, ...
```

**2. JSON output instruction** appended at the end of each prompt:

```
OUTPUT FORMAT: Respond ONLY with a valid JSON object:
{"segments":[{"type":"text"|"exercise"|"heading","value":"..."}]}
- "heading": a section title. Never use ### or --- in values.
- "exercise": an exercise name from KNOWN EXERCISES above.
- "text": all other content.
Always complete your final sentence before stopping. Never cut off mid-thought.
Keep responses concise — this app is used on mobile.
```

### `route.ts`

- Replace `provider.chatStream(...)` with `provider.chat(..., { jsonMode: true, maxTokens: 400 })`
- Return `NextResponse.json({ content: data.content })`
- Remove SSE response headers
- Error handling unchanged

---

## Section 2: Hook (`use-coach-chat.ts`)

### SSE → JSON fetch

The `sendMessage` function replaces the SSE reader loop with:

```ts
const res = await fetch('/api/coach/chat', { method: 'POST', ... });
const data = await res.json();
const content = data.content ?? '';
persistMessages(prev => [...prev, { role: 'assistant', content }]);
```

`isStreaming` remains as the loading state name (no prop chain changes). `stopStreaming` still works via `AbortController`.

### History sanitization

When building the `messages` array sent to the API, assistant messages are transformed:

```ts
function extractTextFromContent(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (parsed?.segments) {
      return parsed.segments.map((s: { value: string }) => s.value).join(' ');
    }
  } catch { /* not JSON */ }
  return content;
}
```

This ensures the model's conversation history reads as natural dialogue, not raw JSON.

### Storage

`ChatMessage.content` for assistant messages stores the raw JSON string. Existing localStorage data (plain text from before this change) continues to work — `SegmentRenderer` falls back to `renderMarkdown()` if `JSON.parse` fails.

---

## Section 3: UI (`CoachChatSheet.tsx`)

### 3a. SegmentRenderer

New component inside `CoachChatSheet.tsx`. Replaces `renderMarkdown()` for assistant message rendering.

```
SegmentRenderer(content: string):
  1. Try JSON.parse(content)
  2. If success → map segments:
     - "heading" → <p className="font-semibold text-sm mt-2 pb-0.5 border-b border-primary/30">
     - "exercise" → <span className="italic text-primary font-medium">
     - "text"    → <span className="block leading-snug">
  3. If fail → sanitize(content) → renderMarkdown()
     sanitize(): strip "---" lines, convert "### text" lines to heading style
```

User messages remain `<span className="whitespace-pre-wrap">`.

Streaming cursor (blinking `|`) is removed — responses arrive complete, not progressively.
Loading state during fetch: existing `<Loader2>` spinner in the empty assistant bubble.

### 3b. Backdrop overlay

When `open === true`, render a full-screen overlay **inside** `CoachChatSheet` before the chat panel:

```tsx
<div
  className="fixed inset-0 z-[49] bg-black/30 backdrop-blur-sm"
  onClick={() => setOpen(false)}
/>
```

`z-[49]` places it below the chat panel (`z-50`) and above page content. Clicking the overlay closes the chat. This covers the mobile action bar (Delete/Save buttons at `z-40`), making them visually blurred and non-interactive while the coach is open.

### 3c. Auto-scroll fix

Replace `scrollRef.scrollTop` with a sentinel approach:

```tsx
const bottomRef = useRef<HTMLDivElement>(null);

// Inside message list, after last message:
<div ref={bottomRef} />

// Effect triggers on: messages change, open state change
useEffect(() => {
  bottomRef.current?.scrollIntoView({ behavior: 'instant' });
}, [messages, open]);
```

`behavior: 'instant'` (not smooth) prevents animation jitter when opening the panel.

---

## Data Flow

```
User types → sendMessage()
  → fetch POST /api/coach/chat
    body: { mode, messages: history (assistant content sanitized to plain text), context }
  → route.ts builds system prompt (with KNOWN EXERCISES + JSON format instruction)
  → provider.chat({ jsonMode: true, maxTokens: 400 })
  → Groq returns { content: '{"segments":[...]}' }
  → NextResponse.json({ content })
  → use-coach-chat stores raw JSON string in ChatMessage.content
  → SegmentRenderer parses and renders typed segments
```

---

## Error Handling

- If Groq returns malformed JSON → `JSON.parse` fails → fallback to `renderMarkdown()` with sanitization
- If fetch fails → existing error state + Spanish error message (unchanged)
- If `content` is empty → existing "No se recibio respuesta" fallback (unchanged)

---

## Conversation Persistence

Already implemented. `localStorage` key: `coach-chat-{mode}-{YYYY-MM-DD}`. Navigating away and back restores the full conversation for the current day. Old day keys are pruned on each save. No changes needed.

---

## Constraints Observed

- No new files created
- No Redux/Zustand — state stays in hook + component
- Spanish error messages preserved
- Mobile-first: 400 token cap, concise prompts
- No scope creep: photo input is explicitly deferred
