import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { isEventStore } from "@/lib/eventStore";

// The booth's attract loop: a video full screen on the stores' laptops between
// visitors, opened from the icon at the left of the header. Swapping the video
// is a matter of replacing this file in public; until it is there, the page
// shows the logo on black instead of a broken player.
const VIDEO_SRC = "/videos/screensaver.mp4";

// How long the buttons stay after the last movement, so the loop plays clean.
const IDLE_MS = 3000;

export default function Screensaver() {
  const router = useRouter();
  const [missing, setMissing] = useState(false);
  const [controls, setControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  // Event stores only, like the icon that opens it.
  useEffect(() => {
    if (!isEventStore()) router.replace("/");
  }, [router]);

  useEffect(() => {
    let timer = window.setTimeout(() => setControls(false), IDLE_MS);
    const wake = () => {
      setControls(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setControls(false), IDLE_MS);
    };
    const events = ["mousemove", "pointerdown", "keydown", "touchstart"] as const;
    events.forEach((name) => window.addEventListener(name, wake));
    return () => {
      window.clearTimeout(timer);
      events.forEach((name) => window.removeEventListener(name, wake));
    };
  }, []);

  // Followed rather than set on click, since Esc leaves fullscreen without
  // going through the button.
  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  };

  const button =
    "flex h-12 items-center rounded-[12px] px-5 font-sohne text-main-medium font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-white focus-visible:ring-offset-2 focus-visible:ring-offset-grays-ld-black";

  return (
    <>
      <Head>
        <title>ToggleWear</title>
      </Head>
      {/* Above everything else on the page, Under the hood and the swag
          assistant included, which would otherwise sit over the video. */}
      <div
        className={`fixed inset-0 z-[80] flex items-center justify-center bg-grays-ld-black ${
          controls ? "" : "cursor-none"
        }`}
      >
        {missing ? (
          <div className="flex items-center gap-4 font-sora text-[56px] font-bold tracking-[-1.12px] text-grays-white">
            <img src="/icons/ld-logo-white.svg" alt="" width={52} height={52} />
            ToggleWear
          </div>
        ) : (
          <video
            src={VIDEO_SRC}
            autoPlay
            loop
            muted
            playsInline
            onError={() => setMissing(true)}
            className="h-full w-full object-contain"
          />
        )}

        <div
          className={`absolute right-6 top-6 flex gap-3 transition-opacity duration-300 ${
            controls ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <button
            type="button"
            onClick={toggleFullscreen}
            className={`${button} border border-grays-white text-grays-white hover:bg-grays-white/10`}
          >
            {fullscreen ? "Exit fullscreen" : "Fullscreen"}
          </button>
          <Link href="/" className={`${button} bg-base-lime text-grays-ld-black`}>
            Back to ToggleWear
          </Link>
        </div>
      </div>
    </>
  );
}
