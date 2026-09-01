interface Props {
  x: number;
  y: number;
}

export default function RecommendationPointHighlight({ x, y }: Props) {
  return (
    <g pointerEvents="none">
      <circle
        cx={x}
        cy={y}
        r={9.5}
        fill="none"
        stroke="rgba(232, 236, 244, 0.75)"
        strokeWidth={1.5}
        opacity={0.95}
        style={{ filter: "drop-shadow(0 0 9px #e8ecf4)" }}
      >
        <animate attributeName="opacity" values="0.65;1;0.65" dur="1.4s" repeatCount="indefinite" />
        <animate attributeName="r" values="9.5;12;9.5" dur="1.4s" repeatCount="indefinite" />
      </circle>
      <circle
        cx={x}
        cy={y}
        r={4.5 * 0.4}
        fill="#e8ecf4"
        opacity={0.95}
        style={{ filter: "drop-shadow(0 0 7px #e8ecf4)" }}
      >
        <animate attributeName="opacity" values="0.65;1;0.65" dur="1.4s" repeatCount="indefinite" />
      </circle>
    </g>
  );
}
