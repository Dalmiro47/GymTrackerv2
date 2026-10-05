import * as React from "react"

import { cn } from "@/lib/utils"

const moveCaretToEnd = (el: HTMLInputElement) => {
  if (document.activeElement !== el) return
  const end = el.value.length
  el.setSelectionRange(end, end)
}

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onFocus, onMouseUp, ...props }, ref) => {
    // Number fields put the caret at the END when focused, so a tap lets you
    // backspace and retype — a tap near the left edge used to land the caret
    // before the digits (mostly on mobile). The browser places the caret from
    // the tap AFTER `focus` (iOS: on the following mouseup), so it is applied
    // again on the mouseup of the focusing tap only; later taps can still
    // position the caret freely. Text-type inputs only: `type="number"` does
    // not support selection ranges.
    const caretToEnd = (props.inputMode === "numeric" || props.inputMode === "decimal") && (!type || type === "text")
    const focusingTap = React.useRef(false)

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      onFocus?.(e)
      if (!caretToEnd) return
      const el = e.currentTarget
      focusingTap.current = true
      window.setTimeout(() => moveCaretToEnd(el), 0)
      window.setTimeout(() => { focusingTap.current = false }, 500)
    }

    const handleMouseUp = (e: React.MouseEvent<HTMLInputElement>) => {
      onMouseUp?.(e)
      if (!focusingTap.current) return
      focusingTap.current = false
      const el = e.currentTarget
      window.setTimeout(() => moveCaretToEnd(el), 0)
    }

    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full rounded-md border border-input bg-background/60 px-3 py-2 text-base transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        onFocus={handleFocus}
        onMouseUp={handleMouseUp}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
