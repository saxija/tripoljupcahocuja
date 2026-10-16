export function normalized(text) {
  return text
    .normalize("NFC")
    .toLocaleLowerCase("sr-Latn")
    .replaceAll("đ", "dj")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export function matchesCity(name, query) {
  const trimmed = query.trim();
  if (!trimmed) return true;
  return normalized(name).includes(normalized(trimmed));
}

export function matchesPlace(place, query) {
  const trimmed = query.trim();
  if (!trimmed) return true;
  const folded = normalized(trimmed);
  if (normalized(place.name).includes(folded) || normalized(place.address).includes(folded)) {
    return true;
  }
  if (![...trimmed].every((character) => character >= "0" && character <= "9")) return false;
  return String(place.number).startsWith(trimmed);
}

export function mapLinkKind(userAgent) {
  const ua = userAgent || "";
  if (/Android/i.test(ua)) return "geo";
  if (/iPad|iPhone|iPod|Macintosh/i.test(ua)) return "apple";
  return "google";
}

function formatCoord(value) {
  return Number(value).toFixed(6);
}

export function validCoordinates(place) {
  const coordinates = place.coordinates;
  if (!coordinates) return null;
  const latitude = Number(coordinates.latitude);
  const longitude = Number(coordinates.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function googleDirectionsUrl(place, coordinates) {
  const destination = coordinates
    ? `${formatCoord(coordinates.latitude)},${formatCoord(coordinates.longitude)}`
    : encodeURIComponent(place.address);
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}

export function directionsUrl(kind, place) {
  const coordinates = validCoordinates(place);
  if (kind === "apple") {
    const daddr = coordinates
      ? `${formatCoord(coordinates.latitude)},${formatCoord(coordinates.longitude)}`
      : encodeURIComponent(place.address);
    return `https://maps.apple.com/?daddr=${daddr}&dirflg=d`;
  }
  if (kind === "geo") {
    const fallback = encodeURIComponent(googleDirectionsUrl(place, coordinates));
    const query = coordinates
      ? `${formatCoord(coordinates.latitude)},${formatCoord(coordinates.longitude)}`
      : encodeURIComponent(place.address);
    return `intent://0,0?q=${query}#Intent;scheme=geo;S.browser_fallback_url=${fallback};end`;
  }
  return googleDirectionsUrl(place, coordinates);
}

export function osmEmbedUrl(coordinates) {
  const latitude = Number(coordinates.latitude);
  const longitude = Number(coordinates.longitude);
  const delta = 0.008;
  const bbox = [longitude - delta, latitude - delta, longitude + delta, latitude + delta]
    .map((value) => value.toFixed(6))
    .join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${formatCoord(latitude)},${formatCoord(longitude)}`;
}

export function placePageUrl(href, cityName, number) {
  const url = new URL(href);
  url.searchParams.set("city", cityName);
  url.searchParams.set("number", String(number));
  url.hash = "";
  return url.toString();
}

if (typeof document !== "undefined") {
  const DATA_URL = new URL("data/polling-places.json", document.baseURI);
  const app = document.querySelector("#app");

  const state = {
    catalog: null,
    error: null,
    cityName: null,
    placeNumber: null,
    query: "",
    toast: "",
    mapOpen: false,
  };

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function countWord(count, one, few, many) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  function findCity(name) {
    const cities = state.catalog?.cities ?? [];
    return (
      cities.find((city) => city.name === name) ||
      cities.find((city) => normalized(city.name) === normalized(name)) ||
      null
    );
  }

  function findPlace(city, number) {
    if (!city || !Number.isInteger(number)) return null;
    return city.places.find((place) => place.number === number) ?? null;
  }

  function readRoute() {
    const params = new URLSearchParams(location.search);
    const city = params.get("city");
    const numberText = params.get("number");
    state.cityName = city || null;
    if (numberText == null || numberText === "") {
      state.placeNumber = null;
      return;
    }
    const number = Number(numberText);
    state.placeNumber = Number.isInteger(number) ? number : null;
  }

  function writeRoute(cityName, placeNumber, replace) {
    const url = new URL(location.href);
    if (cityName) url.searchParams.set("city", cityName);
    else url.searchParams.delete("city");
    if (placeNumber != null) url.searchParams.set("number", String(placeNumber));
    else url.searchParams.delete("number");
    url.hash = "";
    history[replace ? "replaceState" : "pushState"]({ app: true }, "", url);
    state.cityName = cityName;
    state.placeNumber = placeNumber;
    state.query = "";
    state.toast = "";
    state.mapOpen = false;
    render();
  }

  function render() {
    if (!app) return;
    if (state.error) {
      app.innerHTML = frame({
        title: "Biračka mesta",
        body: `<p class="error">${escapeHtml(state.error)}</p>`,
      });
      return;
    }
    if (!state.catalog) {
      app.innerHTML = frame({
        title: "Biračka mesta",
        body: `<p class="count">Učitavanje…</p>`,
      });
      return;
    }

    const city = state.cityName ? findCity(state.cityName) : null;
    if (state.placeNumber != null) {
      renderPlace(city);
      return;
    }
    if (state.cityName) {
      renderPlaces(city);
      return;
    }
    renderCities();
  }

  function frame({ title, back, body, search }) {
    const backButton = back
      ? `<button class="back" type="button" data-back>${escapeHtml(back)}</button>`
      : "";
    const searchBox = search
      ? `<div class="search"><label for="q">${escapeHtml(search.label)}</label><input id="q" type="search" enterkeyhint="search" autocomplete="off" placeholder="${escapeHtml(search.placeholder)}" value="${escapeHtml(state.query)}" /></div>`
      : "";
    return `<header class="masthead">${backButton}<p class="eyebrow">Biračka mesta</p><h1>${escapeHtml(title)}</h1></header>${searchBox}${body}`;
  }

  function renderCities() {
    const cities = state.catalog.cities.filter((city) => matchesCity(city.name, state.query));
    const items = cities
      .map(
        (city) => `<li><button class="row" type="button" data-city="${escapeHtml(city.name)}">
        <span class="row-text"><strong>${escapeHtml(city.name)}</strong><span>${city.places.length} ${countWord(city.places.length, "mesto", "mesta", "mesta")}</span></span>
      </button></li>`,
      )
      .join("");
    const list = cities.length
      ? `<p class="count">${cities.length} ${countWord(cities.length, "grad", "grada", "gradova")}</p><ul class="list">${items}</ul>`
      : `<p class="empty">Nema gradova za ovu pretragu.</p>`;
    app.innerHTML = frame({
      title: "Gradovi",
      search: { label: "Pretraži gradove", placeholder: "Pretraži gradove" },
      body: list,
    });
    bindSearch();
  }

  function renderPlaces(city) {
    if (!city) {
      app.innerHTML = frame({
        title: "Grad nije pronađen",
        back: "Svi gradovi",
        body: `<p class="empty">Taj grad nije u spisku.</p>`,
      });
      return;
    }
    const places = city.places.filter((place) => matchesPlace(place, state.query));
    const items = places
      .map(
        (place) => `<li><button class="row" type="button" data-place="${place.number}">
        <span class="badge">${place.number}</span>
        <span class="row-text"><strong>${escapeHtml(place.name)}</strong><span>${escapeHtml(place.address)}</span></span>
      </button></li>`,
      )
      .join("");
    const list = places.length
      ? `<p class="count">${places.length} ${countWord(places.length, "mesto", "mesta", "mesta")}</p><ul class="list">${items}</ul>`
      : `<p class="empty">Nema biračkih mesta za ovu pretragu.</p>`;
    app.innerHTML = frame({
      title: city.name,
      back: "Svi gradovi",
      search: { label: "Broj, naziv ili adresa", placeholder: "Broj, naziv ili adresa" },
      body: list,
    });
    bindSearch();
  }

  function renderPlace(city) {
    const place = findPlace(city, state.placeNumber);
    if (!city || !place) {
      app.innerHTML = frame({
        title: "Mesto nije pronađeno",
        back: city ? city.name : "Svi gradovi",
        body: `<p class="empty">To biračko mesto nije u spisku.</p>`,
      });
      return;
    }
    const coordinates = validCoordinates(place);
    const mapsHref = escapeHtml(directionsUrl(mapLinkKind(navigator.userAgent), place));
    const mapBlock =
      coordinates && state.mapOpen
        ? `<iframe class="map-frame" title="Mapa, broj ${escapeHtml(place.number)}, ${escapeHtml(place.name)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${escapeHtml(osmEmbedUrl(coordinates))}"></iframe>`
        : coordinates
          ? ""
          : `<p class="note">Nema sačuvanih koordinata. Pin nije prikazan.</p>`;
    const mapAction = coordinates
      ? `<button class="action" type="button" data-map>Prikaži na mapi</button>`
      : `<a class="action" href="${mapsHref}">Prikaži na mapi</a>`;
    app.innerHTML = frame({
      title: "Biračko mesto",
      back: city.name,
      body: `<article class="card">
      <dl class="facts">
        <div><dt>Redni broj</dt><dd>${place.number}</dd></div>
        <div><dt>Naziv</dt><dd>${escapeHtml(place.name)}</dd></div>
        <div><dt>Adresa</dt><dd>${escapeHtml(place.address)}</dd></div>
        <div><dt>Grad</dt><dd>${escapeHtml(city.name)}</dd></div>
      </dl>
      <div class="actions">
        ${mapAction}
        <a class="action primary" href="${mapsHref}">Navigacija</a>
        <button class="action" type="button" data-share>Podeli</button>
      </div>
      <div id="mapa">${mapBlock}</div>
      <p class="toast" role="status">${escapeHtml(state.toast)}</p>
    </article>`,
    });
  }

  function bindSearch() {
    const input = document.querySelector("#q");
    if (!input) return;
    input.addEventListener("input", () => {
      state.query = input.value;
      state.toast = "";
      const selection = input.selectionStart;
      render();
      const next = document.querySelector("#q");
      if (!next) return;
      next.focus();
      if (selection != null) next.setSelectionRange(selection, selection);
    });
  }

  async function shareCurrent() {
    const city = findCity(state.cityName);
    const place = findPlace(city, state.placeNumber);
    if (!city || !place) return;
    const url = placePageUrl(location.href, city.name, place.number);
    const text = `Biračko mesto br. ${place.number}, ${place.name}, ${city.name}: ${place.address}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Biračka mesta", text, url });
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      state.toast = "Link je kopiran.";
    } catch {
      state.toast = url;
    }
    render();
  }

  app.addEventListener("click", (event) => {
    const back = event.target.closest("[data-back]");
    if (back) {
      if (state.placeNumber != null && state.cityName) writeRoute(state.cityName, null, true);
      else writeRoute(null, null, true);
      return;
    }
    const cityButton = event.target.closest("[data-city]");
    if (cityButton) {
      writeRoute(cityButton.dataset.city, null, false);
      return;
    }
    const placeButton = event.target.closest("[data-place]");
    if (placeButton) {
      writeRoute(state.cityName, Number(placeButton.dataset.place), false);
    }
  });

  app.addEventListener("click", (event) => {
    const share = event.target.closest("[data-share]");
    if (share) {
      event.preventDefault();
      shareCurrent();
      return;
    }
    const mapButton = event.target.closest("[data-map]");
    if (!mapButton) return;
    state.mapOpen = true;
    render();
    document.querySelector("#mapa")?.scrollIntoView({ block: "nearest" });
  });

  window.addEventListener("popstate", () => {
    readRoute();
    state.query = "";
    state.toast = "";
    state.mapOpen = false;
    render();
  });

  function isCatalog(data) {
    if (!data || !Array.isArray(data.cities)) return false;
    return data.cities.every(
      (city) =>
        city &&
        typeof city.name === "string" &&
        Array.isArray(city.places) &&
        city.places.every(
          (place) =>
            place &&
            Number.isInteger(place.number) &&
            typeof place.name === "string" &&
            typeof place.address === "string" &&
            (place.coordinates == null ||
              (typeof place.coordinates === "object" &&
                Number.isFinite(Number(place.coordinates.latitude)) &&
                Number.isFinite(Number(place.coordinates.longitude)))),
        ),
    );
  }

  async function load() {
    readRoute();
    render();
    try {
      const response = await fetch(DATA_URL);
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      if (!isCatalog(data)) {
        state.error =
          "Fajl sa biračkim mestima nije ispravan. Očekuje se objekat sa listom gradova. Svaki grad ima ime i mesta, a svako mesto ima broj, naziv, adresu i koordinate ili prazno polje.";
      } else {
        state.catalog = data;
        state.error = null;
      }
    } catch {
      state.error =
        "Spisak biračkih mesta nije učitan. Proveri da fajl data/polling-places.json postoji pored stranice.";
    }
    render();
  }

  load();
}
