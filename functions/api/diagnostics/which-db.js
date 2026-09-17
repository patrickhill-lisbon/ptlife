export async function onRequestGet(context) {
  const db = context.env.DB;

  const result = await db
    .prepare("SELECT COUNT(*) AS count FROM sources")
    .first();

  return Response.json({
    binding: "DB",
    sources_count: result?.count ?? null
  });
}
