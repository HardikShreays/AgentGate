import { AgentChat } from "@/components/AgentChat";
import { PageHeader } from "@/components/PageHeader";

export default function AgentPage() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <PageHeader title="Buyer agent chat">
        Ask the LangGraph buyer agent to make a purchase against a consent. Each message
        is a fresh, memory-less run — name the product and the consent id every time. If
        the agent creates an order, checkout opens right here.
      </PageHeader>
      <AgentChat />
    </div>
  );
}
