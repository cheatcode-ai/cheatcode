export function SettingsHeading({ description, title }: { description: string; title: string }) {
  return (
    <div className="mb-10 max-w-xl space-y-6 text-center">
      <h1 className="font-medium text-2xl text-white tracking-tight">{title}</h1>
      <p className="text-sm text-zinc-500 leading-relaxed">{description}</p>
    </div>
  );
}
