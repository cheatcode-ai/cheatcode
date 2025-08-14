/**
 * Constructs a preview URL for HTML files in the sandbox environment.
 * Properly handles URL encoding of file paths by encoding each path segment individually.
 *
 * @param sandboxUrl - The base URL of the sandbox
 * @param filePath - The path to the HTML file (can include /workspace/ prefix)
 * @param appType - The app type to determine workspace directory
 * @returns The properly encoded preview URL, or undefined if inputs are invalid
 */
export function constructHtmlPreviewUrl(
  sandboxUrl: string | undefined,
  filePath: string | undefined,
  appType: 'web' | 'mobile' = 'web',
): string | undefined {
  if (!sandboxUrl || !filePath) {
    return undefined;
  }

  // Remove appropriate workspace prefix based on app type, with fallback for backward compatibility
  const workspacePath = appType === 'mobile' ? '/workspace/cheatcode-mobile/' : '/workspace/cheatcode-app/';
  let processedPath = filePath;
  
  // Remove specific workspace prefix first
  if (processedPath.startsWith(workspacePath)) {
    processedPath = processedPath.substring(workspacePath.length);
  } else {
    // Fallback: remove any /workspace/ prefix and any legacy workspace names
    processedPath = processedPath
      .replace(/^\/workspace\//, '')
      .replace(/^(cheatcode-app|cheatcode-mobile)\//, '');
  }

  // Split the path into segments and encode each segment individually
  const pathSegments = processedPath
    .split('/')
    .map((segment) => encodeURIComponent(segment));

  // Join the segments back together with forward slashes
  const encodedPath = pathSegments.join('/');

  return `${sandboxUrl}/${encodedPath}`;
}
