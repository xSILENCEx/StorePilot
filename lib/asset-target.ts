import { z } from "zod";
import { graphicTypes, platformSchema } from "./model";

export const assetTarget = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("graphic"),
    platform: z.literal("google"),
    type: z.enum(graphicTypes),
  }),
  z.object({
    kind: z.literal("screenshot"),
    platform: platformSchema,
    appId: z.uuid(),
    group: z.string().regex(/^[\w-]{1,150}$/),
    preferred: z
      .string()
      .regex(/^\d{2,4}x\d{2,4}$/)
      .optional(),
  }),
]);
export type AssetTarget = z.infer<typeof assetTarget>;
