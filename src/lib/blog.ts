import type {CollectionEntry} from "astro:content";
import type {MarkdownHeading} from "astro";

type Post = CollectionEntry<"blog">;

const WORDS_PER_MINUTE = 200;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function publishedPosts(posts: Post[]): Post[] {
  return posts
    .filter(post =>
      import.meta.env.PROD ? post.data.status === "published" : true
    )
    .sort(
      (a, b) =>
        b.data.date.valueOf() - a.data.date.valueOf() ||
        a.data.order - b.data.order
    );
}

export function tagSlug(tag: string): string {
  return slugify(tag);
}

export function allTags(posts: Post[]): string[] {
  const seen = new Set<string>();
  for (const post of posts) {
    for (const tag of post.data.tags) seen.add(tag);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export function tagCounts(posts: Post[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.data.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return new Map(
    [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  );
}

export function featuredPosts(posts: Post[]): Post[] {
  return posts.filter(post => post.data.featured);
}

export function assertSingleFeatured(posts: Post[]): void {
  const featured = featuredPosts(posts);
  if (featured.length > 1) {
    throw new Error(
      `At most one post may set featured: true. Found ${featured.length}: ${featured
        .map(post => post.id)
        .join(", ")}`
    );
  }
}

export function assertArticlesExist(posts: Post[], slugs: string[]): void {
  const known = new Set(posts.map(post => post.id));
  const missing = slugs.filter(slug => slug.length > 0 && !known.has(slug));
  if (missing.length > 0) {
    throw new Error(
      `Homepage article slug(s) with no matching post: ${missing.join(", ")}`
    );
  }
}

export function readingMinutes(post: Post): number {
  const text = `${post.data.lede} ${post.body ?? ""}`;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

const CASE_HEADINGS = ["Situation", "Decision", "Trade-off", "Outcome"];

export function assertCaseStudyHeadings(
  post: Post,
  headings: MarkdownHeading[]
): void {
  if (post.data.kind !== "case-study") return;
  const h2 = headings.filter(h => h.depth === 2).map(h => h.text);
  let cursor = 0;
  for (const expected of CASE_HEADINGS) {
    const at = h2.indexOf(expected, cursor);
    if (at === -1) {
      throw new Error(
        `case-study ${post.id} is missing "## ${expected}" (in order: ${CASE_HEADINGS.join(", ")}). Found: ${h2.join(", ") || "none"}`
      );
    }
    cursor = at + 1;
  }
}
