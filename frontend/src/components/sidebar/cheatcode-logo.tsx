import Image from 'next/image';
import { cn } from '@/lib/utils';

interface CheatcodeLogoProps {
  size?: number;
  className?: string;
}

export function CheatcodeLogo({ size = 24, className }: CheatcodeLogoProps) {
  return (
    <Image
      src="/cheatcode-symbol.png"
      alt="Cheatcode"
      width={size}
      height={size}
      className={cn("flex-shrink-0", className)}
    />
  );
} 