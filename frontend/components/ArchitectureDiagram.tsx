// P2-3 — small SVG rendering of the README §2 ASCII architecture diagram,
// reusing GateMark's exact hex values (navy #0C2451 / brand blue #3395FF)
// so it reads as the same product rather than a bolted-on illustration.
// Gives the "architecture walkthrough" pitch beat something to point at
// in-app instead of switching to the README.
export function ArchitectureDiagram() {
  return (
    <svg
      viewBox="0 0 720 244"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full"
      role="img"
      aria-label="Buyer Agent talks to the AgentGate API, which serves a server-priced Catalog and runs a Consent Engine, a row-locked Transaction Executor, and an Audit Logger; the executor calls Razorpay Test Mode, and the Merchant Dashboard reads the audit trail."
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
      <rect x="12" y="92" width="130" height="60" rx="10" fill="#FFFFFF" stroke="#E3E8F1" />
      <text x="77" y="116" textAnchor="middle" fontSize="11" fontWeight="600" fill="#0C2451">
        Buyer Agent
      </text>
      <text x="77" y="131" textAnchor="middle" fontSize="8.5" fill="#64748B">
        LangGraph · ReAct · 4 tools
      </text>

      {/* Buyer Agent <-> API */}
      <line x1="142" y1="110" x2="200" y2="110" stroke="#94A3AF" strokeWidth="1.2" markerEnd="url(#arch-arrow)" />
      <line x1="200" y1="128" x2="142" y2="128" stroke="#94A3AF" strokeWidth="1.2" markerEnd="url(#arch-arrow)" />
      <text x="171" y="104" textAnchor="middle" fontSize="7.5" fill="#94A3AF">
        NL request
      </text>

      {/* AgentGate API outer box */}
      <rect x="200" y="10" width="230" height="224" rx="12" fill="#F6F8FC" stroke="#CBD5E4" />
      <text x="315" y="26" textAnchor="middle" fontSize="9" fontWeight="600" fill="#3E4C6B">
        AgentGate API (FastAPI)
      </text>

      {/* Catalog */}
      <rect x="216" y="34" width="198" height="32" rx="8" fill="#FFFFFF" stroke="#E3E8F1" />
      <text x="315" y="50" textAnchor="middle" fontSize="10" fontWeight="600" fill="#0C2451">
        Catalog
      </text>
      <text x="315" y="61" textAnchor="middle" fontSize="7.5" fill="#64748B">
        server-priced — agent names a SKU, not a price
      </text>

      <line x1="315" y1="66" x2="315" y2="78" stroke="#94A3AF" strokeWidth="1.2" markerEnd="url(#arch-arrow)" />

      {/* Consent Engine */}
      <rect x="216" y="78" width="198" height="32" rx="8" fill="#FFFFFF" stroke="#E3E8F1" />
      <text x="315" y="98" textAnchor="middle" fontSize="10" fontWeight="600" fill="#0C2451">
        Consent Engine
      </text>

      <line x1="315" y1="110" x2="315" y2="122" stroke="#94A3AF" strokeWidth="1.2" markerEnd="url(#arch-arrow)" />

      {/* Tx Executor */}
      <rect x="216" y="122" width="198" height="34" rx="8" fill="#EAF3FF" stroke="#3395FF" />
      <text x="315" y="139" textAnchor="middle" fontSize="10" fontWeight="600" fill="#1C6FE0">
        Tx Executor
      </text>
      <text x="315" y="150" textAnchor="middle" fontSize="7.5" fill="#1C6FE0">
        row-locked (SELECT … FOR UPDATE)
      </text>

      <line x1="315" y1="156" x2="315" y2="168" stroke="#94A3AF" strokeWidth="1.2" markerEnd="url(#arch-arrow)" />

      {/* Audit Logger */}
      <rect x="216" y="168" width="198" height="34" rx="8" fill="#FFFFFF" stroke="#E3E8F1" />
      <text x="315" y="186" textAnchor="middle" fontSize="10" fontWeight="600" fill="#0C2451">
        Audit Logger
      </text>
      <text x="315" y="197" textAnchor="middle" fontSize="7.5" fill="#64748B">
        deterministic, queryable trail
      </text>

      {/* Executor -> Razorpay (out the side of the API box) */}
      <line x1="414" y1="139" x2="470" y2="139" stroke="#94A3AF" strokeWidth="1.2" markerEnd="url(#arch-arrow)" />
      <rect x="470" y="116" width="238" height="46" rx="10" fill="#FFFFFF" stroke="#E3E8F1" strokeDasharray="4 3" />
      <text x="589" y="136" textAnchor="middle" fontSize="10" fontWeight="600" fill="#3E4C6B">
        Razorpay Test Mode API
      </text>
      <text x="589" y="149" textAnchor="middle" fontSize="7.5" fill="#94A3AF">
        orders · capture · webhooks
      </text>

      {/* Audit Logger -> Merchant Dashboard */}
      <line x1="414" y1="185" x2="470" y2="192" stroke="#94A3AF" strokeWidth="1.2" markerEnd="url(#arch-arrow)" />
      <rect x="470" y="174" width="238" height="36" rx="10" fill="#F0ECFC" stroke="#7C5CE0" />
      <text x="589" y="194" textAnchor="middle" fontSize="10" fontWeight="600" fill="#5B3FBF">
        Merchant Dashboard
      </text>
      <text x="589" y="205" textAnchor="middle" fontSize="7.5" fill="#5B3FBF">
        Next.js — Inspector · Timeline · live demos
      </text>
    </svg>
  );
}
