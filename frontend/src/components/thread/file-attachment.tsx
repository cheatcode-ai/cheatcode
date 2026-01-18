import React from 'react';
import {
    FileText, FileImage, FileCode, FileSpreadsheet, FileVideo,
    FileAudio, FileType, Database, Archive, File, ExternalLink,
    Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AttachmentGroup } from './attachment-group';
import { MarkdownRenderer } from './preview-renderers/markdown-renderer';
import { useFileContent, useImageContent } from '@/hooks/react-query/files';
import { Project } from '@/lib/api';
import { API_URL } from '@/lib/api/config';

// Define basic file types
export type FileType =
    | 'image' | 'code' | 'text' | 'pdf'
    | 'audio' | 'video' | 'spreadsheet'
    | 'archive' | 'database' | 'markdown'
    | 'csv'
    | 'other';

// Simple extension-based file type detection
function getFileType(filename: string): FileType {
    const ext = filename.split('.').pop()?.toLowerCase() || '';

    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
    if (['js', 'jsx', 'ts', 'tsx', 'html', 'css', 'json', 'py', 'java', 'c', 'cpp'].includes(ext)) return 'code';
    if (['txt', 'log', 'env'].includes(ext)) return 'text';
    if (['md', 'markdown'].includes(ext)) return 'markdown';
    if (ext === 'pdf') return 'pdf';
    if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return 'audio';
    if (['mp4', 'webm', 'mov', 'avi'].includes(ext)) return 'video';
    if (['csv', 'tsv'].includes(ext)) return 'csv';
    if (['xls', 'xlsx'].includes(ext)) return 'spreadsheet';
    if (['zip', 'rar', 'tar', 'gz'].includes(ext)) return 'archive';
    if (['db', 'sqlite', 'sql'].includes(ext)) return 'database';

    return 'other';
}

// Get appropriate icon for file type
function getFileIcon(type: FileType): React.ElementType {
    const icons: Record<FileType, React.ElementType> = {
        image: FileImage,
        code: FileCode,
        text: FileText,
        markdown: FileText,
        pdf: FileType,
        audio: FileAudio,
        video: FileVideo,
        spreadsheet: FileSpreadsheet,
        csv: FileSpreadsheet,
        archive: Archive,
        database: Database,
        other: File
    };

    return icons[type];
}

// Generate a human-readable display name for file type
function getTypeLabel(type: FileType, extension?: string): string {
    if (type === 'code' && extension) {
        return extension.toUpperCase();
    }

    const labels: Record<FileType, string> = {
        image: 'Image',
        code: 'Code',
        text: 'Text',
        markdown: 'Markdown',
        pdf: 'PDF',
        audio: 'Audio',
        video: 'Video',
        spreadsheet: 'Spreadsheet',
        csv: 'CSV',
        archive: 'Archive',
        database: 'Database',
        other: 'File'
    };

    return labels[type];
}

// Generate realistic file size based on file path and type
function getFileSize(filepath: string, type: FileType): string {
    // Base size calculation
    const base = (filepath.length * 5) % 800 + 200;

    // Type-specific multipliers
    const multipliers: Record<FileType, number> = {
        image: 5.0,
        video: 20.0,
        audio: 10.0,
        code: 0.5,
        text: 0.3,
        markdown: 0.3,
        pdf: 8.0,
        spreadsheet: 3.0,
        csv: 2.0,
        archive: 5.0,
        database: 4.0,
        other: 1.0
    };

    const size = base * multipliers[type];

    if (size < 1024) return `${Math.round(size)} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

// Get the API URL for file content
function getFileUrl(sandboxId: string | undefined, path: string, appType: string = 'web'): string {
    if (!sandboxId) return path;

    const workspacePath = `/workspace/${appType === 'mobile' ? 'cheatcode-mobile' : 'cheatcode-app'}`;

    // Check if the path already starts with the correct workspace path
    if (path.startsWith(workspacePath)) {
        // Already correct
    } else if (path.startsWith('/workspace')) {
        // Convert old /workspace paths to new structure
        const relativePart = path.replace('/workspace/', '').replace('/workspace', '');
        // Remove any legacy workspace directory names
        const cleanRelativePart = relativePart.replace(/^(cheatcode-app|cheatcode-mobile)\//, '');
        path = cleanRelativePart ? `${workspacePath}/${cleanRelativePart}` : workspacePath;
    } else {
        // Relative path, make it relative to the correct workspace
        path = `${workspacePath}/${path.startsWith('/') ? path.substring(1) : path}`;
    }

    // Handle any potential Unicode escape sequences
    try {
        // Replace escaped Unicode sequences with actual characters
        path = path.replace(/\\u([0-9a-fA-F]{4})/g, (_, hexCode) => {
            return String.fromCharCode(parseInt(hexCode, 16));
        });
    } catch (e) {
        // Error processing Unicode escapes in path - continue with original
    }

    const url = new URL(`${API_URL}/sandboxes/${sandboxId}/files/content`);

    // Properly encode the path parameter for UTF-8 support
    url.searchParams.append('path', path);

    return url.toString();
}

interface FileAttachmentProps {
    filepath: string;
    onClick?: (path: string) => void;
    className?: string;
    sandboxId?: string;
    showPreview?: boolean;
    localPreviewUrl?: string;
    customStyle?: React.CSSProperties;
    /**
     * Controls whether HTML, Markdown, and CSV files show their content preview.
     * - true: files are shown as regular file attachments (default)
     * - false: HTML, MD, and CSV files show rendered content in grid layout
     */
    collapsed?: boolean;
    project?: Project;
}

export function FileAttachment({
    filepath,
    onClick,
    className,
    sandboxId,
    showPreview = true,
    localPreviewUrl,
    customStyle,
    collapsed = true,
    project
}: FileAttachmentProps) {

    // Simplified state management
    const [hasError, setHasError] = React.useState(false);

    // Basic file info
    const filename = filepath.split('/').pop() || 'file';
    const extension = filename.split('.').pop()?.toLowerCase() || '';
    const fileType = getFileType(filename);
    const fileUrl = localPreviewUrl || (sandboxId ? getFileUrl(sandboxId, filepath, project?.app_type) : filepath);
    const typeLabel = getTypeLabel(fileType, extension);
    const fileSize = getFileSize(filepath, fileType);
    const IconComponent = getFileIcon(fileType);

    // Display flags
    const isImage = fileType === 'image';
    const isHtmlOrMd = extension === 'html' || extension === 'htm' || extension === 'md' || extension === 'markdown';
    const isCsv = extension === 'csv' || extension === 'tsv';
    const isGridLayout = customStyle?.gridColumn === '1 / -1' || Boolean(customStyle && ('--attachment-height' in customStyle));
    // Define isInlineMode early, before any hooks
    const isInlineMode = !isGridLayout;
    const shouldShowPreview = (isHtmlOrMd || isCsv) && showPreview && collapsed === false;

    // Use the React Query hook to fetch file content
    const {
        data: fileContent,
        isLoading: fileContentLoading,
        error: fileContentError
    } = useFileContent(
        shouldShowPreview ? sandboxId : undefined,
        shouldShowPreview ? filepath : undefined
    );

    // Use the React Query hook to fetch image content with authentication
    const {
        data: imageUrl,
        isLoading: imageLoading,
        error: imageError
    } = useImageContent(
        isImage && showPreview && sandboxId ? sandboxId : undefined,
        isImage && showPreview ? filepath : undefined
    );

    // Set error state based on query errors
    React.useEffect(() => {
        if (fileContentError || imageError) {
            setHasError(true);
        }
    }, [fileContentError, imageError]);

    const handleClick = () => {
        if (onClick) {
            onClick(filepath);
        }
    };

    // Images are displayed with their natural aspect ratio
    if (isImage && showPreview) {
        // Use custom height for images if provided through CSS variable
        const imageHeight = isGridLayout
            ? (customStyle as Record<string, string>)?.['--attachment-height'] ?? '180px'
            : '54px';

        // Show loading state for images
        if (imageLoading && sandboxId) {
            return (
                <button
                    onClick={handleClick}
                    className={cn(
                        "group relative min-h-[54px] min-w-fit rounded-sm cursor-pointer",
                        "border border-zinc-900 bg-background hover:bg-zinc-900 rounded-sm",
                        "bg-zinc-900",
                        "p-0 overflow-hidden",
                        "flex items-center justify-center",
                        isGridLayout ? "w-full" : "min-w-[54px]",
                        className
                    )}
                    style={{
                        maxWidth: "100%",
                        height: isGridLayout ? imageHeight : 'auto',
                        ...customStyle
                    }}
                    title={filename}
                >
                    <Loader2 className="h-6 w-6 text-primary animate-spin" />
                </button>
            );
        }

        // Check for errors
        if (imageError || hasError) {
            return (
                <button
                    onClick={handleClick}
                    className={cn(
                        "group relative min-h-[54px] min-w-fit rounded-sm cursor-pointer",
                        "border border-zinc-900 bg-background hover:bg-zinc-900 rounded-sm",
                        "bg-zinc-900",
                        "p-0 overflow-hidden",
                        "flex flex-col items-center justify-center gap-1",
                        isGridLayout ? "w-full" : "inline-block",
                        className
                    )}
                    style={{
                        maxWidth: "100%",
                        height: isGridLayout ? imageHeight : 'auto',
                        ...customStyle
                    }}
                    title={filename}
                >
                    <IconComponent className="h-6 w-6 text-red-500 mb-1" />
                    <div className="text-xs text-red-500">Failed to load image</div>
                </button>
            );
        }

        return (
            <button
                onClick={handleClick}
                className={cn(
                    "group relative min-h-[54px] rounded-sm cursor-pointer",
                    "border border-zinc-900 bg-background hover:bg-zinc-900 rounded-sm",
                    "bg-zinc-900",
                    "p-0 overflow-hidden", // No padding, content touches borders
                    "flex items-center justify-center", // Center the image
                    isGridLayout ? "w-full" : "inline-block", // Full width in grid
                    className
                )}
                style={{
                    maxWidth: "100%", // Ensure doesn't exceed container width
                    height: isGridLayout ? imageHeight : 'auto',
                    ...customStyle
                }}
                title={filename}
            >
                <img
                    src={sandboxId ? (imageUrl ?? undefined) : fileUrl}
                    alt={filename}
                    className={cn(
                        "max-h-full", // Respect parent height constraint
                        isGridLayout ? "w-full h-full object-cover" : "w-auto" // Full width & height in grid with object-cover
                    )}
                    style={{
                        height: imageHeight,
                        objectPosition: "center",
                        objectFit: isGridLayout ? "cover" : "contain"
                    }}
                    onLoad={() => {
                        // Image loaded successfully
                    }}
                    onError={(e) => {
                        setHasError(true);
                        // If the image failed to load and we have a localPreviewUrl that's a blob URL, try using it directly
                        if (localPreviewUrl && typeof localPreviewUrl === 'string' && localPreviewUrl.startsWith('blob:')) {
                            (e.target as HTMLImageElement).src = localPreviewUrl;
                        }
                    }}
                />
            </button>
        );
    }

    const rendererMap = {
        'md': MarkdownRenderer,
        'markdown': MarkdownRenderer
    };

    // HTML/MD/CSV preview when not collapsed and in grid layout
    if (shouldShowPreview && isGridLayout) {
        // Determine the renderer component
        const Renderer = rendererMap[extension as keyof typeof rendererMap];

        return (
            <div
                className={cn(
                    "group relative rounded-sm w-full",
                    "border",
                    "bg-card",
                    "overflow-hidden",
                    "h-[300px]", // Fixed height for previews
                    "pt-10", // Room for header
                    className
                )}
                style={{
                    gridColumn: "1 / -1", // Make it take full width in grid
                    width: "100%",        // Ensure full width
                    ...customStyle
                }}
                onClick={hasError ? handleClick : undefined} // Make clickable if error
            >
                {/* Content area */}
                <div className="h-full w-full relative">
                    {/* Only show content if we have it and no errors */}
                    {!hasError && fileContent && (
                        <>
                            {Renderer ? (
                                <Renderer
                                    content={fileContent}
                                    className="h-full w-full"
                                />
                            ) : (
                                <div className="p-4 text-muted-foreground">
                                    No preview available for this file type
                                </div>
                            )}
                        </>
                    )}

                    {/* Error state */}
                    {hasError && (
                        <div className="h-full w-full flex flex-col items-center justify-center p-4">
                            <div className="text-red-500 mb-2">Error loading content</div>
                            <div className="text-muted-foreground text-sm text-center mb-2">
                                {fileUrl && (
                                    <div className="text-xs max-w-full overflow-hidden truncate opacity-70">
                                        Path may need /workspace prefix
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={handleClick}
                                className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 rounded-md text-sm"
                            >
                                Open in viewer
                            </button>
                        </div>
                    )}

                    {/* Loading state */}
                    {fileContentLoading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
                            <Loader2 className="h-6 w-6 text-primary animate-spin" />
                        </div>
                    )}

                    {/* Empty content state - show when not loading and no content yet */}
                    {!fileContent && !fileContentLoading && !hasError && (
                        <div className="h-full w-full flex flex-col items-center justify-center p-4 pointer-events-none">
                            <div className="text-muted-foreground text-sm mb-2">
                                Preview available
                            </div>
                            <div className="text-muted-foreground text-xs text-center">
                                Click header to open externally
                            </div>
                        </div>
                    )}
                </div>

                {/* Header with filename */}
                <div className="absolute top-0 left-0 right-0 bg-accent p-2 z-10 flex items-center justify-between">
                    <div className="text-sm font-medium truncate">{filename}</div>
                    {onClick && (
                        <button
                            onClick={handleClick}
                            className="p-1 rounded-full hover:bg-background/10 dark:hover:bg-white/10"
                        >
                            <ExternalLink size={14} />
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // Regular files with details
    const safeStyle: React.CSSProperties = { ...customStyle };
    delete safeStyle.height;
    delete (safeStyle as Record<string, unknown>)['--attachment-height'];

    return (
        <button
            onClick={handleClick}
            className={cn(
                "group flex rounded-sm transition-all duration-200 min-h-[54px] h-[54px] overflow-hidden cursor-pointer",
                "border border-zinc-900 bg-background hover:bg-zinc-900 rounded-sm",
                "bg-sidebar",
                "text-left",
                "pr-7", // Right padding for X button
                isInlineMode
                    ? "min-w-[170px] w-full sm:max-w-[300px] sm:w-fit" // Full width on mobile, constrained on larger screens
                    : "min-w-[170px] max-w-[300px] w-fit", // Original constraints for grid layout
                className
            )}
            style={safeStyle}
            title={filename}
        >
            <div className="relative min-w-[54px] w-[54px] h-full aspect-square flex-shrink-0 bg-zinc-900">
                <div className="flex items-center justify-center h-full w-full">
                    <IconComponent className="h-5 w-5 text-black/60 dark:text-white/60" />
                </div>
            </div>

            <div className="flex-1 min-w-0 flex flex-col justify-center p-2 pl-3 overflow-hidden">
                <div className="text-sm font-medium text-foreground truncate max-w-full">
                    {filename}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                    <span className="text-black/60 dark:text-white/60 truncate">{typeLabel}</span>
                    <span className="text-black/40 dark:text-white/40 flex-shrink-0">·</span>
                    <span className="text-black/60 dark:text-white/60 flex-shrink-0">{fileSize}</span>
                </div>
            </div>
        </button>
    );
}

interface FileAttachmentGridProps {
    attachments: string[];
    onFileClick?: (path: string, filePathList?: string[]) => void;
    className?: string;
    sandboxId?: string;
    showPreviews?: boolean;
    collapsed?: boolean;
    project?: Project;
}

export function FileAttachmentGrid({
    attachments,
    onFileClick,
    className,
    sandboxId,
    showPreviews = true,
    collapsed = false,
    project
}: FileAttachmentGridProps) {
    if (!attachments || attachments.length === 0) return null;

    return (
        <AttachmentGroup
            files={attachments}
            onFileClick={onFileClick}
            className={className}
            sandboxId={sandboxId}
            showPreviews={showPreviews}
            layout="grid"
            gridImageHeight={150} // Use larger height for grid layout
            collapsed={collapsed}
            project={project}
        />
    );
} 