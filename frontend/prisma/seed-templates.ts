import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();

const SYSTEM_TEMPLATES = [
  {
    scope: "system" as const,
    title: "Early Check-In Request",
    requestType: "early_check_in" as const,
    defaultBody: `Dear {{vendorName}},

We have a reservation for our client {{clientName}} and would like to request early check-in if available.

Preferred arrival time: before noon if possible.
Trip: {{tripTitle}}

Please confirm availability. Thank you for your assistance.

Best regards`,
    defaultUrgency: "medium" as const,
    defaultReminders: [24, 48],
  },
  {
    scope: "system" as const,
    title: "Late Check-Out Request",
    requestType: "late_check_out" as const,
    defaultBody: `Dear {{vendorName}},

We would like to request a late check-out for our client {{clientName}}.

Preferred departure time: 2:00 PM or later if possible.
Trip: {{tripTitle}}

Please let us know if this can be accommodated and any additional charges. Thank you.

Best regards`,
    defaultUrgency: "medium" as const,
    defaultReminders: [24, 48],
  },
  {
    scope: "system" as const,
    title: "Room Upgrade Request",
    requestType: "room_upgrade" as const,
    defaultBody: `Dear {{vendorName}},

We would like to inquire about the possibility of a room upgrade for our client {{clientName}}.

Current booking details are on file. If a complimentary or paid upgrade is available to a higher room category, suite, or room with a better view, please let us know the options.

Trip: {{tripTitle}}

Thank you for your consideration.

Best regards`,
    defaultUrgency: "medium" as const,
    defaultReminders: [24, 48, 72],
  },
  {
    scope: "system" as const,
    title: "Celebration Amenity",
    requestType: "celebration_request" as const,
    defaultBody: `Dear {{vendorName}},

Our client {{clientName}} will be celebrating a special occasion during their stay.

Could you please arrange a special amenity or acknowledgment? Options such as champagne, a dessert plate, flowers, or a personalized note would be wonderful.

Trip: {{tripTitle}}

Please confirm what can be arranged. Thank you!

Best regards`,
    defaultUrgency: "medium" as const,
    defaultReminders: [48, 72],
  },
  {
    scope: "system" as const,
    title: "Airport Transfer Inquiry",
    requestType: "airport_transfer" as const,
    defaultBody: `Dear {{vendorName}},

We need to arrange airport transfer service for our client {{clientName}}.

Trip: {{tripTitle}}
Travelers: Please see booking for party size.

Could you provide options and pricing for private transfer service? We would prefer a meet-and-greet at the airport.

Thank you for the information.

Best regards`,
    defaultUrgency: "high" as const,
    defaultReminders: [24, 48],
  },
  {
    scope: "system" as const,
    title: "Connecting Rooms Request",
    requestType: "connecting_rooms" as const,
    defaultBody: `Dear {{vendorName}},

Our client {{clientName}} requires connecting or adjacent rooms for their party.

Trip: {{tripTitle}}

Please confirm that connecting rooms can be guaranteed or note as a preference on the reservation.

Thank you for your help.

Best regards`,
    defaultUrgency: "high" as const,
    defaultReminders: [24, 48],
  },
  {
    scope: "system" as const,
    title: "Dietary Accommodation Request",
    requestType: "amenity_request" as const,
    defaultBody: `Dear {{vendorName}},

Our client {{clientName}} has specific dietary requirements that should be noted for their stay.

Trip: {{tripTitle}}

Please ensure the kitchen and dining team are informed. We would appreciate confirmation that accommodations can be made.

Thank you.

Best regards`,
    defaultUrgency: "medium" as const,
    defaultReminders: [48],
  },
];

async function main() {
  console.log("Seeding system templates...");

  for (const template of SYSTEM_TEMPLATES) {
    const existing = await prisma.vendorRequestTemplate.findFirst({
      where: { scope: "system", title: template.title },
    });

    if (!existing) {
      await prisma.vendorRequestTemplate.create({ data: template });
      console.log(`  Created: ${template.title}`);
    } else {
      console.log(`  Skipped (exists): ${template.title}`);
    }
  }

  console.log("Done.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
