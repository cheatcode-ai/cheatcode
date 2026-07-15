import { PreviewAddressBar } from "@/components/preview/preview-address-bar";
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
        <PreviewAddressBar previewUrl={previewUrl} />
        <PreviewExternalLink previewUrl={previewUrl} />
      </div>
    </div>
  );
}
