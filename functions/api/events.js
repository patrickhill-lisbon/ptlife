export async function onRequestGet(context) {
  const db = context.env.DB;

  const url = new URL(context.request.url);

  const limit = Math.min(
    Number(url.searchParams.get("limit")) || 50,
    100
  );

  const category = (
    url.searchParams.get("category") || ""
  ).trim();

  const tag = (
    url.searchParams.get("tag") || ""
  ).trim();

  const from = (
    url.searchParams.get("from") || ""
  ).trim();

  const to = (
    url.searchParams.get("to") || ""
  ).trim();


  // --------------------------------------------------
  // BUILD FILTERS
  // --------------------------------------------------

  let where = `
    p.status IN ('scheduled', 'active')
    AND po.status = 'scheduled'
  `;

  const bindings = [];


  // If no starting date is supplied, show upcoming events.
  if (from) {
    where += `
      AND po.starts_at >= ?
    `;

    bindings.push(from);
  } else {
    where += `
      AND po.starts_at >= datetime('now', '-1 day')
    `;
  }


  if (to) {
    where += `
      AND po.starts_at <= ?
    `;

    bindings.push(to);
  }


  // --------------------------------------------------
  // CATEGORY FILTER
  // --------------------------------------------------

  if (category) {
    where += `
      AND EXISTS (
        SELECT 1
        FROM program_categories pc
        JOIN categories c
          ON c.id = pc.category_id
        WHERE pc.program_id = p.id
          AND (
            LOWER(c.slug) = LOWER(?)
            OR LOWER(c.name_english) = LOWER(?)
          )
      )
    `;

    bindings.push(
      category,
      category
    );
  }


  // --------------------------------------------------
  // TAG FILTER
  // --------------------------------------------------

  if (tag) {
    where += `
      AND EXISTS (
        SELECT 1
        FROM program_tags pt
        JOIN tags t
          ON t.id = pt.tag_id
        WHERE pt.program_id = p.id
          AND (
            LOWER(t.slug) = LOWER(?)
            OR LOWER(t.name_english) = LOWER(?)
          )
      )
    `;

    bindings.push(
      tag,
      tag
    );
  }


  // --------------------------------------------------
  // UPCOMING EVENT OCCURRENCES
  // --------------------------------------------------

  const sql = `
    SELECT
      po.id AS occurrence_id,
      p.id AS program_id,

      COALESCE(
        tr_en.display_title,
        p.official_title
      ) AS title,

      tr_en.short_description,

      p.program_type,

      po.starts_at,
      po.ends_at,
      po.timezone,
      po.status AS occurrence_status,

      pl.slug AS place_slug,
      pl.official_name AS place_name,
      pl.neighborhood,
      pl.city,

      parent.official_name
        AS parent_place_name,

      (
        SELECT MIN(ptr.price_cents)
        FROM program_ticket_rules ptr
        WHERE ptr.program_id = p.id
          AND (
            ptr.occurrence_id IS NULL
            OR ptr.occurrence_id = po.id
          )
          AND ptr.price_cents IS NOT NULL
      ) AS min_price_cents,

      (
        SELECT MAX(ptr.price_cents)
        FROM program_ticket_rules ptr
        WHERE ptr.program_id = p.id
          AND (
            ptr.occurrence_id IS NULL
            OR ptr.occurrence_id = po.id
          )
          AND ptr.price_cents IS NOT NULL
      ) AS max_price_cents,

      EXISTS (
        SELECT 1
        FROM program_ticket_rules ptr
        WHERE ptr.program_id = p.id
          AND (
            ptr.occurrence_id IS NULL
            OR ptr.occurrence_id = po.id
          )
          AND (
            ptr.pricing_type = 'free'
            OR ptr.price_cents = 0
          )
      ) AS has_free_ticket

    FROM program_occurrences po

    JOIN programs p
      ON p.id = po.program_id

    LEFT JOIN program_translations tr_en
      ON tr_en.program_id = p.id
      AND tr_en.language_code = 'en'

    LEFT JOIN places pl
      ON pl.id = p.place_id

    LEFT JOIN places parent
      ON parent.id = pl.parent_place_id

    WHERE ${where}

    ORDER BY
      po.starts_at,
      title

    LIMIT ?
  `;


  bindings.push(limit);


  // --------------------------------------------------
  // RUN QUERY
  // --------------------------------------------------

  const rows = await db
    .prepare(sql)
    .bind(...bindings)
    .all();


  // --------------------------------------------------
  // FORMAT RESULTS
  // --------------------------------------------------

  const results = rows.results.map(row => ({
    occurrence_id:
      row.occurrence_id,

    program_id:
      row.program_id,

    title:
      row.title,

    description:
      row.short_description,

    program_type:
      row.program_type,

    starts_at:
      row.starts_at,

    ends_at:
      row.ends_at,

    timezone:
      row.timezone,

    status:
      row.occurrence_status,

    venue: {
      slug:
        row.place_slug,

      name:
        row.place_name,

      parent_name:
        row.parent_place_name,

      neighborhood:
        row.neighborhood,

      city:
        row.city
    },

    price: {
      min_eur:
        row.min_price_cents === null
          ? null
          : row.min_price_cents / 100,

      max_eur:
        row.max_price_cents === null
          ? null
          : row.max_price_cents / 100,

      has_free_ticket:
        Boolean(row.has_free_ticket)
    },

    url:
      `/event.html?id=${row.program_id}`
  }));


  // --------------------------------------------------
  // RESPONSE
  // --------------------------------------------------

  return Response.json({
    count:
      results.length,

    filters: {
      from:
        from || null,

      to:
        to || null,

      category:
        category || null,

      tag:
        tag || null
    },

    results
  });
}
