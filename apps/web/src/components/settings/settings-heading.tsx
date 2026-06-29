export function SettingsHeading({ description, title }: { description: string; title: string }) {
  return (
    <div className="mb-6">
      <h1 className="font-bold text-[#1b1b1b] text-[30px] tracking-[-0.01em]">{title}</h1>
      <p className="mt-3 text-[#4f4f4f] text-[18px] leading-7">{description}</p>
    </div>
  );
}
