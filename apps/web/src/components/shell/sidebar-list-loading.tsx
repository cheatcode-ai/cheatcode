import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";

export function SidebarListLoading({ label }: { label: string }) {
  return <CheatcodeLoader className="py-3" label={label} markClassName="size-6" />;
}
