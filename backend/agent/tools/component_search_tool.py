import os
import json
import numpy as np
from typing import List, Dict, Any, Optional
from agentpress.tool import Tool, ToolResult, ToolSchema, SchemaType, XMLTagSchema, XMLNodeMapping
from agentpress.thread_manager import ThreadManager
from services.supabase import DBConnection
from utils.logger import logger
# Google Generative AI (Gemini) SDK
from google import genai
from google.genai import types

class ComponentSearchTool(Tool):
    """Tool for searching components using embedding-based semantic search.
    
    This tool searches the component index using vector embeddings to find
    the most relevant components for a given user request or description.
    """

    def __init__(self, thread_manager: ThreadManager, app_type: str = 'web'):
        super().__init__()
        self.thread_manager = thread_manager
        self.db = DBConnection()
        self.app_type = app_type
        logger.info(f"🔍 ComponentSearchTool initialized with app_type: {app_type}")
        
        # Initialize Gemini API client using the new google.genai Client
        # Strictly use GOOGLE_API_KEY; do not fallback to other envs or defaults
        api_key = os.getenv('GOOGLE_API_KEY')
        try:
            if api_key:
                self.client = genai.Client(api_key=api_key)
            else:
                logger.debug("GOOGLE_API_KEY not set – skipping Gemini client init")
                self.client = None
        except Exception as api_err:  # pragma: no cover
            logger.warning(f"Failed to initialize Google GenAI client: {api_err}")
            self.client = None

    def get_schemas(self) -> Dict[str, List[ToolSchema]]:
        """Override base class to provide dynamic schemas based on app_type."""
        return self.get_tool_schemas()
    
    def get_tool_schemas(self) -> Dict[str, List[ToolSchema]]:
        """Generate dynamic tool schemas based on app_type context."""
        
        # Determine context-appropriate examples and descriptions based on actual database content
        if self.app_type == 'mobile':
            # Mobile React Native examples - based on 182 components in mobile_component_index
            search_example = "tab navigation with icons and animations"
            search_description = "Search through 182+ React Native mobile components using semantic similarity. This tool finds mobile UI components optimized for React Native/Expo apps, including navigation (tabs, headers), modals (dialogs, popups), icons (Lucide for React Native), typography (mobile-optimized text), cards, buttons, and toggles. Returns complete component code ready for mobile integration."
            search_query_examples = "'tab navigation', 'modal dialog', 'Lucide icons', 'mobile card component', 'toggle switch', 'mobile typography', 'navigation header'"
            suggestions_section = "navigation"
            suggestions_sections = ["navigation", "modals", "icons", "typography", "cards", "buttons", "toggles", "tooltips", "screens", "layouts"]
        else:
            # Web React examples - based on 632 components in component_index  
            search_example = "animated hero section with text effects"
            search_description = "Search through 632+ React web components using semantic similarity. This extensive library includes 236 UI effects (animations, backgrounds, text effects like WobbleCard, Vortex, TypewriterEffect), 45 cards, 36 navigation components, plus hero sections, features, testimonials, forms, footers, pricing tables, and more. Returns complete component code ready for web integration."
            search_query_examples = "'animated hero section', 'pricing table with effects', 'testimonial cards', 'navigation header', 'contact form', 'text animation effects', 'background animations'"
            suggestions_section = "hero"
            suggestions_sections = ["hero", "features", "pricing", "testimonials", "contact", "navigation", "footer", "cta", "cards", "ui-effects", "forms", "modals", "buttons"]

        schemas = {}

        # search_components schema
        schemas["search_components"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function",
                    "function": {
                        "name": "search_components",
                        "description": search_description,
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "query": {
                                    "type": "string",
                                    "description": f"Natural language description of what kind of component you're looking for. Examples: {search_query_examples}"
                                },
                                "match_threshold": {
                                    "type": "number",
                                    "description": "Minimum similarity score (0.0 to 1.0). Higher values return only very similar components. Default: 0.7",
                                    "minimum": 0.0,
                                    "maximum": 1.0,
                                    "default": 0.7
                                },
                                "match_count": {
                                    "type": "integer",
                                    "description": "Maximum number of components to return. Default: 5",
                                    "minimum": 1,
                                    "maximum": 20,
                                    "default": 5
                                },
                                "include_full_code": {
                                    "type": "boolean",
                                    "description": "Whether to include the complete component source code in results for direct editing. Default: true",
                                    "default": True
                                }
                            },
                            "required": ["query"]
                        }
                    }
                }
            ),
            ToolSchema(
                schema_type=SchemaType.XML,
                schema={},
                xml_schema=XMLTagSchema(
                    tag_name="search-components",
                    mappings=[
                        XMLNodeMapping(param_name="query", node_type="element", path="query", required=True),
                        XMLNodeMapping(param_name="match_threshold", node_type="attribute", path=".", required=False),
                        XMLNodeMapping(param_name="match_count", node_type="attribute", path=".", required=False),
                        XMLNodeMapping(param_name="include_full_code", node_type="attribute", path=".", required=False)
                    ],
                    example=f'''
<function_calls>
<invoke name="search_components">
<parameter name="query">{search_example}</parameter>
<parameter name="match_threshold">0.7</parameter>
<parameter name="match_count">3</parameter>
<parameter name="include_full_code">true</parameter>
</invoke>
</function_calls>
'''
                )
            )
        ]

        # get_component_suggestions schema
        schemas["get_component_suggestions"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function", 
                    "function": {
                        "name": "get_component_suggestions",
                        "description": f"Get component suggestions for common {'mobile app' if self.app_type == 'mobile' else 'website'} sections. Based on actual component database with {'182+ mobile components' if self.app_type == 'mobile' else '632+ web components'}. Useful when you need ideas for what components are available.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "section_type": {
                                    "type": "string",
                                    "description": "Type of section to get suggestions for",
                                    "enum": suggestions_sections
                                }
                            },
                            "required": ["section_type"]
                        }
                    }
                }
            ),
            ToolSchema(
                schema_type=SchemaType.XML,
                schema={},
                xml_schema=XMLTagSchema(
                    tag_name="get-component-suggestions", 
                    mappings=[
                        XMLNodeMapping(param_name="section_type", node_type="attribute", path=".", required=True)
                    ],
                    example=f'''
<function_calls>
<invoke name="get_component_suggestions">
<parameter name="section_type">{suggestions_section}</parameter>
</invoke>
</function_calls>
'''
                )
            )
        ]

        return schemas

    async def _generate_embedding(self, text: str) -> List[float]:
        """Generate embedding for the given text using Gemini."""
        try:
            if not self.client:
                logger.error("Gemini client not initialized")
                return []
            
            # Use the latest Gemini embedding API
            response = self.client.models.embed_content(
                model='gemini-embedding-001',
                contents=text,
                config=types.EmbedContentConfig(
                    task_type="CODE_RETRIEVAL_QUERY",  # Optimized for code queries
                    output_dimensionality=1536
                )
            )
            
            if response and response.embeddings:
                # Get the first (and only) embedding from the response
                embedding_obj = response.embeddings[0]
                embedding_values = embedding_obj.values
                
                # Normalize the embedding for 1536 dimensions (as per documentation)
                # The 3072 dimension embedding is auto-normalized, but smaller ones need manual normalization
                embedding_array = np.array(embedding_values)
                normalized_embedding = embedding_array / np.linalg.norm(embedding_array)
                
                return normalized_embedding.tolist()
            else:
                logger.error("No embeddings returned from Gemini API")
                return []
                
        except Exception as e:
            logger.error(f"Error generating embedding: {e}")
            return []


    async def search_components(
        self, 
        query: str, 
        match_threshold: float = 0.7, 
        match_count: int = 5,
        include_full_code: bool = True
    ) -> ToolResult:
        """Search for components based on user description or requirements and return complete code for direct editing."""
        try:
            logger.info(f"Searching for components with query: {query}")
            
            # Generate embedding for the query
            query_embedding = await self._generate_embedding(query)
            
            if not query_embedding:
                return ToolResult(
                    success=False,
                    output="Failed to generate embedding for query"
                )
            
            logger.info(f"Generated {len(query_embedding)} dimensional embedding for query")
            
            # Initialize database connection
            await self.db.initialize()
            client = await self.db.client
            
            # Call the appropriate RPC function based on app_type
            if self.app_type == 'mobile':
                rpc_function = 'match_mobile_components'
                logger.info(f"🔍 Using mobile component search (RPC: {rpc_function}) for app_type: {self.app_type}")
            else:
                rpc_function = 'match_components'
                logger.info(f"🔍 Using web component search (RPC: {rpc_function}) for app_type: {self.app_type}")
            
            result = await client.rpc(
                rpc_function,
                {
                    'query_embedding': query_embedding,
                    'match_threshold': match_threshold,
                    'match_count': match_count
                }
            ).execute()
            
            if result.data is None:
                return ToolResult(
                    success=True,
                    output="No matching components found. Try lowering the match_threshold or using different search terms."
                )
            
            components = result.data
            logger.info(f"Found {len(components)} matching components")
            
            # Format the results for the agent
            formatted_results = []
            for comp in components:
                formatted_comp = {
                    "path": comp["path"],
                    "component": comp["component"],
                    "route": comp.get("route"),
                    "summary": comp["summary"],
                    "props": comp.get("props", ""),
                    "similarity_score": round(comp["score"], 3)
                }
                
                # Include full code if requested
                if include_full_code and comp.get("full_code"):
                    formatted_comp["full_code"] = comp["full_code"]
                
                formatted_results.append(formatted_comp)
            
            # Create a detailed response for the agent
            content_lines = [
                f"Found {len(components)} matching components for: '{query}'",
                ""
            ]
            
            if formatted_results:
                content_lines.append("Components found (with complete source code):")
                content_lines.append("")
                
                for i, comp in enumerate(formatted_results, 1):
                    score_pct = comp["similarity_score"] * 100
                    content_lines.extend([
                        f"{i}. PATH: `{comp['path']}` ({score_pct:.1f}% match)",
                        f"   Component: {comp['component']}",
                        f"   {comp['summary']}",
                        f"   Props: {comp['props']}" if comp.get('props') else "",
                        ""
                    ])
                    
                    # Include the full source code for direct editing
                    if include_full_code and comp.get("full_code"):
                        content_lines.extend([
                            f"   COMPLETE SOURCE CODE:",
                            "   ```tsx",
                            f"   {comp['full_code']}",
                            "   ```",
                            ""
                        ])
                
                # Add workflow instructions based on app_type
                if self.app_type == 'mobile':
                    content_lines.extend([
                        "MOBILE WORKFLOW:",
                        "1. Copy component code and integrate into your app/index.tsx",
                        "2. Use proper React Native imports and mobile-optimized styling",
                        "3. Available: React Native, Expo, Lucide React Native, NativeWind"
                    ])
                else:
                    content_lines.extend([
                        "WEB WORKFLOW:",
                        "1. Copy component code into src/app/page.tsx as internal functions",
                        "2. Replace 'framer-motion' imports with 'motion'",
                        "3. Available: React, lucide-react, motion, @/components/ui/*"
                    ])
            else:
                content_lines.extend([
                    "No matches found.",
                    "Try lowering the match_threshold or using different search terms."
                ])
            
            return ToolResult(
                success=True,
                output="\n".join(content_lines)
            )
            
        except Exception as e:
            logger.error(f"Error in component search: {e}")
            return ToolResult(
                success=False,
                output=f"Component search failed: {str(e)}"
            )


    async def get_component_suggestions(self, section_type: str) -> ToolResult:
        """Get suggestions for common component types based on actual component database content."""
        
        # Dynamic suggestions based on app_type and actual database content
        if self.app_type == 'mobile':
            suggestions_map = {
                "navigation": "tab navigation with icons and mobile header",
                "modals": "mobile dialog and popup components",
                "icons": "Lucide icons optimized for React Native",
                "typography": "mobile-optimized text components like H1, H2, P",
                "cards": "mobile card layouts and interactions",
                "buttons": "mobile-friendly button components",
                "toggles": "toggle switches and mobile controls",
                "tooltips": "mobile tooltip and hint components",
                "screens": "full mobile screen layouts",
                "layouts": "mobile app layout and structure components"
            }
        else:
            suggestions_map = {
                "hero": "animated hero section with background effects and call to action",
                "features": "feature section with icons, animations and descriptions", 
                "pricing": "pricing table with multiple tiers and effects",
                "testimonials": "customer testimonials with animations and photos",
                "contact": "contact form with validation and effects",
                "navigation": "navigation bar with logo, menu and animations",
                "footer": "footer with links, animations and company information",
                "cta": "call to action section with animated buttons",
                "cards": "interactive card components with hover effects",
                "ui-effects": "animations, backgrounds, text effects like WobbleCard, Vortex, TypewriterEffect",
                "forms": "form components with validation and styling",
                "modals": "modal dialogs and popup components",
                "buttons": "interactive button components with effects"
            }
        
        if section_type not in suggestions_map:
            return ToolResult(
                success=False,
                output=f"Unknown section type: {section_type}. Available types: {', '.join(suggestions_map.keys())}"
            )
        
        # Search for components of this type
        query = suggestions_map[section_type]
        return await self.search_components(query, match_threshold=0.65, match_count=6) 