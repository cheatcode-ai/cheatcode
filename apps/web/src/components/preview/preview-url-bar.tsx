import { PreviewDeviceMenu } from "@/components/preview/preview-device-menu";
import { PreviewPathInput } from "@/components/preview/preview-path-input";
import {
  PreviewExternalLink,
  PreviewNavigationControls,
} from "@/components/preview/preview-url-controls";

/**
 * Controls only the preview entry URL. The cross-origin iframe's live SPA
 * location is intentionally opaque to the parent application.
 */
export function PreviewUrlBar({ previewUrl }: { previewUrl: string | null }) {
  return (
    <div className="h-11 shrink-0 bg-background px-2 py-1.5">
      <div className="flex h-8 items-center gap-1 rounded-full bg-background">
        <PreviewNavigationControls previewUrl={previewUrl} />
        <div className="flex min-h-8 min-w-0 flex-1 cursor-text items-center gap-1.5 rounded-full bg-secondary py-0.5 pr-20 pl-2.5 transition-colors hover:bg-bg-secondary">
          <PreviewDeviceMenu isPreviewAvailable={previewUrl !== null} />
          <PreviewPathInput previewUrl={previewUrl} />
        </div>
        <PreviewExternalLink previewUrl={previewUrl} />
      </div>
    </div>
  );
}
