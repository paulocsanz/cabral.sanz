const COPY = {
  pt: {
    description: "Paulo Cabral Sanz — engenheiro na Railway.",
    ogDescription: "Engenheiro na Railway.",
    locale: "pt_BR",
    htmlLang: "pt-BR",
    langsLabel: "Idioma",
  },
  en: {
    description: "Paulo Cabral Sanz — engineer at Railway.",
    ogDescription: "Engineer at Railway.",
    locale: "en",
    htmlLang: "en",
    langsLabel: "Language",
  },
};

const LUSOPHONE = new Set([
  "BR",
  "PT",
  "AO",
  "MZ",
  "CV",
  "GW",
  "ST",
  "TL",
  "GQ",
]);

function currentLang() {
  return document.documentElement.lang.toLowerCase().startsWith("en")
    ? "en"
    : "pt";
}

function setLang(lang, persist) {
  const next = lang === "en" ? "en" : "pt";
  const meta = COPY[next];
  document.documentElement.lang = meta.htmlLang;

  const description = document.querySelector('meta[name="description"]');
  const ogDescription = document.querySelector(
    'meta[property="og:description"]',
  );
  const ogLocale = document.querySelector('meta[property="og:locale"]');
  const twitterDescription = document.querySelector(
    'meta[name="twitter:description"]',
  );
  if (description) description.setAttribute("content", meta.description);
  if (ogDescription) ogDescription.setAttribute("content", meta.ogDescription);
  if (ogLocale) ogLocale.setAttribute("content", meta.locale);
  if (twitterDescription) {
    twitterDescription.setAttribute("content", meta.ogDescription);
  }

  document.querySelectorAll("[data-lang]").forEach((button) => {
    const on = button.getAttribute("data-lang") === next;
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });

  const group = document.querySelector(".langs");
  if (group) group.setAttribute("aria-label", meta.langsLabel);

  if (persist) {
    try {
      localStorage.setItem("lang", next);
    } catch (error) {}
  }
}

function browserLang() {
  const languages =
    navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language];
  for (const language of languages) {
    const code = String(language || "").toLowerCase();
    if (code.startsWith("pt")) return "pt";
    if (code.startsWith("en")) return "en";
  }
  return null;
}

function savedLang() {
  try {
    const saved = localStorage.getItem("lang");
    return saved === "en" || saved === "pt" ? saved : null;
  } catch (error) {
    return null;
  }
}

async function detectFromIp() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch("https://get.geojs.io/v1/ip/country.json", {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    const country = String(data.country || "").toUpperCase();
    if (!country) return null;
    return LUSOPHONE.has(country) ? "pt" : "en";
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function init() {
  document.querySelectorAll("[data-lang]").forEach((button) => {
    button.addEventListener("click", () => {
      setLang(button.getAttribute("data-lang"), true);
    });
  });

  setLang(currentLang(), false);

  if (savedLang() || browserLang()) return;

  detectFromIp().then((lang) => {
    if (!lang || savedLang()) return;
    setLang(lang, false);
  });
}

init();
