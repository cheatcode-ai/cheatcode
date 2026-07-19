import { z } from "zod";

export const UserDeletionPhaseSchema = z.enum([
  "runs",
  "sandbox",
  "billing",
  "quota",
  "integrations",
  "objects",
  "archive",
  "finalize",
]);
