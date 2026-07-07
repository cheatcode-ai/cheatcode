/**
 * Build-time content registry for the `/101` route. A typed TS module (no MDX, no
 * runtime fs — same philosophy as the bundled skills). Verbatim design copy is
 * used where the artboard provided it; below-the-fold sections carry
 * accurate-to-product placeholder copy flagged `draft` for the content pass.
 */
export type Cheatcode101Block =
  | { items: string[]; kind: "bullets" }
  | { kind: "footnote"; text: string }
  | { kind: "paragraph"; text: string };

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
        kind: "paragraph",
        text: "The same chat keeps the project, files, preview, and terminal together so you can keep iterating without losing context.",
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
        kind: "paragraph",
        text: "Generated files appear in the project computer and deliverables list, so you can inspect or download them without leaving the chat.",
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
        text: "Ask a research question and Cheatcode fans out parallel agents across the live web — searching, fetching sources, and cross-checking claims — then synthesizes a report with citations you can verify. Use it for competitor briefs, market scans, or deep dives, and the findings flow straight into a deck or doc.",
      },
    ],
    id: "research",
    title: "Research",
  },
  {
    blocks: [
      {
        kind: "paragraph",
        text: "Turn a recurring task into an automation that runs without you. Describe a schedule (“every morning at 8am, summarize the Mag 7”) or an event in a connected app (“when an invoice email arrives, file it in Notion”) and Cheatcode runs the agent and delivers the result to Slack, Notion, or email.",
      },
      {
        kind: "footnote",
        text: "Manage automations, watch their run history, and pause or delete them from the Automations page.",
      },
    ],
    id: "automate",
    title: "Automate",
  },
  {
    blocks: [
      {
        kind: "paragraph",
        text: "Skills are multi-step operating procedures the agent loads on demand — building pitch decks, running deep research, analyzing CSVs, designing landing pages, and more. Integrations connect your real tools and data: link GitHub, Gmail, Slack, Notion, Linear, and hundreds of other apps so agents can act on your accounts, not just talk about them.",
      },
    ],
    id: "skills-and-integrations",
    title: "Skills & integrations",
  },
  {
    blocks: [
      {
        kind: "paragraph",
        text: "Agents drive a real browser to get things done on the web — logging in, filling forms, navigating pages, and pulling out data. You can watch the session live in the Computer panel and take over at any point to steer, then hand control back.",
      },
    ],
    id: "browser-use",
    title: "Browser use",
  },
  {
    blocks: [
      {
        items: [
          "Where does my work live? Everything lands in your project files or in the chat where it was generated, ready to download.",
          "What does it cost? Bring your own provider keys and pay the providers directly, or use a Cheatcode plan.",
          "Can I edit the output? Yes — code, docs, and decks are all editable, and you can keep iterating by chatting.",
          "Can I share a run? Not yet — keep the work in your project and download deliverables when you need to hand them off.",
        ],
        kind: "bullets",
      },
    ],
    id: "faq",
    title: "FAQ",
  },
];
