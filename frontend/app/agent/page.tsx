import { AgentChat } from "@/components/AgentChat";

export default function AgentPage() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="mb-4">
        <div className="text-[11px] font-medium uppercase tracking-label text-faint">
          Not scripted — differentiator
        </div>
        <h1 className="mt-1 text-lg font-semibold text-navy">Buyer Agent chat</h1>
        <p className="mt-1 text-sm text-muted">
          Drive the LangGraph buyer agent directly instead of curling{" "}
          <code className="font-mono text-xs">POST /agent/message</code>.
        </p>
      </div>
      <AgentChat />
    </div>
  );
}
