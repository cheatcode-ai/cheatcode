import { createMutationHook, createQueryHook } from '@/hooks/use-query';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { agentKeys } from './keys';
import { Agent } from './utils';
import { useRef, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';

// Removed useThreadAgent hook - agent display is now hardcoded to "cheatcode"