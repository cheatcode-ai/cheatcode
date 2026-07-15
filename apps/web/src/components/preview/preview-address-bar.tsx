import { PreviewDeviceMenu } from "@/components/preview/preview-device-menu";
import { PreviewPathInput } from "@/components/preview/preview-path-input";

export function PreviewAddressBar({ previewUrl }: { previewUrl: string | null }) {
  return (
    <div className="flex min-h-8 min-w-0 flex-1 cursor-text items-center gap-1.5 rounded-full bg-secondary py-0.5 pr-20 pl-2.5 transition-colors hover:bg-bg-secondary">
      <PreviewDeviceMenu isPreviewAvailable={previewUrl !== null} />
      <PreviewPathInput previewUrl={previewUrl} />
    </div>
  );
}
