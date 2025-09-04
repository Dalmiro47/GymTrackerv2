
import {PointerSensor, KeyboardSensor} from '@dnd-kit/core';

function isInteractive(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  if (node.isContentEditable) return true;
  const tag = node.tagName?.toLowerCase();
  if (['input','textarea','select','button','option'].includes(tag || '')) return true;
  if (node.closest('[data-dndkit-no-drag],[data-no-dnd],input,textarea,select,button,[contenteditable="true"]')) {
    return true;
  }
  return false;
}

export class SafePointerSensor extends PointerSensor {
  // Block activation when the original event starts on an interactive element
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent }: { nativeEvent: PointerEvent }) =>
        !isInteractive(nativeEvent.target),
    },
    {
      // cover environments that use mouse activator
      eventName: 'onMouseDown' as const,
      handler: ({ nativeEvent }: { nativeEvent: MouseEvent }) =>
        !isInteractive(nativeEvent.target),
    },
    {
      // cover touch activator on mobile/safari
      eventName: 'onTouchStart' as const,
      handler: ({ nativeEvent }: { nativeEvent: TouchEvent }) =>
        !isInteractive(nativeEvent.target),
    },
  ];
}


export class SafeKeyboardSensor extends KeyboardSensor {
  static activators = [
    {
      eventName: 'onKeyDown' as const,
      handler: ({ nativeEvent }: { nativeEvent: KeyboardEvent }) => {
        const target = nativeEvent.target as HTMLElement | null;
        // Do NOT start a drag when an interactive element has focus
        if (
          target?.isContentEditable ||
          ['input', 'textarea', 'select', 'button', 'option'].includes(
            target?.tagName?.toLowerCase() || ''
          ) ||
          target?.closest(
            '[data-dndkit-no-drag],[data-no-dnd],input,textarea,select,button,[contenteditable="true"]'
          )
        ) {
          return false;
        }
        return true;
      },
    },
  ];
}
