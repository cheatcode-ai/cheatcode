import { cn } from '@/lib/utils';
import { memo, useId } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock, CodeBlockCode } from '@/components/ui/code-block';

export type MarkdownProps = {
  children: string;
  id?: string;
  className?: string;
  components?: Partial<Components>;
};

function extractLanguage(className?: string): string {
  if (!className) return 'plaintext';
  const match = className.match(/language-(\w+)/);
  return match ? match[1] : 'plaintext';
}

const INITIAL_COMPONENTS: Partial<Components> = {
  code: function CodeComponent({
    className,
    children,
    ...props
  }: React.ComponentPropsWithoutRef<'code'> & {
    node?: { position?: { start: { line: number }; end: { line: number } } };
  }) {
    const isInline =
      !props.node?.position?.start.line ||
      props.node?.position?.start.line === props.node?.position?.end.line;

    if (isInline) {
      return (
        <span
          className={cn(
            'bg-primary-foreground dark:bg-zinc-800 dark:border dark:border-zinc-700 rounded-sm px-1 font-mono text-sm',
            className,
          )}
        >
          {children}
        </span>
      );
    }

    const language = extractLanguage(className);

    return (
      <CodeBlock className="rounded-md overflow-hidden my-4 border border-zinc-200 dark:border-zinc-800 max-w-full min-w-0 w-full">
        <CodeBlockCode
          code={children as string}
          language={language}
          className="text-sm"
        />
      </CodeBlock>
    );
  },
  pre: function PreComponent({
    children,
  }: React.ComponentPropsWithoutRef<'pre'>) {
    return <>{children}</>;
  },
  ul: function UnorderedList({
    children,
    ...props
  }: React.ComponentPropsWithoutRef<'ul'>) {
    return (
      <ul className="list-disc pl-5 my-2" {...props}>
        {children}
      </ul>
    );
  },
  ol: function OrderedList({
    children,
    ...props
  }: React.ComponentPropsWithoutRef<'ol'>) {
    return (
      <ol className="list-decimal pl-5 my-2" {...props}>
        {children}
      </ol>
    );
  },
  li: function ListItem({
    children,
    ...props
  }: React.ComponentPropsWithoutRef<'li'>) {
    return (
      <li className="my-1" {...props}>
        {children}
      </li>
    );
  },
  h1: function H1({
    children,
    ...props
  }: React.ComponentPropsWithoutRef<'h1'>) {
    return (
      <h1 className="text-2xl font-bold my-3" {...props}>
        {children}
      </h1>
    );
  },
  h2: function H2({
    children,
    ...props
  }: React.ComponentPropsWithoutRef<'h2'>) {
    return (
      <h2 className="text-xl font-bold my-2" {...props}>
        {children}
      </h2>
    );
  },
  h3: function H3({
    children,
    ...props
  }: React.ComponentPropsWithoutRef<'h3'>) {
    return (
      <h3 className="text-lg font-bold my-2" {...props}>
        {children}
      </h3>
    );
  },
  blockquote: function Blockquote({
    children,
    ...props
  }: React.ComponentPropsWithoutRef<'blockquote'>) {
    return (
      <blockquote
        className="border-l-4 border-muted pl-4 italic my-2 dark:text-zinc-400 dark:border-zinc-600"
        {...props}
      >
        {children}
      </blockquote>
    );
  },
  a: function Anchor({
    children,
    href,
    ...props
  }: React.ComponentPropsWithoutRef<'a'>) {
    return (
      <a
        href={href}
        className="text-primary hover:underline dark:text-blue-400"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {children}
      </a>
    );
  },
  table: function Table({
    children,
    ...props
  }: React.ComponentPropsWithoutRef<'table'>) {
    return (
      <table className="w-full border-collapse my-3 text-sm" {...props}>
        {children}
      </table>
    );
  },
  th: function TableHeader({
    children,
    ...props
  }: React.ComponentPropsWithoutRef<'th'>) {
    return (
      <th
        className="border border-slate-300 dark:border-zinc-700 px-3 py-2 text-left font-semibold bg-slate-100 dark:bg-zinc-800"
        {...props}
      >
        {children}
      </th>
    );
  },
  td: function TableCell({
    children,
    ...props
  }: React.ComponentPropsWithoutRef<'td'>) {
    return (
      <td
        className="border border-slate-300 dark:border-zinc-700 px-3 py-2"
        {...props}
      >
        {children}
      </td>
    );
  },
};

function MarkdownComponent({
  children,
  id,
  className,
  components = INITIAL_COMPONENTS,
}: MarkdownProps) {
  const generatedId = useId();
  const blockId = id ?? generatedId;

  return (
    <div
      id={blockId}
      className={cn(
        'prose-code:before:hidden prose-code:after:hidden',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

const Markdown = memo(MarkdownComponent);
Markdown.displayName = 'Markdown';

export { Markdown };
