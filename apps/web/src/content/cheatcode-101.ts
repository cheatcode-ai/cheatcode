/** Build-time content registry for the `/101` product guide. */
export type Cheatcode101Block =
  | { kind: "example"; label: string; prompt: string }
  | { items: readonly Cheatcode101Faq[]; kind: "faqs" }
  | { kind: "paragraph"; text: string };

export interface Cheatcode101Faq {
  answer: string;
  question: string;
}

export interface Cheatcode101Section {
  blocks: readonly Cheatcode101Block[];
  id: string;
  title: string;
}

export const CHEATCODE_101_TAGLINE = "Your AI agent team, working from any browser.";

export const CHEATCODE_101_SECTIONS: readonly Cheatcode101Section[] = [
  {
    blocks: [
      {
        kind: "paragraph",
        text: "Cheatcode is a generalist AI agent with a full cloud computer. Unlike a chatbot that only replies, Cheatcode can plan and carry out work across code, files, the live web, connected tools, and a real browser. A team of agents handles the work while the workspace keeps every step visible.",
      },
    ],
    id: "what-is-cheatcode",
    title: "What is Cheatcode?",
  },
  {
    blocks: [
      {
        kind: "paragraph",
        text: "Describe an app and Cheatcode scaffolds it, writes the code, and gives you a live preview you can use. Keep chatting to iterate in any language or stack, then ship when it is ready.",
      },
      {
        kind: "paragraph",
        text: "Start with a request like this:",
      },
      {
        kind: "example",
        label: "Build & code",
        prompt:
          "Build a polished, responsive client portal with authentication, project status, file sharing, and a production-ready landing page.",
      },
    ],
    id: "build-and-code",
    title: "Build & Code",
  },
  {
    blocks: [
      {
        kind: "paragraph",
        text: "Cheatcode can turn rough ideas into professional work: source-backed research, reports, spreadsheets, documents, presentations, and data analysis.",
      },
      {
        kind: "paragraph",
        text: "Agents can search the live web, cross-check claims, organize the findings, and turn them into a finished deliverable without making you move between tools.",
      },
      {
        kind: "paragraph",
        text: "Start with a request like this:",
      },
      {
        kind: "example",
        label: "Research, docs, slides, sheets",
        prompt:
          "Research the market for AI customer support platforms, compare the leading companies, and turn the findings into a cited report and an executive presentation.",
      },
      {
        kind: "paragraph",
        text: "Documents are created as .docx files and presentations as .pptx files — ready to download, edit, and share from your project.",
      },
    ],
    id: "professional-work",
    title: "Professional Work",
  },
  {
    blocks: [
      {
        kind: "paragraph",
        text: "Skills are multi-step operating procedures that agents load when a task needs a specialized workflow. Integrations connect real tools and data, including GitHub, Gmail, Slack, Notion, Linear, and hundreds of other apps.",
      },
      {
        kind: "paragraph",
        text: "Use built-in skills, create your own, or connect an account so Cheatcode can do the work inside the tools you already use.",
      },
      {
        kind: "example",
        label: "Skills & integrations",
        prompt:
          "Review my latest GitHub pull requests, summarize the open risks, and draft a concise engineering update for Slack.",
      },
    ],
    id: "skills-and-integrations",
    title: "Skills & Integrations",
  },
  {
    blocks: [
      {
        kind: "paragraph",
        text: "Cheatcode can use a real browser to navigate pages, sign in, fill forms, gather information, and complete multi-step work on the web.",
      },
      {
        kind: "paragraph",
        text: "Browser work runs inside your private cloud computer, and the agent reports its progress and results in the chat.",
      },
      {
        kind: "example",
        label: "Browser research and automation",
        prompt:
          "Compare three suitable project-management tools, collect their current pricing and key limitations, and recommend the best fit for a ten-person product team.",
      },
    ],
    id: "browser-use",
    title: "Browser Use",
  },
  {
    blocks: [
      {
        kind: "paragraph",
        text: "A straightforward guide to what Cheatcode is, how it works, and where your work goes.",
      },
      {
        items: [
          {
            answer:
              "Cheatcode is a generalist AI agent platform. It gives a team of agents a cloud computer, project files, tools, and a browser so they can carry out work instead of only describing how to do it.",
            question: "What is Cheatcode?",
          },
          {
            answer:
              "A normal chatbot mainly produces text. Cheatcode can plan multi-step work, write and run code, create files, research the live web, use connected tools, and operate a browser while showing you its progress.",
            question: "How is Cheatcode different from a normal AI chatbot?",
          },
          {
            answer:
              "Your account gets one private cloud computer, with every project kept in its own workspace folder. Agents can use its files, terminal, and live previews to build and inspect real outputs without touching your local computer.",
            question: "What does it mean that Cheatcode has a computer?",
          },
          {
            answer:
              "Yes. Cheatcode can scaffold applications, work in existing codebases, run development commands, inspect previews, and keep iterating from the same chat.",
            question: "Can Cheatcode code?",
          },
          {
            answer:
              "Yes. Agents can search and read current sources, cross-check claims, and produce cited research that can feed directly into documents, presentations, or spreadsheets.",
            question: "Can Cheatcode research the live web?",
          },
          {
            answer:
              "Yes. Cheatcode can navigate websites, collect information, and complete browser-based workflows inside your private cloud computer.",
            question: "Can Cheatcode use websites for me?",
          },
          {
            answer:
              "Integrations connect services such as GitHub, Gmail, Slack, Notion, and Linear. Cheatcode asks you to connect an account before an agent can act inside it.",
            question: "How do integrations work?",
          },
          {
            answer:
              "Project work stays with the project: generated files live in its isolated workspace folder and deliverables, while decisions and progress remain in the chat that produced them.",
            question: "Where does my work live?",
          },
          {
            answer:
              "You can bring your own provider API keys and pay those providers directly. Cheatcode plans cover the sandbox capacity used to run agent work.",
            question: "What does Cheatcode cost?",
          },
          {
            answer:
              "Yes. Code, documents, presentations, and spreadsheets remain editable. You can also keep chatting to revise the result while preserving the project context.",
            question: "Can I edit the output?",
          },
        ],
        kind: "faqs",
      },
    ],
    id: "faq",
    title: "FAQ",
  },
];
