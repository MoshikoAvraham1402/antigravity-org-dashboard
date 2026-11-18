import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export default function FilterDropdown({
  label,
  value,
  options,
  onChange,
  disabled = false,
  includeAllOption = true,
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleOutsideClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const selectedLabel =
    value === 'ALL'
      ? `All ${label}s`
      : options.find((opt) => (typeof opt === 'string' ? opt === value : opt.value === value))?.label || value;

  return (
    <div ref={containerRef} className="relative z-30">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 bg-white dark:bg-[#0c0c0f] hover:bg-zinc-50 dark:hover:bg-zinc-800/80 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-3 py-2 text-xs font-medium transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="text-zinc-400 dark:text-zinc-500">{label}:</span>
        <span className="truncate max-w-[140px] font-semibold text-zinc-950 dark:text-zinc-100">
          {selectedLabel}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-56 bg-white dark:bg-[#0c0c0f] shadow-xl border border-zinc-200 dark:border-zinc-800 rounded-[12px] py-1.5 z-50 max-h-72 overflow-y-auto">
          {includeAllOption && (
            <>
              <button
                type="button"
                onClick={() => {
                  onChange('ALL');
                  setOpen(false);
                }}
                className="w-full flex items-center justify-between px-3.5 py-2 text-xs text-left text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <span>All {label}s</span>
                {value === 'ALL' && <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />}
              </button>
              <div className="my-1 border-t border-zinc-100 dark:border-zinc-800/80" />
            </>
          )}
          {options.map((opt) => {
            const optVal = typeof opt === 'string' ? opt : opt.value;
            const optLabel = typeof opt === 'string' ? opt : opt.label;
            const isSelected = value === optVal;
            return (
              <button
                key={optVal}
                type="button"
                onClick={() => {
                  onChange(optVal);
                  setOpen(false);
                }}
                className="w-full flex items-center justify-between px-3.5 py-2 text-xs text-left text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <span className="truncate pr-2">{optLabel}</span>
                {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
