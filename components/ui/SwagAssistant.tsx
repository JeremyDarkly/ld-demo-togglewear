import ChatLauncher from "@/components/ui/ChatLauncher";
import ChatPanel from "@/components/ui/ChatPanel";
import { useSwagAssistant } from "@/components/ui/SwagAssistantProvider";

// The launcher and the panel occupy the same corner, so only one is mounted
// at a time. Everything else about the assistant — whether it is open, what
// has been said, and which pricing the recommendations show — belongs to
// SwagAssistantProvider, so that it survives a page change and so that the
// cart can open it from the other side of the screen.
export default function SwagAssistant() {
  const {
    isOpen,
    open,
    close,
    messages,
    memberPricing,
    send,
    pending,
    rate,
    reset,
    expanded,
    toggleExpanded,
  } = useSwagAssistant();

  if (!isOpen) return <ChatLauncher onClick={open} />;

  return (
    <ChatPanel
      messages={messages}
      memberPricing={memberPricing}
      expanded={expanded}
      pending={pending}
      onSend={send}
      onRate={rate}
      onClose={close}
      onReset={reset}
      onToggleExpand={toggleExpanded}
    />
  );
}
