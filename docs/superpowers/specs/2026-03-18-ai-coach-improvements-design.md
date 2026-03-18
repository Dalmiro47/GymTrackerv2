# AI Coach Improvements — Design Spec
**Date:** 2026-03-18
**Branch:** ref/ai-coach3
**Scope:** Approach B — features 1–5 (photo input deferred to follow-up)

---

## Context

The AI Coach is a contextual chat panel embedded in `/log` (log-day mode) and `/routines` (routine-review mode). It uses Groq (`qwen/qwen3-32b`) via a vendor-agnostic `LLMProvider` interface. The model is a reasoning model that emits `<think>...</think>` blocks; these are suppressed when `response_format: { type: 'json_object' }` is active (Groq does not include thinking tokens in the returned `content` field for json_object mode — verify with Groq docs if this assumption changes). Responses are currently streamed via SSE and rendered with a lightweight markdown parser. The goal is to improve response quality, visual rendering, and modal UX.

---

## What We Are Building

Five improvements to the AI Coach feature:

1. **Structured JSON response rendering** — model outputs typed segments, client renders them with purpose-built styles
2. **Modal UX: backdrop blur + button protection** — overlay behind chat panel, Delete/Save buttons visually obscured
3. **Section divider sanitization** — fallback strip of raw `---` / `###` when JSON parse fails
4. **Response length cap** — 400 `max_tokens` hard cap (safety net above the 200/250 word instructions in the prompts; the prompt instructions remain the binding constraint, the token cap prevents runaway responses if the model ignores them)
5. **Auto-scroll fix** — sentinel `<div>` approach that correctly reaches the Radix ScrollArea viewport

**Out of scope (deferred):** Photo input / multimodal (feature 6).

---

## Architecture

### Files Changed

| File | Change |
|------|--------|
| `src/lib/ai/chat-prompts.ts` | Add `KNOWN EXERCISES:` block + JSON output format instruction to both system prompts; remove conflicting word-count instructions |
| `src/app/api/coach/chat/route.ts` | Switch `chatStream` → `chat`, add `jsonMode: true`, `maxTokens: 400`, return `NextResponse.json({ content })` |
| `src/hooks/use-coach-chat.ts` | Replace SSE reader + empty-bubble pattern with single `fetch` + `res.json()`, add `extractTextFromContent()` for history sanitization |
| `src/components/coach/CoachChatSheet.tsx` | Add `SegmentRenderer`, remove `stripThinkingBlocks`, add backdrop overlay, fix auto-scroll sentinel |

No new files. No type changes to `ChatMessage`. `ChatMode` duplication across files is a pre-existing issue, not addressed here.

---

## Section 1: API Layer

### `chat-prompts.ts`

Both `buildLogDaySystemPrompt` and `buildRoutineReviewSystemPrompt` get two additions and one removal:

**Remove:** The following two lines from each prompt are removed:
- `"Keep responses under 200 words..."` / `"Keep responses under 250 words..."` — replaced by the JSON format instruction's own length guidance; two competing length signals confuse the model.
- `"Use motivational gym emojis naturally (💪 🏋️ 🔥 ✅ 📈) to keep the tone energetic."` — conflicts with `"Respond ONLY with a valid JSON object"`. Emojis can still appear naturally inside `"text"` segment `value` strings without an explicit instruction; removing this line avoids uncertain model behavior about emoji placement in JSON.

**1. KNOWN EXERCISES block** (injected from context, placed immediately before the JSON format instruction at the end of each prompt):

- Log-day mode: `context.exercises.map(ex => ex.name).join(', ')`
- Routine-review mode: `context.routines.flatMap(r => r.exercises.map(ex => ex.name)).join(', ')`

Exact string in prompt:
```
KNOWN EXERCISES: Press Banca, Sentadillas, Peso Muerto, Dominadas
```
(comma-separated, single line, placed at the end of the prompt before the OUTPUT FORMAT block)

**2. JSON output instruction** appended at the very end:

```
OUTPUT FORMAT: Respond ONLY with a valid JSON object:
{"segments":[{"type":"text"|"exercise"|"heading","value":"..."}]}
- "heading": a section title. Never use ### or --- in values.
- "exercise": an exercise name from KNOWN EXERCISES above.
- "text": all other content.
Always complete your final sentence before stopping. Never cut off mid-thought.
Keep responses concise — this app is used on a phone.
```

### `route.ts`

- Replace `provider.chatStream(...)` with `provider.chat(..., { jsonMode: true, maxTokens: 400 })`
- Update (or remove) the `// Stream response` comment on the line above the provider call
- Return `NextResponse.json({ content: data.content })`
- Remove SSE response headers
- Error handling unchanged (Spanish messages preserved)

---

## Section 2: Hook (`use-coach-chat.ts`)

### SSE → JSON fetch

The entire SSE reader loop, the pre-emptive empty assistant bubble insertion, and the bubble cleanup on error are **removed**. The `res.body` null check is also removed (dead code after switching to `res.json()`).

The new `sendMessage` core:

```ts
// 1. Insert empty assistant bubble immediately — this shows the <Loader2> spinner
//    in MessageBubble while the HTTP request is in-flight (same visual as current SSE behavior)
persistMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

try {
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

  // 2. Replace the empty bubble with the actual content
  persistMessages((prev) => {
    const updated = [...prev];
    updated[updated.length - 1] = {
      role: 'assistant',
      content: content || 'No se recibio respuesta del coach. Intenta de nuevo.',
    };
    return updated;
  });
} catch (err) {
  if (err instanceof DOMException && err.name === 'AbortError') {
    // 3. On abort: remove the empty bubble
    persistMessages((prev) =>
      prev[prev.length - 1]?.role === 'assistant' && !prev[prev.length - 1].content
        ? prev.slice(0, -1)
        : prev
    );
    return;
  }
  // 4. On error: replace empty bubble with error, set error state
  persistMessages((prev) => {
    const updated = [...prev];
    if (updated[updated.length - 1]?.role === 'assistant' && !updated[updated.length - 1].content) {
      updated.splice(updated.length - 1, 1);
    }
    return updated;
  });
  setError(err instanceof Error ? err.message : 'Error desconocido.');
}
```

**Loading state**: The empty assistant bubble is inserted synchronously before the fetch, so `MessageBubble` renders `<Loader2>` immediately (condition: `!message.content && isLast && isStreaming`). This preserves the current loading UX with no new code needed in the component.

**`stopStreaming`** now cancels the in-flight HTTP request via `AbortController.abort()`. If `res.json()` has already resolved before the user taps stop, the abort is a no-op — this is acceptable. The Stop button (`<Square>` icon) remains visible whenever `isStreaming === true` (which now covers the full HTTP round-trip), so the user sees it during the wait and can cancel before a response arrives.

**`isStreaming`** — name kept unchanged for interface stability (no prop chain changes). It now means "waiting for JSON response" rather than "stream in progress". This semantic mismatch is deliberate and noted as technical debt for a future rename.

### History sanitization

Applied inline on the `messages` array in the `fetch` body (see code snippet above). Transforms assistant messages to plain text before sending to the API:

```ts
function extractTextFromContent(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (parsed?.segments) {
      return parsed.segments.map((s: { value?: string }) => s.value ?? '').join(' ');
    }
  } catch { /* not JSON — pass through */ }
  return content;
}
```

Note: `s.value ?? ''` guards against malformed segments that lack a `value` key.

### Storage

`ChatMessage.content` for assistant messages stores the raw JSON string. Existing localStorage data (plain text from before this change) continues to work — `SegmentRenderer` falls back to `renderMarkdown()` if `JSON.parse` fails.

---

## Section 3: UI (`CoachChatSheet.tsx`)

### 3a. SegmentRenderer

New component inside `CoachChatSheet.tsx` (no new file). Replaces the `renderMarkdown(stripThinkingBlocks(...))` call in `MessageBubble`.

`stripThinkingBlocks` in `CoachChatSheet.tsx` (lines 225–232) is **removed** — json_object mode suppresses thinking tokens server-side. If a future fallback produces plain text, the markdown sanitization pass (below) handles `<think>` as unknown content gracefully.

```
SegmentRenderer(content: string):
  1. Try JSON.parse(content)
  2. If success → map segments:
     - "heading" → <p className="font-semibold text-sm mt-2 pb-0.5 border-b border-primary/30 text-foreground">
     - "exercise" → inline <span className="italic text-primary font-medium">
     - "text"    → <span className="block leading-snug">
     (all segments wrapped in a <div className="space-y-1">)
  3. If fail → sanitize(content) → renderMarkdown()
     sanitize():
       - strip lines that are exactly "---"
       - convert lines matching /^###\s+(.+)/ to heading-style <span>
       - strip any remaining <think>...</think> blocks defensively
```

User messages remain `<span className="whitespace-pre-wrap">`. Blinking streaming cursor removed (responses arrive complete).

Loading state: existing `<Loader2>` spinner in the message list while `isStreaming === true` and no new assistant message has arrived yet (same as current behavior for empty-bubble state).

### 3b. Backdrop overlay

When `open === true`, render a full-screen overlay **inside** `CoachChatSheet`, before the chat panel div:

```tsx
{open && (
  <>
    <div
      className="fixed inset-0 z-[49] bg-black/30 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    />
    <div className="fixed ... z-50 flex flex-col ...">
      {/* chat panel */}
    </div>
  </>
)}
```

`z-[49]` covers the mobile action bar (Delete/Save at `z-40`) and all page content. Clicking the overlay closes the chat.

**Trigger button z-index**: the floating "AI Coach" trigger button stays at `z-50`, sitting above the overlay alongside the chat panel. This is intentional — tapping it while the panel is open calls `setOpen(v => !v)`, toggling the panel closed. The trigger acts as an additional close affordance. No change needed to trigger button behavior.

### 3c. Auto-scroll fix

**Why the current approach fails:** `<ScrollArea>` (Radix `Root`) renders as `overflow: hidden`. Setting `scrollTop` on it has no effect. The actual scrollable element is the internal `ScrollAreaPrimitive.Viewport` which is not exposed via the ref.

**Fix:** Replace `scrollRef` with a sentinel at the bottom of the message list:

```tsx
const bottomRef = useRef<HTMLDivElement>(null);

// Inside <ScrollArea> → <div className="space-y-4 py-4"> → last child:
<div ref={bottomRef} />   {/* sentinel — MUST be inside the py-4 div */}

// Effect:
useEffect(() => {
  bottomRef.current?.scrollIntoView({ behavior: 'instant' });
}, [messages, open]);
```

**Critical placement:** `<div ref={bottomRef} />` must be the last child inside `<div className="space-y-4 py-4">`, not placed after `</ScrollArea>`. Placing it outside the viewport will make `scrollIntoView` scroll the page instead of the chat panel.

`behavior: 'instant'` prevents animation jitter when opening. `scrollRef` (previously on `<ScrollArea>`) is removed entirely.

---

## Data Flow

```
User types → sendMessage()
  → fetch POST /api/coach/chat
    body: { mode, messages: history (assistant content sanitized to plain text), context }
  → route.ts builds system prompt (KNOWN EXERCISES + JSON format instruction)
  → provider.chat({ jsonMode: true, maxTokens: 400 })
  → Groq returns full response: { content: '{"segments":[...]}' }
  → NextResponse.json({ content })
  → use-coach-chat stores raw JSON string in ChatMessage.content (localStorage)
  → SegmentRenderer parses and renders typed segments
  → On JSON parse failure → sanitize → renderMarkdown() fallback
```

---

## Error Handling

- If Groq returns malformed JSON → `JSON.parse` fails → fallback to `renderMarkdown()` with sanitization
- If fetch fails / is aborted → existing Spanish error message via `setError()` (unchanged)
- If `content` is empty → "No se recibio respuesta del coach. Intenta de nuevo." fallback

---

## Conversation Persistence

Already implemented. `localStorage` key: `coach-chat-{mode}-{YYYY-MM-DD}`. Navigating away and back restores the full conversation for the current day. Old day keys are pruned on each save. No changes needed.

---

## Constraints Observed

- No new files created
- No Redux/Zustand — state stays in hook + component
- Spanish error messages preserved
- Mobile-first: 400 token hard cap, concise prompt instructions
- No scope creep: photo input is explicitly deferred
- `isStreaming` rename deferred (no prop chain impact, noted as tech debt)
