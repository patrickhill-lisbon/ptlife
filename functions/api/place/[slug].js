export async function onRequestGet(context) {
  const { slug } = context.params;

  const place = await context.env.DB
    .prepare(`
      SELECT
        id,
        slug,
        place_type,
        official_name,
        neighborhood,
        city,
        country_code,
        address,
        postal_code,
        official_website,
        status
      FROM places
      WHERE slug = ?
      LIMIT 1
    `)
    .bind(slug)
    .first();

  if (!place) {
    return Response.json(
      { error: "Place not found" },
      { status: 404 }
    );
  }

  return Response.json(place);
}
