/**
 * Essential tool parsing utilities extracted from tool-views
 * These are needed for ThreadContent to handle tool display and parsing
 */

// XML Tool Parser interfaces and functions
export interface ParsedToolCall {
  functionName: string;
  parameters: Record<string, any>;
  rawXml: string;
}

export interface ParsedToolResult {
  toolName: string;
  functionName: string;
  xmlTagName?: string;
  toolOutput: string;
  isSuccess: boolean;
  arguments?: Record<string, any>;
  timestamp?: string;
  toolCallId?: string;
  summary?: string;
}

/**
 * Check if content uses new XML format
 */
export function isNewXmlFormat(content: string): boolean {
  return content.includes('<function_calls>') && content.includes('<invoke');
}

/**
 * Extract tool name from streaming content
 */
export function extractToolNameFromStream(content: string): string | null {
  if (!content) return null;
  
  // Look for function_calls format first
  const functionCallsMatch = content.match(/<function_calls>[\s\S]*?<invoke\s+name=["']([^"']+)["']/i);
  if (functionCallsMatch) {
    return functionCallsMatch[1].replace(/_/g, '-');
  }
  
  // Look for old format XML tags
  const xmlTagMatch = content.match(/<([a-zA-Z][a-zA-Z0-9_-]*)/);
  if (xmlTagMatch) {
    return xmlTagMatch[1].replace(/_/g, '-');
  }
  
  return null;
}

/**
 * Parse XML tool calls from content
 */
export function parseXmlToolCalls(content: string): ParsedToolCall[] {
  const toolCalls: ParsedToolCall[] = [];

  const functionCallsRegex = /<function_calls>([\s\S]*?)<\/function_calls>/gi;
  let functionCallsMatch;
  
  while ((functionCallsMatch = functionCallsRegex.exec(content)) !== null) {
    const functionCallsContent = functionCallsMatch[1];
    
    const invokeRegex = /<invoke\s+name=["']([^"']+)["']>([\s\S]*?)<\/invoke>/gi;
    let invokeMatch;
    
    while ((invokeMatch = invokeRegex.exec(functionCallsContent)) !== null) {
      const functionName = invokeMatch[1].replace(/_/g, '-');
      const invokeContent = invokeMatch[2];
      const parameters: Record<string, any> = {};
      
      const paramRegex = /<parameter\s+name=["']([^"']+)["']>([\s\S]*?)<\/parameter>/gi;
      let paramMatch;
      
      while ((paramMatch = paramRegex.exec(invokeContent)) !== null) {
        const paramName = paramMatch[1];
        const paramValue = paramMatch[2].trim();
        parameters[paramName] = parseParameterValue(paramValue);
      }
      
      toolCalls.push({
        functionName,
        parameters,
        rawXml: invokeMatch[0]
      });
    }
  }
  
  return toolCalls;
}

/**
 * Parse parameter value with type inference
 */
function parseParameterValue(value: string): any {
  const trimmed = value.trim();
  
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (trimmed === 'undefined') return undefined;
  
  const numValue = Number(trimmed);
  if (!isNaN(numValue) && trimmed !== '') {
    return numValue;
  }
  
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

/**
 * Parse tool result content from various formats
 */
export function parseToolResult(content: any): ParsedToolResult | null {
  try {
    if (typeof content === 'string') {
      return parseStringToolResult(content);
    }
    
    if (typeof content === 'object' && content !== null) {
      return parseObjectToolResult(content);
    }
    
    return null;
  } catch (error) {
    console.error('Error parsing tool result:', error);
    return null;
  }
}

/**
 * Parse string-based tool result
 */
function parseStringToolResult(content: string): ParsedToolResult | null {
  try {
    const parsed = JSON.parse(content);
    return parseObjectToolResult(parsed);
  } catch {
    return {
      toolName: 'unknown',
      functionName: 'unknown',
      toolOutput: content,
      isSuccess: true
    };
  }
}

/**
 * Parse object-based tool result
 */
function parseObjectToolResult(content: any): ParsedToolResult | null {
  if (content.tool_execution) {
    return {
      toolName: content.tool_execution.tool_name || 'unknown',
      functionName: content.tool_execution.function_name || 'unknown',
      toolOutput: content.tool_execution.result?.output || content.tool_execution.result || '',
      isSuccess: content.tool_execution.result?.success !== false,
      arguments: content.tool_execution.arguments,
      timestamp: content.tool_execution.timestamp
    };
  }
  
  return {
    toolName: content.tool_name || 'unknown',
    functionName: content.function_name || 'unknown', 
    toolOutput: content.output || content.result || JSON.stringify(content),
    isSuccess: content.success !== false
  };
}

/**
 * Format MCP tool display name
 */
export function formatMCPToolDisplayName(serverName: string, toolName: string): string {
  const formattedServerName = serverName.charAt(0).toUpperCase() + serverName.slice(1);
  const formattedToolName = toolName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  return `${formattedServerName}: ${formattedToolName}`;
} 