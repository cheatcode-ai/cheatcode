'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface SliderProps extends React.InputHTMLAttributes<HTMLInputElement> {
  value: number[];
  min?: number;
  max?: number;
  step?: number;
  onValueChange?: (val: number[]) => void;
}

// Lightweight slider built on <input type="range"> to avoid Radix compose-refs loops
export function Slider({
  className,
  value,
  min = 0,
  max = 100,
  step = 1,
  onValueChange,
  ...props
}: SliderProps) {
  const current = Array.isArray(value) ? value[0] : 0;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = Number(e.target.value);
    onValueChange?.([newVal]);
  };

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={current}
      onChange={handleChange}
      className={cn(
        'w-full h-1.5 cursor-pointer rounded-lg bg-muted outline-none appearance-none',
        className,
      )}
      {...props}
    />
  );
}
