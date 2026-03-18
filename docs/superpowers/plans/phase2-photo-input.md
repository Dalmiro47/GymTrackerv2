# AI Coach — Phase 2: Photo Input

## Goal
Add a camera/image button to the AI Coach input bar so users can send a photo of a gym machine or exercise. The image is sent to a vision-capable model alongside the text prompt. The text-only model (`qwen/qwen3-32b`) is preserved for regular chat.

## Context
- Branch: `ref/ai-coach3`
- Phase 1 (non-streaming JSON, markdown renderer, backdrop, auto-scroll) is complete and working.
- The API route at `src/app/api/coach/chat/route.ts` already handles non-streaming JSON: `POST → { content: string }`.
- The hook `src/hooks/use-coach-chat.ts` uses `fetch + res.json()` (no SSE).
- The UI is in `src/components/coach/CoachChatSheet.tsx`.

## Open question before starting
Confirm which Groq vision model to use. Candidate: `meta-llama/llama-4-scout-17b-16e-instruct` (original model, supports images on Groq). Verify it's available on your Groq plan at https://console.groq.com before coding.

---

## Changes by file

### 1. `src/lib/ai/chat-prompts.ts`
- Add a shared photo instruction to both `buildLogDaySystemPrompt` and `buildRoutineReviewSystemPrompt`:
  > "El usuario puede enviar una foto de una máquina o ejercicio de gimnasio. Si lo hace, identifícala, explica qué músculos trabaja y cómo usarla correctamente."

### 2. `src/app/api/coach/chat/route.ts`
- Inspect the last user message in `messages`. If its `content` is an array (multimodal), it contains an image block.
- If image detected → use vision model (e.g. `meta-llama/llama-4-scout-17b-16e-instruct`).
- If text only → keep `qwen/qwen3-32b`.
- Pass the model override to `provider.chat(fullMessages, { ..., model: selectedModel })` — check if `GroqProvider` supports a per-call model override; add it if not.

### 3. `src/hooks/use-coach-chat.ts`
- Extend `sendMessage` signature: `sendMessage(text: string, imageBase64?: string)`
- When `imageBase64` is present, build a multimodal content array for the user message:
  ```ts
  content: [
    { type: "text", text },
    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
  ]
  ```
- Store user message in localStorage as plain text only — no base64 (too large for localStorage).

### 4. `src/components/coach/CoachChatSheet.tsx`
- Add `imageBase64` state (`string | null`).
- Add a hidden `<input type="file" accept="image/*" capture="environment">` ref'd via `useRef`.
- Add a camera icon button (`ImageIcon` from lucide-react) to the left of the send button. On click, trigger the file input.
- On file selected: read via `FileReader.readAsDataURL`, strip the `data:...;base64,` prefix, store in `imageBase64` state.
- Show a small thumbnail preview above the input bar when an image is selected, with an × button to clear it.
- On send: call `sendMessage(input, imageBase64 ?? undefined)`, then clear both `input` and `imageBase64`.
- User message bubble: if content is an array, render the image as `<img>` + the text below it.

---

## Constraints
- Never store base64 in localStorage — only plain text for history.
- The model switch must be transparent to the user (no UI indication needed).
- Keep the camera button visually subtle — same size/weight as the send button.
- If the file picker is cancelled, do nothing (no error).
- Error handling: if the vision API call fails, show the standard Spanish error banner.
