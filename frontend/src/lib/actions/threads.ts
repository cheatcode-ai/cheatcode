'use server';

import { updateThreadName as updateThreadNameApi } from '@/lib/api';
import { auth } from '@clerk/nextjs/server';

export const generateThreadName = async (message: string): Promise<string> => {
  try {
    // Default name in case the API fails
    const defaultName =
      message.trim().length > 50
        ? message.trim().substring(0, 47) + '...'
        : message.trim();

    // OpenAI API key should be stored in an environment variable
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return defaultName;
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              "You are a helpful assistant that generates extremely concise titles (2-4 words maximum) for chat threads based on the user's message. Respond with only the title, no other text or punctuation.",
          },
          {
            role: 'user',
            content: `Generate an extremely brief title (2-4 words only) for a chat thread that starts with this message: "${message}"`,
          },
        ],
        max_tokens: 20,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      return defaultName;
    }

    const data = await response.json();
    const generatedName = data.choices[0]?.message?.content?.trim();

    // Return the generated name or default if empty
    return generatedName || defaultName;
  } catch (error) {
    // Fall back to using a truncated version of the message
    return message.trim().length > 50
      ? message.trim().substring(0, 47) + '...'
      : message.trim();
  }
};

export const generateAndUpdateThreadName = async (threadId: string, message: string): Promise<string> => {
  try {
    // Get Clerk token from server-side auth
    const { getToken } = await auth();
    const clerkToken = await getToken();

    if (!clerkToken) {
      throw new Error('Authentication required. No Clerk token available.');
    }

    // Generate the thread name
    const threadName = await generateThreadName(message);

    // Update the thread in the database
    await updateThreadNameApi(threadId, threadName, clerkToken);

    return threadName;
  } catch (error) {
    // Return a fallback name
    return message.trim().length > 50
      ? message.trim().substring(0, 47) + '...'
      : message.trim();
  }
};
