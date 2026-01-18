'use client';

import React, { useRef, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Slot } from '@radix-ui/react-slot';
import { LiquidMetal } from '@paper-design/shaders-react';

interface LiquidMetalButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement | HTMLAnchorElement> {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'circular';
  asChild?: boolean;
  href?: string;
  // LiquidMetal shader props
  colorBack?: string;
  colorTint?: string;
  repetition?: number;
  softness?: number;
  shiftRed?: number;
  shiftBlue?: number;
  distortion?: number;
  contour?: number;
  angle?: number;
  speed?: number;
  scale?: number;
}

export function LiquidMetalButton({
  children,
  className,
  variant = 'default',
  asChild = false,
  href,
  colorBack = '#09090b',
  colorTint = '#ffffff',
  repetition = 1.5,
  softness = 0.5,
  shiftRed = 0.3,
  shiftBlue = 0.3,
  distortion = 0,
  contour = 0,
  angle = 100,
  speed = 0.6,
  scale = 1.5,
  ...props
}: LiquidMetalButtonProps) {
  const shaderContainerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!shaderContainerRef.current) return;

    const updateDimensions = () => {
      if (shaderContainerRef.current) {
        const { offsetWidth, offsetHeight } = shaderContainerRef.current;
        setDimensions({ width: offsetWidth, height: offsetHeight });
      }
    };

    updateDimensions();

    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(shaderContainerRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  const Comp = asChild ? Slot : (href ? 'a' : 'button');
  const elementProps = href ? { ...props, href } : props;

  if (variant === 'circular') {
    return (
      <div className={cn("relative group", className)}>
        {/* Outer container for the button */}
        {/* @ts-ignore - Dynamic component props typing */}
        <Comp
          className="relative w-full h-full flex items-center justify-center rounded-full overflow-hidden cursor-pointer"
          {...elementProps}
        >
          {/* Liquid Metal Ring - this is the shader layer */}
          <div
            ref={shaderContainerRef}
            className="absolute inset-0 w-full h-full rounded-full overflow-hidden"
          >
            {dimensions.width > 0 && dimensions.height > 0 && (
              <LiquidMetal
                style={{ width: '100%', height: '100%' }}
                colorBack={colorBack}
                colorTint={colorTint}
                shape="circle"
                repetition={repetition}
                softness={softness}
                shiftRed={shiftRed}
                shiftBlue={shiftBlue}
                distortion={distortion}
                contour={contour}
                angle={angle}
                speed={speed}
                scale={scale}
              />
            )}
          </div>

          {/* Dark center circle - creates the ring effect by masking the center */}
          <div
            className="absolute rounded-full bg-gradient-to-b from-zinc-900 to-black"
            style={{
              width: 'calc(100% - 6px)',
              height: 'calc(100% - 6px)',
              boxShadow: 'inset 0 2px 4px rgba(255,255,255,0.05), inset 0 -2px 4px rgba(0,0,0,0.3)'
            }}
          />

          {/* Content */}
          <span className="relative z-30 flex items-center justify-center text-zinc-500 group-hover:text-zinc-300 transition-colors">
            {children}
          </span>
        </Comp>
      </div>
    );
  }

  // Default rectangular button variant - liquid metal on border
  // Check if w-full is in className to make button full width
  const isFullWidth = className?.includes('w-full');

  return (
    <div className={cn("relative group", className)}>
      {/* @ts-ignore - Dynamic component props typing */}
      <Comp
        className={cn(
          "relative overflow-hidden rounded-lg transition-all duration-300",
          "font-mono text-[11px] font-medium tracking-wide text-zinc-100 uppercase",
          "h-8 px-4 flex items-center justify-center",
          "cursor-pointer",
          isFullWidth && "w-full"
        )}
        {...elementProps}
      >
        {/* Liquid Metal Border Layer */}
        <div
          ref={shaderContainerRef}
          className="absolute inset-0 rounded-lg overflow-hidden"
        >
          {dimensions.width > 0 && dimensions.height > 0 && (
            <LiquidMetal
              style={{ width: '100%', height: '100%' }}
              colorBack={colorBack}
              colorTint={colorTint}
              shape="none"
              repetition={repetition}
              softness={softness}
              shiftRed={shiftRed}
              shiftBlue={shiftBlue}
              distortion={distortion}
              contour={contour}
              angle={angle}
              speed={speed}
              scale={scale}
            />
          )}
        </div>

        {/* Dark center - creates border effect */}
        <div
          className="absolute rounded-md bg-gradient-to-b from-zinc-900 via-black to-zinc-950"
          style={{
            inset: '2px',
            boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.05)'
          }}
        />

        {/* Content */}
        <span className="relative z-30 flex w-full h-full items-center justify-center gap-2 text-zinc-400 group-hover:text-white transition-colors">
          {children}
        </span>
      </Comp>
    </div>
  );
}
