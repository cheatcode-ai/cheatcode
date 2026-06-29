export type SeededReplayAccent = "app" | "data" | "deck" | "landing" | "research" | "social";

export type SeededReplayArtifact = {
  kind: "code" | "csv" | "docx" | "image" | "joblib" | "pptx" | "zip";
  name: string;
};

export type SeededReplayFile = {
  active?: boolean;
  children?: readonly SeededReplayFile[];
  name: string;
  type: "file" | "folder";
};

export type SeededReplayStep = {
  detail?: string;
  title: string;
};

export type SeededReplay = {
  accentKind: SeededReplayAccent;
  artifactTitle: string;
  artifacts: readonly SeededReplayArtifact[];
  attachmentName?: string;
  computerTabTitle: string;
  files: readonly SeededReplayFile[];
  id: string;
  previewText: string;
  prompt: string;
  resultBody: readonly string[];
  resultIntro: string;
  resultTitle: string;
  steps: readonly SeededReplayStep[];
  surface?: "mobile" | "web";
  title: string;
};

export const SEEDED_REPLAYS: readonly SeededReplay[] = [
  {
    accentKind: "app",
    artifactTitle: "Generated mobile app",
    artifacts: [
      { kind: "code", name: "app/(tabs)/index.tsx" },
      { kind: "code", name: "lib/streak-freezes.ts" },
      { kind: "zip", name: "habit-tracker-source.zip" },
    ],
    computerTabTitle: "habit-tracker/app/(tabs)/index.tsx",
    files: [
      {
        name: "habit-tracker",
        type: "folder",
        children: [
          {
            name: "app",
            type: "folder",
            children: [{ active: true, name: "index.tsx", type: "file" }],
          },
          { name: "lib", type: "folder", children: [{ name: "streak-freezes.ts", type: "file" }] },
          { name: "package.json", type: "file" },
        ],
      },
    ],
    id: "habit-tracker",
    previewText: "Live phone preview, tabs, local reminders",
    prompt: "Build a habit tracker with streak freezes",
    resultBody: [
      "Built the Expo app shell with Today, Calendar, and Settings tabs.",
      "Added streak-freeze rules, local reminder scheduling, and sample habit data.",
      "Prepared a source bundle so the project can be continued immediately.",
    ],
    resultIntro:
      "I built a mobile habit tracker with streak freezes and a live preview-ready structure.",
    resultTitle: "Habit tracker app ready",
    steps: [
      { title: "Parsed the app goals", detail: "habit tracking, streak freezes, reminders" },
      { title: "Scaffolded the Expo screens", detail: "tabs, cards, empty states, local state" },
      {
        title: "Implemented streak-freeze logic",
        detail: "earned freezes, spend rules, reset copy",
      },
      { title: "Prepared the preview bundle", detail: "source files and continuation notes" },
    ],
    surface: "mobile",
    title: "Build a habit tracker with streak freezes",
  },
  {
    accentKind: "deck",
    artifactTitle: "Generated deck",
    artifacts: [
      { kind: "pptx", name: "seed-round-story.pptx" },
      { kind: "docx", name: "speaker-notes.docx" },
      { kind: "image", name: "slide-contact-sheet.png" },
    ],
    computerTabTitle: "seed-round-story.pptx",
    files: [
      {
        name: "seed-deck",
        type: "folder",
        children: [
          { active: true, name: "seed-round-story.pptx", type: "file" },
          { name: "speaker-notes.docx", type: "file" },
          { name: "market-sizing.csv", type: "file" },
        ],
      },
    ],
    id: "seed-deck",
    previewText: "Twelve slides with speaker notes",
    prompt: "Turn seed-round notes into a 12-slide deck",
    resultBody: [
      "Structured the deck into problem, insight, product, traction, market, and ask.",
      "Wrote concise speaker notes for every slide.",
      "Generated a contact sheet for quick review before export.",
    ],
    resultIntro: "I turned the notes into an investor-ready 12-slide seed narrative.",
    resultTitle: "Seed deck assembled",
    steps: [
      { title: "Extracted the storyline", detail: "problem, market, traction, raise" },
      { title: "Drafted the slide outline", detail: "12 slides with proof points" },
      { title: "Wrote speaker notes", detail: "one talk-track per slide" },
      { title: "Packaged the deck", detail: "PPTX, notes, and review sheet" },
    ],
    title: "Turn seed-round notes into a 12-slide deck",
  },
  {
    accentKind: "research",
    artifactTitle: "Research package",
    artifacts: [
      { kind: "docx", name: "agent-startups-brief.docx" },
      { kind: "csv", name: "startup-shortlist.csv" },
      { kind: "docx", name: "source-notes.docx" },
    ],
    computerTabTitle: "agent-startups-brief.docx",
    files: [
      {
        name: "agent-startups",
        type: "folder",
        children: [
          { active: true, name: "agent-startups-brief.docx", type: "file" },
          { name: "startup-shortlist.csv", type: "file" },
          { name: "source-notes.docx", type: "file" },
        ],
      },
    ],
    id: "agent-startups",
    previewText: "Parallel research agents and cited sources",
    prompt: "Scan 40 agent startups and brief me",
    resultBody: [
      "Grouped the market into dev tooling, sales ops, research, support, and workflow automation.",
      "Ranked startups by traction signal, differentiation, and buyer urgency.",
      "Captured citations and notes for follow-up diligence.",
    ],
    resultIntro: "I scanned the agent-startup landscape and summarized the strongest patterns.",
    resultTitle: "Agent startup brief ready",
    steps: [
      { title: "Split the research plan", detail: "market map, traction signals, buyer personas" },
      { title: "Collected public evidence", detail: "sites, launch posts, docs, pricing pages" },
      { title: "Scored the shortlist", detail: "traction, moat, urgency, clarity" },
      { title: "Wrote the brief", detail: "ranked themes and cited notes" },
    ],
    title: "Scan 40 agent startups and brief me",
  },
  {
    accentKind: "data",
    artifactTitle: "Analysis outputs",
    artifacts: [
      { kind: "csv", name: "cohort-retention.csv" },
      { kind: "docx", name: "retention-readout.docx" },
      { kind: "image", name: "retention-chart.png" },
    ],
    attachmentName: "signups.csv",
    computerTabTitle: "retention-analysis/cohort-retention.csv",
    files: [
      {
        name: "retention-analysis",
        type: "folder",
        children: [
          { name: "analysis.py", type: "file" },
          { active: true, name: "cohort-retention.csv", type: "file" },
          { name: "retention-readout.docx", type: "file" },
        ],
      },
      { name: "signups.csv", type: "file" },
    ],
    id: "retention-csv",
    previewText: "Profile, cohorts, activation, day-7 retention",
    prompt: "Analyze signups CSV and chart retention",
    resultBody: [
      "Profiled missing values, activation events, and signup cohorts.",
      "Built day-1, day-7, and day-30 retention tables.",
      "Flagged a week-two onboarding drop-off and charted the cohort curve.",
    ],
    resultIntro: "I analyzed the signup data and produced a retention readout.",
    resultTitle: "Retention analysis complete",
    steps: [
      { title: "Loaded the CSV", detail: "columns, nulls, event distribution" },
      { title: "Built cohort tables", detail: "signup week, activation, retention windows" },
      { title: "Charted retention", detail: "day-1, day-7, day-30 curves" },
      { title: "Wrote the readout", detail: "findings and next experiment" },
    ],
    title: "Analyze signups CSV and chart retention",
  },
  {
    accentKind: "landing",
    artifactTitle: "Landing page files",
    artifacts: [
      { kind: "code", name: "app/page.tsx" },
      { kind: "image", name: "bandra-cafe-preview.png" },
      { kind: "zip", name: "bandra-cafe-site.zip" },
    ],
    computerTabTitle: "bandra-cafe/app/page.tsx",
    files: [
      {
        name: "bandra-cafe",
        type: "folder",
        children: [
          {
            name: "app",
            type: "folder",
            children: [{ active: true, name: "page.tsx", type: "file" }],
          },
          { name: "content.md", type: "file" },
          { name: "menu-data.ts", type: "file" },
        ],
      },
    ],
    id: "bandra-cafe",
    previewText: "Copy, sections, responsive page",
    prompt: "Design a landing page for a Bandra cafe",
    resultBody: [
      "Designed a warm but restrained cafe landing page with menu, location, and booking sections.",
      "Wrote the headline, section copy, and mobile-first layout.",
      "Prepared a preview image and source bundle.",
    ],
    resultIntro: "I designed a production-ready landing page for the Bandra cafe.",
    resultTitle: "Cafe landing page ready",
    steps: [
      { title: "Defined the page story", detail: "food, place, booking, social proof" },
      { title: "Drafted the responsive layout", detail: "hero, menu, map, events" },
      { title: "Built the component structure", detail: "Next page and data-driven menu" },
      { title: "Prepared the preview", detail: "source bundle and visual check" },
    ],
    surface: "web",
    title: "Design a landing page for a Bandra cafe",
  },
  {
    accentKind: "social",
    artifactTitle: "Automation package",
    artifacts: [
      { kind: "docx", name: "social-pack-calendar.docx" },
      { kind: "csv", name: "scheduled-posts.csv" },
      { kind: "code", name: "automation-plan.ts" },
    ],
    computerTabTitle: "social-pack/automation-plan.ts",
    files: [
      {
        name: "social-pack",
        type: "folder",
        children: [
          { active: true, name: "automation-plan.ts", type: "file" },
          { name: "scheduled-posts.csv", type: "file" },
          { name: "social-pack-calendar.docx", type: "file" },
        ],
      },
    ],
    id: "social-pack",
    previewText: "Morning automation from a changelog",
    prompt: "Draft a social pack every morning at 8",
    resultBody: [
      "Mapped the recurring trigger and output destinations.",
      "Drafted post templates for launch notes, customer proof, and product tips.",
      "Packaged the automation plan with a first-week content calendar.",
    ],
    resultIntro: "I drafted the daily social-pack automation and the first content set.",
    resultTitle: "Social automation drafted",
    steps: [
      { title: "Designed the trigger", detail: "every morning at 8 with changelog input" },
      { title: "Built the content templates", detail: "LinkedIn, X, and short email copy" },
      { title: "Created the schedule", detail: "first week of posts and review checkpoints" },
      { title: "Packaged the automation", detail: "plan, calendar, and structured CSV" },
    ],
    title: "Draft a social pack every morning at 8",
  },
] as const;

export const SEEDED_REPLAY_ROWS = SEEDED_REPLAYS.map((replay) => ({
  accentKind: replay.accentKind,
  id: replay.id,
  previewText: replay.previewText,
  title: replay.title,
}));

export function seededReplayById(id: string): SeededReplay | null {
  return SEEDED_REPLAYS.find((replay) => replay.id === id) ?? null;
}
