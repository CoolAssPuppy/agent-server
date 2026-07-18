import { z } from 'zod';

const ResourceIdentitySchema = z.object({
  id: z.string().trim().min(1).max(512).refine((value) => !value.includes('\0')),
  name: z.string().trim().min(1).max(160),
  account: z.string().trim().min(1).max(160).optional(),
});

const uniqueActions = <T extends z.ZodTypeAny>(schema: T) => z.array(schema).min(1).superRefine((actions, ctx) => {
  if (new Set(actions).size !== actions.length) {
    ctx.addIssue({ code: 'custom', message: 'Native service actions must be unique' });
  }
});

const CalendarResourceGrantSchema = ResourceIdentitySchema.extend({
  actions: uniqueActions(z.enum(['read', 'create', 'update'])),
}).strict();

const ReminderResourceGrantSchema = ResourceIdentitySchema.extend({
  actions: uniqueActions(z.enum(['read', 'create', 'complete'])),
}).strict();

const ContactResourceGrantSchema = ResourceIdentitySchema.extend({
  actions: z.tuple([z.literal('read')]),
  fields: uniqueActions(z.enum(['name', 'email', 'phone', 'birthday'])),
}).strict();

const resourceCollection = <T extends z.ZodTypeAny>(schema: T) => z.object({
  resources: z.array(schema).max(128).superRefine((resources, ctx) => {
    if (new Set(resources.map((resource) => (resource as { id: string }).id)).size !== resources.length) {
      ctx.addIssue({ code: 'custom', message: 'Native service resources must be unique' });
    }
  }),
}).strict();

export const NativeServicesSchema = z.object({
  calendar: resourceCollection(CalendarResourceGrantSchema).optional(),
  reminders: resourceCollection(ReminderResourceGrantSchema).optional(),
  contacts: resourceCollection(ContactResourceGrantSchema).optional(),
}).strict();

export type NativeServices = z.infer<typeof NativeServicesSchema>;

type LegacyCalendarGrant = {
  id: string;
  name: string;
  account?: string;
  access: 'read_only' | 'read_write';
};

export function nativeServiceGrantEnvironment(agent: {
  native_services?: NativeServices;
  calendar_access?: LegacyCalendarGrant[];
}): string | undefined {
  const calendar = agent.calendar_access ? {
    resources: agent.calendar_access.map((grant) => ({
      id: grant.id,
      name: grant.name,
      account: grant.account,
      actions: grant.access === 'read_write'
        ? ['read', 'create', 'update'] as const
        : ['read'] as const,
    })),
  } : undefined;
  const services = agent.native_services || calendar
    ? {
      ...agent.native_services,
      ...(calendar ? { calendar } : {}),
    }
    : undefined;
  return services === undefined ? undefined : JSON.stringify({ version: 1, services });
}
