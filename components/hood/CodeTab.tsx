import { Highlight, type PrismTheme } from "prism-react-renderer";
import { useEffect, useRef, useState } from "react";

import {
  LANG_LABELS,
  SECTIONS,
  type Example,
  type Lang,
  type Section,
} from "@/components/hood/codeExamples";

// How to do each thing in LaunchDarkly, from its docs, for the moment on a
// call when someone asks "what does that look like in Python?". The content
// is in codeExamples.ts; this is the browsing around it.

// Prism has no Java, shell or HCL grammar of its own. Java reads well with
// the C-like one; the rest stay plain rather than half-coloured.
const PRISM_LANGUAGE: Record<Lang, string> = {
  node: "tsx",
  react: "tsx",
  javascript: "tsx",
  python: "python",
  go: "go",
  java: "clike",
  ios: "swift",
  android: "kotlin",
  yaml: "yaml",
  json: "json",
  shell: "plain",
  hcl: "plain",
};

// The Live tab's terminal colours, so the two dark panes read as one tool.
const THEME: PrismTheme = {
  plain: { color: "#F8F8F8", backgroundColor: "#191919" },
  styles: [
    { types: ["comment", "prolog", "doctype", "cdata"], style: { color: "#A7A9AC", fontStyle: "italic" } },
    { types: ["string", "char", "attr-value", "template-string", "regex"], style: { color: "#DDFF46" } },
    { types: ["keyword", "important", "atrule", "selector"], style: { color: "#9AA8FF" } },
    { types: ["number", "boolean", "constant", "symbol"], style: { color: "#FF9D29" } },
    { types: ["function", "class-name", "builtin", "tag"], style: { color: "#3DD6F5" } },
    { types: ["punctuation", "operator"], style: { color: "#D1D6D9" } },
  ],
};

// Session storage like the panel itself, so a reload mid-call keeps the
// section and language an SE had picked.
const STORAGE_KEY = "togglewear.hood.code";

function readSaved(): { section: string; lang: Lang } {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved && SECTIONS.some((s) => s.id === saved.section) && saved.lang in LANG_LABELS) {
      return saved;
    }
  } catch {
    // Nothing usable saved.
  }
  return { section: SECTIONS[0].id, lang: "node" };
}

function matches(section: Section, example: Example, terms: string[]) {
  const haystack = [
    section.title,
    example.title,
    example.summary,
    example.status ?? "",
    ...example.snippets.map((s) => `${LANG_LABELS[s.lang]} ${s.code}`),
  ]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export default function CodeTab() {
  const [sectionId, setSectionId] = useState(SECTIONS[0].id);
  const [lang, setLang] = useState<Lang>("node");
  const [query, setQuery] = useState("");
  const [restored, setRestored] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = readSaved();
    setSectionId(saved.section);
    setLang(saved.lang);
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ section: sectionId, lang }));
    } catch {
      // Still works for this page load.
    }
  }, [sectionId, lang, restored]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [sectionId, query]);

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  // A search looks across every section, since the person asking doesn't
  // know which one the answer is filed under.
  const current = SECTIONS.find((s) => s.id === sectionId) ?? SECTIONS[0];
  const shown =
    terms.length === 0
      ? [{ section: current, examples: current.examples }]
      : SECTIONS.map((section) => ({
          section,
          examples: section.examples.filter((example) => matches(section, example, terms)),
        })).filter((group) => group.examples.length > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-3 px-6 py-4">
        <p className="font-sohne text-small text-grays-04">
          How to do it in code, from LaunchDarkly&apos;s docs. Keys are placeholders, and each
          example links to the page it came from.
        </p>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search, for example: python track, relay, judges"
          aria-label="Search code examples"
          className="w-full rounded-full border border-grays-02 px-4 py-2 font-sohne text-small text-grays-ld-black placeholder:text-grays-03 focus-visible:border-grays-ld-black focus-visible:outline-none"
        />
        {terms.length === 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sections">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => setSectionId(section.id)}
                aria-pressed={section.id === sectionId}
                className={`rounded-full px-3 py-1 font-sohne text-xsmall font-medium transition-colors ${
                  section.id === sectionId
                    ? "bg-grays-ld-black text-grays-white"
                    : "bg-grays-01 text-grays-ld-black hover:bg-base-lime"
                }`}
              >
                {section.title}
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6">
        {shown.length === 0 && (
          <p className="font-sohne text-small text-grays-04">
            Nothing matches &ldquo;{query.trim()}&rdquo;. Try fewer words, or the feature&apos;s
            name in the docs.
          </p>
        )}
        {shown.map(({ section, examples }) => (
          <section key={section.id} className="flex flex-col gap-4">
            {terms.length === 0 ? (
              <p className="font-sohne text-small text-grays-04">{section.summary}</p>
            ) : (
              <h3 className="font-geist text-[12px] font-semibold uppercase tracking-[1.2px] text-grays-04">
                {section.title}
              </h3>
            )}
            {examples.map((example) => (
              <ExampleCard key={example.id} example={example} lang={lang} onLang={setLang} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function ExampleCard({
  example,
  lang,
  onLang,
}: {
  example: Example;
  lang: Lang;
  onLang: (lang: Lang) => void;
}) {
  // The language picked anywhere carries to every card that has it.
  const snippet = example.snippets.find((s) => s.lang === lang) ?? example.snippets[0];

  return (
    <article className="flex flex-col gap-3 rounded-[16px] border border-grays-hairline p-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-sohne text-main font-medium text-grays-ld-black">{example.title}</h4>
          {example.status && (
            <span
              className={`rounded-full px-2 py-0.5 font-sohne text-[11px] font-medium ${
                example.status === "Legacy"
                  ? "bg-grays-01 text-grays-04"
                  : "bg-base-orange/15 text-[#A35A00]"
              }`}
            >
              {example.status}
            </span>
          )}
        </div>
        <p className="font-sohne text-small text-grays-04">{example.summary}</p>
      </div>

      {example.inToggleWear && (
        <p className="font-sohne text-xsmall text-grays-04">
          <span className="font-medium text-grays-ld-black">In ToggleWear: </span>
          {example.inToggleWear}
        </p>
      )}

      {example.snippets.length > 1 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={`${example.title} language`}>
          {example.snippets.map((s) => (
            <button
              key={s.lang}
              type="button"
              onClick={() => onLang(s.lang)}
              aria-pressed={s.lang === snippet.lang}
              className={`rounded-full px-2.5 py-0.5 font-sohne text-xsmall transition-colors ${
                s.lang === snippet.lang
                  ? "bg-grays-ld-black text-grays-white"
                  : "text-grays-04 hover:bg-grays-01 hover:text-grays-ld-black"
              }`}
            >
              {LANG_LABELS[s.lang]}
            </button>
          ))}
        </div>
      )}

      <CodeBlock code={snippet.code} lang={snippet.lang} />

      <a
        href={example.docs}
        target="_blank"
        rel="noreferrer"
        className="self-start font-sohne text-xsmall font-medium text-grays-ld-black underline decoration-grays-02 underline-offset-4 hover:decoration-grays-ld-black"
      >
        Read the docs ↗
      </a>
    </article>
  );
}

function CodeBlock({ code, lang }: { code: string; lang: Lang }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard blocked (an insecure origin or a denied permission): the
      // code is still selectable by hand.
    }
  }

  return (
    <div className="relative overflow-hidden rounded-[12px] bg-grays-ld-black">
      <div className="flex items-center justify-between border-b border-grays-06 px-4 py-2">
        <span className="font-sohne-mono text-xsmall-mono text-grays-03">{LANG_LABELS[lang]}</span>
        <button
          type="button"
          onClick={copy}
          className="font-sohne-mono text-xsmall-mono text-grays-03 transition-colors hover:text-base-lime focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-lime"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <Highlight theme={THEME} code={code} language={PRISM_LANGUAGE[lang]}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <pre className="overflow-x-auto px-4 py-3 font-sohne-mono text-xsmall-mono leading-relaxed">
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  );
}
