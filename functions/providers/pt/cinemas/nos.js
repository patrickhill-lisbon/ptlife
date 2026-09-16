/*
 * PTLife — Cinemas NOS Provider Adapter
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * Provider key:
 *   pt.cinema.nos
 *
 * This module contains NOS-specific knowledge.
 * It does NOT expose an HTTP endpoint.
 */

import {
  fetchProviderJson
} from "../../../lib/provider-fetch.js";


export const provider = {
  key: "pt.cinema.nos",
  country: "PT",
  category: "cinema",
  slug: "nos",
  name: "Cinemas NOS",
  sourceId: 8
};


const NOS_ORIGIN =
  "https://www.cinemas.nos.pt";

const MOVIES_URL =
  NOS_ORIGIN +
  "/graphql/execute.json/cinemas/getMoviesInTheaters";

const SESSIONS_BASE =
  NOS_ORIGIN +
  "/bin/cinemas/render/" +
  "getMovieSessions.getMovieSessionsAggregator.json";


function clean(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const result =
    String(value).trim();

  return result || null;
}


function findMovies(data) {
  const candidates = [
    data?.data?.movieList?.items,
    data?.data?.moviesList?.items,
    data?.data?.movies?.items,
    data?.movieList?.items,
    data?.movies?.items
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "NOS movie catalogue array not found"
  );
}


function getAggregateId(movie) {
  return clean(
    movie?.aggregateformatnumber
  );
}


function firstValue(
  variants,
  field
) {
  for (const movie of variants) {
    const value =
      clean(movie?.[field]);

    if (value) {
      return value;
    }
  }

  return null;
}


function getRuntime(variants) {
  for (const movie of variants) {
    const value =
      Number.parseInt(
        movie?.duration,
        10
      );

    if (
      Number.isFinite(value) &&
      value > 0
    ) {
      return value;
    }
  }

  return null;
}


function getTitle(variants) {
  return (
    firstValue(
      variants,
      "aggregatetitle"
    ) ||
    firstValue(
      variants,
      "title"
    ) ||
    "Untitled NOS film"
  );
}


function absoluteNosUrl(path) {
  if (!path) {
    return NOS_ORIGIN + "/";
  }

  try {
    return new URL(
      path,
      NOS_ORIGIN
    ).toString();
  } catch {
    return NOS_ORIGIN + "/";
  }
}


function buildStartsAt(
  operationalDate,
  time
) {
  const date =
    clean(operationalDate);

  const clock =
    clean(time);

  if (!date || !clock) {
    return null;
  }

  const dateMatch =
    date.match(
      /^(\d{4})-(\d{2})-(\d{2})/
    );

  const timeMatch =
    clock.match(
      /^(\d{1,2}):(\d{2})/
    );

  if (
    !dateMatch ||
    !timeMatch
  ) {
    return null;
  }

  const hh =
    timeMatch[1]
      .padStart(2, "0");

  return (
    `${dateMatch[1]}-` +
    `${dateMatch[2]}-` +
    `${dateMatch[3]}T` +
    `${hh}:` +
    `${timeMatch[2]}:00`
  );
}


/*
 * ---------------------------------------------------------
 * CATALOGUE
 * ---------------------------------------------------------
 */

export async function fetchCatalogue() {
  const fetched =
    await fetchProviderJson(
      MOVIES_URL
    );

  const rows =
    findMovies(
      fetched.data
    );

  return {
    rows,
    fetch: {
      durationMs:
        fetched.durationMs,

      retried:
        fetched.retried,

      attempts:
        fetched.attempts
    }
  };
}


/*
 * Convert NOS catalogue rows into one PTLife candidate
 * per aggregate movie.
 *
 * NOS can expose multiple variants of one movie, such as
 * 2D and IMAX. Those variants share aggregateformatnumber.
 */

export function normalizeCatalogue(
  rows
) {
  const groups =
    new Map();

  const rejected = [];


  for (const row of rows) {
    const aggregateId =
      getAggregateId(row);

    if (!aggregateId) {
      rejected.push({
        reason:
          "missing_aggregate_id",

        title:
          clean(row?.title),

        uuid:
          clean(row?.uuid)
      });

      continue;
    }

    if (!groups.has(aggregateId)) {
      groups.set(
        aggregateId,
        []
      );
    }

    groups
      .get(aggregateId)
      .push(row);
  }


  const movies = [];


  for (
    const [aggregateId, variants]
    of groups
  ) {
    movies.push({
      externalId:
        aggregateId,

      title:
        getTitle(variants),

      originalTitle:
        firstValue(
          variants,
          "originaltitle"
        ),

      runtimeMinutes:
        getRuntime(variants),

      contentRating:
        firstValue(
          variants,
          "classification"
        ),

      originalLanguage:
        "pt-PT",

      sourceUrl:
        absoluteNosUrl(
          variants[0]?.detailurl
        ),

      variants:
        variants.map(
          row => ({
            uuid:
              clean(row?.uuid),

            title:
              clean(row?.title),

            format:
              clean(row?.format),

            version:
              clean(row?.version)
          })
        )
    });
  }


  return {
    movies,
    rejected
  };
}


/*
 * ---------------------------------------------------------
 * SESSIONS
 * ---------------------------------------------------------
 */

export async function fetchSessions(
  aggregateMovieId
) {
  if (!aggregateMovieId) {
    throw new Error(
      "NOS aggregate movie ID is required"
    );
  }

  const url =
    SESSIONS_BASE +
    "?aggregateMovieId=" +
    encodeURIComponent(
      aggregateMovieId
    );

  const fetched =
    await fetchProviderJson(
      url
    );

  return {
    aggregateMovieId,

    data:
      fetched.data,

    fetch: {
      durationMs:
        fetched.durationMs,

      retried:
        fetched.retried,

      attempts:
        fetched.attempts
    }
  };
}


/*
 * Normalize NOS session data without knowing anything
 * about PTLife's database IDs.
 *
 * Theater identity remains the NOS external UUID.
 * The synchronization layer will later translate that
 * into a PTLife place_id.
 */

export function normalizeSessions(
  aggregateMovieId,
  data
) {
  const days =
    Array.isArray(
      data?.days
    )
      ? data.days
      : [];

  const sessions = [];

  const rejected = [];


  for (const day of days) {
    const theaters =
      Array.isArray(
        day?.theaters
      )
        ? day.theaters
        : [];


    for (const theater of theaters) {
      const theaterExternalId =
        clean(
          theater?.theaterId ??
          theater?.theaterID
        );

      const theaterName =
        clean(
          theater?.name
        );

      const theaterSessions =
        Array.isArray(
          theater?.sessions
        )
          ? theater.sessions
          : [];


      for (
        const session
        of theaterSessions
      ) {
        const externalId =
          clean(
            session?.uuid
          );

        if (!externalId) {
          rejected.push({
            reason:
              "missing_session_uuid",

            aggregateMovieId,

            theaterExternalId,

            theaterName
          });

          continue;
        }


        const startsAt =
          buildStartsAt(
            session?.operationalDate,
            session?.time
          );


        if (!startsAt) {
          rejected.push({
            reason:
              "invalid_session_datetime",

            externalId,

            aggregateMovieId,

            theaterExternalId,

            theaterName
          });

          continue;
        }


        sessions.push({
          externalId,

          aggregateMovieId,

          theaterExternalId,

          theaterName,

          startsAt,

          format:
            clean(
              session?.format
            ),

          version:
            clean(
              session?.version
            ),

          type:
            clean(
              session?.type
            ),

          description:
            clean(
              session?.description
            )
        });
      }
    }
  }


  /*
   * A session UUID is our provider-side occurrence
   * identity. Duplicates are therefore a provider
   * integrity problem, not something to silently ignore.
   */

  const seen =
    new Set();

  const duplicates =
    [];


  for (const session of sessions) {
    if (
      seen.has(
        session.externalId
      )
    ) {
      duplicates.push(
        session.externalId
      );
    } else {
      seen.add(
        session.externalId
      );
    }
  }


  if (duplicates.length) {
    throw new Error(
      "NOS returned duplicate session UUIDs: " +
      duplicates
        .slice(0, 10)
        .join(", ")
    );
  }


  return {
    aggregateMovieId,
    days:
      days.length,
    sessions,
    rejected
  };
}
