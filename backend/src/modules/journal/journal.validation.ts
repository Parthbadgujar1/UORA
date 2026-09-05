import { z } from "zod";

export const createJournalSchema = z.object({
  body: z.object({
    name: z.string().min(3),
    shortName: z.string().min(2),
    slug: z.string().min(2),
    subdomain: z.string().min(2),
    issn: z.string().optional(),
    eissn: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
  }),
});

export const updateJournalSchema = z.object({
  body: z.object({
    name: z.string().min(3).optional(),
    shortName: z.string().min(2).optional(),
    issn: z.string().optional(),
    eissn: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
  }),
});

export type CreateJournalInput = z.infer<typeof createJournalSchema>["body"];
export type UpdateJournalInput = z.infer<typeof updateJournalSchema>["body"];