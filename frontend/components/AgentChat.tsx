"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { getAuditTrail, sendAgentMessage } from "@/lib/api";
import { ApiError, AuditLogEntry, TransactionStatusResponse } from "@/lib/types";
import { openCheckout } from "@/lib/checkout";
import { Timeline } from "@/components/Timeline";
import { TransactionStatusCard } from "@/components/TransactionStatusStepper";

interface PendingCheckout {
  transactionId: string;
  razorpayOrderId: string;
  description: string;
}

interface ChatTurn {
  id: string;
  role: "user" | "agent" | "error";
  text: string;
  newEntries?: AuditLogEntry[]; // audit rows that appeared during this turn
  checkout?: PendingCheckout; // set when the agent created a real Razorpay order
  txStatus?: TransactionStatusResponse; // filled once checkout completes / is polled
  note?: string;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// P1-1 — POST /agent/message returns only {"response": "..."}: no
// tool-call trace, no session memory across calls (README §4: "no
// streaming, no session persistence"). Per the plan's frontend-only
// strengthening option, this diffs GET /audit/{consent_id} immediately
// before and after each turn and renders whatever new rows appeared
// underneath the reply — making the agent's otherwise-invisible tool
// calls visible without touching the backend.
export function AgentChat() {
  const [consentId, setConsentId] = useState("");
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("agentgate:last_consent_id");
    if (stored) setConsentId(stored);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || sending) return;

    const userTurn: ChatTurn = { id: newId(), role: "user", text: trimmed };
    setTurns((t) => [...t, userTurn]);
    setMessage("");
    setSending(true);

    const watchId = consentId.trim();
    let before: AuditLogEntry[] = [];
    if (watchId) {
      try {
        before = (await getAuditTrail(watchId)).entries;
      } catch {
        // Watching an audit trail is a bonus visual, not load-bearing —
        // if the lookup fails (bad id, backend down) just skip the diff.
      }
    }

    try {
      const res = await sendAgentMessage({ message: trimmed });
      let newEntries: AuditLogEntry[] | undefined;
      if (watchId) {
        try {
          const after = (await getAuditTrail(watchId)).entries;
          const beforeIds = new Set(before.map((e) => e.log_id));
          newEntries = after.filter((e) => !beforeIds.has(e.log_id));
        } catch {
          // Same as above — the reply still stands without the diff.
        }
      }
      const turnId = newId();
      const checkout: PendingCheckout | undefined =
        res.transaction_id && res.razorpay_order_id
          ? {
              transactionId: res.transaction_id,
              razorpayOrderId: res.razorpay_order_id,
              description: "Buyer-agent purchase",
            }
          : undefined;

      setTurns((t) => [
        ...t,
        { id: turnId, role: "agent", text: res.response, newEntries, checkout },
      ]);

      // Auto-open Checkout so the agent flow doesn't dead-end at `pending`
      // (the reservation sweep would expire it in 15 min). The manual
      // button below covers the case where Checkout.js wasn't ready yet.
      if (checkout) launchCheckout(turnId, checkout);
    } catch (e) {
      setTurns((t) => [
        ...t,
        {
          id: newId(),
          role: "error",
          text: e instanceof ApiError ? e.message : "Something went wrong.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function launchCheckout(turnId: string, c: PendingCheckout) {
    openCheckout({
      transactionId: c.transactionId,
      razorpayOrderId: c.razorpayOrderId,
      description: c.description,
      onStatus: (status) =>
        setTurns((t) => t.map((turn) => (turn.id === turnId ? { ...turn, txStatus: status } : turn))),
      onNote: (note) =>
        setTurns((t) => t.map((turn) => (turn.id === turnId ? { ...turn, note } : turn))),
    });
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col rounded-lg border border-border bg-surface shadow-card">
      <div className="border-b border-border p-4">
        <div className="text-sm font-semibold text-navy">Buyer Agent</div>
        <p className="mt-0.5 text-xs text-muted">
          POST /agent/message — a ReAct loop bound to browse_catalog_tool,
          check_consent_tool, execute_transaction_tool, and get_status_tool. Each
          message is a fresh, memory-less run: name the product and the consent id
          every time. If the agent creates an order, checkout opens here.
        </p>
        <label className="mt-3 block">
          <span className="block text-[11px] font-medium uppercase tracking-label text-faint">
            Watch audit trail for (optional)
          </span>
          <input
            value={consentId}
            onChange={(e) => setConsentId(e.target.value)}
            placeholder="c_a1b2c3d4-..."
            spellCheck={false}
            className="mt-1.5 w-full rounded-sm border border-border bg-surfaceMuted px-2.5 py-2 font-mono text-xs text-navy placeholder:text-faint focus:border-brand focus:bg-surface"
          />
        </label>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-faint">
            Try: "Buy me a bag of rice against consent {consentId || "c_..."}"
          </div>
        )}
        {turns.map((turn) => (
          <ChatBubble
            key={turn.id}
            turn={turn}
            onCheckout={() => turn.checkout && launchCheckout(turn.id, turn.checkout)}
          />
        ))}
        {sending && (
          <div className="flex items-center gap-1.5 text-xs text-faint">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
            Agent is thinking…
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-border p-3">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask the buyer agent to make a purchase…"
          disabled={sending}
          className="min-w-0 flex-1 rounded-sm border border-border bg-surfaceMuted px-3 py-2.5 text-sm text-navy placeholder:text-faint focus:border-brand focus:bg-surface disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={sending || !message.trim()}
          className="shrink-0 rounded-sm bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brandDark disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function ChatBubble({ turn, onCheckout }: { turn: ChatTurn; onCheckout: () => void }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg bg-brand px-3.5 py-2.5 text-sm text-white shadow-card">
          {turn.text}
        </div>
      </div>
    );
  }

  if (turn.role === "error") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] rounded-lg border border-danger/30 bg-dangerTint px-3.5 py-2.5 text-sm text-danger">
          {turn.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-2">
        <div className="rounded-lg border border-border bg-surfaceMuted px-3.5 py-2.5 text-sm leading-relaxed text-navy shadow-card">
          {turn.text}
        </div>
        {turn.newEntries && turn.newEntries.length > 0 && (
          <div className="rounded-lg border border-brand/25 bg-brandTint/40 p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-label text-brand">
              {turn.newEntries.length} new audit {turn.newEntries.length === 1 ? "row" : "rows"} since
              this message
            </div>
            <Timeline entries={turn.newEntries} showLegend={false} stagger />
          </div>
        )}
        {turn.newEntries && turn.newEntries.length === 0 && (
          <div className="text-[11px] text-faint">No new audit rows — no tool call touched this consent.</div>
        )}

        {turn.checkout && !turn.txStatus && (
          <button
            type="button"
            onClick={onCheckout}
            className="rounded-sm bg-brand px-3 py-2 text-xs font-semibold text-white transition hover:bg-brandDark"
          >
            Complete checkout (order {turn.checkout.razorpayOrderId.slice(0, 14)}…)
          </button>
        )}
        {turn.note && <div className="text-[11px] text-muted">{turn.note}</div>}
        {turn.txStatus && (
          <TransactionStatusCard status={turn.txStatus} polling={turn.txStatus.status === "pending"} />
        )}
      </div>
    </div>
  );
}
