import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import ThumbButton from "@/components/ui/ThumbButton";
import { type PastOrder } from "@/lib/account";
import { resolveLines } from "@/lib/cart";
import { formatPrice, memberPriceUsd, type Product } from "@/lib/products";
import {
  SUGGESTED_PROMPTS,
  type ChatMessage,
  type FeedbackKind,
  type LiveVariation,
} from "@/lib/swagAssistant";

// A compact version of the product card for use inside a chat bubble. The
// full ProductCard is built for a 305px grid column and is too tall here.
function ChatProduct({
  product,
  memberPricing,
}: {
  product: Product;
  memberPricing: boolean;
}) {
  return (
    <Link
      href={`/products/${product.slug}`}
      className="flex items-center gap-3 rounded-[12px] border border-grays-02 bg-grays-white p-2 transition-colors hover:border-grays-04"
    >
      {/* 40x56 rather than square, so the portrait photos are not cropped. */}
      <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-[2px] bg-grays-02">
        <Image
          src={product.image}
          alt={product.name}
          fill
          sizes="40px"
          className="object-cover"
        />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-sohne text-small font-medium text-grays-ld-black">
          {product.name}
        </p>
        {memberPricing ? (
          <p className="font-sohne text-xsmall">
            <span className="text-grays-04 line-through">
              {formatPrice(product.priceUsd)}
            </span>{" "}
            <span className="font-bold text-grays-ld-black">
              {formatPrice(memberPriceUsd(product.priceUsd))}
            </span>
          </p>
        ) : (
          <p className="font-sohne text-xsmall text-grays-04">
            {formatPrice(product.priceUsd)}
          </p>
        )}
      </div>
    </Link>
  );
}

// A preview of an order the reply talks about: enough to answer "where is
// it" at a glance, with the account page a click away for the tracking
// timeline and the rest of the order history.
function ChatOrder({ order }: { order: PastOrder }) {
  const lines = resolveLines(order.lines);
  const first = lines[0];
  const others = lines.length - 1;
  const date = new Date(order.arrivesOn).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <Link
      href="/account"
      className="flex flex-col gap-2 rounded-[12px] border border-grays-02 bg-grays-white p-2 transition-colors hover:border-grays-04"
    >
      <div className="flex items-center gap-3">
        {first && (
          <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-[2px] bg-grays-02">
            <Image
              src={first.product.image}
              alt={first.product.name}
              fill
              sizes="40px"
              className="object-cover"
            />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-sohne text-small font-medium text-grays-ld-black">
              {order.ref}
            </p>
            <p className="shrink-0 font-sohne text-xsmall-caps font-medium uppercase text-grays-04">
              {order.status}
            </p>
          </div>
          {first && (
            <p className="truncate font-sohne text-xsmall text-grays-04">
              {first.product.name} / {first.size}
              {others > 0 && ` + ${others} more`}
            </p>
          )}
          <p className="font-sohne text-xsmall text-grays-04">
            {order.status === "Delivered" ? `Delivered ${date}` : `Arrives ${date}`}
          </p>
        </div>
      </div>

      <p className="border-t border-grays-02 pt-2 font-sohne text-xsmall text-base-blue">
        View in your account
      </p>
    </Link>
  );
}

// The line under a reply: which variation of the Swag Assistant AI Config
// wrote it, and the thumbs that rate it. It is how a demo shows targeting
// at work without leaving the store: switch from a guest to a Gold member,
// ask the same thing, and the label changes along with the answer.
function ReplyFooter({
  message,
  onRate,
}: {
  message: ChatMessage;
  onRate: (messageId: string, kind: FeedbackKind) => void;
}) {
  if (message.scripted) {
    return (
      <p className="font-sohne text-xsmall text-grays-03">
        Scripted reply · the AI Config is off
      </p>
    );
  }
  if (!message.servedBy || !message.replyId) return null;

  return (
    <div className="flex items-center gap-2 font-sohne text-xsmall text-grays-03">
      <span>
        {message.servedBy.variation} · {message.servedBy.model}
      </span>
      <span className="flex items-center gap-0.5">
        {(["positive", "negative"] as const).map((kind) => (
          <ThumbButton
            key={kind}
            kind={kind}
            chosen={message.feedback === kind}
            disabled={Boolean(message.feedback)}
            onClick={() => onRate(message.id, kind)}
          />
        ))}
      </span>
    </div>
  );
}

// The variation LaunchDarkly is serving this shopper, under the panel title.
// It follows the AI Config's flag in the browser, so changing targeting in
// LaunchDarkly changes it within a second, with no question asked. Keyed on
// the label so each change replays the flash rather than just swapping text.
function LiveBadge({ live }: { live: LiveVariation }) {
  const off = live === "off";
  const label = off
    ? "AI Config off · scripted replies"
    : `${live.variation} · ${live.model}`;

  return (
    <span
      key={label}
      className="-ml-1.5 flex animate-badge-flash items-center gap-1.5 rounded-full px-1.5 py-0.5 font-sohne text-xsmall text-grays-03"
    >
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${off ? "bg-grays-04" : "bg-base-lime"}`}
      />
      {label}
    </span>
  );
}

// A line across the conversation where the serving variation changed, so the
// replies either side of it can be told apart at a glance.
function NoticeLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 font-sohne text-xsmall text-grays-04">
      <span aria-hidden="true" className="h-px flex-1 bg-grays-02" />
      <span className="text-center">{text}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-grays-02" />
    </div>
  );
}

// Three dots in the assistant's bubble while a reply is on its way. A real
// model takes a few seconds, more when it calls tools, and an empty panel
// for that long reads as broken.
function TypingBubble({ expanded }: { expanded: boolean }) {
  return (
    <div
      role="status"
      aria-label="The swag assistant is typing"
      className={`flex items-center gap-1 self-start rounded-[12px] bg-grays-01 ${
        expanded ? "px-4 py-3.5" : "px-3 py-3"
      }`}
    >
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1.5 animate-bounce rounded-full bg-grays-03"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}

// The expanded swag assistant. Jen designed only the collapsed launcher, so
// this panel is a proposal built from her tokens: the 30px panel radius, the
// 12px radius she uses on buttons, LD Black chrome, Base/Blue for the
// customer's own messages, and Geist for the uppercase label.
// The expand and collapse glyphs: corner brackets pointing out of the box and
// then into it. Drawn inline like the close cross, since the icon set Jen
// exported has nothing for either.
const EXPAND_PATH = "M6 2H2v4M10 14h4v-4";
const COLLAPSE_PATH = "M2 6h4V2M14 10h-4v4";

export default function ChatPanel({
  messages,
  memberPricing,
  expanded,
  pending,
  live,
  onSend,
  onRate,
  onClose,
  onReset,
  onToggleExpand,
}: {
  messages: ChatMessage[];
  memberPricing: boolean;
  expanded: boolean;
  pending: boolean;
  live: LiveVariation | null;
  onSend: (text: string) => void;
  onRate: (messageId: string, kind: FeedbackKind) => void;
  onClose: () => void;
  onReset: () => void;
  onToggleExpand: () => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    onSend(trimmed);
    setDraft("");
  }

  return (
    <div
      role="dialog"
      aria-label="Swag Assistant"
      // Expanding is mostly a width change, because height runs out first: a
      // 726px-tall window leaves 676px after the margins, so anything past
      // that is clamped by max-h and the number stops meaning anything. 760
      // is for the taller monitor, not the laptop.
      //
      // Filling the viewport vertically was the obvious move and the wrong
      // one. A conversation stacks upward from the input, so most of a tall
      // panel is room it has not grown into yet, and the header ends up far
      // enough away to be a journey.
      className={`fixed bottom-[25px] right-[30px] z-40 flex max-h-[calc(100vh-50px)] w-[calc(100vw-60px)] flex-col overflow-hidden rounded-[30px] bg-grays-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] transition-[max-width,height] duration-200 ease-out ${
        expanded ? "h-[760px] max-w-[880px]" : "h-[600px] max-w-[400px]"
      }`}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 bg-grays-ld-black px-5 py-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <img
            src="/icons/ld-logo.svg"
            alt=""
            className="mt-px size-4 max-w-none brightness-0 invert"
          />
          <div className="flex min-w-0 flex-col items-start gap-0.5">
            <span className="font-geist text-[12px] font-semibold uppercase tracking-[1.2px] text-grays-01">
              Swag Assistant
            </span>
            <div aria-live="polite">{live && <LiveBadge live={live} />}</div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {/* A word, not a third glyph: two icons that both mean "undo
              something" sitting side by side is the same trap the search
              field fell into with its two crosses. Hidden until there is
              actually a conversation to throw away. */}
          {messages.length > 1 && (
            <button
              type="button"
              onClick={onReset}
              className="font-sohne text-xsmall-caps font-medium uppercase text-grays-03 transition-colors hover:text-grays-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-white"
            >
              Reset
            </button>
          )}

          <button
            type="button"
            onClick={onToggleExpand}
            aria-pressed={expanded}
            aria-label={expanded ? "Shrink swag assistant" : "Expand swag assistant"}
            className="text-grays-03 transition-colors hover:text-grays-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-white"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d={expanded ? COLLAPSE_PATH : EXPAND_PATH}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close swag assistant"
            className="text-grays-03 transition-colors hover:text-grays-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-white"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex flex-1 flex-col overflow-y-auto px-5 py-4"
      >
        {/* mt-auto settles a short conversation against the input instead of
            stranding the greeting at the top above a column of white, which
            is what every messenger does and what the panel looked wrong
            without. It stops applying as soon as the messages are taller
            than the panel, so it does not interfere with scrolling. */}
        <div className="mt-auto flex flex-col gap-4">
          {messages.map((m) =>
            m.notice ? (
              <NoticeLine key={m.id} text={m.text} />
            ) : (
            <div key={m.id} className="flex flex-col gap-2">
            {/* Expanding steps the message type from 14px to 16px. A wider
                box on its own only lengthens the lines; the thing that makes
                a conversation easier to read, and legible to a room watching
                a shared screen, is larger type. The padding grows with it so
                the bubbles do not end up tight around bigger text. */}
            {/* pre-line keeps the paragraph breaks a longer answer comes
                with, which would otherwise collapse into one block. */}
            <div
              className={`whitespace-pre-line rounded-[12px] font-sohne ${
                expanded ? "px-4 py-2.5 text-main" : "px-3 py-2 text-small"
              } ${
                m.role === "user"
                  ? "max-w-[80%] self-end bg-base-blue text-grays-white"
                  : m.failed
                    ? "max-w-[85%] self-start bg-grays-01 text-grays-04"
                    : "max-w-[85%] self-start bg-grays-01 text-grays-ld-black"
              }`}
            >
              {m.text}
            </div>

              {m.products && m.products.length > 0 && (
                <div className="flex max-w-[85%] flex-col gap-2 self-start">
                  {m.products.map((p) => (
                    <ChatProduct
                      key={p.slug}
                      product={p}
                      memberPricing={memberPricing}
                    />
                  ))}
                </div>
              )}

              {m.orders && m.orders.length > 0 && (
                <div className="flex w-full max-w-[85%] flex-col gap-2 self-start">
                  {m.orders.map((o) => (
                    <ChatOrder key={o.ref} order={o} />
                  ))}
                </div>
              )}

              {(m.scripted || m.replyId) && (
                <div className="self-start">
                  <ReplyFooter message={m} onRate={onRate} />
                </div>
              )}
            </div>
            ),
          )}

          {pending && <TypingBubble expanded={expanded} />}

          {messages.length === 1 && !pending && (
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => submit(p)}
                  className="rounded-full border border-grays-02 px-3 py-1.5 font-sohne text-xsmall text-grays-04 transition-colors hover:border-grays-ld-black hover:text-grays-ld-black"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
        className="flex shrink-0 items-center gap-2 border-t border-grays-02 p-4"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about sizing, shipping, anything"
          aria-label="Message the swag assistant"
          // Scales with the messages, since a 14px field under 16px replies
          // would be the one thing in the panel that got smaller.
          className={`h-10 min-w-0 flex-1 rounded-[10px] border border-grays-02 bg-grays-white px-3 font-sohne text-grays-ld-black placeholder:text-grays-03 focus:border-grays-ld-black focus:outline-none ${
            expanded ? "text-main" : "text-small"
          }`}
        />

        <button
          type="submit"
          disabled={!draft.trim() || pending}
          aria-label="Send message"
          className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-grays-ld-black bg-base-lime text-grays-ld-black transition-opacity disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-ld-black focus-visible:ring-offset-2"
        >
          <img
            src="/icons/arrow-link.svg"
            alt=""
            width={15.619}
            height={11.714}
            className="max-w-none"
          />
        </button>
      </form>
    </div>
  );
}
