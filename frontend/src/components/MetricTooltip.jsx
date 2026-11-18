import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, Sparkles } from 'lucide-react';

export default function MetricTooltip({
  title,
  description,
  formula,
  benchmark,
  align = 'center',
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, placeBelow: true });
  const triggerRef = useRef(null);
  const TOOLTIP_WIDTH = 296;

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const vw = window.innerWidth || 1280;

    // Flip below if near top sticky command bar so popover is never occluded
    const placeBelow = rect.top < 220;
    const top = placeBelow ? rect.bottom + 8 : rect.top - 8;

    let rawLeft = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
    if (align === 'right') {
      rawLeft = rect.right - TOOLTIP_WIDTH;
    } else if (align === 'left') {
      rawLeft = rect.left;
    }
    const left = Math.max(12, Math.min(vw - TOOLTIP_WIDTH - 12, rawLeft));

    setCoords({ top, left, placeBelow });
  }, [align]);

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();
    const handleScrollOrResize = () => updatePosition();
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [open, updatePosition]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Metric definition: ${title}`}
        onMouseEnter={() => {
          updatePosition();
          setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => {
          updatePosition();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          updatePosition();
          setOpen((prev) => !prev);
        }}
        className="inline-flex items-center justify-center rounded-full p-0.5 text-zinc-400 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-colors shrink-0"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              width: `${TOOLTIP_WIDTH}px`,
              transform: coords.placeBelow ? 'none' : 'translateY(-100%)',
              zIndex: 9999,
            }}
            className="pointer-events-none rounded-[11px] bg-white/98 dark:bg-[#111116]/98 backdrop-blur-md border border-zinc-200 dark:border-zinc-700/90 shadow-2xl p-3.5 text-left normal-case tracking-normal font-sans"
          >
            <div className="text-xs font-bold text-zinc-950 dark:text-zinc-50 mb-1">
              {title}
            </div>
            <p className="text-[11.5px] leading-relaxed text-zinc-600 dark:text-zinc-300 font-normal">
              {description}
            </p>

            {formula && (
              <div className="mt-2 px-2.5 py-1.5 rounded-md bg-zinc-100/90 dark:bg-zinc-900/95 border border-zinc-200/80 dark:border-zinc-800 text-[10.5px] font-mono text-zinc-700 dark:text-zinc-300 leading-snug">
                <span className="text-zinc-400 dark:text-zinc-500 select-none">Formula: </span>
                {formula}
              </div>
            )}

            {benchmark && (
              <div className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-emerald-700 dark:text-emerald-400 font-medium">
                <Sparkles className="w-3 h-3 shrink-0 mt-0.5" />
                <span>{benchmark}</span>
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
