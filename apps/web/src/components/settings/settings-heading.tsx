export function SettingsHeading({ description, title }: { description: string; title: string }) {
  return (
    <header className="mb-6 flex flex-col gap-1.5">
      <h1 className="hidden font-bold text-[30px] text-foreground leading-9 md:block">{title}</h1>
      <p className="font-medium text-[18px] text-fg-secondary leading-7">{description}</p>
    </header>
  );
}
