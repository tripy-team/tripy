import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id: clientId } = await params;

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const members = await prisma.familyMember.findMany({
      where: { clientId },
      orderBy: { createdAt: "asc" },
      include: {
        linkedClient: {
          include: {
            loyaltyBalances: { include: { loyaltyProgram: true } },
            preferences: true,
          },
        },
      },
    });

    return json(members);
  } catch (error) {
    console.error("List group members error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id: clientId } = await params;

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);
    if (client.clientType !== "individual") {
      return errorResponse("Group members can only be added to individual clients", 400);
    }

    const body = await request.json();
    const { existingClientId, firstName, lastName, relationship, email, phone, dateOfBirth, notes, loyaltyBalances } = body;
    const balancesToCreate: { loyaltyProgramId: string; balance: number }[] = Array.isArray(loyaltyBalances) ? loyaltyBalances : [];

    if (!relationship) {
      return errorResponse("Relationship is required", 400);
    }

    const reciprocalRelationship: Record<string, string> = {
      spouse: "spouse",
      partner: "partner",
      child: "parent",
      parent: "child",
      sibling: "sibling",
      friend: "friend",
      other: "other",
    };

    if (existingClientId) {
      const existingClient = await prisma.client.findFirst({
        where: { id: existingClientId, organizationId: client.organizationId },
      });
      if (!existingClient) return errorResponse("Selected client not found", 404);

      const fullName = `${existingClient.firstName} ${existingClient.lastName}`.trim();
      const parentFullName = `${client.firstName} ${client.lastName}`.trim();

      const [createdMember] = await prisma.$transaction(async (tx) => {
        const member = await tx.familyMember.create({
          data: {
            clientId,
            name: fullName,
            relationship,
            email: existingClient.email || null,
            phone: existingClient.phone || null,
            dateOfBirth: existingClient.dateOfBirth || null,
            notes: notes || null,
          },
        });

        await tx.$executeRawUnsafe(
          `UPDATE family_members SET linked_client_id = $1 WHERE id = $2`,
          existingClient.id,
          member.id,
        );

        const existingReverse = await tx.familyMember.findFirst({
          where: { clientId: existingClient.id, linkedClientId: clientId },
        });

        if (!existingReverse && existingClient.clientType === "individual") {
          const reverseRelationship = reciprocalRelationship[relationship] || "other";
          const reverseMember = await tx.familyMember.create({
            data: {
              clientId: existingClient.id,
              name: parentFullName,
              relationship: reverseRelationship,
              email: client.email || null,
              phone: client.phone || null,
              dateOfBirth: client.dateOfBirth || null,
              notes: null,
            },
          });

          await tx.$executeRawUnsafe(
            `UPDATE family_members SET linked_client_id = $1 WHERE id = $2`,
            clientId,
            reverseMember.id,
          );
        }

        for (const bal of balancesToCreate) {
          if (bal.loyaltyProgramId && typeof bal.balance === "number") {
            const existing = await tx.clientLoyaltyBalance.findFirst({
              where: { clientId: existingClient.id, loyaltyProgramId: bal.loyaltyProgramId },
            });
            if (!existing) {
              await tx.clientLoyaltyBalance.create({
                data: {
                  clientId: existingClient.id,
                  loyaltyProgramId: bal.loyaltyProgramId,
                  balance: bal.balance,
                  source: "manual",
                },
              });
            }
          }
        }

        return [member];
      });

      return json({ ...createdMember, linkedClientId: existingClient.id }, 201);
    }

    if (!firstName || !lastName || !email) {
      return errorResponse("First name, last name, and email are required", 400);
    }

    const fullName = `${firstName} ${lastName}`.trim();
    const parentFullName = `${client.firstName} ${client.lastName}`.trim();

    const [newClient, member] = await prisma.$transaction(async (tx) => {
      const createdClient = await tx.client.create({
        data: {
          organizationId: client.organizationId,
          ownerUserId: client.ownerUserId,
          clientType: "individual",
          firstName,
          lastName,
          email,
          phone: phone || null,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          notes: notes || null,
          status: "active",
        },
      });

      const createdMember = await tx.familyMember.create({
        data: {
          clientId,
          name: fullName,
          relationship,
          email,
          phone: phone || null,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          notes: notes || null,
        },
      });

      await tx.$executeRawUnsafe(
        `UPDATE family_members SET linked_client_id = $1 WHERE id = $2`,
        createdClient.id,
        createdMember.id,
      );

      const reverseRelationship = reciprocalRelationship[relationship] || "other";
      const reverseMember = await tx.familyMember.create({
        data: {
          clientId: createdClient.id,
          name: parentFullName,
          relationship: reverseRelationship,
          email: client.email || null,
          phone: client.phone || null,
          dateOfBirth: client.dateOfBirth || null,
          notes: null,
        },
      });

      await tx.$executeRawUnsafe(
        `UPDATE family_members SET linked_client_id = $1 WHERE id = $2`,
        clientId,
        reverseMember.id,
      );

      for (const bal of balancesToCreate) {
        if (bal.loyaltyProgramId && typeof bal.balance === "number") {
          await tx.clientLoyaltyBalance.create({
            data: {
              clientId: createdClient.id,
              loyaltyProgramId: bal.loyaltyProgramId,
              balance: bal.balance,
              source: "manual",
            },
          });
        }
      }

      return [createdClient, { ...createdMember, linkedClientId: createdClient.id }];
    });

    return json({ ...member, linkedClientId: newClient.id }, 201);
  } catch (error) {
    console.error("Create group member error:", error);
    return errorResponse("Internal server error", 500);
  }
}
