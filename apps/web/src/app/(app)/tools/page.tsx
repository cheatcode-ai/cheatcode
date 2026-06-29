import { ToolsCatalog } from "@/components/tools/tools-catalog";

export default function ToolsPage() {
  return (
    <section className="chat-scrollbar min-w-0 flex-1 overflow-y-auto bg-white px-4 pt-12 pb-16 text-[#1b1b1b] sm:px-6 lg:px-10">
      <div className="mx-auto w-full max-w-[740px]">
        <ToolsCatalog />
      </div>
    </section>
  );
}
