/**
 * Build-time content registry for the `/101` route. A typed TS module (no MDX, no
 * runtime fs — same philosophy as the bundled skills). Verbatim design copy is
 * used where the artboard provided it; below-the-fold sections carry
 * accurate-to-product placeholder copy flagged `draft` for the content pass.
 * `replayCard` blocks render as inert placeholders until the replays cluster
 * activates them via `replaySlug`.
 */
export type Cheatcode101Block =
  | { items: string[]; kind: "bullets" }
  | { kind: "footnote"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "replayCard"; replaySlug: string; title: string };

export interface Cheatcode101Section {
  blocks: Cheatcode101Block[];
  draft?: boolean;
  id: string;
  title: string;
}

export const CHEATCODE_101_HERO = "Your AI agent team, working from any browser.";

export const CHEATCODE_101_SECTIONS: readonly Cheatcode101Section[] = [
  {
    blocks: [
      {
        kind: "paragraph",
        text: "Cheatcode is a generalist AI agent platform. Tell it what you want to make and a team of agents plans the work, builds it, and shows you every step — apps, decks, research, data analysis, browser automation, and media, all from any browser.",
      },
    ],
    id: "what-is-cheatcode",
    title: "What is cheatcode?",
  },
  {
    blocks: [
      {
        kind: "paragraph",
        text: "Describe an app and Cheatcode scaffolds it, writes the code, and gives you a live preview you can interact with. Keep chatting to iterate, then ship when it is ready.",
      },
      {
        kind: "replayCard",
        replaySlug: "build-ship-habit-tracker",
        title: "Build & ship a habit tracker",
      },
    ],
    id: "build-and-ship",
    title: "Build & ship apps",
  },
  {
    blocks: [
      {
        kind: "paragraph",
        text: "Turn rough notes into polished decks and documents. Agents research, draft, and format the output for you.",
      },
      {
        kind: "replayCard",
        replaySlug: "deck-from-seed-round-notes",
        title: "Deck from seed-round notes",
      },
      {
        kind: "footnote",
        text: "Documents ship as .docx, decks as .pptx — ready to download, edit, and share. Everything lands in your project files.",
      },
    ],
    id: "decks-and-documents",
    title: "Decks & documents",
  },
  {
    blocks: [
      {
        kind: "paragraph",
        text: "Ask a research question and Cheatcode fans out parallel agents, gathers sources, and returns a report with citations you can verify.",
      },
    ],
    draft: true,
    id: "research",
    title: "Research",
  },
  {
    blocks: [
      {
        kind: "paragraph",
        text: "Describe a trigger and an action and Cheatcode runs the workflow for you — on a schedule or in response to events.",
      },
    ],
    draft: true,
    id: "automate",
    title: "Automate",
  },
  {
    blocks: [
      {
        kind: "paragraph",
        text: "Skills are multi-step operating procedures the agent loads on demand. Connect tools and data sources to extend what your agents can do.",
      },
    ],
    draft: true,
    id: "skills-and-integrations",
    title: "Skills & integrations",
  },
  {
    blocks: [
      {
        kind: "paragraph",
        text: "Agents can drive a real browser to complete tasks on the web. Take over the live session whenever you want to steer.",
      },
    ],
    draft: true,
    id: "browser-use",
    title: "Browser use",
  },
  {
    blocks: [
      {
        items: [
          "Where does my work live? Everything lands in your project files, ready to download.",
          "What does it cost? Bring your own provider keys and pay providers directly.",
          "Can I edit the output? Yes — code, docs, and decks are all editable.",
        ],
        kind: "bullets",
      },
    ],
    draft: true,
    id: "faq",
    title: "FAQ",
  },
];
