import Image from "next/image";

/**
 * Sandbox cold-start skeleton (preview-surface §A2) - a softly pulsing, ghosted
 * Cheatcode mark + muted label, mirroring bud's "Booting computer" state. The
 * pulse rides on `animate-pulse` (disabled by the globals.css reduced-motion
 * block); the static opacity wrapper keeps the mark ghosted rather than bright.
 */
export function BootingComputer({ label = "Booting computer" }: { label?: string }) {
  return (
    <div
      aria-live="polite"
      className="grid h-full min-h-[420px] place-items-center rounded-[16px] border border-[#f1f1f1] bg-[#fafafa]"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <Image
          alt=""
          className="cc-loading-mark h-14 w-14"
          height={56}
          src="/cheatcode-symbol.png"
          width={56}
        />
        <span className="text-[13px] text-thread-text-muted">{label}</span>
      </div>
    </div>
  );
}
