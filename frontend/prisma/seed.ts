import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
	AlertType,
	BalanceSource,
	CabinPreference,
	ClientStatus,
	PoolingScope,
	Prisma,
	PrismaClient,
	ProgramCategory,
	RedemptionStyle,
	TravelerType,
	TripStatus,
	UserRole,
} from "../src/generated/prisma";
import bcrypt from "bcryptjs";

function stripSslMode(url: string): string {
	return url.replace(/[?&]sslmode=[^&]*/g, "").replace(/\?&/, "?").replace(/\?$/, "");
}

function createPrismaClient() {
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error("DATABASE_URL is not set. Add it to frontend/.env before seeding.");
	}
	const isAws = url.includes(".rds.amazonaws.com") || url.includes(".cluster-");
	const pool = new Pool({
		connectionString: isAws ? stripSslMode(url) : url,
		...(isAws ? { ssl: { rejectUnauthorized: false } } : {}),
	});
	const adapter = new PrismaPg(pool);
	return {
		prisma: new PrismaClient({ adapter }),
		pool,
	};
}

const { prisma, pool } = createPrismaClient();

const DEMO_ORG_SLUG = "demo-agency";

function addDays(d: Date, days: number): Date {
	const out = new Date(d);
	out.setUTCDate(out.getUTCDate() + days);
	return out;
}

function addMonths(d: Date, months: number): Date {
	const out = new Date(d);
	out.setUTCMonth(out.getUTCMonth() + months);
	return out;
}

type ProgramSeed = {
	code: string;
	name: string;
	category: (typeof ProgramCategory)[keyof typeof ProgramCategory];
	issuer: string | null;
	supportsTransfer: boolean;
	supportsPooling: boolean;
	supportsExpiration: boolean;
	defaultPointValueCents: number;
};

const PROGRAM_SEEDS: ProgramSeed[] = [
	{
		code: "chase_ultimate_rewards",
		name: "Chase Ultimate Rewards",
		category: ProgramCategory.transferable_bank,
		issuer: "Chase",
		supportsTransfer: true,
		supportsPooling: false,
		supportsExpiration: false,
		defaultPointValueCents: 1.7,
	},
	{
		code: "amex_membership_rewards",
		name: "Amex Membership Rewards",
		category: ProgramCategory.transferable_bank,
		issuer: "American Express",
		supportsTransfer: true,
		supportsPooling: false,
		supportsExpiration: false,
		defaultPointValueCents: 1.6,
	},
	{
		code: "capital_one_miles",
		name: "Capital One Miles",
		category: ProgramCategory.transferable_bank,
		issuer: "Capital One",
		supportsTransfer: true,
		supportsPooling: false,
		supportsExpiration: false,
		defaultPointValueCents: 1.5,
	},
	{
		code: "citi_thankyou",
		name: "Citi ThankYou",
		category: ProgramCategory.transferable_bank,
		issuer: "Citi",
		supportsTransfer: true,
		supportsPooling: false,
		supportsExpiration: false,
		defaultPointValueCents: 1.4,
	},
	{
		code: "bilt_rewards",
		name: "Bilt Rewards",
		category: ProgramCategory.transferable_bank,
		issuer: "Bilt",
		supportsTransfer: true,
		supportsPooling: false,
		supportsExpiration: false,
		defaultPointValueCents: 1.5,
	},
	{
		code: "united_mileageplus",
		name: "United MileagePlus",
		category: ProgramCategory.airline,
		issuer: "United Airlines",
		supportsTransfer: false,
		supportsPooling: true,
		supportsExpiration: true,
		defaultPointValueCents: 1.2,
	},
	{
		code: "alaska_mileage_plan",
		name: "Alaska Mileage Plan",
		category: ProgramCategory.airline,
		issuer: "Alaska Airlines",
		supportsTransfer: false,
		supportsPooling: true,
		supportsExpiration: true,
		defaultPointValueCents: 1.5,
	},
	{
		code: "delta_skymiles",
		name: "Delta SkyMiles",
		category: ProgramCategory.airline,
		issuer: "Delta Air Lines",
		supportsTransfer: false,
		supportsPooling: true,
		supportsExpiration: true,
		defaultPointValueCents: 1.1,
	},
	{
		code: "flying_blue",
		name: "Flying Blue",
		category: ProgramCategory.airline,
		issuer: "Air France–KLM",
		supportsTransfer: false,
		supportsPooling: true,
		supportsExpiration: true,
		defaultPointValueCents: 1.3,
	},
	{
		code: "aeroplan",
		name: "Aeroplan",
		category: ProgramCategory.airline,
		issuer: "Air Canada",
		supportsTransfer: false,
		supportsPooling: true,
		supportsExpiration: true,
		defaultPointValueCents: 1.5,
	},
	{
		code: "american_aadvantage",
		name: "American Airlines AAdvantage",
		category: ProgramCategory.airline,
		issuer: "American Airlines",
		supportsTransfer: false,
		supportsPooling: true,
		supportsExpiration: true,
		defaultPointValueCents: 1.3,
	},
	{
		code: "southwest_rapid_rewards",
		name: "Southwest Rapid Rewards",
		category: ProgramCategory.airline,
		issuer: "Southwest Airlines",
		supportsTransfer: false,
		supportsPooling: true,
		supportsExpiration: true,
		defaultPointValueCents: 1.3,
	},
	{
		code: "hyatt_world_of_hyatt",
		name: "World of Hyatt",
		category: ProgramCategory.hotel,
		issuer: "Hyatt",
		supportsTransfer: false,
		supportsPooling: true,
		supportsExpiration: true,
		defaultPointValueCents: 1.9,
	},
	{
		code: "hilton_honors",
		name: "Hilton Honors",
		category: ProgramCategory.hotel,
		issuer: "Hilton",
		supportsTransfer: false,
		supportsPooling: true,
		supportsExpiration: true,
		defaultPointValueCents: 0.5,
	},
	{
		code: "marriott_bonvoy",
		name: "Marriott Bonvoy",
		category: ProgramCategory.hotel,
		issuer: "Marriott",
		supportsTransfer: false,
		supportsPooling: true,
		supportsExpiration: true,
		defaultPointValueCents: 0.7,
	},
	{
		code: "ihg_rewards",
		name: "IHG Rewards",
		category: ProgramCategory.hotel,
		issuer: "IHG",
		supportsTransfer: false,
		supportsPooling: true,
		supportsExpiration: true,
		defaultPointValueCents: 0.5,
	},
];

type TransferSeed = {
	from: string;
	to: string;
	ratioNumerator: number;
	ratioDenominator: number;
};

const TRANSFER_SEEDS: TransferSeed[] = [
	{ from: "chase_ultimate_rewards", to: "united_mileageplus", ratioNumerator: 1, ratioDenominator: 1 },
	{ from: "chase_ultimate_rewards", to: "hyatt_world_of_hyatt", ratioNumerator: 1, ratioDenominator: 1 },
	{ from: "chase_ultimate_rewards", to: "southwest_rapid_rewards", ratioNumerator: 1, ratioDenominator: 1 },
	{ from: "chase_ultimate_rewards", to: "aeroplan", ratioNumerator: 1, ratioDenominator: 1 },
	{ from: "chase_ultimate_rewards", to: "flying_blue", ratioNumerator: 1, ratioDenominator: 1 },
	{ from: "chase_ultimate_rewards", to: "ihg_rewards", ratioNumerator: 1, ratioDenominator: 1 },
	{ from: "chase_ultimate_rewards", to: "marriott_bonvoy", ratioNumerator: 1, ratioDenominator: 1 },
	{ from: "amex_membership_rewards", to: "delta_skymiles", ratioNumerator: 1, ratioDenominator: 1 },
	{ from: "amex_membership_rewards", to: "flying_blue", ratioNumerator: 1, ratioDenominator: 1 },
	{ from: "amex_membership_rewards", to: "aeroplan", ratioNumerator: 1, ratioDenominator: 1 },
	{ from: "amex_membership_rewards", to: "hilton_honors", ratioNumerator: 1, ratioDenominator: 2 },
	{ from: "amex_membership_rewards", to: "marriott_bonvoy", ratioNumerator: 1, ratioDenominator: 1 },
	{ from: "capital_one_miles", to: "united_mileageplus", ratioNumerator: 1, ratioDenominator: 1 },
	{ from: "capital_one_miles", to: "aeroplan", ratioNumerator: 1, ratioDenominator: 1 },
	{ from: "citi_thankyou", to: "american_aadvantage", ratioNumerator: 1, ratioDenominator: 1 },
	{ from: "citi_thankyou", to: "flying_blue", ratioNumerator: 1, ratioDenominator: 1 },
	{ from: "bilt_rewards", to: "hyatt_world_of_hyatt", ratioNumerator: 1, ratioDenominator: 1 },
	{ from: "bilt_rewards", to: "united_mileageplus", ratioNumerator: 1, ratioDenominator: 1 },
	{ from: "bilt_rewards", to: "american_aadvantage", ratioNumerator: 1, ratioDenominator: 1 },
];

type PoolingSeed = { programCode: string; scope: (typeof PoolingScope)[keyof typeof PoolingScope] };

function poolingSeedsFromPrograms(): PoolingSeed[] {
	const rows: PoolingSeed[] = [];
	for (const p of PROGRAM_SEEDS) {
		if (p.category === ProgramCategory.transferable_bank) {
			rows.push({ programCode: p.code, scope: PoolingScope.none });
		} else if (p.category === ProgramCategory.airline) {
			rows.push({ programCode: p.code, scope: PoolingScope.book_for_others });
		} else {
			rows.push({ programCode: p.code, scope: PoolingScope.household_only });
		}
	}
	return rows;
}

const TX_OPTS = { timeout: 30000 };

async function cleanDemoOrganization() {
	await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
		const org = await tx.organization.findUnique({
			where: { slug: DEMO_ORG_SLUG },
		});
		if (!org) return;

		const tripIds = (
			await tx.tripRequest.findMany({
				where: { organizationId: org.id },
				select: { id: true },
			})
		).map((t) => t.id);

		const runIds = (
			await tx.recommendationRun.findMany({
				where: { tripRequestId: { in: tripIds } },
				select: { id: true },
			})
		).map((r) => r.id);

		if (runIds.length > 0) {
			const optionIds = (
				await tx.recommendationOption.findMany({
					where: { recommendationRunId: { in: runIds } },
					select: { id: true },
				})
			).map((o) => o.id);

			if (optionIds.length > 0) {
				await tx.recommendationInsight.deleteMany({
					where: { recommendationOptionId: { in: optionIds } },
				});
				await tx.recommendationTravelerAllocation.deleteMany({
					where: { recommendationOptionId: { in: optionIds } },
				});
				await tx.recommendationOption.deleteMany({
					where: { id: { in: optionIds } },
				});
			}

			await tx.recommendationMemo.deleteMany({
				where: { recommendationRunId: { in: runIds } },
			});
			await tx.recommendationRun.deleteMany({
				where: { id: { in: runIds } },
			});
		}

		const alertIds = (
			await tx.alertSubscription.findMany({
				where: { organizationId: org.id },
				select: { id: true },
			})
		).map((a) => a.id);

		if (alertIds.length > 0) {
			await tx.alertEvent.deleteMany({
				where: { alertSubscriptionId: { in: alertIds } },
			});
		}
		await tx.alertSubscription.deleteMany({
			where: { organizationId: org.id },
		});

		if (tripIds.length > 0) {
			await tx.tripTraveler.deleteMany({
				where: { tripRequestId: { in: tripIds } },
			});
		}
		await tx.tripRequest.deleteMany({
			where: { organizationId: org.id },
		});

		const clientIds = (
			await tx.client.findMany({
				where: { organizationId: org.id },
				select: { id: true },
			})
		).map((c) => c.id);

		if (clientIds.length > 0) {
			const balanceIds = (
				await tx.clientLoyaltyBalance.findMany({
					where: { clientId: { in: clientIds } },
					select: { id: true },
				})
			).map((b) => b.id);

			if (balanceIds.length > 0) {
				await tx.balanceLedgerEntry.deleteMany({
					where: { clientLoyaltyBalanceId: { in: balanceIds } },
				});
				await tx.clientLoyaltyBalance.deleteMany({
					where: { id: { in: balanceIds } },
				});
			}

			await tx.clientPreference.deleteMany({
				where: { clientId: { in: clientIds } },
			});
		}

		const householdIds = (
			await tx.household.findMany({
				where: { organizationId: org.id },
				select: { id: true },
			})
		).map((h) => h.id);

		if (householdIds.length > 0) {
			await tx.householdMember.deleteMany({
				where: { householdId: { in: householdIds } },
			});
		}

		await tx.household.deleteMany({
			where: { organizationId: org.id },
		});

		await tx.client.deleteMany({
			where: { organizationId: org.id },
		});

		await tx.user.deleteMany({
			where: { organizationId: org.id },
		});

		await tx.organization.delete({
			where: { id: org.id },
		});
	}, TX_OPTS);
}

async function refreshReferenceData(programByCode: Map<string, { id: string }>) {
	const programIds = Array.from(programByCode.values()).map((p) => p.id);

	await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
		await tx.programPoolingRule.deleteMany({
			where: { loyaltyProgramId: { in: programIds } },
		});

		for (const row of poolingSeedsFromPrograms()) {
			const prog = programByCode.get(row.programCode);
			if (!prog) continue;
			await tx.programPoolingRule.create({
				data: {
					loyaltyProgramId: prog.id,
					poolingScope: row.scope,
				},
			});
		}

		for (const rule of TRANSFER_SEEDS) {
			const from = programByCode.get(rule.from);
			const to = programByCode.get(rule.to);
			if (!from || !to) continue;

			await tx.programTransferRule.deleteMany({
				where: {
					fromProgramId: from.id,
					toProgramId: to.id,
				},
			});
			await tx.programTransferRule.create({
				data: {
					fromProgramId: from.id,
					toProgramId: to.id,
					ratioNumerator: rule.ratioNumerator,
					ratioDenominator: rule.ratioDenominator,
					isIrreversible: true,
					isActive: true,
				},
			});
		}

		const bonusPairs: { from: string; to: string }[] = [
			{ from: "amex_membership_rewards", to: "aeroplan" },
			{ from: "chase_ultimate_rewards", to: "flying_blue" },
			{ from: "chase_ultimate_rewards", to: "marriott_bonvoy" },
		];

		for (const pair of bonusPairs) {
			const from = programByCode.get(pair.from);
			const to = programByCode.get(pair.to);
			if (!from || !to) continue;
			await tx.transferBonus.deleteMany({
				where: {
					fromProgramId: from.id,
					toProgramId: to.id,
				},
			});
		}

		const now = new Date();

		const amex = programByCode.get("amex_membership_rewards");
		const chase = programByCode.get("chase_ultimate_rewards");
		const aeroplan = programByCode.get("aeroplan");
		const flyingBlue = programByCode.get("flying_blue");
		const marriott = programByCode.get("marriott_bonvoy");

		if (amex && aeroplan) {
			await tx.transferBonus.create({
				data: {
					fromProgramId: amex.id,
					toProgramId: aeroplan.id,
					bonusPercent: 30,
					startsAt: now,
					endsAt: addDays(now, 30),
					isActive: true,
					sourceLabel: "Amex → Aeroplan partner offer",
				},
			});
		}
		if (chase && flyingBlue) {
			await tx.transferBonus.create({
				data: {
					fromProgramId: chase.id,
					toProgramId: flyingBlue.id,
					bonusPercent: 25,
					startsAt: now,
					endsAt: addDays(now, 14),
					isActive: true,
					sourceLabel: "Chase → Flying Blue partner offer",
				},
			});
		}
		if (chase && marriott) {
			await tx.transferBonus.create({
				data: {
					fromProgramId: chase.id,
					toProgramId: marriott.id,
					bonusPercent: 20,
					startsAt: now,
					endsAt: addDays(now, 21),
					isActive: true,
					sourceLabel: "Chase → Marriott Bonvoy partner offer",
				},
			});
		}
	}, TX_OPTS);
}

async function main() {
	await cleanDemoOrganization();

	await prisma.$transaction(
		PROGRAM_SEEDS.map((p) =>
			prisma.loyaltyProgram.upsert({
				where: { code: p.code },
				create: {
					code: p.code,
					name: p.name,
					category: p.category,
					issuer: p.issuer,
					supportsTransfer: p.supportsTransfer,
					supportsPooling: p.supportsPooling,
					supportsExpiration: p.supportsExpiration,
					defaultPointValueCents: p.defaultPointValueCents,
				},
				update: {
					name: p.name,
					category: p.category,
					issuer: p.issuer,
					supportsTransfer: p.supportsTransfer,
					supportsPooling: p.supportsPooling,
					supportsExpiration: p.supportsExpiration,
					defaultPointValueCents: p.defaultPointValueCents,
				},
			}),
		),
	);

	const programs = await prisma.loyaltyProgram.findMany({
		where: { code: { in: PROGRAM_SEEDS.map((p) => p.code) } },
		select: { id: true, code: true },
	});
	const programByCode = new Map<string, { id: string }>(
		programs.map((p) => [p.code, { id: p.id }]),
	);

	await refreshReferenceData(programByCode);

	const passwordHash = await bcrypt.hash("password123", 12);

	const now = new Date();
	const departureDate = addMonths(now, 2);
	const returnDate = addDays(departureDate, 10);

	await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
		const org = await tx.organization.create({
			data: {
				name: "Luxe Travel Advisors",
				slug: DEMO_ORG_SLUG,
				planTier: "pro",
			},
		});

		await tx.user.create({
			data: {
				organizationId: org.id,
				firstName: "Sarah",
				lastName: "Chen",
				email: "sarah@luxetravel.com",
				passwordHash,
				role: UserRole.admin,
			},
		});

		const james = await tx.user.create({
			data: {
				organizationId: org.id,
				firstName: "James",
				lastName: "Wilson",
				email: "james@luxetravel.com",
				passwordHash,
				role: UserRole.advisor,
			},
		});

		await tx.user.create({
			data: {
				organizationId: org.id,
				firstName: "Maya",
				lastName: "Rodriguez",
				email: "maya@luxetravel.com",
				passwordHash,
				role: UserRole.viewer,
			},
		});

		const robert = await tx.client.create({
			data: {
				organizationId: org.id,
				ownerUserId: james.id,
				firstName: "Robert",
				lastName: "Thompson",
				email: "robert.thompson@example.com",
				status: ClientStatus.active,
			},
		});

		const lisa = await tx.client.create({
			data: {
				organizationId: org.id,
				ownerUserId: james.id,
				firstName: "Lisa",
				lastName: "Thompson",
				email: "lisa.thompson@example.com",
				status: ClientStatus.active,
			},
		});

		const david = await tx.client.create({
			data: {
				organizationId: org.id,
				ownerUserId: james.id,
				firstName: "David",
				lastName: "Park",
				email: "david.park@example.com",
				status: ClientStatus.active,
			},
		});

		const emma = await tx.client.create({
			data: {
				organizationId: org.id,
				ownerUserId: james.id,
				firstName: "Emma",
				lastName: "Harris",
				email: "emma.harris@example.com",
				status: ClientStatus.active,
			},
		});

		const michael = await tx.client.create({
			data: {
				organizationId: org.id,
				ownerUserId: james.id,
				firstName: "Michael",
				lastName: "Harris",
				email: "michael.harris@example.com",
				status: ClientStatus.active,
			},
		});

		const thompsonHh = await tx.household.create({
			data: {
				organizationId: org.id,
				name: "Thompson Family",
				notes: "Robert & Lisa — married couple",
			},
		});

		const harrisHh = await tx.household.create({
			data: {
				organizationId: org.id,
				name: "Harris Family",
				notes: "Emma & Michael — family",
			},
		});

		await tx.householdMember.createMany({
			data: [
				{
					householdId: thompsonHh.id,
					clientId: robert.id,
					relationshipLabel: "spouse",
					canRedeemForHousehold: true,
				},
				{
					householdId: thompsonHh.id,
					clientId: lisa.id,
					relationshipLabel: "spouse",
					canRedeemForHousehold: true,
				},
				{
					householdId: harrisHh.id,
					clientId: emma.id,
					relationshipLabel: "spouse",
					canRedeemForHousehold: true,
				},
				{
					householdId: harrisHh.id,
					clientId: michael.id,
					relationshipLabel: "spouse",
					canRedeemForHousehold: true,
				},
			],
		});

		const pid = (code: string) => {
			const p = programByCode.get(code);
			if (!p) throw new Error(`Missing loyalty program: ${code}`);
			return p.id;
		};

		const balances: {
			clientId: string;
			loyaltyProgramId: string;
			balance: number;
			householdId?: string;
		}[] = [
			{ clientId: robert.id, loyaltyProgramId: pid("chase_ultimate_rewards"), balance: 180_000, householdId: thompsonHh.id },
			{ clientId: robert.id, loyaltyProgramId: pid("united_mileageplus"), balance: 45_000, householdId: thompsonHh.id },
			{ clientId: robert.id, loyaltyProgramId: pid("hyatt_world_of_hyatt"), balance: 32_000, householdId: thompsonHh.id },
			{ clientId: robert.id, loyaltyProgramId: pid("marriott_bonvoy"), balance: 85_000, householdId: thompsonHh.id },
			{ clientId: lisa.id, loyaltyProgramId: pid("amex_membership_rewards"), balance: 120_000, householdId: thompsonHh.id },
			{ clientId: lisa.id, loyaltyProgramId: pid("delta_skymiles"), balance: 67_000, householdId: thompsonHh.id },
			{ clientId: lisa.id, loyaltyProgramId: pid("hilton_honors"), balance: 250_000, householdId: thompsonHh.id },
			{ clientId: david.id, loyaltyProgramId: pid("chase_ultimate_rewards"), balance: 350_000 },
			{ clientId: david.id, loyaltyProgramId: pid("amex_membership_rewards"), balance: 220_000 },
			{ clientId: david.id, loyaltyProgramId: pid("alaska_mileage_plan"), balance: 95_000 },
			{ clientId: david.id, loyaltyProgramId: pid("hyatt_world_of_hyatt"), balance: 55_000 },
			{ clientId: emma.id, loyaltyProgramId: pid("capital_one_miles"), balance: 140_000, householdId: harrisHh.id },
			{ clientId: emma.id, loyaltyProgramId: pid("american_aadvantage"), balance: 78_000, householdId: harrisHh.id },
			{ clientId: emma.id, loyaltyProgramId: pid("marriott_bonvoy"), balance: 160_000, householdId: harrisHh.id },
			{ clientId: michael.id, loyaltyProgramId: pid("bilt_rewards"), balance: 85_000, householdId: harrisHh.id },
			{ clientId: michael.id, loyaltyProgramId: pid("united_mileageplus"), balance: 52_000, householdId: harrisHh.id },
		];

		for (const b of balances) {
			await tx.clientLoyaltyBalance.create({
				data: {
					clientId: b.clientId,
					loyaltyProgramId: b.loyaltyProgramId,
					balance: b.balance,
					householdId: b.householdId ?? null,
					source: BalanceSource.manual,
				},
			});
		}

		await tx.clientPreference.create({
			data: {
				clientId: robert.id,
				preferredCabin: CabinPreference.business,
				redemptionStyle: RedemptionStyle.balanced,
				prefersNonstop: true,
			},
		});
		await tx.clientPreference.create({
			data: {
				clientId: lisa.id,
				preferredCabin: CabinPreference.business,
				redemptionStyle: RedemptionStyle.maximize_experience,
				prefersNonstop: false,
			},
		});
		await tx.clientPreference.create({
			data: {
				clientId: david.id,
				preferredCabin: CabinPreference.first,
				redemptionStyle: RedemptionStyle.save_points,
				prefersNonstop: true,
			},
		});
		await tx.clientPreference.create({
			data: {
				clientId: emma.id,
				preferredCabin: CabinPreference.premium_economy,
				redemptionStyle: RedemptionStyle.balanced,
				prefersNonstop: false,
			},
		});
		await tx.clientPreference.create({
			data: {
				clientId: michael.id,
				preferredCabin: CabinPreference.economy,
				redemptionStyle: RedemptionStyle.save_points,
				prefersNonstop: false,
			},
		});

		const trip = await tx.tripRequest.create({
			data: {
				organizationId: org.id,
				ownerUserId: james.id,
				clientId: robert.id,
				householdId: thompsonHh.id,
				title: "Thompson Anniversary Trip",
				originAirports: ["SFO"],
				destinationAirports: ["NRT"],
				departureDate,
				returnDate,
				travelerCount: 2,
				cabinPreference: CabinPreference.business,
				budgetCash: 15_000,
				status: TripStatus.draft,
				notes: "San Francisco to Tokyo (Narita), business class for two.",
			},
		});

		await tx.tripTraveler.createMany({
			data: [
				{
					tripRequestId: trip.id,
					clientId: robert.id,
					travelerType: TravelerType.adult,
				},
				{
					tripRequestId: trip.id,
					clientId: lisa.id,
					travelerType: TravelerType.adult,
				},
			],
		});

		await tx.alertSubscription.create({
			data: {
				organizationId: org.id,
				clientId: robert.id,
				alertType: AlertType.transfer_bonus,
				targetProgramId: pid("chase_ultimate_rewards"),
				isActive: true,
			},
		});

		await tx.alertSubscription.create({
			data: {
				organizationId: org.id,
				clientId: lisa.id,
				alertType: AlertType.expiration,
				targetProgramId: pid("delta_skymiles"),
				isActive: true,
			},
		});
	}, TX_OPTS);

	console.log("Seed completed: loyalty catalog, transfer rules, pooling rules, bonuses, and demo-agency data.");
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
		await pool.end();
	});
