# Personal blogs, digital gardens & the indie web — design landscape 2024–2026

Findings from fetching these sites in October 2026. Computed CSS (measure, leading, exact sizes) can't be read from fetched text, so unmeasured numbers are flagged. Browser figures are caniuse's September 2026 usage share.

## 1. Archetypes

**Minimal text-first**
- [danluu.com](https://danluu.com/) — One column, no images; posts are a dense list of date-prefixed links (`09/26`) split "↑ Public posts" / "↓ Patreon posts". The archive *is* the homepage: zero clicks to any year.
- [jvns.ca](https://jvns.ca/) — "Most recent 10 posts", then the whole corpus grouped by category (Git, DNS, Terminals, Nix). Categories double as a map of her interests, so browsing reads like a syllabus.
- [fabiensanglard.net](https://fabiensanglard.net/) — `21/08/2026: title`, ~250 entries back to 2008, plus a separate Magic: The Gathering section. A two-line intro does all the about-page work.

**Editorial / magazine**
- [craigmod.com](https://craigmod.com/) — Serif voice, book-cover hero with award seals, pull quotes, image-card essay lists. Splits its newsletter by list (Roden monthly, Ridgeline weekly) under "~50,000 subscribers. Always one-click to unsubscribe."
- [robinsloan.com](https://www.robinsloan.com/) — A novelist's site as print object: Filosofia body, Trade Gothic Next, Kyrios blackletter headlines ([colophon](https://www.robinsloan.com/colophon/)). The footer promises it "doesn't collect any information about you or your reading."

**Terminal / hacker**
- [lukesmith.xyz](https://lukesmith.xyz/) — H1, portrait, *two-column HTML tables* as navigation, then "Some writings:" as title + dek. It looks like 1998 because it is 1998.
- [cblgh.org](https://cblgh.org/) — "my home on this internetwork": everything is a project list with one-line descriptions, nav is four bare words (map/about/rss/now). Uses `/sitemap`, not `/archive`, plus an XXIIVV webring button.

**Digital garden / wiki**
- [maggieappleton.com](https://maggieappleton.com/) — Typed taxonomy with self-describing blurbs (Essays = "opinionated, long-form narrative writing with an agenda"; Smidgeons = "interesting links, papers, and tiny thoughts"). Relative timestamps ("planted over 6 years ago / last tended over 5 years ago") make staleness legible.
- [notes.andymatuschak.org](https://notes.andymatuschak.org/) — Deliberately no index: "there's no index or navigational aids." Links are titled sentences, so a list of links reads as prose; opaque slugs never break when titles change.
- [rachsmith.com](https://rachsmith.com/) — Three site-wide toggles (rainbows / cursor trails / dark mode); month-grouped notes with a day-number gutter. Micro-posts carry full timestamps, essays only titles — density signals genre.

**Card-grid / bento**
- [mxb.dev](https://mxb.dev/) — "I make websites." then a featured grid of processed thumbnails with title, dek, numeric badge. A live Speedlify performance badge in the footer: the site grades itself in public.
- [swyx.io](https://www.swyx.io/) — "A FEW PLACES TO START": a 12-card grid (eyebrow → title → dek → "Read essay"). One `/ideas` page filtered by query string instead of separate archives.

**Site as product**
- [kentcdodds.com](https://kentcdodds.com/) — Full mascot system (Kody the Koala), illustrated course cards, a stats claim ("214 blog posts… read 965,986 times by 767,091 people"). Per-post recommendations with "Click to copy url".
- [rauno.me](https://rauno.me/) — Name as headline with color-differentiated inline words, five bare links, footer mantra ("Make it fast. / … / Make it."). Year-versioned archives (`2023.rauno.me`): the design history is the portfolio.

## 2. 2025–2026 trends

- **Dark mode is table stakes** — `prefers-color-scheme` at **97.15%** global ([caniuse](https://caniuse.com/prefers-color-scheme)). The shift is treatment: sites swap assets, not just colors (two portraits at joshwcomeau; [gwern.net](https://gwern.net/design) describes an "InvertOrNot" AI image-inversion pass).
- **Variable fonts and self-hosting won** — **97.22%** global ([caniuse](https://caniuse.com/variable-fonts)). Self-hosted `woff2` is the default on well-made sites.
- **View transitions shipped** — single-document API at **92.9%** global, Chrome 111+, Safari 18+, Firefox 144+ ([caniuse](https://caniuse.com/view-transitions)). Firefox only cleared it in 2026, which pushed the interesting work into multi-page transitions.
- **Scroll-driven animation is baseline-adjacent** — `animation-timeline: scroll()` at **87.84%**, Safari arriving only in 26.0. Canonical demos at [scroll-driven-animations.style](https://scroll-driven-animations.style/), "no framework or build step."
- **RSS revival is infrastructural** — feeds went per-section: [bram.us](https://bram.us/) runs `/feed/`, `/category/original-content/feed/`, `/category/elsewhere/feed/`; [jim-nielsen.com](https://jim-nielsen.com/) runs a feed per subdomain.
- **Newsletter-first is the business model** — Craig Mod ~50k, Henrik Karlsson ~66k on Substack, Sloan on Buttondown driven from a Ruby script. Email capture now sits inline in essay lists.
- **AI disclosure became a design element** — `/ai` in the wild at [sive.rs/ai](https://sive.rs/ai): "I never use AI to write as me." Counter-current: [cassie.codes](https://cassie.codes/) is now a farewell note about making "stuff that can't be regurgitated in exchange for tokens."
- **Slash pages are the new site architecture** — [slashpages.net](https://slashpages.net/) catalogs ~60 (`/now`, `/uses`, `/colophon`, `/blogroll`, `/til`, `/ai`, `/style`, `/canon`, `/verify`, `/why`); [aboutideasnow.com](https://aboutideasnow.com/) indexes 1,775 sites by three of them.
- **Curation is a genre** — [ooh.directory](https://ooh.directory/) (2,433 blogs), [blogroll.org](https://blogroll.org/) (1,308, "No algorithms ever!"), [uses.tech](https://uses.tech/) (950), the 256-slot [XXIIVV webring](https://webring.xxiivv.com/), [Micro.blog](https://micro.blog/), [Neocities](https://neocities.org/) (1,799,600 sites).

## 3. Typography worth stealing

- **Measure** 45–75ch; ~65ch for essays, narrower with a large x-height (*convention, not measured*).
- **Line-height** 1.5–1.7 body, 1.05–1.2 headings. The most reliable "designed" tell is tighter heading leading than body leading.
- **Type scale** — the cheapest credible system is [Utopia](https://utopia.fyi/): define a scale at min viewport (360px / 18px / 1.2) and max (1240px / 20px / 1.25), interpolate with `clamp()`. Explicitly "not a product, a plugin, or a framework."
- **Serif body and headlines; mono reserved only for metadata** — dates, read times, tags, code. Never mono for prose.
- **Code blocks** differentiate on chrome, not highlighting: filename bar, copy button, horizontal scroll that doesn't break the grid.
- **Footnotes vs sidenotes** — gwern argues for "sidenotes instead of footnotes on wide windows"; Archibald argues the reverse ("Give footnotes the boot", July 2025, [jakearchibald.com](https://jakearchibald.com/)). Sidenotes are higher craft, higher cost.
- **TOC** — two-column sticky with the current section highlighted, collapsing below ~1100px. And "Web design is not about picking great typefaces, it is how we use them" ([iA, 2006](https://ia.net/topics/the-web-is-all-about-typography-period)).

## 4. What retains readers

- **Deep dives with a named, narrow thesis** beat volume; the sites surviving on writing alone publish rarely and irreplaceably.
- **Numbered series** create return visits ("Month notes & numbers No. 1–16", "Code sketch #4–7"); numbering is a promise of continuation.
- **Notes and TILs as a second tier** keep cadence without diluting essays, and give RSS something weekly.
- **Link posts are a legitimate format**, not filler — and the cheapest thing to ship by hand.
- **Dek-writing is the actual skill**: [benkuhn.net](https://benkuhn.net/) uses each post's own section outline as its dek, which makes every entry self-selling.

## 5. Designed vs template-y

1. **One committed typeface with real weights** — one family, 3–4 weights, one mono — beats three Google fonts.
2. **Optical over box alignment**: hanging punctuation, negative margins on quotes, aligned numerals.
3. **Metadata as a visual system**: one mono style for every date, duration and tag, everywhere.
4. **A non-generic nav.** `/now`, `/uses`, `/colophon`, `/blogroll`, `/ai` say "person"; Home/About/Blog/Contact says "theme".
5. **One repeated motif.** daneden reuses a single iPhone mockup for four cards; 100r uses hand-drawn rabbits as nav. Repetition reads as system; variety reads as stock.
6. **Semantic restraint.** gwern: "visual differences should be semantic differences"; "you must earn your ornaments."
7. **Self-documentation.** A colophon converts "nice CSS" into "authored design."

## 6. Cheap vs expensive on a hand-written static site

| Idea | Cost |
|---|---|
| Type scale via `clamp()` + Utopia | **Cheap** — one CSS block |
| Self-hosted variable `woff2`, 1–2 families | **Cheap** — two files + `@font-face` |
| Dark mode via `prefers-color-scheme` + toggle | **Cheap** — CSS vars + ~6 lines JS |
| Mono metadata system, date/read-time formatting | **Cheap** |
| Slash pages (`/now`, `/uses`, `/colophon`, `/ai`) | **Cheap** — plain HTML |
| Sticky two-column TOC | **Cheap** — `<nav>` + `position: sticky` |
| Hand-written RSS/Atom | **Cheap** — one template + find/replace |
| View transitions on navigation | **Cheap** — `@view-transition { navigation: auto }` |
| Sidenotes on wide viewports | **Medium** — grid + margin notes, needs care |
| Scroll-driven header / reading progress | **Medium** — needs a fallback |
| Custom illustration system (mascot, per-post art) | **Expensive** — commissioning + art direction |
| Interactive embeds (ciechanow.ski-style canvas) | **Expensive** — per-post engineering |
| Live data widgets (Sloan's library-hold counter) | **Expensive** — backend + upkeep |
| Backlinks / bidirectional links | **Expensive** — needs an index; why most gardens use a generator |
| Per-post OG images, search, comments | **Medium–expensive** |

**The arbitrage:** nearly every "designed" signal in this survey is typographic, not illustrative. A hand-written site that nails one typeface, a fluid scale, a mono metadata system, and four slash pages reads as more authored than a framework theme with a mascot.
