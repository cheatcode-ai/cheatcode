# Edit File Tool Setup

## Environment Variables Required

To use the new `edit_file` tool, you need to add one of the following API keys to your `backend/.env` file:

### Option 1: Morph API (Recommended)
```bash
MORPH_API_KEY=your_morph_api_key_here
```

### Option 2: OpenRouter (Fallback)
```bash
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

## Complete .env File Example

Create a `backend/.env` file with the following content:

```bash
# AI API Keys for edit_file functionality
MORPH_API_KEY=your_morph_api_key_here
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Other LLM API Keys (if you have them)
OPENAI_API_KEY=your_openai_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
GROQ_API_KEY=your_groq_api_key_here

# Your other existing environment variables...
```

## How to Get API Keys

### Morph API Key
1. Visit [Morph AI](https://api.morphllm.com/)
2. Sign up for an account
3. Generate an API key

### OpenRouter API Key
1. Visit [OpenRouter](https://openrouter.ai/)
2. Sign up for an account
3. Go to your dashboard and create an API key

## Testing the Tool

Once you have the API keys set up:

1. Restart your backend service
2. Use the `edit_file` tool in your agent with this format:

```xml
<function_calls>
<invoke name="edit_file">
<parameter name="target_file">src/example.py</parameter>
<parameter name="instructions">Add error handling to the main function</parameter>
<parameter name="code_edit">
// ... existing imports ...
import logging
// ... existing code ...
def main():
    try:
        # existing code here
        result = process_data()
        return result
    except Exception as e:
        logging.error(f"Error in main: {e}")
        raise
// ... existing code ...
</parameter>
</invoke>
</function_calls>
```

The tool will intelligently apply your changes using AI!