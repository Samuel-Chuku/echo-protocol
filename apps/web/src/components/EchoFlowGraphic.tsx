const CENTER = { x: 320, y: 190 };

// Genericized: labels describe the flow (stake → advance → earn USDC + reputation) without asserting
// specific dollar amounts, since payouts are set per market by the requester.
const NODES = [
  { key: 'submit', label: 'Submit', amount: 'stake', x: 320, y: 60 },
  { key: 'shortlist', label: 'Shortlist', amount: '+USDC', x: 443.6, y: 149.8 },
  { key: 'final', label: 'Final', amount: '+USDC', x: 396.4, y: 295.2 },
  { key: 'win', label: 'Win', amount: 'Badge', x: 243.6, y: 295.2 },
  { key: 'reputation', label: 'Reputation', amount: '+Rep', x: 196.4, y: 149.8 },
];

/** Animated SVG of the Echo flow: stake, advance through tiers, earn USDC + reputation. CSS/SMIL only. */
export function EchoFlowGraphic() {
  return (
    <svg
      viewBox="0 0 640 380"
      className="w-full h-auto max-h-[340px]"
      role="img"
      aria-label="Echo protocol flow: submit a stake, advance through shortlist and final tiers, win, and build reputation"
    >
      {[0, 1, 2].map((i) => (
        <circle
          key={`pulse-${i}`}
          cx={CENTER.x}
          cy={CENTER.y}
          r={74}
          fill="none"
          stroke="#00E5C0"
          strokeWidth={1.5}
          strokeOpacity={0.35}
          className="echo-pulse-ring"
          style={{ animationDelay: `${i}s` }}
        />
      ))}

      {NODES.map((n) => (
        <line
          key={`line-${n.key}`}
          x1={CENTER.x}
          y1={CENTER.y}
          x2={n.x}
          y2={n.y}
          stroke="#00E5C0"
          strokeOpacity={0.25}
          strokeWidth={1.5}
          className="echo-flow-line"
        />
      ))}

      {NODES.map((n, i) => (
        <circle key={`dot-${n.key}`} r={4} fill="#00E5C0">
          <animateMotion
            path={`M${CENTER.x},${CENTER.y} L${n.x},${n.y}`}
            dur="2.4s"
            begin={`${i * 0.3}s`}
            repeatCount="indefinite"
          />
        </circle>
      ))}

      {NODES.map((n, i) => (
        <g key={n.key} className="echo-node-float" style={{ animationDelay: `${i * 0.4}s` }}>
          <circle cx={n.x} cy={n.y} r={28} fill="#0A2540" stroke="#00E5C0" strokeOpacity={0.4} strokeWidth={1.5} />
          <text x={n.x} y={n.y - 4} textAnchor="middle" className="fill-white text-[11px] font-semibold">
            {n.label}
          </text>
          <text x={n.x} y={n.y + 10} textAnchor="middle" className="fill-teal-400 text-[10px] font-mono">
            {n.amount}
          </text>
        </g>
      ))}

      {/* Center: teal disc with the official Echo mark (navy, tuned for contrast on teal). */}
      <circle cx={CENTER.x} cy={CENTER.y} r={70} fill="#00E5C0" />
      <image
        href="/logo-navy-mark.png"
        x={CENTER.x - 39}
        y={CENTER.y - 44}
        width={78}
        height={88}
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  );
}
