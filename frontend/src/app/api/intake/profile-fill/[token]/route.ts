import { prisma } from "@/lib/prisma";
import { json, errorResponse } from "@/lib/auth";
import { sendFormCompletionNotification, buildClientUrl } from "@/lib/email";

// Fields the public recipient is allowed to modify. Mirrors the advisor
// PATCH allowlist but excludes admin-only fields (isTemplate, templateName).
const ALLOWED_FIELDS = [
  "tripType",
  "tripTypeOther",
  "destinations",
  "departureAirports",
  "dateFlexibility",
  "earliestDeparture",
  "latestReturn",
  "tripDurationDays",
  "budgetMin",
  "budgetMax",
  "budgetCurrency",
  "budgetNotes",
  "cabinPreference",
  "hotelStyles",
  "loyaltyNotes",
  "accessibilityNeeds",
  "dietaryNeeds",
  "travelPace",
  "layoverTolerance",
  "luxuryPreference",
  "familyFriendly",
  "travelerCount",
  "childrenCount",
  "childrenAges",
  "desiredExperiences",
  "dealbreakers",
  "preferredAirlines",
  "avoidedAirlines",
  "preferredAccommodationBrands",
  "accommodationDealbreakers",
  "notes",
] as const;

function pickIntakeData(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in body) {
      if (
        (key === "earliestDeparture" || key === "latestReturn") &&
        body[key]
      ) {
        data[key] = new Date(body[key] as string);
      } else {
        data[key] = body[key];
      }
    }
  }
  return data;
}

async function loadToken(token: string) {
  return prisma.intakeFormToken.findUnique({
    where: { token },
    include: {
      client: {
        include: { owner: true },
      },
      intake: true,
    },
  });
}

/**
 * GET /api/intake/profile-fill/:token
 *
 * Public endpoint. Returns the current intake snapshot plus the client's
 * display name so the tokenized page can render the form pre-filled with
 * whatever the advisor has already captured.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const record = await loadToken(token);
    if (!record) return errorResponse("Invalid or expired link", 404);
    if (record.formVariant !== "profile_link") {
      return errorResponse("This link is not a profile-fill link", 400);
    }
    if (record.expiresAt < new Date()) return json({ status: "expired" });
    if (record.completedAt) {
      return json({
        status: "completed",
        clientName: record.recipientName,
        intake: record.intake,
      });
    }
    if (!record.openedAt) {
      await prisma.intakeFormToken.update({
        where: { token },
        data: { openedAt: new Date() },
      });
    }
    return json({
      status: "pending",
      clientName: record.recipientName,
      clientFirstName: record.client.firstName,
      advisorName:
        [record.client.owner?.firstName, record.client.owner?.lastName]
          .filter(Boolean)
          .join(" ") || record.client.owner?.email || "your travel advisor",
      intake: record.intake,
    });
  } catch (error) {
    console.error("[profile-fill] GET error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * PATCH /api/intake/profile-fill/:token
 *
 * Public endpoint. Applies form updates to the linked ClientIntake. Used as
 * an autosave path while the recipient is filling out the form — does NOT
 * mark the token as completed. Call POST to finalize.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const record = await loadToken(token);
    if (!record || !record.intakeId) {
      return errorResponse("Invalid link", 404);
    }
    if (record.formVariant !== "profile_link") {
      return errorResponse("This link is not a profile-fill link", 400);
    }
    if (record.completedAt) {
      return errorResponse("Form already submitted", 400);
    }
    if (record.expiresAt < new Date()) {
      return errorResponse("Link expired", 410);
    }

    const body = (await request.json()) as Record<string, unknown>;
    const data = pickIntakeData(body);
    if (Object.keys(data).length === 0) {
      return json({ ok: true, updated: 0 });
    }

    const updated = await prisma.clientIntake.update({
      where: { id: record.intakeId },
      data: data as never,
    });

    return json({ ok: true, intake: updated });
  } catch (error) {
    console.error("[profile-fill] PATCH error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * POST /api/intake/profile-fill/:token
 *
 * Public endpoint. Final submit — applies any remaining updates, marks the
 * intake status=complete, marks the token completedAt, and emails the
 * advisor so they know to review it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const record = await loadToken(token);
    if (!record || !record.intakeId) {
      return errorResponse("Invalid link", 404);
    }
    if (record.formVariant !== "profile_link") {
      return errorResponse("This link is not a profile-fill link", 400);
    }
    if (record.completedAt) {
      return errorResponse("Form already submitted", 400);
    }
    if (record.expiresAt < new Date()) {
      return errorResponse("Link expired", 410);
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const data = pickIntakeData(body);
    data.status = "complete";
    data.completedAt = new Date();

    await prisma.clientIntake.update({
      where: { id: record.intakeId },
      data: data as never,
    });

    await prisma.intakeFormToken.update({
      where: { token },
      data: { completedAt: new Date(), formAnswers: data as never },
    });

    // Notify the advisor
    const advisor = record.client.owner;
    if (advisor?.email) {
      const advisorName =
        `${advisor.firstName ?? ""} ${advisor.lastName ?? ""}`.trim() ||
        advisor.email;
      await sendFormCompletionNotification({
        advisorEmail: advisor.email,
        advisorName,
        clientName: `${record.client.firstName} ${record.client.lastName}`.trim(),
        formTitle: "Travel Profile",
        clientUrl: buildClientUrl(record.clientId),
        formVariant: "profile_link",
      }).catch((e) =>
        console.error("[profile-fill] completion email failed:", e),
      );
    }

    return json({ ok: true });
  } catch (error) {
    console.error("[profile-fill] POST error:", error);
    return errorResponse("Internal server error", 500);
  }
}
