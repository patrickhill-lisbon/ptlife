export async function onRequestGet(context) {
  const db = context.env.DB;

  const url =
    new URL(context.request.url);

  const rawQuery =
    (url.searchParams.get("q") || "")
      .trim();

  if (!rawQuery) {
    return Response.json({
      query: "",
      results: []
    });
  }

  const query =
    rawQuery.toLowerCase();

  const like =
    `%${query}%`;

  // --------------------------------------------------
  // FIND MATCHING TAGS THROUGH TAG NAMES + ALIASES
  // --------------------------------------------------

  const matchingTags = await db
    .prepare(`
      SELECT DISTINCT
        t.id,
        t.slug,
        t.name_english,
        MIN(sa.priority) AS alias_priority
      FROM tags t
      LEFT JOIN search_aliases sa
        ON sa.tag_id = t.id
        AND sa.status = 'active'
      WHERE
        t.status = 'active'
        AND (
          LOWER(t.name_english) LIKE ?
          OR LOWER(t.slug) LIKE ?
          OR LOWER(sa.alias) LIKE ?
        )
      GROUP BY
        t.id,
        t.slug,
        t.name_english
      ORDER BY
        alias_priority,
        t.name_english
    `)
    .bind(
      like,
      like,
      like
    )
    .all();

  const tagIds =
    matchingTags.results.map(
      tag => tag.id
    );

  // --------------------------------------------------
  // PROGRAM RESULTS
  // --------------------------------------------------

  let programTagClause = "";
  let programTagBindings = [];

  if (tagIds.length > 0) {
    const placeholders =
      tagIds.map(() => "?").join(",");

    programTagClause = `
      OR EXISTS (
        SELECT 1
        FROM program_tags pt
        WHERE pt.program_id = p.id
          AND pt.tag_id IN (${placeholders})
      )
    `;

    programTagBindings =
      tagIds;
  }

  const programSql = `
    SELECT DISTINCT
      p.id,
      p.official_title,
      p.program_type,
      p.status,

      COALESCE(
        pt_en.display_title,
        p.official_title
      ) AS display_title,

      pt_en.short_description,

      pl.slug AS place_slug,
      pl.official_name AS place_name,

      parent.official_name
        AS parent_place_name,

      (
        SELECT MIN(po.starts_at)
        FROM program_occurrences po
        WHERE po.program_id = p.id
          AND po.status = 'scheduled'
          AND po.starts_at >= datetime('now', '-1 day')
      ) AS next_occurrence,

      CASE
        WHEN LOWER(p.official_title) LIKE ? THEN 10
        WHEN LOWER(
          COALESCE(
            pt_en.display_title,
            ''
          )
        ) LIKE ? THEN 15

        WHEN EXISTS (
          SELECT 1
          FROM program_credits pc
          WHERE pc.program_id = p.id
            AND LOWER(pc.person_name) LIKE ?
        ) THEN 20

        WHEN LOWER(
          COALESCE(
            pt_en.short_description,
            ''
          )
        ) LIKE ? THEN 30

        ELSE 50
      END AS relevance

    FROM programs p

    LEFT JOIN program_translations pt_en
      ON pt_en.program_id = p.id
      AND pt_en.language_code = 'en'

    LEFT JOIN places pl
      ON pl.id = p.place_id

    LEFT JOIN places parent
      ON parent.id = pl.parent_place_id

    WHERE
      p.status IN (
        'scheduled',
        'active'
      )

      AND (
        LOWER(p.official_title) LIKE ?

        OR LOWER(
          COALESCE(
            pt_en.display_title,
            ''
          )
        ) LIKE ?

        OR LOWER(
          COALESCE(
            pt_en.short_description,
            ''
          )
        ) LIKE ?

        OR LOWER(
          COALESCE(
            pt_en.full_description,
            ''
          )
        ) LIKE ?

        OR EXISTS (
          SELECT 1
          FROM program_credits pc
          WHERE pc.program_id = p.id
            AND (
              LOWER(pc.person_name) LIKE ?
              OR LOWER(
                COALESCE(
                  pc.character_or_role,
                  ''
                )
              ) LIKE ?
            )
        )

        OR EXISTS (
          SELECT 1
          FROM program_categories pcg
          JOIN categories c
            ON c.id = pcg.category_id
          WHERE pcg.program_id = p.id
            AND (
              LOWER(c.name_english) LIKE ?
              OR LOWER(c.slug) LIKE ?
            )
        )

        ${programTagClause}
      )

    ORDER BY
      relevance,
      next_occurrence,
      display_title

    LIMIT 30
  `;

  const programBindings = [
    like,
    like,
    like,
    like,

    like,
    like,
    like,
    like,
    like,
    like,
    like,
    like,

    ...programTagBindings
  ];

  const programs = await db
    .prepare(programSql)
    .bind(
      ...programBindings
    )
    .all();

  // --------------------------------------------------
  // PLACE RESULTS
  // --------------------------------------------------

  let placeTagClause = "";
  let placeTagBindings = [];

  if (tagIds.length > 0) {
    const placeholders =
      tagIds.map(() => "?").join(",");

    placeTagClause = `
      OR EXISTS (
        SELECT 1
        FROM place_tags ptag
        WHERE ptag.place_id = pl.id
          AND ptag.tag_id IN (${placeholders})
      )
    `;

    placeTagBindings =
      tagIds;
  }

  const placeSql = `
    SELECT DISTINCT
      pl.id,
      pl.slug,
      pl.place_type,
      pl.official_name,

      COALESCE(
        tr_en.display_name,
        pl.official_name
      ) AS display_name,

      tr_en.short_description,

      pl.neighborhood,
      pl.city,

      CASE
        WHEN LOWER(pl.official_name) LIKE ? THEN 10

        WHEN LOWER(
          COALESCE(
            tr_en.display_name,
            ''
          )
        ) LIKE ? THEN 15

        WHEN EXISTS (
          SELECT 1
          FROM place_aliases pa
          WHERE pa.place_id = pl.id
            AND LOWER(pa.alias) LIKE ?
        ) THEN 20

        ELSE 40
      END AS relevance

    FROM places pl

    LEFT JOIN place_translations tr_en
      ON tr_en.place_id = pl.id
      AND tr_en.language_code = 'en'

    WHERE
      pl.status = 'active'

      AND (
        LOWER(pl.official_name) LIKE ?

        OR LOWER(
          COALESCE(
            tr_en.display_name,
            ''
          )
        ) LIKE ?

        OR LOWER(
          COALESCE(
            tr_en.short_description,
            ''
          )
        ) LIKE ?

        OR LOWER(
          COALESCE(
            pl.neighborhood,
            ''
          )
        ) LIKE ?

        OR LOWER(
          COALESCE(
            pl.city,
            ''
          )
        ) LIKE ?

        OR EXISTS (
          SELECT 1
          FROM place_aliases pa
          WHERE pa.place_id = pl.id
            AND LOWER(pa.alias) LIKE ?
        )

        OR EXISTS (
          SELECT 1
          FROM place_categories pcg
          JOIN categories c
            ON c.id = pcg.category_id
          WHERE pcg.place_id = pl.id
            AND (
              LOWER(c.name_english) LIKE ?
              OR LOWER(c.slug) LIKE ?
            )
        )

        ${placeTagClause}
      )

    ORDER BY
      relevance,
      display_name

    LIMIT 30
  `;

  const placeBindings = [
    like,
    like,
    like,

    like,
    like,
    like,
    like,
    like,
    like,
    like,
    like,

    ...placeTagBindings
  ];

  const places = await db
    .prepare(placeSql)
    .bind(
      ...placeBindings
    )
    .all();

  // --------------------------------------------------
  // FORMAT RESULTS
  // --------------------------------------------------

  const results = [];

  programs.results.forEach(
    program => {
      results.push({
        result_type: "program",
        id: program.id,
        title:
          program.display_title,
        subtitle:
          program.place_name,
        parent_place_name:
          program.parent_place_name,
        description:
          program.short_description,
        program_type:
          program.program_type,
        next_occurrence:
          program.next_occurrence,
        url:
          `/event.html?id=${program.id}`,
        relevance:
          program.relevance
      });
    }
  );

  places.results.forEach(
    place => {
      results.push({
        result_type: "place",
        id: place.id,
        title:
          place.display_name,
        subtitle:
          [
            place.neighborhood,
            place.city
          ]
            .filter(Boolean)
            .join(", "),
        description:
          place.short_description,
        place_type:
          place.place_type,
        url:
          `/place.html?slug=${encodeURIComponent(
            place.slug
          )}`,
        relevance:
          place.relevance
      });
    }
  );

  results.sort(
    (a, b) => {
      if (
        a.relevance !==
        b.relevance
      ) {
        return (
          a.relevance -
          b.relevance
        );
      }

      return a.title.localeCompare(
        b.title
      );
    }
  );

  return Response.json({
    query: rawQuery,

    matched_tags:
      matchingTags.results,

    results
  });
}
