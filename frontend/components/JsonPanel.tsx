"use client";

import { useState } from "react";

export function JsonPanel({
  data,
  label = "Raw JSON",
  defaultOpen = false,
}: {
  data: unknown;
  label?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-label text-faint transition hover:text-brand"
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        {label}
      </button>
      {open && (
        <pre className="mt-2 max-h-96 overflow-auto rounded-sm border border-border bg-surfaceMuted px-3 py-2.5 text-[11px] leading-relaxed text-navySoft">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
