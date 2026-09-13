export async function onRequestGet(context) {
  const { id } = context.params;
  const db = context.env.DB;

  const program = await db
    .prepare(`
      SELECT
        p.id,
        p.place_id,
        p.program_type,
        p.official_title,
        p.original_language,
        p.status,
        p.source_id,
        pl.slug AS place_slug,
        pl.official_name AS place_name,
        pl.place_type,
        pl.parent_place_id,
        parent.official_name AS parent_place_name
      FROM programs p
      LEFT JOIN places pl
        ON pl.id = p.place_id
      LEFT JOIN places parent
        ON parent.id = pl.parent_place_id
      WHERE p.id = ?
      LIMIT 1
    `)
    .bind(id)
    .first();

  if (!program) {
    return Response.json(
      { error: "Program not found" },
      { status: 404 }
    );
  }

  const translations = await db
    .prepare(`
      SELECT
        language_code,
        display_title,
        short_description,
        full_description,
        translation_status
      FROM program_translations
      WHERE program_id = ?
      ORDER BY language_code
    `)
    .bind(program.id)
    .all();

  const occurrences = await db
    .prepare(`
      SELECT
        id,
        starts_at,
        ends_at,
        timezone,
        status,
        capacity,
        places_remaining
      FROM program_occurrences
      WHERE program_id = ?
      ORDER BY starts_at
    `)
    .bind(program.id)
    .all();

  const ticketRules = await db
    .prepare(`
      SELECT
        id,
        occurrence_id,
        ticket_name_original,
        ticket_name_english,
        price_cents,
        currency,
        pricing_type,
        discount_value,
        valid_from,
        valid_until,
        proof_required,
        notes_original,
        notes_english
      FROM program_ticket_rules
      WHERE program_id = ?
      ORDER BY price_cents, id
    `)
    .bind(program.id)
    .all();

  const discounts = await db
    .prepare(`
      SELECT
        id,
        discount_name_original,
        discount_name_english,
        discount_type,
        discount_value,
        currency,
        minimum_base_price_cents,
        proof_required,
        valid_from,
        valid_until,
        notes_original,
        notes_english
      FROM program_ticket_discounts
      WHERE program_id = ?
      ORDER BY id
    `)
    .bind(program.id)
    .all();

  const discountIds =
    discounts.results.map(discount => discount.id);

  let discountConditions = [];

  if (discountIds.length > 0) {
    const placeholders =
      discountIds.map(() => "?").join(",");

    const conditionResults = await db
      .prepare(`
        SELECT
          id,
          discount_id,
          condition_type,
          operator,
          value_text,
          value_number,
          requirement_group,
          notes_original,
          notes_english
        FROM program_ticket_discount_conditions
        WHERE discount_id IN (${placeholders})
        ORDER BY discount_id, requirement_group, id
      `)
      .bind(...discountIds)
      .all();

    discountConditions =
      conditionResults.results;
  }

  const ticketDiscounts =
    discounts.results.map(discount => ({
      ...discount,
      conditions:
        discountConditions.filter(
          condition =>
            condition.discount_id === discount.id
        )
    }));

  const actions = await db
    .prepare(`
      SELECT
        id,
        occurrence_id,
        action_type,
        action_at,
        timezone,
        action_url,
        status,
        notes_original,
        notes_english
      FROM action_dates
      WHERE program_id = ?
      ORDER BY action_at
    `)
    .bind(program.id)
    .all();

  return Response.json({
    program,
    translations: translations.results,
    occurrences: occurrences.results,
    ticket_rules:
      ticketRules.results.map(ticket => ({
        ...ticket,
        price_eur:
          ticket.price_cents === null
            ? null
            : ticket.price_cents / 100
      })),
    ticket_discounts: ticketDiscounts,
    action_dates: actions.results
  });
}
