// Utility API Functions
import { createClient } from '@/lib/supabase/client';

// Exported for potential testing purposes
export const testSupabaseConnection = async (): Promise<{ success: boolean; message: string }> => {
  try {
    const supabase = createClient();

    const { error } = await supabase
      .from('projects')
      .select('count')
      .eq('is_public', true)
      .limit(1);

    if (error) {
      return {
        success: false,
        message: `Supabase error: ${error.message} (${error.code})`
      };
    }

    return {
      success: true,
      message: 'Supabase connection successful'
    };
  } catch (err) {
    return {
      success: false,
      message: `Connection error: ${err instanceof Error ? err.message : 'Unknown error'}`
    };
  }
};
