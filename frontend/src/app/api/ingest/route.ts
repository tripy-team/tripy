export async function POST(req: Request) {
  const body = await req.text();
  const upstream = await fetch(`${process.env.BACKEND_URL}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
