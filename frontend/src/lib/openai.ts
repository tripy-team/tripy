import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

interface MemoInput {
  tripTitle: string;
  origin: string[];
  destination: string[];
  departureDate: string;
  returnDate?: string;
  travelers: { name: string; type: string }[];
  topOption: {
    title: string;
    strategyType: string;
    totalCashCost: number;
    summary: string;
    allocations: {
      travelerName: string;
      paymentType: string;
      programName?: string;
      pointsUsed?: number;
      cashUsed?: number;
    }[];
    insights: { title: string; body: string; severity: string }[];
  };
  alternativeOptions: {
    title: string;
    strategyType: string;
    totalCashCost: number;
    summary: string;
  }[];
  clientPreferences?: {
    preferredCabin: string;
    redemptionStyle: string;
  };
}

export async function generateRecommendationMemo(input: MemoInput) {
  const prompt = `You are a travel advisor writing recommendation memos for luxury travel clients.

Given the following trip analysis data, generate three outputs:

1. **internal_summary**: A concise advisor-facing summary (2-3 paragraphs) explaining the recommendation logic, trade-offs considered, and strategic reasoning. Use industry jargon freely.

2. **client_summary**: A client-friendly summary (2-3 paragraphs) explaining what you recommend and why, written warmly and professionally. Avoid technical loyalty program jargon.

3. **email_draft**: A ready-to-send email draft the advisor can copy-paste to the client. Include a greeting, the recommendation summary, key next steps, and a warm closing.

Trip: ${input.tripTitle}
Route: ${input.origin.join("/")} → ${input.destination.join("/")}
Dates: ${input.departureDate}${input.returnDate ? ` – ${input.returnDate}` : " (one-way)"}
Travelers: ${input.travelers.map((t) => `${t.name} (${t.type})`).join(", ")}
${input.clientPreferences ? `Preferences: ${input.clientPreferences.preferredCabin} cabin, ${input.clientPreferences.redemptionStyle} style` : ""}

Top Recommendation: ${input.topOption.title} (${input.topOption.strategyType})
Cash cost: $${(input.topOption.totalCashCost / 100).toLocaleString()}
Summary: ${input.topOption.summary}

Traveler Allocations:
${input.topOption.allocations
  .map(
    (a) =>
      `- ${a.travelerName}: ${a.paymentType}${a.programName ? ` via ${a.programName}` : ""}${a.pointsUsed ? ` (${a.pointsUsed.toLocaleString()} pts)` : ""}${a.cashUsed ? ` ($${(a.cashUsed / 100).toLocaleString()})` : ""}`,
  )
  .join("\n")}

Key Insights:
${input.topOption.insights.map((i) => `- [${i.severity}] ${i.title}: ${i.body}`).join("\n")}

Alternative Strategies Considered:
${input.alternativeOptions.map((o) => `- ${o.title} (${o.strategyType}): $${(o.totalCashCost / 100).toLocaleString()} — ${o.summary}`).join("\n")}

Return a JSON object with keys: internal_summary, client_summary, email_draft. All values should be strings.`;

  if (!process.env.OPENAI_API_KEY) {
    return {
      internalSummary: generateFallbackInternalSummary(input),
      clientSummary: generateFallbackClientSummary(input),
      emailDraft: generateFallbackEmailDraft(input),
    };
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from OpenAI");
  }

  const parsed = JSON.parse(content);
  return {
    internalSummary: parsed.internal_summary,
    clientSummary: parsed.client_summary,
    emailDraft: parsed.email_draft,
  };
}

function generateFallbackInternalSummary(input: MemoInput): string {
  return `**Recommendation Analysis for ${input.tripTitle}**\n\nThe engine evaluated ${input.alternativeOptions.length + 1} strategies for ${input.origin.join("/")} → ${input.destination.join("/")}. The top recommendation "${input.topOption.title}" was selected based on a ${input.topOption.strategyType} approach with a total cash outlay of $${(input.topOption.totalCashCost / 100).toLocaleString()}.\n\n${input.topOption.insights.map((i) => `• ${i.title}: ${i.body}`).join("\n")}\n\n${input.topOption.summary}`;
}

function generateFallbackClientSummary(input: MemoInput): string {
  return `We've analyzed the best options for your upcoming trip from ${input.origin.join("/")} to ${input.destination.join("/")}.\n\nOur top recommendation is the "${input.topOption.title}" approach. ${input.topOption.summary}\n\nThe estimated cost is $${(input.topOption.totalCashCost / 100).toLocaleString()}.`;
}

function generateFallbackEmailDraft(input: MemoInput): string {
  return `Hi there,\n\nI've completed the analysis for your upcoming ${input.tripTitle} trip and wanted to share our recommendation.\n\n${generateFallbackClientSummary(input)}\n\nLet me know if you'd like to discuss these options or if you have any questions.\n\nBest regards,\nYour Travel Advisor`;
}
