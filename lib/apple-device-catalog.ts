import { z } from "zod";
import { appleGroupLabel, type DeviceGroup } from "./screenshot-groups";

const groupId = z.string().regex(/^[A-Z0-9_]{1,150}$/);
const catalog = z.object({
  placementProfileGroups: z.array(
    z.object({
      placementProfileGroupId: groupId,
      displayClassId: z.string(),
      platform: z.string(),
    }),
  ),
  features: z.array(
    z.object({
      featureId: z.string(),
      placementPolicies: z
        .array(
          z.object({
            placementType: z.string(),
            groupLimits: z.array(
              z.object({
                groupIds: z.array(z.string()),
                maxCount: z.number().int().nonnegative(),
              }),
            ),
          }),
        )
        .default([]),
    }),
  ),
});
export function parseAppleDeviceCatalog(attributes: unknown): DeviceGroup[] {
  const data = catalog.parse(attributes);
  const policies =
    data.features.find((f) => f.featureId === "APP_STORE_VERSIONS")
      ?.placementPolicies ?? [];
  const limits = new Map<string, number>();
  for (const policy of policies.filter((p) =>
    ["APP_SCREENSHOT", "IMESSAGE_APP_SCREENSHOT"].includes(p.placementType),
  )) {
    for (const { groupIds, maxCount } of policy.groupLimits)
      for (const id of groupIds) limits.set(id, maxCount);
  }
  return data.placementProfileGroups.flatMap((group) => {
    const value = group.placementProfileGroupId;
    const limit = limits.get(value);
    return limit
      ? [
          {
            value,
            limit,
            label: appleGroupLabel(group.displayClassId, group.platform, value),
          },
        ]
      : [];
  });
}
