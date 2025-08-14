import Image from 'next/image';

interface CheatcodeLogoProps {
  size?: number;
}

export function CheatcodeLogo({ size = 24 }: CheatcodeLogoProps) {
  return (
    <Image
      src="/cheatcode-symbol.png"
      alt="Cheatcode"
      width={size}
      height={size}
      className="flex-shrink-0"
    />
  );
} 