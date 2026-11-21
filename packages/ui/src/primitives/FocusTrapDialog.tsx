import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface FocusTrapDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /**
   * When false, Escape dismissal is suppressed (e.g. an active un-cancellable
   * wallet signing state). Focus trapping remains active.
   */
  dismissible?: boolean;
  /** Optional element to return focus to; defaults to the captured trigger. */
  returnFocusTo?: HTMLElement | null;
}

const DialogContext = createContext<{ titleId: string } | null>(null);

export function useFocusTrapDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error('useFocusTrapDialog must be used within a FocusTrapDialog');
  }
  return ctx;
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export function FocusTrapDialog({
  open,
  onClose,
  title,
  children,
  dismissible = true,
  returnFocusTo,
}: FocusTrapDialogProps) {
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  // Capture the triggering element when the dialog opens.
  useEffect(() => {
    if (open) {
      triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    }
  }, [open]);

  // Move focus into the dialog on open.
  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;
    const focusable = getFocusable(container);
    (focusable[0] ?? container).focus();
  }, [open]);

  // Return focus deterministically on close.
  useEffect(() => {
    if (open) return;
    const target = returnFocusTo ?? triggerRef.current;
    if (target && document.contains(target)) {
      target.focus();
    } else {
      document.body.focus();
    }
  }, [open, returnFocusTo]);

  // Re-assert focus when an external window (wallet extension) closes.
  useEffect(() => {
    if (!open) return;
    const onWindowFocus = () => {
      const container = containerRef.current;
      if (!container) return;
      if (!container.contains(document.activeElement)) {
        const focusable = getFocusable(container);
        (focusable[0] ?? container).focus();
      }
    };
    window.addEventListener('focus', onWindowFocus);
    return () => window.removeEventListener('focus', onWindowFocus);
  }, [open]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        if (dismissibleRef.current) {
          event.stopPropagation();
          onClose();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = getFocusable(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <DialogContext.Provider value={{ titleId }}>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onKeyDown={handleKeyDown}
      >
        <div
          ref={containerRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </DialogContext.Provider>
  );
}
