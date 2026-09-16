/*
 * PTLife / WorthAGo — Cinemas NOS Provider Adapter
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


/*
 * NOS groups after-midnight screenings with the preceding
 * cinema operational day.
 *
 * Example:
 *
 *   operationalDate = 2026-09-16
 *   time            = 00:10
 *
 * represents the real calendar datetime:
 *
 *   2026-09-17T00:10:00
 *
 * We currently use 04:00 as the operational-day boundary
 * for NOS. The original operationalDate is also preserved
 * in normalized session data so the presentation layer can
 * later group the screening with the evening NOS assigned it
 * to while displaying the true calendar date when useful.
 */

const NOS_OPERATIONAL_DAY_CUTOFF_HOUR =
  4;


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


/*
 * =========================================================
 * NOS OPERATIONAL-DATE RULE
 * =========================================================
 *
 * operationalDate is the cinema schedule/business date.
 *
 * startsAt must instead represent the real calendar
 * datetime at which the screening occurs.
 *
 * Sessions between:
 *
 *   00:00 and 03:59
 *
 * are therefore moved to the following calendar date.
 *
 * IMPORTANT:
 *
 * We deliberately do this without constructing a JavaScript
 * Date from a local Lisbon datetime. That avoids accidental
 * UTC/browser/runtime timezone conversion.
 */

function nextCalendarDate(
  year,
  month,
  day
) {
  /*
   * Date.UTC is used only for calendar arithmetic.
   *
   * We extract the UTC date components afterward and return
   * a date string without interpreting the eventual session
   * datetime as UTC.
   */

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day + 1
      )
    );


  const yyyy =
    date
      .getUTCFullYear()
      .toString()
      .padStart(4, "0");

  const mm =
    (
      date.getUTCMonth() + 1
    )
      .toString()
      .padStart(2, "0");

  const dd =
    date
      .getUTCDate()
      .toString()
      .padStart(2, "0");


  return `${yyyy}-${mm}-${dd}`;
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


  const year =
    Number(dateMatch[1]);

  const month =
    Number(dateMatch[2]);

  const day =
    Number(dateMatch[3]);

  const hour =
    Number(timeMatch[1]);

  const minute =
    Number(timeMatch[2]);


  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }


  let calendarDate =
    `${dateMatch[1]}-` +
    `${dateMatch[2]}-` +
    `${dateMatch[3]}`;


  /*
   * NOS OPERATIONAL-DATE RULE
   *
   * A 00:10 session appearing under September 16 is really
   * September 17 at 00:10.
   */

  if (
    hour <
    NOS_OPERATIONAL_DAY_CUTOFF_HOUR
  ) {
    calendarDate =
      nextCalendarDate(
        year,
        month,
        day
      );
  }


  const hh =
    String(hour)
      .padStart(2, "0");

  const min =
    String(minute)
      .padStart(2, "0");


  return (
    `${calendarDate}T` +
    `${hh}:${min}:00`
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
 * Convert NOS catalogue rows into one PTLife/WorthAGo
 * candidate per aggregate movie.
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
 * about WorthAGo's database IDs.
 *
 * Theater identity remains the NOS external UUID.
 *
 * operationalDate remains the provider's cinema/business
 * date.
 *
 * startsAt is the actual calendar datetime.
 *
 * The synchronization layer later translates theater
 * identity into a WorthAGo place_id.
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


        /*
         * Preserve NOS's original operational date.
         */

        const operationalDate =
          clean(
            session?.operationalDate
          );


        const sessionTime =
          clean(
            session?.time
          );


        const startsAt =
          buildStartsAt(
            operationalDate,
            sessionTime
          );


        if (!startsAt) {
          rejected.push({
            reason:
              "invalid_session_datetime",

            externalId,

            aggregateMovieId,

            theaterExternalId,

            theaterName,

            operationalDate,

            time:
              sessionTime
          });

          continue;
        }


        sessions.push({
          externalId,

          aggregateMovieId,

          theaterExternalId,

          theaterName,

          /*
           * Provider's schedule/business date.
           */

          operationalDate,

          /*
           * Provider's displayed local clock time.
           */

          time:
            sessionTime,

          /*
           * Actual local calendar datetime.
           */

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
