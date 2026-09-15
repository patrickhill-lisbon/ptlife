<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1, viewport-fit=cover"
  >

  <title>Event | PTLife</title>

  <link rel="stylesheet" href="/style.css">

  <style>
    .event-page {
      width: min(1100px, calc(100% - 3rem));
      margin: 0 auto;
      padding: 2rem 0 4rem;
    }

    .event-header {
      margin-bottom: 2rem;
    }

    .event-type {
      text-transform: uppercase;
      font-size: 0.8rem;
      font-weight: 800;
      letter-spacing: 0.1em;
      color: #176c46;
      margin-bottom: 0.5rem;
    }

    .event-header h1 {
      margin: 0;
      font-size: clamp(2rem, 5vw, 3.7rem);
      line-height: 1.05;
      letter-spacing: -0.04em;
    }

    .event-location {
      margin-top: 0.75rem;
      font-size: 1.05rem;
      color: #626962;
      font-weight: 650;
    }

    .event-description {
      margin-top: 1rem;
      max-width: 760px;
      font-size: 1.08rem;
      color: #555d57;
    }

    .event-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.55rem;
      margin-top: 1rem;
    }

    .meta-chip {
      padding: 0.35rem 0.65rem;
      border-radius: 999px;
      background: #f2f4f1;
      font-size: 0.9rem;
      font-weight: 700;
      color: #4f5751;
    }

    .event-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1.25rem;
    }

    .event-card {
      min-width: 0;
      background: #fff;
      border: 1px solid #dfe2dc;
      border-radius: 14px;
      padding: 1.3rem;
    }

    .event-card h2 {
      margin: 0 0 1rem;
      font-size: 1.45rem;
    }

    .event-card h3 {
      margin: 1rem 0 0.4rem;
      font-size: 1.05rem;
    }

    .about-text {
      line-height: 1.6;
      color: #4f5751;
      white-space: pre-line;
    }

    .occurrence {
      padding: 0.9rem 0;
      border-bottom: 1px solid #eceeea;
    }

    .occurrence:first-child {
      padding-top: 0;
    }

    .occurrence:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }

    .occurrence-date {
      font-weight: 800;
      font-size: 1.05rem;
    }

    .occurrence-time {
      margin-top: 0.2rem;
      color: #555d57;
    }

    .price-summary {
      font-size: 1.5rem;
      font-weight: 800;
      color: #176c46;
      margin-bottom: 0.8rem;
    }

    .ticket-row,
    .discount-row,
    .credit-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1rem;
      padding: 0.65rem 0;
      border-bottom: 1px solid #eceeea;
    }

    .ticket-row:last-child,
    .discount-row:last-child,
    .credit-row:last-child {
      border-bottom: 0;
    }

    .row-label {
      min-width: 0;
    }

    .row-value {
      flex: 0 0 auto;
      font-weight: 800;
      text-align: right;
    }

    .discount-detail,
    .credit-detail {
      margin-top: 0.25rem;
      color: #626962;
      font-size: 0.92rem;
    }

    .ticket-details {
      margin-top: 1rem;
    }

    .ticket-details summary {
      cursor: pointer;
      font-weight: 800;
      color: #176c46;
    }

    .ticket-details[open] summary {
      margin-bottom: 0.8rem;
    }

    .venue-link {
      display: inline-block;
      margin-top: 0.75rem;
      font-weight: 700;
    }

    .action-box {
      margin-bottom: 1.25rem;
      padding: 1rem;
      background: #fff6d8;
      border-radius: 10px;
    }

    .action-box strong {
      display: block;
      margin-bottom: 0.25rem;
    }

    .info-disclaimer {
      margin-top: 1.25rem;
    }

    .info-disclaimer p:last-child {
      margin-bottom: 0;
    }

    .error-message {
      padding: 3rem 1rem;
      text-align: center;
    }

    @media (max-width: 700px) {
      .event-page {
        width: calc(
          100% -
          max(
            2rem,
            env(safe-area-inset-left) +
            env(safe-area-inset-right)
          )
        );
        padding-top: 1.25rem;
      }

      .event-grid {
        grid-template-columns: 1fr;
      }

      .ticket-row,
      .discount-row,
      .credit-row {
        flex-wrap: wrap;
      }

      .row-value {
        text-align: left;
      }
    }
  </style>
</head>

<body>

  <main class="event-page">

    <div id="loading">
      Loading…
    </div>

    <div id="event-content" hidden>

      <header class="event-header">

        <div
          id="event-type"
          class="event-type"
        ></div>

        <h1 id="event-title"></h1>

        <div
          id="event-location"
          class="event-location"
        ></div>

        <p
          id="event-description"
          class="event-description"
        ></p>

        <div
          id="event-meta"
          class="event-meta"
          hidden
        ></div>

      </header>

      <div
        id="action-dates"
        hidden
      ></div>

      <div class="event-grid">

        <section
          class="event-card"
          id="about-section"
          hidden
        >
          <h2>About</h2>

          <div
            id="about-text"
            class="about-text"
          ></div>

          <div
            id="work-info"
            class="discount-detail"
            style="margin-top: 1rem;"
          ></div>
        </section>

        <section class="event-card">
          <h2>Dates & times</h2>
          <div id="occurrences"></div>
        </section>

        <section class="event-card">
          <h2>Tickets</h2>

          <div
            id="price-summary"
            class="price-summary"
          ></div>

          <div id="ticket-intro"></div>

          <details class="ticket-details">
            <summary>
              Ticket prices
            </summary>

            <div id="ticket-rules"></div>
          </details>
        </section>

        <section
          class="event-card"
          id="discount-section"
          hidden
        >
          <h2>Discounts & concessions</h2>
          <div id="discounts"></div>
        </section>

        <section
          class="event-card"
          id="credits-section"
          hidden
        >
          <h2>Credits</h2>
          <div id="credits"></div>
        </section>

        <section class="event-card">
          <h2>Venue</h2>

          <div id="venue-name"></div>

          <div
            id="parent-venue"
            class="discount-detail"
          ></div>

          <a
            id="venue-link"
            class="venue-link"
          >
            View venue information
          </a>
        </section>

      </div>

      <section class="event-card info-disclaimer">
        <h2>Information & sources</h2>

        <p>
          PTLife compiles information from official and other primary and
          secondary sources. While we aim to provide accurate and useful
          information, details may change without notice and may contain
          errors or omissions.
        </p>

        <p>
          PTLife does not guarantee the accuracy, completeness, or current
          validity of the information presented. Please verify important
          details, including event dates, times, ticket prices, discounts,
          eligibility requirements and availability, with the venue or
          organizer before making plans.
        </p>
      </section>

    </div>

    <div
      id="error"
      class="error-message"
      hidden
    >
      We couldn't find this event.
    </div>

  </main>

<script>

const params =
  new URLSearchParams(window.location.search);

const programId =
  params.get("id") || "1";


function euro(
  value,
  currency = "EUR"
) {
  return new Intl.NumberFormat(
    "en-IE",
    {
      style: "currency",
      currency
    }
  ).format(value);
}


function parseLocalDateTime(value) {

  if (!value) {
    return null;
  }

  const [
    datePart,
    timePart
  ] = value.split("T");

  const [
    year,
    month,
    day
  ] = datePart
    .split("-")
    .map(Number);

  const [
    hour,
    minute
  ] = timePart
    .split(":")
    .map(Number);

  return {
    year,
    month,
    day,
    hour,
    minute
  };
}


function formatEventDate(value) {

  const parts =
    parseLocalDateTime(value);

  if (!parts) {
    return "";
  }

  const date =
    new Date(
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day
      )
    );

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    }
  ).format(date);
}


function formatTime(value) {

  const parts =
    parseLocalDateTime(value);

  if (!parts) {
    return "";
  }

  return (
    String(parts.hour)
      .padStart(2, "0") +
    ":" +
    String(parts.minute)
      .padStart(2, "0")
  );
}


function humanizeCreditType(type) {

  const labels = {
    choreographer: "Choreography",
    director: "Director",
    performer: "Performer",
    actor: "Cast",
    playwright: "Playwright",
    composer: "Composer",
    conductor: "Conductor",
    orchestra: "Orchestra",
    musician: "Musician",
    dramaturgy: "Dramaturgy",
    lighting_design: "Lighting",
    costume_design: "Costumes",
    artistic_assistance: "Artistic assistance",
    speaker: "Speaker",
    curator: "Curator"
  };

  return (
    labels[type] ||
    type
      .replaceAll("_", " ")
      .replace(
        /\b\w/g,
        letter =>
          letter.toUpperCase()
      )
  );
}


function addMetaChip(text) {

  if (!text) {
    return;
  }

  const container =
    document.getElementById(
      "event-meta"
    );

  const chip =
    document.createElement(
      "span"
    );

  chip.className =
    "meta-chip";

  chip.textContent =
    text;

  container.appendChild(
    chip
  );

  container.hidden =
    false;
}


function renderDetails(
  data,
  english
) {

  const details =
    data.details;

  const fullDescription =
    english?.full_description;


  if (
    fullDescription ||
    details
  ) {

    const section =
      document.getElementById(
        "about-section"
      );

    section.hidden =
      false;


    if (
      fullDescription
    ) {

      document
        .getElementById(
          "about-text"
        )
        .textContent =
          fullDescription;
    }


    if (
      details
    ) {

      const workPieces =
        [];


      if (
        details.original_work_title &&
        details.original_work_title !==
          data.program.official_title
      ) {

        workPieces.push(
          `Original work: ${details.original_work_title}`
        );
      }


      if (
        details.original_year
      ) {

        workPieces.push(
          String(
            details.original_year
          )
        );
      }


      if (
        details.country_code
      ) {

        workPieces.push(
          details.country_code
        );
      }


      document
        .getElementById(
          "work-info"
        )
        .textContent =
          workPieces.join(
            " · "
          );


      if (
        details.runtime_minutes
      ) {

        addMetaChip(
          `${details.runtime_minutes} min`
        );
      }


      if (
        details.presentation_language
      ) {

        addMetaChip(
          details.presentation_language
        );
      }

      else if (
        details.original_language
      ) {

        addMetaChip(
          details.original_language
        );
      }


      if (
        details.subtitle_language
      ) {

        addMetaChip(
          `${details.subtitle_language} subtitles`
        );
      }


      if (
        details.surtitles_language
      ) {

        addMetaChip(
          `${details.surtitles_language} surtitles`
        );
      }


      if (
        details.content_rating
      ) {

        addMetaChip(
          details.content_rating
        );
      }


      if (
        details.notes_english
      ) {

        const lower =
          details.notes_english
            .toLowerCase();

        if (
          lower.includes(
            "ages 6+"
          )
        ) {

          addMetaChip(
            "Ages 6+"
          );
        }
      }

    }
  }
}


function renderCredits(data) {

  if (
    !Array.isArray(
      data.credits
    ) ||
    data.credits.length === 0
  ) {
    return;
  }


  const section =
    document.getElementById(
      "credits-section"
    );

  const container =
    document.getElementById(
      "credits"
    );

  section.hidden =
    false;


  data.credits.forEach(
    credit => {

      const row =
        document.createElement(
          "div"
        );

      row.className =
        "credit-row";


      const labelArea =
        document.createElement(
          "div"
        );

      labelArea.className =
        "row-label";


      const type =
        document.createElement(
          "div"
        );

      type.textContent =
        humanizeCreditType(
          credit.credit_type
        );


      if (
        credit.character_or_role
      ) {

        const detail =
          document.createElement(
            "div"
          );

        detail.className =
          "credit-detail";

        detail.textContent =
          credit.character_or_role;

        labelArea.append(
          type,
          detail
        );

      } else {

        labelArea.appendChild(
          type
        );
      }


      const person =
        document.createElement(
          "div"
        );

      person.className =
        "row-value";

      person.textContent =
        credit.person_name;


      row.append(
        labelArea,
        person
      );

      container.appendChild(
        row
      );
    }
  );
}


function renderOccurrences(data) {

  const container =
    document.getElementById(
      "occurrences"
    );

  data.occurrences.forEach(
    occurrence => {

      const item =
        document.createElement(
          "div"
        );

      item.className =
        "occurrence";


      const date =
        document.createElement(
          "div"
        );

      date.className =
        "occurrence-date";

      date.textContent =
        formatEventDate(
          occurrence.starts_at
        );


      const time =
        document.createElement(
          "div"
        );

      time.className =
        "occurrence-time";

      const start =
        formatTime(
          occurrence.starts_at
        );

      const end =
        formatTime(
          occurrence.ends_at
        );

      time.textContent =
        end
          ? `${start}–${end}`
          : start;


      item.append(
        date,
        time
      );


      if (
        occurrence.status &&
        occurrence.status !==
          "scheduled"
      ) {

        const status =
          document.createElement(
            "div"
          );

        status.className =
          "discount-detail";

        status.textContent =
          occurrence.status;

        item.appendChild(
          status
        );
      }


      container.appendChild(
        item
      );
    }
  );
}


function renderTickets(data) {

  const summary =
    document.getElementById(
      "price-summary"
    );

  const intro =
    document.getElementById(
      "ticket-intro"
    );

  const container =
    document.getElementById(
      "ticket-rules"
    );


  const fixedPrices =
    data.ticket_rules
      .filter(
        ticket =>
          ticket.pricing_type ===
            "fixed" &&
          ticket.price_eur != null
      )
      .map(
        ticket =>
          Number(
            ticket.price_eur
          )
      );


  if (
    fixedPrices.length
  ) {

    const minimum =
      Math.min(
        ...fixedPrices
      );

    const maximum =
      Math.max(
        ...fixedPrices
      );


    if (
      minimum === maximum
    ) {

      summary.textContent =
        euro(minimum);

    } else {

      summary.textContent =
        `${euro(minimum)}–${euro(maximum)}`;
    }


    intro.textContent =
      "Ticket price depends on seating area.";

  } else {

    summary.textContent =
      "See ticket details";
  }


  data.ticket_rules.forEach(
    ticket => {

      const row =
        document.createElement(
          "div"
        );

      row.className =
        "ticket-row";


      const labelArea =
        document.createElement(
          "div"
        );

      labelArea.className =
        "row-label";


      const label =
        document.createElement(
          "div"
        );

      label.textContent =
        ticket
          .ticket_name_english;


      labelArea.appendChild(
        label
      );


      if (
        ticket.notes_english
      ) {

        const note =
          document.createElement(
            "div"
          );

        note.className =
          "discount-detail";

        note.textContent =
          ticket.notes_english;

        labelArea.appendChild(
          note
        );
      }


      const value =
        document.createElement(
          "div"
        );

      value.className =
        "row-value";


      if (
        ticket.pricing_type ===
          "free" ||
        ticket.price_eur === 0
      ) {

        value.textContent =
          "Free";

      }

      else if (
        ticket.price_eur != null
      ) {

        value.textContent =
          euro(
            ticket.price_eur,
            ticket.currency ||
              "EUR"
          );

      }

      else {

        value.textContent =
          "See details";
      }


      row.append(
        labelArea,
        value
      );

      container.appendChild(
        row
      );
    }
  );
}


function discountValueText(
  discount
) {

  if (
    discount.discount_type ===
      "percentage"
  ) {

    return `${discount.discount_value}% off`;
  }


  if (
    discount.discount_type ===
      "fixed_price"
  ) {

    if (
      Number(
        discount.discount_value
      ) === 0
    ) {

      return "Free";
    }

    return euro(
      Number(
        discount.discount_value
      ) / 100,
      discount.currency ||
        "EUR"
    );
  }


  if (
    discount.discount_type ===
      "amount_off"
  ) {

    return `${euro(
      Number(
        discount.discount_value
      ) / 100,
      discount.currency ||
        "EUR"
    )} off`;
  }


  return "See details";
}


function renderDiscounts(data) {

  if (
    !Array.isArray(
      data.ticket_discounts
    ) ||
    data.ticket_discounts.length ===
      0
  ) {
    return;
  }


  const section =
    document.getElementById(
      "discount-section"
    );

  const container =
    document.getElementById(
      "discounts"
    );

  section.hidden =
    false;


  data.ticket_discounts.forEach(
    discount => {

      const row =
        document.createElement(
          "div"
        );

      row.className =
        "discount-row";


      const labelArea =
        document.createElement(
          "div"
        );

      labelArea.className =
        "row-label";


      const label =
        document.createElement(
          "div"
        );

      label.textContent =
        discount
          .discount_name_english;

      labelArea.appendChild(
        label
      );


      if (
        discount.notes_english
      ) {

        const note =
          document.createElement(
            "div"
          );

        note.className =
          "discount-detail";

        note.textContent =
          discount.notes_english;

        labelArea.appendChild(
          note
        );
      }


      if (
        discount.proof_required
      ) {

        const proof =
          document.createElement(
            "div"
          );

        proof.className =
          "discount-detail";

        proof.textContent =
          "Proof of eligibility may be required.";

        labelArea.appendChild(
          proof
        );
      }


      const value =
        document.createElement(
          "div"
        );

      value.className =
        "row-value";

      value.textContent =
        discountValueText(
          discount
        );


      row.append(
        labelArea,
        value
      );

      container.appendChild(
        row
      );
    }
  );
}


function renderActions(data) {

  if (
    !Array.isArray(
      data.action_dates
    ) ||
    data.action_dates.length ===
      0
  ) {
    return;
  }


  const container =
    document.getElementById(
      "action-dates"
    );

  container.hidden =
    false;


  data.action_dates.forEach(
    action => {

      const box =
        document.createElement(
          "div"
        );

      box.className =
        "action-box";


      const title =
        document.createElement(
          "strong"
        );

      title.textContent =
        action.action_type
          .replaceAll(
            "_",
            " "
          );


      const date =
        document.createElement(
          "div"
        );

      date.textContent =
        `${formatEventDate(
          action.action_at
        )} · ${formatTime(
          action.action_at
        )}`;


      box.append(
        title,
        date
      );


      if (
        action.action_url
      ) {

        const link =
          document.createElement(
            "a"
          );

        link.href =
          action.action_url;

        link.target =
          "_blank";

        link.rel =
          "noopener noreferrer";

        link.textContent =
          "More information";

        box.appendChild(
          link
        );
      }


      container.appendChild(
        box
      );
    }
  );
}


async function loadEvent() {

  try {

    const response =
      await fetch(
        `/api/program/${encodeURIComponent(programId)}`
      );


    if (
      !response.ok
    ) {

      throw new Error(
        "Event not found"
      );
    }


    const data =
      await response.json();


    const english =
      data.translations.find(
        translation =>
          translation.language_code ===
          "en"
      ) ||
      data.translations[0];


    const title =
      english?.display_title ||
      data.program.official_title;


    document.title =
      `${title} | PTLife`;


    document
      .getElementById(
        "event-type"
      )
      .textContent =
        data.program.program_type;


    document
      .getElementById(
        "event-title"
      )
      .textContent =
        title;


    document
      .getElementById(
        "event-description"
      )
      .textContent =
        english?.short_description ||
        "";


    const locationPieces = [
      data.program.place_name
    ];


    if (
      data.program
        .parent_place_name
    ) {

      locationPieces.push(
        data.program
          .parent_place_name
      );
    }


    document
      .getElementById(
        "event-location"
      )
      .textContent =
        locationPieces.join(
          " · "
        );


    renderDetails(
      data,
      english
    );

    renderOccurrences(
      data
    );

    renderTickets(
      data
    );

    renderDiscounts(
      data
    );

    renderCredits(
      data
    );

    renderActions(
      data
    );


    document
      .getElementById(
        "venue-name"
      )
      .textContent =
        data.program.place_name ||
        "Venue";


    const parent =
      document.getElementById(
        "parent-venue"
      );


    if (
      data.program
        .parent_place_name
    ) {

      parent.textContent =
        `Part of ${
          data.program
            .parent_place_name
        }`;
    }


    const venueLink =
      document.getElementById(
        "venue-link"
      );


    if (
      data.program.place_slug
    ) {

      venueLink.href =
        `/place.html?slug=${encodeURIComponent(
          data.program.place_slug
        )}`;

    } else {

      venueLink.hidden =
        true;
    }


    document
      .getElementById(
        "loading"
      )
      .hidden =
        true;


    document
      .getElementById(
        "event-content"
      )
      .hidden =
        false;


  } catch (error) {

    document
      .getElementById(
        "loading"
      )
      .hidden =
        true;


    document
      .getElementById(
        "error"
      )
      .hidden =
        false;
  }
}


loadEvent();

</script>

</body>
</html>
