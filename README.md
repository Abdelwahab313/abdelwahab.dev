# abdelwahab.dev

Source for my personal site and engineering blog at
[abdelwahab.dev](https://abdelwahab.dev): who I am, the work I've shipped, and
long-form posts on the production problems behind it.

## Stack

- [Astro 5](https://astro.build), static output, zero client-side framework
- Blog posts as Astro content collections (`src/content/blog/*.md`), validated by a
  Zod schema in `src/content.config.ts`
- Diagrams as theme-aware inline SVGs (`src/diagrams/`), embedded by a small remark
  plugin (`src/lib/remark-diagrams.mjs`)
- Shiki code highlighting at build time, dual light/dark themes
- IBM Plex Sans + Mono and Fraunces, self-hosted via Fontsource
- RSS (`/rss.xml`), Atom (`/atom.xml`) and a sitemap

## Layout

```
src/
  pages/          index, /work, /blog, /blog/tag/*, feeds, 404
  layouts/        Base.astro (head, theme toggle, nav)
  data/           portfolio.ts — profile, experience, skills
  content/blog/   one Markdown file per post
  diagrams/       SVGs referenced from posts
  styles/         global.css
public/           favicons, og.png, resume.pdf, CNAME
docs/             blog authoring guide, ADRs, specs
```

## Commands

| Command                                   | Action                                       |
| ----------------------------------------- | -------------------------------------------- |
| `npm install`                             | Install dependencies                         |
| `npm run dev`                             | Dev server on `http://localhost:4321`        |
| `npm run build`                           | Production build to `dist/` (schema-checked) |
| `npm run preview`                         | Serve the built site locally                 |
| `npm run check`                           | `astro check` type and content checks        |
| `npm run format` / `npm run check-format` | Prettier write / check                       |

## Writing

- Site copy lives in `CONTENT.md` and `src/data/portfolio.ts`. My CV is the source of
  truth for facts; the site mirrors it.
- Blog authoring contract: `docs/BLOG.md`, workflow in `docs/BLOG-WORKFLOW.md`. Add a
  `.md` file under `src/content/blog/` and it is picked up automatically.
- Renamed posts keep their old URL via `redirects` in `astro.config.mjs`.
- Glossary in `CONTEXT.md`, decisions in `docs/adr/`.
- `public/resume.pdf` is built from my CV repo and replaced whenever the CV changes.

## Deploy

Every push to `main` builds the site and publishes `dist/` to the `gh-pages` branch
via `.github/workflows/deploy.yml`. The custom domain is set by `public/CNAME`.

## History

The site started as a fork of [developerFolio](https://github.com/saadpasta/developerFolio)
(React / Create React App). It was rebuilt from scratch on Astro in October 2026
(`docs/adr/0001-astro-rebrand.md`); no template code remains.

## License

GPL-3.0, see `LICENSE`. Code is free to reuse under that license; the writing, CV and
personal content are mine, so please don't republish them as your own.
