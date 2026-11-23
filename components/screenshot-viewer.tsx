"use client";
import { useEffect, useRef, useState } from "react";
export function ScreenshotViewer({ src }: { src: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    function zoom(event: WheelEvent) {
      event.preventDefault();
      const bounds = element!.getBoundingClientRect();
      const x = event.clientX - bounds.left - bounds.width / 2;
      const y = event.clientY - bounds.top - bounds.height / 2;
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? bounds.height
            : 1);
      setView((previous) => {
        const scale = Math.min(
          8,
          Math.max(0.25, previous.scale * Math.exp(-delta * 0.002)),
        );
        const ratio = scale / previous.scale;
        return {
          scale,
          x: x + (previous.x - x) * ratio,
          y: y + (previous.y - y) * ratio,
        };
      });
    }
    element.addEventListener("wheel", zoom, { passive: false });
    return () => element.removeEventListener("wheel", zoom);
  }, []);
  return (
    <div
      ref={viewport}
      className="screenshot-viewport"
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pointer.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
      }}
      onPointerMove={(event) => {
        const last = pointer.current;
        if (!last || last.id !== event.pointerId) return;
        const dx = event.clientX - last.x,
          dy = event.clientY - last.y;
        last.x = event.clientX;
        last.y = event.clientY;
        setView((previous) => ({
          ...previous,
          x: previous.x + dx,
          y: previous.y + dy,
        }));
      }}
      onLostPointerCapture={() => {
        pointer.current = null;
      }}
    >
      <img
        src={src}
        alt="商店截图预览"
        draggable={false}
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
      />
    </div>
  );
}
