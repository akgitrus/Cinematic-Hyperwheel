import { useTranslation } from "react-i18next";

// Add an entry here (and a matching locales/<code>.json) to support a
// new UI language - no other code changes needed.
const LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "EN" },
  { code: "ru", label: "RU" },
];

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  return (
    <div className="lang-switch">
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          className={
            "lang-switch__btn" +
            (i18n.resolvedLanguage?.startsWith(l.code) ? " lang-switch__btn--active" : "")
          }
          onClick={() => i18n.changeLanguage(l.code)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
