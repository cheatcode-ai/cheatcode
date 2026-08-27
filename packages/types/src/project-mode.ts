import { z } from "zod";

const PROJECT_MODES = ["app-builder", "app-builder-mobile", "general"] as const;
export const ProjectModeSchema = z.enum(PROJECT_MODES);
