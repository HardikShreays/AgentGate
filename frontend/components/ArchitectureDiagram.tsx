// P2-3 — small SVG rendering of the README §2 ASCII architecture diagram,
// reusing GateMark's exact hex values (navy #0C2451 / brand blue #3395FF)
// so it reads as the same product rather than a bolted-on illustration.
// Gives the 0:30 "architecture walkthrough" pitch beat something to
// point at in-app instead of switching to the README.
export function ArchitectureDiagram() {
  return (
    <svg
      viewBox="0 0 720 200"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full"
      role="img"
      aria-label="Buyer Agent talks to the AgentGate API, which runs a Consent Engine, a row-locked Transaction Executor, and an Audit Logger; the executor calls Razorpay Test Mode, and the Merchant Dashboard reads the audit trail."
    >
      <defs>
        <marker
          id="arch-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 Z" fill="#94A3AF" />
        </marker>
      </defs>

      {/* Buyer Agent */}
      <rect x="12" y="70" width="130" height="60" rx="10" fill="#FFFFFF" stroke="#E3E8F1" />
      <text x="77" y="94" textAnchor="middle" fontSize="11" fontWeight="600" fill="#0C2451">
        Buyer Agent
      </text>
      <text x="77" y="109" textAnchor="middle" fontSize="8.5" fill="#64748B">
        LangGraph · ReAct · 3 tools
      </text>

      {/* Buyer Agent <-> API */}
      <line x1="142" y1="88" x2="200" y2="88" stroke="#94A3AF" strokeWidth="1.2" markerEnd="url(#arch-arrow)" />
      <line x1="200" y1="106" x2="142" y2="106" stroke="#94A3AF" strokeWidth="1.2" markerEnd="url(#arch-arrow)" />
      <text x="171" y="82" textAnchor="middle" fontSize="7.5" fill="#94A3AF">
        NL request
      </text>

      {/* AgentGate API outer box */}
      <rect x="200" y="12" width="230" height="164" rx="12" fill="#F6F8FC" stroke="#CBD5E4" />
      <text x="315" y="28" textAnchor="middle" fontSize="9" fontWeight="600" fill="#3E4C6B">
        AgentGate API (FastAPI)
      </text>

      {/* Consent Engine */}
      <rect x="216" y="38" width="198" height="34" rx="8" fill="#FFFFFF" stroke="#E3E8F1" />
      <text x="315" y="59" textAnchor="middle" fontSize="10" fontWeight="600" fill="#0C2451">
        Consent Engine
      </text>

      <line x1="315" y1="72" x2="315" y2="86" stroke="#94A3AF" strokeWidth="1.2" markerEnd="url(#arch-arrow)" />

      {/* Tx Executor */}
      <rect x="216" y="86" width="198" height="34" rx="8" fill="#EAF3FF" stroke="#3395FF" />
      <text x="315" y="103" textAnchor="middle" fontSize="10" fontWeight="600" fill="#1C6FE0">
        Tx Executor
      </text>
      <text x="315" y="114" textAnchor="middle" fontSize="7.5" fill="#1C6FE0">
        row-locked (SELECT … FOR UPDATE)
      </text>

      <line x1="315" y1="120" x2="315" y2="134" stroke="#94A3AF" strokeWidth="1.2" markerEnd="url(#arch-arrow)" />

      {/* Audit Logger */}
      <rect x="216" y="134" width="198" height="34" rx="8" fill="#FFFFFF" stroke="#E3E8F1" />
      <text x="315" y="152" textAnchor="middle" fontSize="10" fontWeight="600" fill="#0C2451">
        Audit Logger
      </text>
      <text x="315" y="163" textAnchor="middle" fontSize="7.5" fill="#64748B">
        deterministic, queryable trail
      </text>

      {/* Executor -> Razorpay (out the side of the API box) */}
      <line x1="414" y1="103" x2="470" y2="103" stroke="#94A3AF" strokeWidth="1.2" markerEnd="url(#arch-arrow)" />
      <rect x="470" y="80" width="238" height="46" rx="10" fill="#FFFFFF" stroke="#E3E8F1" strokeDasharray="4 3" />
      <text x="589" y="100" textAnchor="middle" fontSize="10" fontWeight="600" fill="#3E4C6B">
        Razorpay Test Mode API
      </text>
      <text x="589" y="113" textAnchor="middle" fontSize="7.5" fill="#94A3AF">
        orders · capture · webhooks
      </text>

      {/* Audit Logger -> Merchant Dashboard */}
      <line x1="414" y1="151" x2="470" y2="158" stroke="#94A3AF" strokeWidth="1.2" markerEnd="url(#arch-arrow)" />
      <rect x="470" y="140" width="238" height="36" rx="10" fill="#F0ECFC" stroke="#7C5CE0" />
      <text x="589" y="160" textAnchor="middle" fontSize="10" fontWeight="600" fill="#5B3FBF">
        Merchant Dashboard
      </text>
      <text x="589" y="171" textAnchor="middle" fontSize="7.5" fill="#5B3FBF">
        Next.js — Inspector · Timeline · live demos
      </text>
    </svg>
  );
}
