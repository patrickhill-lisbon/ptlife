export async function onRequestGet(context) {
  const { slug } = context.params;

  const db = context.env.DB;

  const place = await db
    .prepare(`
      SELECT
        id,
        slug,
        place_type,
        official_name,
        original_language,
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

  const translations = await db
    .prepare(`
      SELECT
        language_code,
        display_name,
        short_description,
        full_description,
        translation_status
      FROM place_translations
      WHERE place_id = ?
      ORDER BY language_code
    `)
    .bind(place.id)
    .all();

  const openingHours = await db
    .prepare(`
      SELECT
        day_of_week,
        opens_at,
        closes_at,
        is_closed,
        valid_from,
        valid_until
      FROM opening_hours
      WHERE place_id = ?
      ORDER BY day_of_week, opens_at
    `)
    .bind(place.id)
    .all();

  const scheduleExceptions = await db
    .prepare(`
      SELECT
        exception_date,
        exception_type,
        opens_at,
        closes_at,
        note_original,
        note_language,
        note_english
      FROM schedule_exceptions
      WHERE place_id = ?
      ORDER BY exception_date
    `)
    .bind(place.id)
    .all();

  return Response.json({
    place,
    translations: translations.results,
    opening_hours: openingHours.results,
    schedule_exceptions: scheduleExceptions.results
  });
}
