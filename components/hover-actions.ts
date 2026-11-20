import type { MouseEvent, PointerEvent } from "react";

// Opening a modal or file picker can interrupt the usual pointer-leave event.
export const hoverActionEvents = {
  onClickCapture(event: MouseEvent<HTMLElement>) {
    if (event.detail > 0) event.currentTarget.dataset.hoverDismissed = "true";
  },
  onPointerMove(event: PointerEvent<HTMLElement>) {
    delete event.currentTarget.dataset.hoverDismissed;
  },
};
