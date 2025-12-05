// Models API Functions
import { API_URL } from './config';

export interface AvailableModel {
  id: string;
  openrouter_id: string;
  name: string;
  provider: string;
  description: string;
  max_tokens: number;
  context_window?: number;
  cost_input_per_1k?: number;
  cost_output_per_1k?: number;
  default?: boolean;
  logo_url?: string;
}

export interface ModelsResponse {
  models: AvailableModel[];
  default_model_id: string;
}

export const getAvailableModels = async (): Promise<ModelsResponse> => {
  if (!API_URL) {
    throw new Error('Backend URL is not configured');
  }

  const response = await fetch(`${API_URL}/models/available`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch available models: ${response.statusText}`);
  }

  return response.json();
};
