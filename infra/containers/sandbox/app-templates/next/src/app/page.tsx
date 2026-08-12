const cards = [
  ["Gateway", "Clerk auth and rate limits route the request."],
  ["Agent session", "Durable Object stores resumable stream parts."],
  ["Sandbox", "Daytona serves this live preview."],
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0b0b0b] px-6 py-16 text-zinc-100">
      <section className="mx-auto flex max-w-5xl flex-col gap-10">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-orange-400">
            Cheatcode Preview
          </p>
          <h1 className="mt-5 max-w-3xl font-mono text-4xl tracking-tight md:text-6xl">
            Sandbox preview is live.
          </h1>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {cards.map(([title, body]) => (
            <article className="border border-zinc-800 bg-zinc-950 p-5" key={title}>
              <h2 className="font-mono text-sm uppercase tracking-[0.22em] text-zinc-200">
                {title}
              </h2>
              <p className="mt-4 text-sm leading-6 text-zinc-500">{body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
