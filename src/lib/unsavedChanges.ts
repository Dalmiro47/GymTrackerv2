// Tiny module-level "dirty" flag shared between the Training Log hook and
// app-wide navigation (sidebar links), plus a beforeunload guard for tab close /
// refresh. Kept deliberately simple: no router interception, no context.

let dirty = false;
let listenerAttached = false;

export const UNSAVED_CHANGES_MESSAGE =
  'You have unsaved changes in your workout. Leave without saving?';

const onBeforeUnload = (e: BeforeUnloadEvent) => {
  if (!dirty) return;
  e.preventDefault();
  e.returnValue = '';
};

export function setUnsavedChanges(value: boolean) {
  dirty = value;
  if (typeof window === 'undefined') return;
  if (value && !listenerAttached) {
    window.addEventListener('beforeunload', onBeforeUnload);
    listenerAttached = true;
  } else if (!value && listenerAttached) {
    window.removeEventListener('beforeunload', onBeforeUnload);
    listenerAttached = false;
  }
}

export function hasUnsavedChanges() {
  return dirty;
}

/** True when it is OK to proceed (nothing unsaved, or the user confirmed). */
export function confirmDiscardUnsavedChanges(): boolean {
  if (!dirty || typeof window === 'undefined') return true;
  return window.confirm(UNSAVED_CHANGES_MESSAGE);
}
