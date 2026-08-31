"use client";

import { useState } from "react";
import { useToast } from "@/components/Toast";

// P2-4 — small, noticeable win for live clicking-through: a copy icon
// next to any id the presenter would otherwise have to double-click and
// hope selects cleanly. `label` names what was copied so the toast reads
// "Consent ID copied" rather than a generic "Copied!".
export function CopyButton({
  value,
  label,
  className = "",
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const showToast = useToast();
  const [justCopied, setJustCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API can be unavailable (insecure context, permissions);
      // still show a toast so a presenter isn't left guessing why nothing
      // happened, and skip the checkmark since nothing was actually copied.
      showToast("Couldn't copy — clipboard access unavailable");
      return;
    }
    showToast(`${label} copied`);
    setJustCopied(true);
    setTimeout(() => setJustCopied(false), 1200);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Copy ${label.toLowerCase()}`}
      aria-label={`Copy ${label.toLowerCase()}`}
      className={`inline-flex shrink-0 items-center justify-center rounded-sm p-1 text-faint transition hover:bg-surfaceMuted hover:text-brand ${className}`}
    >
      {justCopied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <path
        d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M20 6 9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
