// Site content. Source of truth for wording: CONTENT.md. CV is source of
// truth for facts.

export const greeting = {
  username: "Abdelwahab",
  title: "Abdelwahab Mahmoud",
  subTitle: "Senior Software Engineer · Full-stack & Platform",
  valueProp:
    "I build and operate production systems, mostly on AWS. Eight years across Rails, Node.js and Go, lately LLM platforms over Bedrock, OpenAI and Gemini, with the reliability work that keeps them boring.",
  chips: ["Cairo, Egypt", "English · Arabic (native)", "8+ years"],
  resumeLink: "/resume.pdf",
  githubLink: "https://github.com/abdelwahab313",
  linkedinLink: "https://www.linkedin.com/in/abdelwahab313/"
};

export const socialMediaLinks = {
  github: "https://github.com/abdelwahab313",
  linkedin: "https://www.linkedin.com/in/abdelwahab313/",
  gmail: "abdelwahabahmed93@gmail.com"
};

// Same rows as the CV (CONTENT.md section 1).
export const cvStack = {
  languages: [
    "PHP",
    "TypeScript",
    "JavaScript",
    "Go",
    "Ruby",
    "Java (Spring)",
    "Python",
    "SQL"
  ],
  backend: [
    "Ruby on Rails",
    "Node.js",
    "REST API design",
    "service-oriented architecture",
    "SQS",
    "Kafka"
  ],
  frontend: [
    "Next.js",
    "React",
    "Redux",
    "Hotwire (Turbo & Stimulus)",
    "React Native",
    "Tailwind CSS"
  ],
  ai_llm: [
    "AWS Bedrock",
    "OpenAI",
    "Gemini",
    "agentic workflows",
    "Claude Agent SDK",
    "MCP",
    "Langfuse",
    "evals"
  ],
  cloud: [
    "AWS (ECS Fargate, Lambda, SQS, Step Functions, CloudWatch, S3, IAM)",
    "Kubernetes",
    "Terraform",
    "Docker",
    "GitHub Actions",
    "GitLab CI"
  ],
  observability: [
    "Datadog",
    "OpenTelemetry",
    "AWS CloudWatch",
    "Langfuse tracing"
  ],
  databases: [
    "PostgreSQL",
    "MySQL",
    "Aurora",
    "Redis",
    "DynamoDB",
    "ClickHouse"
  ],
  testing: [
    "TDD",
    "Spec-driven development",
    "RSpec",
    "Capybara",
    "Playwright",
    "Cypress",
    "Jest",
    "VCR"
  ],
  wordpress: [
    "WPML ecosystem",
    "plugin update safety",
    "backwards compatibility",
    "i18n"
  ],
  spoken: ["English", "Arabic (native)"]
};

export const skillsSection = {
  title: "What I do",
  subTitle:
    "Backend and platform first: Ruby on Rails, AWS and the database under it. LLM systems over Bedrock, OpenAI and Gemini, with the reliability work that makes them boring. React and Hotwire when the feature needs a front end.",
  skills: [
    "Backend systems in Ruby on Rails, from background job internals to metered billing.",
    "AWS platform work: ECS Fargate, Lambda, Terraform and CloudWatch, from capacity study to deploy pipeline.",
    "LLM integration: a provider-agnostic engine over Bedrock, OpenAI and Gemini, with fallback chains, evaluation harnesses and MCP.",
    "Root-cause investigation on production incidents, separating what is verified from what is inferred.",
    "Frontend when it is needed: React, Hotwire, React Native."
  ]
};

export const educationInfo = {
  schools: [
    {
      schoolName: "Faculty of Science Cairo University",
      logo: "/img/CairoUniversity.png",
      subHeader: "BSc in Geophysics",
      duration: "Sep 2012 – Jun 2016"
    }
  ]
};

// CV durations/tags. Same rows as CONTENT.md section 3.
export const workExperiences = {
  experience: [
    {
      role: "Senior Software Engineer",
      company: "OnTheGoSystems (WPML — WordPress plugins)",
      companylogo: "/img/otgsLogo.png",
      date: "December 2024 – September 2026",
      duration: "1 yr 9 mo",
      location: "Remote (Hong Kong)",
      tags: [
        "Ruby on Rails",
        "React",
        "ECS Fargate",
        "Lambda",
        "Terraform",
        "Aurora",
        "Bedrock",
        "DynamoDB"
      ],
      desc: "Worked on Private Translation Cloud (PTC), an AI translation platform from the team behind WPML, the multilingual plugin that powers 1.5M+ WordPress sites. Full-stack product work in Rails and React, with the AWS platform underneath it.",
      descBullets: [
        "Built the multi-provider translation LLM engine behind WPML (Bedrock, OpenAI, Gemini): fallback chains, JSON repair and rate-limit retries keep translations flowing when a provider degrades.",
        "Built the guardrails agents run behind: an MCP server exposing live databases, logs and selected APIs through authenticated, monitored access, adopted as the team's standard agent integration path.",
        "Owned credits and billing correctness for a metered LLM product; one authorization architecture to replace scattered permission checks.",
        "Owned an agentic triage platform that handled first-line incident and support inquiries, cutting Mean Time To Resolve.",
        "Cleared Aurora MySQL's worst-query backlog query by query: rewritten plans, covering indexes and restructured hot reads, until CPU pressure stopped turning into incidents.",
        "Replaced ECS autoscaling with a queue-depth Lambda autoscaler (DynamoDB deployment state store) that drained long-running jobs instead of killing them, sustaining 500K jobs/hour at peak against a ~5K/hour baseline.",
        "Fixed lock contention under concurrent writes: exclusive advisory locks on hot paths, batch-processing rewrites for load management, and connection-pool tuning after autoscaling exposed pooling contention on the shared database.",
        "Owned the GitLab CI/CD pipelines: build, e2e test, SAST and deploy gates for every service in the product.",
        "Kept plugin APIs backwards compatible across releases with deprecation paths and contract tests.",
        "Migrated the product onto AWS ECS Fargate running Docker containers, and owned the platform and its Terraform; the fleet handled ~100K requests/hour at peak across background processing and LLM inference."
      ]
    },
    {
      role: "Senior Software Engineer",
      company: "Dailymealz",
      companylogo: "/img/dailymealzLogo.png",
      date: "December 2021 – December 2024",
      duration: "3 yrs",
      location: "Riyadh",
      tags: ["React Native", "Node.js", "AWS", "Datadog", "Redis"],
      desc: "Built and scaled a meal subscription platform serving customers across Saudi Arabia, with full-stack work across React Native and Node.js services.",
      descBullets: [
        "Built the real-time order service behind a 100K daily-user delivery product: kitchen, driver and delivery status pushed to mobile and web clients over Node.js and Socket.IO.",
        "Cut Mean Time To Resolve by 30% by instrumenting order, driver and kitchen flows with Datadog and OpenTelemetry.",
        "Decomposed the fulfillment component out of the PHP/Laravel monolith into a standalone service in a distributed event-driven architecture, passing state changes over AWS SQS behind a REST API contract.",
        "Chose incremental extraction over a full event-driven rewrite, because a team of six could not freeze features for months to run two partially consistent systems.",
        "Served hot order state from Redis in a write-behind cache pattern with MySQL behind it, keeping status fan-out off the transactional path.",
        "Migrated the real-time order service from JavaScript to TypeScript so event and message payload mismatches fail at compile time, not at runtime in front of customers.",
        "Led a team of five building a driver location check-in system: planning, reviews and pairing across the driver app."
      ]
    },
    {
      role: "Full-Stack Developer",
      company: "Nformacy",
      companylogo: "/img/nformacy.png",
      date: "October 2020 – December 2021",
      duration: "1 yr 2 mo",
      location: "Cairo",
      tags: ["React", "Ruby on Rails"],
      desc: "Built Nformacy, a knowledge marketplace that connects business advisors with companies that need their expertise. Full-stack work in React and Ruby on Rails, from the first MVP to the beta launch, plus the cloud infrastructure and deploy pipelines.",
      descBullets: [
        "Led full-stack features from requirements to deployment, and moved the web apps to a SaaS model.",
        "Built mentor calendar booking with Zoom, ClickUp and calendar integrations.",
        "Wrote BDD tests and managed CI/CD pipelines."
      ]
    },
    {
      role: "Software Engineer",
      company: "DevSquads (formerly Fikr Labs)",
      companylogo: "/img/devsquads.webp",
      date: "January 2018 – October 2020",
      duration: "2 yrs 9 mo",
      location: "Cairo",
      tags: ["React", "React Native", "Node.js", "Java Spring", "TDD"],
      desc: "First job in tech, at a Cairo venture studio that became DevSquads, an agile consultancy that takes XP seriously: TDD, pair programming and continuous delivery. Delivered products for international clients, including Shapa, a US health tech platform (React, React Native, Node.js, Java Spring).",
      descBullets: [
        "Built software in self-organizing Extreme Programming teams with TDD, thin vertical slices and test-covered refactoring of legacy code, across React Native, Ruby on Rails, Java Spring and React.",
        "Mentored teams adopting XP and Agile practices: pairing, code review discipline and iterative planning."
      ]
    }
  ]
};

export const bigProjects = {
  title: "Products",
  subtitle: "Products I helped build",
  projects: [
    {
      badge: "PTC",
      projectName: "Private Translation Cloud",
      tagline: "AI translation platform from the team behind WPML.",
      projectDesc:
        "I worked on the AWS platform and the multi-provider LLM engine that translates websites automatically, moving the product onto ECS Fargate and keeping its database and autoscaling healthy.",
      scale: "1.5M+ WordPress sites",
      timeframe: "Dec 2024 – Sep 2026",
      stack: ["Ruby on Rails", "React", "AWS", "Terraform", "Bedrock"],
      footerLink: [{name: "Visit website", url: "https://ptc.wpml.org/"}]
    },
    {
      badge: "DM",
      projectName: "Dailymealz",
      tagline: "Meal subscription platform for customers across Saudi Arabia.",
      projectDesc:
        "I spent three years building the real-time order service, the React Native driver app, and the move from a PHP monolith to event-driven services.",
      scale: "100K daily users",
      timeframe: "Dec 2021 – Dec 2024",
      stack: ["React Native", "Node.js", "AWS", "Redis"],
      footerLink: [{name: "Visit website", url: "https://dailymealz.com/"}]
    },
    {
      badge: "SH",
      projectName: "Shapa",
      tagline:
        "US health product built around a numberless smart scale and a behavior change program.",
      projectDesc:
        "I built the mobile app and the backend behind it as part of the DevSquads XP team.",
      timeframe: "2018 – 2020",
      stack: ["React", "React Native", "Node.js", "Java Spring"],
      footerLink: [{name: "Visit website", url: "https://shapahealth.com/"}]
    },
    {
      badge: "NF",
      projectName: "Nformacy",
      tagline:
        "Knowledge marketplace connecting business advisors with companies.",
      projectDesc:
        "I built it from the first MVP to the beta launch, plus the cloud infrastructure and deploy pipelines.",
      timeframe: "Oct 2020 – Dec 2021",
      stack: ["React", "Ruby on Rails"],
      footerLink: [{name: "Visit website", url: "https://nformacy.com/"}]
    }
  ]
};

export const contactInfo = {
  title: "Contact me",
  subtitle:
    "Hiring for a senior backend or platform role, or stuck on a production problem? Email me.",
  email_address: "abdelwahabahmed93@gmail.com"
};

export const openSource = {
  title: "Open Source",
  projects: [
    {
      name: "ecs-drain-scaler",
      url: "https://github.com/abdelwahab313/ecs-drain-scaler",
      desc: "Lambda-based ECS autoscaler that drains long-running jobs before scale-in.",
      role: "Author",
      outcome: "Prevents mid-job termination on Fargate Spot/scale-in.",
      tags: ["Go", "AWS", "Terraform"]
    },
    {
      name: "focusflow",
      url: "https://github.com/abdelwahab313/focusflow",
      desc: "Time and task focus app.",
      role: "Author",
      outcome: "Minimalist flow tracking.",
      tags: ["TypeScript", "PocketBase"]
    },
    {
      name: "handoff-mcp-server",
      url: "https://github.com/abdelwahab313/handoff-mcp-server",
      desc: "MCP server for authenticated access to logs, DB, and APIs.",
      role: "Author",
      outcome: "Standardized agent access path.",
      tags: ["TypeScript", "MCP"]
    },
    {
      name: "egy-finance-radar",
      url: "https://github.com/abdelwahab313/egy-finance-radar",
      desc: "Egyptian finance data radar.",
      role: "Author",
      outcome: "Aggregates signals for analysis.",
      tags: ["Python", "PostgreSQL", "Next.js"]
    }
  ]
};

export const workChallenges = {
  title: "What I work on",
  subtitle:
    "The problems I'm usually brought in for. Each card is backed by something I shipped; open one to see how I approached it.",
  footer:
    "More than the cards cover, when a product needs it: REST APIs, internal tools and the glue between systems.",
  cards: [
    {
      id: "platform-migrations",
      title: "Cloud migrations and platform moves",
      summary:
        "Applications and databases moved onto new infrastructure in one planned cutover, without breaking production.",
      covers: [
        "Moved a product off a single EC2 host onto ECS Fargate",
        "Infrastructure as code with Terraform",
        "Kept the database and autoscaling healthy through the move"
      ],
      project: {
        name: "Private Translation Cloud",
        url: "https://ptc.wpml.org/"
      },
      article: "fargate"
    },
    {
      id: "event-driven-services",
      title: "Event-driven services",
      summary:
        "Monoliths split into services that stay consistent when orders, money and data move between them.",
      covers: [
        "Real-time order service for a meal subscription platform",
        "Moved a PHP monolith to event-driven services",
        "Queues and streams with SQS and Kafka"
      ],
      project: {name: "Dailymealz", url: "https://dailymealz.com/"},
      article: "fulfillment-extraction"
    },
    {
      id: "llm-platforms",
      title: "LLM platforms",
      summary:
        "Provider-agnostic LLM engines that fail over cleanly when a model degrades.",
      covers: [
        "Multi-provider engine over AWS Bedrock, OpenAI and Gemini",
        "Agentic workflows and the Claude Agent SDK",
        "Tracing and evals with Langfuse and MCP tooling"
      ],
      project: {
        name: "Private Translation Cloud",
        url: "https://ptc.wpml.org/"
      },
      article: "engine"
    },
    {
      id: "zero-to-launch",
      title: "Product from zero to launch",
      summary:
        "From the first MVP to a launched product, with the cloud and deploy pipelines behind it.",
      covers: [
        "Took a marketplace from first MVP to beta launch",
        "Cloud infrastructure and deploy pipelines",
        "Full-stack delivery across React and Ruby on Rails"
      ],
      project: {name: "Nformacy", url: "https://nformacy.com/"},
      article: "zero-to-launch"
    },
    {
      id: "mobile-apps",
      title: "Mobile apps",
      summary:
        "React Native apps shipped together with the backend that feeds them.",
      covers: [
        "React Native driver app for live orders",
        "Cross-platform health app built around a smart scale",
        "One backend serving both mobile and web"
      ],
      project: {name: "Dailymealz", url: "https://dailymealz.com/"},
      article: "mobile-backend"
    },
    {
      id: "reliability",
      title: "Reliability and observability",
      summary:
        "Keeping databases out of saturation and autoscaling that respects long-running jobs.",
      covers: [
        "Databases kept out of CPU saturation",
        "Autoscaling that respects long-running jobs",
        "Datadog and OpenTelemetry tracing"
      ],
      project: {
        name: "Private Translation Cloud",
        url: "https://ptc.wpml.org/"
      },
      article: "aurora"
    }
  ]
};
