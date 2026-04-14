import { json } from "@/lib/auth";

export async function POST() {
  return json({ error: "Password-based login is no longer supported. Please use Cognito authentication." }, 410);
}
