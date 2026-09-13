// PTLife v2
// Filtering + accessible text-size preferences

document.addEventListener("DOMContentLoaded", () => {

  const root = document.documentElement;

  // -------------------------
  // TEXT SIZE
  // -------------------------

  const savedScale = localStorage.getItem("ptlife-text-scale");

  if (savedScale) {
    root.style.setProperty("--text-scale", savedScale);
  }

  function setTextScale(scale) {
    root.style.setProperty("--text-scale", scale);
    localStorage.setItem("ptlife-text-scale", scale);
  }

  document
    .getElementById("text-smaller")
    ?.addEventListener("click", () => setTextScale("0.9"));

  document
    .getElementById("text-normal")
    ?.addEventListener("click", () => setTextScale("1"));

  document
    .getElementById("text-larger")
    ?.addEventListener("click", () => setTextScale("1.25"));


  // -------------------------
  // TIME FILTERS
  // -------------------------

  const timeButtons =
    document.querySelectorAll(".filter-button");

  const regularEvents =
    document.querySelectorAll("#event-list .event-card");

  const planSection =
    document.getElementById("plan-ahead");

  const eventHeading =
    document.getElementById("event-heading");


  function showTime(time) {

    timeButtons.forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.filter === time
      );
    });


    // PLAN AHEAD
    if (time === "plan") {

      planSection.hidden = false;

      regularEvents.forEach(event => {
        event.hidden = true;
      });

      eventHeading.textContent = "Plan Ahead";

      planSection.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });

      return;
    }


    // ALL EVENTS
    if (time === "all") {

      planSection.hidden = false;

      regularEvents.forEach(event => {
        event.hidden = false;
      });

      eventHeading.textContent = "All Lisbon Events";

      return;
    }


    // NORMAL TIME FILTER
    planSection.hidden = true;

    regularEvents.forEach(event => {

      const eventTime =
        event.dataset.time;

      if (time === "week") {

        event.hidden = ![
          "today",
          "tomorrow",
          "weekend"
        ].includes(eventTime);

      } else {

        event.hidden =
          eventTime !== time;

      }

    });


    const headings = {
      today: "Today in Lisbon",
      tomorrow: "Tomorrow in Lisbon",
      weekend: "This Weekend in Lisbon",
      week: "This Week in Lisbon"
    };

    eventHeading.textContent =
      headings[time] || "Lisbon Events";
  }


  timeButtons.forEach(button => {

    button.addEventListener("click", () => {
      showTime(button.dataset.filter);
    });

  });


  // -------------------------
  // CATEGORY FILTERS
  // -------------------------

  const categoryButtons =
    document.querySelectorAll(
      "[data-category-filter]"
    );

  const allCards =
    document.querySelectorAll(".event-card");


  categoryButtons.forEach(button => {

    button.addEventListener("click", () => {

      const category =
        button.dataset.categoryFilter;

      // Show all relevant sections
      planSection.hidden = false;

      allCards.forEach(card => {

        if (category === "all") {
          card.hidden = false;
        } else {
          card.hidden =
            card.dataset.category !== category;
        }

      });

      timeButtons.forEach(button => {
        button.classList.remove("active");
      });

      eventHeading.textContent =
        category === "all"
          ? "All Lisbon Events"
          : "Events by Interest";

      window.scrollTo({
        top: planSection.offsetTop - 20,
        behavior: "smooth"
      });

    });

  });


  // Start with Today selected
  showTime("today");


  // --------------------------------------------------
  // SEARCH
  // --------------------------------------------------

  const searchInput =
    document.getElementById("site-search");

  const searchResults =
    document.getElementById("search-results");

  let searchTimer = null;


  function formatSearchDate(value) {
    if (!value) {
      return "";
    }

    const date =
      new Date(value);

    return new Intl.DateTimeFormat(
      "en-GB",
      {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone: "Europe/Lisbon"
      }
    ).format(date);
  }


  function clearSearchResults() {
    if (!searchResults) {
      return;
    }

    searchResults.innerHTML = "";
    searchResults.hidden = true;
  }


  function renderSearchResults(data) {
    if (!searchResults) {
      return;
    }

    searchResults.innerHTML = "";

    if (
      !data.results ||
      data.results.length === 0
    ) {
      const empty =
        document.createElement("div");

      empty.className =
        "search-result-empty";

      empty.textContent =
        "No matching events or places found.";

      searchResults.appendChild(empty);
      searchResults.hidden = false;

      return;
    }


    data.results.forEach(result => {

      const link =
        document.createElement("a");

      link.className =
        "search-result";

      link.href =
        result.url;


      const title =
        document.createElement("div");

      title.className =
        "search-result-title";

      title.textContent =
        result.title;


      const meta =
        document.createElement("div");

      meta.className =
        "search-result-meta";


      const metaParts = [];

      if (result.subtitle) {
        metaParts.push(
          result.subtitle
        );
      }

      if (result.next_occurrence) {
        metaParts.push(
          formatSearchDate(
            result.next_occurrence
          )
        );
      }

      meta.textContent =
        metaParts.join(" · ");


      const description =
        document.createElement("div");

      description.className =
        "search-result-description";

      description.textContent =
        result.description || "";


      link.appendChild(title);

      if (meta.textContent) {
        link.appendChild(meta);
      }

      if (description.textContent) {
        link.appendChild(description);
      }

      searchResults.appendChild(link);
    });


    searchResults.hidden = false;
  }


  async function runSearch(query) {
    if (
      !query ||
      query.trim().length < 2
    ) {
      clearSearchResults();
      return;
    }

    try {
      const response =
        await fetch(
          `/api/search?q=${encodeURIComponent(
            query.trim()
          )}`
        );

      if (!response.ok) {
        throw new Error(
          "Search request failed"
        );
      }

      const data =
        await response.json();

      renderSearchResults(data);

    } catch (error) {
      searchResults.innerHTML = "";

      const message =
        document.createElement("div");

      message.className =
        "search-result-empty";

      message.textContent =
        "Search is temporarily unavailable.";

      searchResults.appendChild(message);
      searchResults.hidden = false;
    }
  }


  if (
    searchInput &&
    searchResults
  ) {

    searchInput.addEventListener(
      "input",
      event => {

        clearTimeout(searchTimer);

        const query =
          event.target.value;

        searchTimer =
          setTimeout(
            () => {
              runSearch(query);
            },
            250
          );
      }
    );


    searchInput.addEventListener(
      "keydown",
      event => {

        if (
          event.key === "Escape"
        ) {
          searchInput.value = "";
          clearSearchResults();
        }
      }
    );


    document.addEventListener(
      "click",
      event => {

        if (
          !event.target.closest(
            ".search-area"
          )
        ) {
          clearSearchResults();
        }
      }
    );
  }

});
