import { getAuthUser, json, errorResponse } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const isUUID = (s?: string | null) =>
  !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    let firstName = user.firstName;
    let lastName = user.lastName;

    // If firstName was stored as a UUID (legacy provisioning bug), derive a
    // readable name from the email and write it back so this only fires once.
    if (isUUID(firstName)) {
      firstName = user.email.split("@")[0];
      lastName = "";
      await prisma.user.update({
        where: { id: user.id },
        data: { firstName, lastName },
      });
    }

    return json({
      id: user.id,
      firstName,
      lastName,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      organization: user.organization,
    });
  } catch (error) {
    console.error("Me error:", error);
    return errorResponse("Internal server error", 500);
  }
}
