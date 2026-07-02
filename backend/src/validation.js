import { z } from "zod";

// Middleware factory: validates req.body against a schema
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
      return res.status(400).json({ error: errors.join("; ") });
    }
    req.validated = result.data;
    next();
  };
}

// Schemas
export const reviewDecisionSchema = z.object({
  decision: z.enum(["approved", "changes_requested"]),
  notes: z.string().optional(),
});

export const trackOverrideSchema = z.object({
  newTrack: z.number().int().min(1).max(4),
  reason: z.string().min(1, "reason is required"),
});

export const reviewNoteSchema = z.object({
  body: z.string().min(1, "body is required"),
});

export const toolStatusSchema = z.object({
  status: z.string().min(1, "status is required"),
});

export const userRoleSchema = z.object({
  role: z.enum(["builder", "reviewer", "admin"]),
});

export const userActiveSchema = z.object({
  active: z.boolean(),
});

export const notificationReadSchema = z.object({
  ids: z.union([
    z.literal("all"),
    z.array(z.string().uuid()).min(1),
  ]),
});

export const notificationPrefsSchema = z.object({
  notify_email: z.boolean().optional(),
  notify_in_app: z.boolean().optional(),
}).refine(
  data => data.notify_email !== undefined || data.notify_in_app !== undefined,
  { message: "No valid preferences provided" }
);

export const emailUpdateSchema = z.object({
  email: z.string().email().or(z.literal("")),
});

export const pipelineRunSchema = z.object({
  mode: z.enum(["direct-api"]).default("direct-api"),
});

export const toolEditSchema = z.object({
  name: z.string().min(1, "name is required").max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
}).refine(
  data => data.name !== undefined || data.description !== undefined,
  { message: "No fields to update" }
);

export const sandboxToggleSchema = z.object({
  sandbox: z.boolean(),
});

export const findingStatusSchema = z.object({
  statuses: z.record(
    z.string().min(1),
    z.enum(["open", "resolved", "wontfix"])
  ).refine(obj => Object.keys(obj).length > 0 && Object.keys(obj).length <= 500, {
    message: "Must contain 1-500 finding statuses",
  }),
});
