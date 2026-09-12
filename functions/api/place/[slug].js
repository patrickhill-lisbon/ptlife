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

  const admissionRules = await db
    .prepare(`
      SELECT
        id,
        rule_name_original,
        rule_name_english,
        price_cents,
        currency,
        pricing_type,
        discount_value,
        valid_from,
        valid_until,
        proof_required,
        proof_description_original,
        proof_description_english,
        priority,
        notes_original,
        notes_english
      FROM admission_rules
      WHERE place_id = ?
      ORDER BY priority, price_cents, id
    `)
    .bind(place.id)
    .all();

  const ruleIds = admissionRules.results.map(rule => rule.id);

  let conditions = [];
  let timeRules = [];

  if (ruleIds.length > 0) {
    const placeholders = ruleIds.map(() => "?").join(",");

    const conditionResults = await db
      .prepare(`
        SELECT
          id,
          admission_rule_id,
          condition_type,
          operator,
          value_text,
          value_number,
          requirement_group,
          notes_original,
          notes_english
        FROM admission_conditions
        WHERE admission_rule_id IN (${placeholders})
        ORDER BY admission_rule_id, requirement_group, id
      `)
      .bind(...ruleIds)
      .all();

    conditions = conditionResults.results;

    const timeRuleResults = await db
      .prepare(`
        SELECT
          id,
          admission_rule_id,
          day_of_week,
          week_of_month,
          starts_at,
          ends_at,
          valid_from,
          valid_until,
          specific_date,
          notes_original,
          notes_english
        FROM admission_time_rules
        WHERE admission_rule_id IN (${placeholders})
        ORDER BY admission_rule_id, id
      `)
      .bind(...ruleIds)
      .all();

    timeRules = timeRuleResults.results;
  }

  const admission = admissionRules.results.map(rule => ({
    ...rule,
    price_eur:
      rule.price_cents === null
        ? null
        : rule.price_cents / 100,
    conditions: conditions.filter(
      condition => condition.admission_rule_id === rule.id
    ),
    time_rules: timeRules.filter(
      timeRule => timeRule.admission_rule_id === rule.id
    )
  }));

  return Response.json({
    place,
    translations: translations.results,
    opening_hours: openingHours.results,
    schedule_exceptions: scheduleExceptions.results,
    admission
  });
}
