import { prisma } from "@/lib/prisma";
import type { RelatedClient } from "@/lib/meeting-copilot-ai";

/**
 * Load all clients related to a given client through family member links
 * and household memberships. Used for cross-client profile extraction.
 */
export async function loadRelatedClients(clientId: string): Promise<RelatedClient[]> {
  const related: RelatedClient[] = [];
  const seenIds = new Set<string>();

  const familyMembers = await prisma.familyMember.findMany({
    where: { clientId, linkedClientId: { not: null } },
    include: { linkedClient: true },
  });

  for (const fm of familyMembers) {
    if (fm.linkedClient && !seenIds.has(fm.linkedClient.id)) {
      seenIds.add(fm.linkedClient.id);
      related.push({
        clientId: fm.linkedClient.id,
        name: `${fm.linkedClient.firstName} ${fm.linkedClient.lastName}`,
        relationship: fm.relationship || "family member",
      });
    }
  }

  const linkedFrom = await prisma.familyMember.findMany({
    where: { linkedClientId: clientId },
    include: { client: true },
  });

  for (const fm of linkedFrom) {
    if (!seenIds.has(fm.client.id)) {
      seenIds.add(fm.client.id);
      related.push({
        clientId: fm.client.id,
        name: `${fm.client.firstName} ${fm.client.lastName}`,
        relationship: fm.relationship ? `${fm.relationship} (reverse)` : "family member",
      });
    }
  }

  const householdMemberships = await prisma.householdMember.findMany({
    where: { clientId },
    select: { householdId: true },
  });

  if (householdMemberships.length > 0) {
    const householdIds = householdMemberships.map((hm) => hm.householdId);
    const householdPeers = await prisma.householdMember.findMany({
      where: {
        householdId: { in: householdIds },
        clientId: { not: clientId },
      },
      include: { client: true, household: true },
    });

    for (const hm of householdPeers) {
      if (!seenIds.has(hm.client.id)) {
        seenIds.add(hm.client.id);
        related.push({
          clientId: hm.client.id,
          name: `${hm.client.firstName} ${hm.client.lastName}`,
          relationship: hm.relationshipLabel || `household member (${hm.household.name})`,
        });
      }
    }
  }

  return related;
}
