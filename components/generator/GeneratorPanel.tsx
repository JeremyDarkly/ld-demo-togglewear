import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useDialog } from "@/components/ui/useDialog";
import {
  GENERATOR_GROUPS,
  GENERATORS,
  isActive,
  type GeneratorId,
  type GeneratorInfo,
  type GeneratorStatus,
} from "@/lib/generator/catalog";
import type { GeneratorsResponse } from "@/pages/api/generators";

// The demo generator's remote control, opened with Cmd+K (Ctrl+K elsewhere),
// the shortcut users know from ToggleBank's. The generators themselves run on
// the server (lib/generator/runner.ts), so this only starts and stops them
// and reads back where they are up to — closing it, refreshing or shopping
// on changes nothing.
//
// Chrome borrowed from the shipment dialog, the account page's precedent.

const POLL_MS = 1000;

async function request(init?: RequestInit) {
  const res = await fetch("/api/generators", init);
  if (!res.ok) throw new Error(`Generator API answered ${res.status}`);
  return ((await res.json()) as GeneratorsResponse).generators;
}

function elapsed(status: GeneratorStatus, now: number) {
  if (!status.startedAt) return "";
  const seconds = Math.max(
    0,
    Math.round(((status.endedAt ?? now) - status.startedAt) / 1000),
  );
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

const STATE_LABEL: Record<GeneratorStatus["state"], string> = {
  idle: "",
  waiting: "Waiting",
  running: "Running",
  done: "Finished",
  stopped: "Stopped",
  error: "Couldn't run",
};

function StatusDot({ state }: { state: GeneratorStatus["state"] }) {
  if (state === "running") {
    return (
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-base-lime opacity-75 motion-reduce:animate-none" />
        {/* Ringed, because the palette's lime alone all but disappears on
            the light grey status strip. */}
        <span className="relative inline-flex size-2 rounded-full bg-base-lime ring-1 ring-grays-ld-black" />
      </span>
    );
  }
  const colour =
    state === "waiting"
      ? "bg-base-blue"
      : state === "error"
        ? "bg-base-orange"
        : "bg-grays-03";
  return <span className={`size-2 shrink-0 rounded-full ${colour}`} />;
}

// Lime and orange because the palette has no green or red; orange is
// already what the status dot uses for a run that went wrong.
function OutcomeTag({ outcome }: { outcome: NonNullable<GeneratorInfo["outcome"]> }) {
  const succeeds = outcome === "succeeds";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 font-sohne text-xsmall font-semibold text-grays-ld-black ${
        succeeds ? "bg-base-lime" : "bg-base-orange"
      }`}
    >
      {succeeds ? "Succeeds" : "Rolls back"}
    </span>
  );
}

function GeneratorCard({
  info,
  status,
  now,
  busy,
  onAction,
}: {
  info: GeneratorInfo;
  status: GeneratorStatus | undefined;
  now: number;
  busy: boolean;
  onAction: (id: GeneratorId, action: "start" | "stop") => void;
}) {
  const state = status?.state ?? "idle";
  const active = isActive(state);

  return (
    <li className="flex flex-col gap-3 rounded-[16px] border border-grays-hairline p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {/* The flag's number as it reads in LaunchDarkly's flag list, so
              the two can be matched at a glance. */}
          <span className="mt-0.5 shrink-0 rounded-[4px] bg-grays-ld-black px-1.5 py-0.5 font-sohne-mono text-xsmall-mono text-base-lime">
            {info.flag}
          </span>
          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="font-sohne text-main font-medium text-grays-ld-black">
                {info.name}
              </p>
              {info.outcome && <OutcomeTag outcome={info.outcome} />}
            </div>
            <p className="font-sohne text-small font-medium text-grays-05">{info.kind}</p>
          </div>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => onAction(info.id, active ? "stop" : "start")}
          className={
            active
              ? "shrink-0 rounded-full border border-grays-02 px-4 py-2 font-sohne text-small font-medium text-grays-ld-black transition-colors hover:border-grays-04 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-ld-black focus-visible:ring-offset-2"
              : "shrink-0 rounded-full bg-grays-ld-black px-4 py-2 font-sohne text-small font-medium text-grays-white transition-colors hover:bg-grays-black-01 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-ld-black focus-visible:ring-offset-2"
          }
        >
          {active ? "Stop" : state === "idle" ? "Start" : "Run again"}
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <p className="font-sohne text-small text-grays-ld-black">{info.does}</p>
        <p className="font-sohne text-small text-grays-04">{info.purpose}</p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-sohne text-xsmall">
        <dt className="text-grays-04">Before you start</dt>
        <dd className="text-grays-ld-black">{info.before}</dd>
        <dt className="text-grays-04">Stops on its own</dt>
        <dd className="text-grays-ld-black">{info.stops}</dd>
      </dl>

      {status && state !== "idle" && (
        <div className="flex items-start gap-2.5 rounded-[10px] bg-grays-01 px-3 py-2.5">
          <span className="mt-[5px]">
            <StatusDot state={state} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="font-sohne text-xsmall text-grays-ld-black">
              <span className="font-medium">{STATE_LABEL[state]}.</span>{" "}
              {status.detail}
            </p>
            <p className="font-sohne-mono text-xsmall-mono text-grays-04">
              {elapsed(status, now)}
              {status.sent > 0 &&
                ` · ${status.sent.toLocaleString()}${
                  status.total ? ` of ${status.total.toLocaleString()}` : ""
                } sent`}
            </p>
          </div>
        </div>
      )}
    </li>
  );
}

export default function GeneratorPanel({ onClose }: { onClose: () => void }) {
  const [statuses, setStatuses] = useState<GeneratorStatus[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<GeneratorId | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const panel = useRef<HTMLDivElement>(null);

  useDialog(onClose);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  // Polled only while open; nothing about a generator depends on this panel
  // watching it.
  useEffect(() => {
    let cancelled = false;
    const poll = () =>
      request()
        .then((next) => {
          if (cancelled) return;
          setStatuses(next);
          setFailed(false);
          setNow(Date.now());
        })
        .catch(() => !cancelled && setFailed(true));
    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const act = useCallback(async (id: GeneratorId, action: "start" | "stop") => {
    setBusy(id);
    try {
      setStatuses(
        await request({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, action }),
        }),
      );
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }, []);

  const statusFor = (id: GeneratorId) => statuses?.find((s) => s.id === id);
  const running = statuses?.filter((s) => isActive(s.state)).length ?? 0;

  return createPortal(
    <div
      onClick={onClose}
      className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-grays-ld-black/60 p-6"
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="generator-heading"
        onClick={(event) => event.stopPropagation()}
        className="animate-drop-in flex max-h-full w-full max-w-[640px] flex-col overflow-hidden rounded-[30px] bg-grays-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] focus-visible:outline-none"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 bg-grays-ld-black px-6 py-4">
          <span className="flex items-center gap-3">
            <span className="font-geist text-[12px] font-semibold uppercase tracking-[1.2px] text-grays-01">
              Demo generator
            </span>
            {running > 0 && (
              <span className="flex items-center gap-1.5 rounded-full bg-grays-black-01 px-2.5 py-1 font-sohne text-[11px] font-medium text-base-lime">
                <span className="size-1.5 rounded-full bg-base-lime" />
                {running} running
              </span>
            )}
          </span>

          <span className="flex items-center gap-4">
            <kbd className="font-sohne-mono text-xsmall-mono text-grays-03">⌘K</kbd>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close demo generator"
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
          </span>
        </header>

        <div className="flex flex-col gap-6 overflow-y-auto px-6 pb-6 pt-6">
          {/* For whoever opens this without knowing what it is. */}
          <div className="flex flex-col gap-2">
            <h2
              id="generator-heading"
              className="font-sohne text-h6 font-medium text-grays-ld-black"
            >
              Demo data generator
            </h2>
            <p className="font-sohne text-small text-grays-04">
              Plays the part of ToggleWear&apos;s backend services and visitors,
              so the scenarios with no screen in the store have something to
              show in LaunchDarkly: guarded releases, experiment results and
              the automatic triggers.
            </p>
            <p className="font-sohne text-small text-grays-04">
              It runs on the server, so you can close this, refresh or keep
              shopping. Each one stops by itself when its story is over.
            </p>
          </div>

          {failed && (
            <p className="rounded-[10px] bg-base-orange/15 px-3 py-2.5 font-sohne text-xsmall text-grays-ld-black">
              Can&apos;t reach the generator on the server. Retrying.
            </p>
          )}

          {GENERATOR_GROUPS.map((group) => (
            <section key={group} className="flex flex-col gap-3">
              <h3 className="font-sohne-mono text-xsmall-mono uppercase text-grays-04">
                {group}
              </h3>
              <ul className="flex flex-col gap-3">
                {GENERATORS.filter((g) => g.group === group).map((info) => (
                  <GeneratorCard
                    key={info.id}
                    info={info}
                    status={statusFor(info.id)}
                    now={now}
                    busy={busy === info.id || statuses === null}
                    onAction={act}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
