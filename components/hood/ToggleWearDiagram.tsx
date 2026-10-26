// ToggleWear's architecture as a picture, drawn in the style of the
// diagrams on LaunchDarkly's architecture docs page (shown above it in the
// panel), so the two read as one set: dark ground, blue-outlined groups,
// lime icons and the LaunchDarkly mark. Inline SVG rather than an image so
// the text uses the store's fonts and stays sharp at any width.

export const GROUND = "#262626";
export const OUTLINE = "#6A6FE0";
export const LINE = "#8C8D90";
export const TEXT = "#F8F8F8";
export const MUTED = "#A7A9AC";
export const LIME = "#DDFF46";

export function Label({
  x,
  y,
  children,
  size = 13,
  color = TEXT,
  weight = 500,
  anchor = "start",
}: {
  x: number;
  y: number;
  children: string;
  size?: number;
  color?: string;
  weight?: number;
  anchor?: "start" | "middle" | "end";
}) {
  return (
    <text x={x} y={y} fill={color} fontSize={size} fontWeight={weight} textAnchor={anchor} className="font-sohne">
      {children}
    </text>
  );
}

function Chip({ x, y, width, children }: { x: number; y: number; width: number; children: string }) {
  return (
    <g>
      <rect x={x} y={y} width={width} height={24} rx={12} fill="#3A3A3A" />
      <Label x={x + width / 2} y={y + 16} size={11} weight={400} anchor="middle">
        {children}
      </Label>
    </g>
  );
}

function LaunchDarklyMark({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const size = r * 1.05;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#000000" />
      <image href="/icons/ld-logo-white.svg" x={cx - size / 2} y={cy - size / 2} width={size} height={size} />
    </g>
  );
}

export default function ToggleWearDiagram() {
  return (
    <svg
      viewBox="0 0 640 600"
      role="img"
      aria-labelledby="togglewear-diagram-title"
      className="h-auto w-full rounded-[12px]"
    >
      <title id="togglewear-diagram-title">
        ToggleWear&apos;s architecture: the shopper&apos;s browser and the ToggleWear server on
        Amazon Web Services both connect to LaunchDarkly, and the server calls Amazon Bedrock for
        its models.
      </title>
      <defs>
        <marker id="tw-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={LINE} />
        </marker>
      </defs>

      <rect width="640" height="600" rx="12" fill={GROUND} />

      {/* The shopper's browser */}
      <g>
        <rect x="176" y="26" width="48" height="32" rx="3" fill={LIME} />
        <rect x="182" y="32" width="36" height="20" rx="1" fill={GROUND} />
        <rect x="166" y="60" width="68" height="6" rx="3" fill={LIME} />
        <Label x={200} y={90} anchor="middle" size={14}>
          Shopper&apos;s browser
        </Label>
        <Label x={200} y={108} anchor="middle" size={11} color={MUTED} weight={400}>
          React SDK · Observability · Session Replay
        </Label>
      </g>

      {/* LaunchDarkly */}
      <g>
        <LaunchDarklyMark cx={540} cy={250} r={34} />
        <Label x={540} y={308} anchor="middle" size={14}>
          LaunchDarkly
        </Label>
        <Label x={540} y={326} anchor="middle" size={11} color={MUTED} weight={400}>
          Flags · AgentControl
        </Label>
        <Label x={540} y={342} anchor="middle" size={11} color={MUTED} weight={400}>
          Experiments · Observability
        </Label>
      </g>

      {/* Browser and LaunchDarkly */}
      <path d="M262 52 C 380 52, 500 120, 528 206" fill="none" stroke={LINE} strokeWidth="1.5" markerStart="url(#tw-arrow)" markerEnd="url(#tw-arrow)" />
      <Label x={360} y={72} size={11} color={MUTED} weight={400}>
        ↓ this shopper&apos;s flag values
      </Label>
      <Label x={360} y={88} size={11} color={MUTED} weight={400}>
        ↑ events, errors, replays
      </Label>

      {/* Amazon Web Services */}
      <rect x="20" y="150" width="420" height="430" rx="4" fill="none" stroke={OUTLINE} strokeWidth="1.5" />
      <Label x={36} y={176} size={14}>
        Amazon Web Services
      </Label>

      {/* Browser to the ingress */}
      <line x1="200" y1="118" x2="200" y2="196" stroke={LINE} strokeWidth="1.5" markerEnd="url(#tw-arrow)" />
      <Label x={210} y={142} size={11} color={MUTED} weight={400}>
        pages and /api calls
      </Label>

      {/* Ingress */}
      <rect x="44" y="200" width="372" height="58" rx="4" fill="none" stroke={LINE} strokeWidth="1" />
      <Label x={60} y={224}>
        NGINX ingress
      </Label>
      <Label x={60} y={243} size={11} color={MUTED} weight={400}>
        DNS in Route 53 · TLS from Let&apos;s Encrypt
      </Label>

      <line x1="200" y1="258" x2="200" y2="288" stroke={LINE} strokeWidth="1.5" markerEnd="url(#tw-arrow)" />

      {/* The pod */}
      <rect x="44" y="292" width="372" height="160" rx="4" fill="none" stroke={LIME} strokeWidth="1.5" />
      <Label x={60} y={316}>
        ToggleWear server · one pod on Amazon EKS
      </Label>
      <Label x={60} y={335} size={11} color={MUTED} weight={400}>
        Next.js API routes on Node.js
      </Label>
      <Chip x={60} y={350} width={160}>Node.js server SDK</Chip>
      <Chip x={228} y={350} width={172}>AI SDK and LangChain</Chip>
      <Chip x={60} y={382} width={160}>Observability plugin</Chip>
      <Chip x={228} y={382} width={172}>Bedrock access: Pod Identity</Chip>
      {/* In-memory flags and fallbacks, the docs diagram's right-hand side */}
      <g>
        <rect x="60" y="420" width="16" height="4" fill={TEXT} />
        <rect x="60" y="426" width="16" height="4" fill={TEXT} />
        <rect x="60" y="432" width="16" height="4" fill={TEXT} />
        <Label x={84} y={434} size={11} color={MUTED} weight={400}>
          Flags held in memory, with fallbacks in the code
        </Label>
      </g>

      {/* Pod and LaunchDarkly */}
      <path d="M416 372 C 480 372, 530 380, 540 350" fill="none" stroke={LINE} strokeWidth="1.5" markerStart="url(#tw-arrow)" markerEnd="url(#tw-arrow)" />
      <Label x={452} y={402} size={11} color={MUTED} weight={400}>
        ← every flag&apos;s rules,
      </Label>
      <Label x={452} y={417} size={11} color={MUTED} weight={400}>
        streamed
      </Label>
      <Label x={452} y={440} size={11} color={MUTED} weight={400}>
        → events, AI metrics,
      </Label>
      <Label x={452} y={455} size={11} color={MUTED} weight={400}>
        traces
      </Label>

      <line x1="200" y1="452" x2="200" y2="494" stroke={LINE} strokeWidth="1.5" markerEnd="url(#tw-arrow)" />
      <Label x={210} y={478} size={11} color={MUTED} weight={400}>
        model calls
      </Label>

      {/* Bedrock */}
      <rect x="44" y="498" width="372" height="58" rx="4" fill="none" stroke={LINE} strokeWidth="1" />
      <Label x={60} y={522}>
        Amazon Bedrock
      </Label>
      <Label x={60} y={541} size={11} color={MUTED} weight={400}>
        Claude, Nova and Llama models, chosen by AgentControl
      </Label>
    </svg>
  );
}
