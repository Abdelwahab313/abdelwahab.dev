import type {CollectionEntry} from "astro:content";
import {
  greeting,
  socialMediaLinks,
  cvStack,
  contactInfo
} from "../data/portfolio";

const SITE = "https://abdelwahab.dev";
const PERSON_ID = `${SITE}/#person`;

export type JsonLd = Record<string, unknown>;

function knowsAbout(): string[] {
  return [
    ...cvStack.languages,
    ...cvStack.backend,
    ...cvStack.frontend,
    ...cvStack.ai_llm,
    ...cvStack.cloud,
    ...cvStack.observability,
    ...cvStack.databases,
    ...cvStack.testing,
    ...cvStack.compatibility
  ];
}

export function personSchema(): JsonLd {
  return {
    "@type": "Person",
    "@id": PERSON_ID,
    name: greeting.title,
    url: SITE,
    jobTitle: greeting.subTitle,
    description: greeting.valueProp,
    email: `mailto:${contactInfo.email_address}`,
    address: {"@type": "PostalAddress", addressLocality: "Cairo, Egypt"},
    sameAs: [socialMediaLinks.github, socialMediaLinks.linkedin],
    knowsAbout: knowsAbout()
  };
}

export function webSiteSchema(): JsonLd {
  return {
    "@type": "WebSite",
    "@id": `${SITE}/#website`,
    url: SITE,
    name: greeting.title,
    description: greeting.valueProp,
    publisher: {"@id": PERSON_ID},
    inLanguage: "en"
  };
}

export function homeGraph(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@graph": [webSiteSchema(), personSchema()]
  };
}

export function breadcrumbSchema(items: {name: string; url: string}[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url
    }))
  };
}

export function blogPostingSchema(post: CollectionEntry<"blog">): JsonLd {
  const {data} = post;
  const url = `${SITE}/blog/${post.id}`;
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: data.title,
    description: data.lede,
    url,
    mainEntityOfPage: {"@type": "WebPage", "@id": url},
    datePublished: data.date.toISOString(),
    dateModified: data.date.toISOString(),
    author: {"@id": PERSON_ID},
    publisher: {"@id": PERSON_ID},
    keywords: data.tags,
    inLanguage: "en"
  };
}
