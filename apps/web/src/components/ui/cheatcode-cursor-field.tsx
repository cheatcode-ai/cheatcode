"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/ui/cn";

const CURSOR_ASSETS = [
  "/assets/cheatcode/cursors/cursor-1.png",
  "/assets/cheatcode/cursors/cursor-2.png",
  "/assets/cheatcode/cursors/cursor-3.png",
  "/assets/cheatcode/cursors/cursor-4.png",
  "/assets/cheatcode/cursors/cursor-5.png",
  "/assets/cheatcode/cursors/cursor-6.png",
] as const;
const CURSOR_TRIGGER_DISTANCE = 25;
const CURSOR_FADE_DELAY = 1_500;
const CURSOR_MAX_TRAIL_IMAGES = 8;
const CURSOR_IMAGE_SIZE = 20;
const INTERACTIVE_SELECTOR =
  'a, button, input, textarea, select, summary, [role="button"], [contenteditable="true"], [data-cheatcode-ignore]';

type FieldVariant = "home" | "loading";

type CheatcodeCursorFieldProps = {
  className?: string | undefined;
  variant?: FieldVariant | undefined;
};

type Point = {
  x: number;
  y: number;
};

/** Runs Cheatcode's cursor-trail interaction while preserving the native cursor. */
export function CheatcodeCursorField({ className, variant = "home" }: CheatcodeCursorFieldProps) {
  return (
    <CheatcodeCursorTrail className={className} restrictToWhitespace={variant !== "loading"} />
  );
}

function CheatcodeCursorTrail({
  className,
  restrictToWhitespace,
}: {
  className?: string | undefined;
  restrictToWhitespace: boolean;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const imageRefs = useRef<Array<HTMLImageElement | null>>([]);
  const nextImageRef = useRef(0);
  const nextZIndexRef = useRef(1);
  const lastPointRef = useRef<Point>({ x: -9_999, y: -9_999 });
  const fadeTimersRef = useRef(new Map<number, number>());
  const timeRef = useRef(0);
  const [isMounted, setIsMounted] = useState(false);
  const motionRefs = useRef<TrailMotionRefs>({
    fadeTimersRef,
    imageRefs,
    lastPointRef,
    nextImageRef,
    nextZIndexRef,
    surfaceRef,
    timeRef,
  }).current;

  useEffect(() => setIsMounted(true), []);
  useExactTrailMotion(motionRefs, restrictToWhitespace);

  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 size-full", className)}
      data-cheatcode-cursor-field={restrictToWhitespace ? "home" : "loading-trail"}
      ref={surfaceRef}
    >
      {isMounted ? createPortal(<CursorTrailPortal imageRefs={imageRefs} />, document.body) : null}
    </div>
  );
}

type TrailMotionRefs = {
  fadeTimersRef: React.RefObject<Map<number, number>>;
  imageRefs: React.RefObject<Array<HTMLImageElement | null>>;
  lastPointRef: React.RefObject<Point>;
  nextImageRef: React.RefObject<number>;
  nextZIndexRef: React.RefObject<number>;
  surfaceRef: React.RefObject<HTMLDivElement | null>;
  timeRef: React.RefObject<number>;
};

function useExactTrailMotion(refs: TrailMotionRefs, restrictToWhitespace: boolean): void {
  const placeImage = usePlaceTrailImage(refs);
  const hideImage = useHideTrailImage(refs);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointerQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (motionQuery.matches || !pointerQuery.matches) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (!isEligiblePointerEvent(refs.surfaceRef.current, event, restrictToWhitespace)) return;
      moveTrail(event.clientX, event.clientY, refs, placeImage, hideImage);
    };
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [hideImage, placeImage, refs, restrictToWhitespace]);

  useEffect(() => () => clearTrail(refs), [refs]);
}

function usePlaceTrailImage(refs: TrailMotionRefs): (index: number, x: number, y: number) => void {
  return useCallback(
    (index: number, x: number, y: number) => {
      const image = refs.imageRefs.current[index];
      if (!image) return;
      refs.timeRef.current = Date.now();
      const position = getRandomTrailPosition(x, y, index, refs.timeRef.current);
      clearFadeTimer(refs.fadeTimersRef.current, index);
      image.style.transition = "none";
      image.style.left = `${position.x}px`;
      image.style.top = `${position.y}px`;
      if (refs.nextZIndexRef.current > 40) refs.nextZIndexRef.current = 1;
      image.style.zIndex = String(refs.nextZIndexRef.current++);
      image.style.transform = "translate(-50%, -50%) scale(1)";
      image.style.opacity = "1";
      scheduleImageFade(image, index, refs.fadeTimersRef.current);
    },
    [refs],
  );
}

function useHideTrailImage(refs: TrailMotionRefs): (index: number) => void {
  return useCallback(
    (index: number) => {
      const image = refs.imageRefs.current[index];
      if (!image) return;
      clearFadeTimer(refs.fadeTimersRef.current, index);
      fadeImage(image);
    },
    [refs],
  );
}

function moveTrail(
  x: number,
  y: number,
  refs: TrailMotionRefs,
  placeImage: (index: number, x: number, y: number) => void,
  hideImage: (index: number) => void,
): void {
  const deltaX = x - refs.lastPointRef.current.x;
  const deltaY = y - refs.lastPointRef.current.y;
  if (Math.hypot(deltaX, deltaY) < CURSOR_TRIGGER_DISTANCE) return;
  const imageIndex = refs.nextImageRef.current % CURSOR_ASSETS.length;
  placeImage(imageIndex, x, y);
  if (refs.nextImageRef.current >= CURSOR_MAX_TRAIL_IMAGES) {
    const oldestIndex =
      (refs.nextImageRef.current - CURSOR_MAX_TRAIL_IMAGES) % CURSOR_ASSETS.length;
    hideImage(oldestIndex < 0 ? oldestIndex + CURSOR_ASSETS.length : oldestIndex);
  }
  refs.nextImageRef.current += 1;
  refs.lastPointRef.current = { x, y };
}

function getRandomTrailPosition(x: number, y: number, index: number, time: number): Point {
  const seed = index + Math.floor(time / 100);
  const randomX = (Math.sin(seed * 12.9898) * 43_758.5453) % 1;
  const randomY = (Math.sin(seed * 78.233) * 43_758.5453) % 1;
  return { x: x + (randomX * 40 - 20), y: y + (randomY * 40 - 20) };
}

function scheduleImageFade(
  image: HTMLImageElement,
  index: number,
  timers: Map<number, number>,
): void {
  const timer = window.setTimeout(() => {
    fadeImage(image);
    timers.delete(index);
  }, CURSOR_FADE_DELAY);
  timers.set(index, timer);
}

function fadeImage(image: HTMLImageElement): void {
  image.style.transition = "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.5s linear";
  image.style.transform = "translate(-50%, -50%) scale(0.7)";
  image.style.opacity = "0";
}

function clearFadeTimer(timers: Map<number, number>, index: number): void {
  const timer = timers.get(index);
  if (timer !== undefined) window.clearTimeout(timer);
  timers.delete(index);
}

function clearTrail(refs: TrailMotionRefs): void {
  for (const timer of refs.fadeTimersRef.current.values()) window.clearTimeout(timer);
  refs.fadeTimersRef.current.clear();
  for (const image of refs.imageRefs.current) {
    if (!image) continue;
    image.style.transition = "none";
    image.style.transform = "translate(-50%, -50%) scale(0)";
    image.style.opacity = "0";
  }
}

function isEligiblePointerEvent(
  surface: HTMLDivElement | null,
  event: MouseEvent,
  restrictToWhitespace: boolean,
): boolean {
  if (!surface) return false;
  const rect = surface.getBoundingClientRect();
  const isInside =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;
  if (!isInside) return false;
  if (!restrictToWhitespace) return true;
  return !(event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR));
}

function CursorTrailPortal({
  imageRefs,
}: {
  imageRefs: React.RefObject<Array<HTMLImageElement | null>>;
}) {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[100] overflow-hidden">
      {CURSOR_ASSETS.map((src, index) => (
        <Image
          alt=""
          className="pointer-events-none fixed object-cover opacity-0 will-change-[transform,opacity]"
          height={CURSOR_IMAGE_SIZE}
          key={src}
          ref={(image) => {
            imageRefs.current[index] = image;
          }}
          src={src}
          style={{ transform: "translate(-50%, -50%) scale(0)" }}
          unoptimized
          width={CURSOR_IMAGE_SIZE}
        />
      ))}
    </div>
  );
}
