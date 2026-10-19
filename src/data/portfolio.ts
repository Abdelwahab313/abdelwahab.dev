// Site content. Source of truth for wording: CONTENT.md. CV is source of
// truth for facts.

export const greeting = {
  username: "Abdelwahab",
  title: "Abdelwahab Mahmoud",
  subTitle: "Senior Software Engineer · Full-stack & Platform",
  valueProp:
    "I build and run production systems end to end, from React in the browser to AWS underneath. Most recently: the LLM engine and cloud platform behind an AI translation product that peaked at ~100K requests an hour.",
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
  compatibility: [
    "backwards compatibility",
    "deprecation paths",
    "contract tests",
    "i18n"
  ],
  spoken: ["English", "Arabic (native)"]
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

// CV durations/tags. Same rows as CONTENT.md section 3. Each entry leads
// with the hardest problem of the job; `story` absorbs the CV bullets it
// tells, so `descBullets` holds only the rest.
export const workExperiences = {
  experience: [
    {
      role: "Senior Software Engineer",
      company: "AI translation platform (under NDA)",
      companylogo: "",
      date: "December 2024 – September 2026",
      duration: "1 yr 9 mo",
      location: "Remote",
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
      article: "fargate",
      headline:
        "Scaled AI translation to 500K jobs an hour at peak without killing a job mid-run",
      story:
        "The product was an AI translation platform that ran LLM jobs on AWS. I did full-stack product work in Rails and React and owned the AWS platform under it. Load sat at ~5K jobs an hour and peaked at 500K. Jobs could run for hours, and the default ECS autoscaling stopped busy tasks on scale-in, so every peak cost work in progress. I migrated the product onto ECS Fargate with Terraform and replaced the scaler with a queue-depth autoscaler on Lambda, deployment state in DynamoDB, that drains a task before stopping it. The fleet handled ~100K requests an hour at peak across background processing and LLM inference.",
      descBullets: [
        "Built the multi-provider translation LLM engine with the team (Bedrock, OpenAI, Gemini): fallback chains, JSON repair and rate-limit retries kept translations flowing when a provider degraded.",
        "Cleared Aurora MySQL's worst-query backlog query by query: rewritten plans, covering indexes and restructured hot reads, until CPU pressure stopped turning into incidents.",
        "Fixed lock contention under concurrent writes: exclusive advisory locks on hot paths, batch-processing rewrites for load management, and connection-pool tuning after autoscaling exposed pooling contention on the shared database.",
        "Built the MCP server the team's agents ran behind, exposing live databases, logs and selected APIs through authenticated, monitored access. It became the team's standard agent integration path.",
        "Owned credits and billing correctness for a metered LLM product, and replaced scattered permission checks with one authorization architecture.",
        "Owned an agentic triage platform that handled first-line incident and support inquiries, cutting Mean Time To Resolve.",
        "Owned the GitLab CI/CD pipelines: build, e2e test, SAST and deploy gates for every service in the product.",
        "Kept public APIs backwards compatible across releases with deprecation paths and contract tests."
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
      product: {name: "Dailymealz", url: "https://dailymealz.com/"},
      article: "fulfillment-extraction",
      headline:
        "Pulled fulfillment out of a PHP monolith while 100K daily users kept ordering",
      story:
        "Dailymealz runs meal subscriptions across Saudi Arabia, and every order moves through kitchen, driver and delivery in real time. I built the order service that pushes that status to mobile and web clients over Node.js and Socket.IO, then took the fulfillment component out of the PHP/Laravel monolith behind it. A full rewrite was off the table: a team of six could not freeze features for months to run two partially consistent systems. So fulfillment came out piece by piece, as a standalone service passing state changes over AWS SQS behind a REST API contract.",
      descBullets: [
        "Cut Mean Time To Resolve by 30% by instrumenting order, driver and kitchen flows with Datadog and OpenTelemetry.",
        "Served hot order state from Redis in a write-behind cache with MySQL behind it, keeping status fan-out off the transactional path.",
        "Migrated the real-time order service from JavaScript to TypeScript, so event and message payload mismatches failed at compile time instead of in front of customers.",
        "Led a team of five building a driver location check-in system in the React Native driver app: planning, reviews and pairing."
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
      product: {name: "Nformacy", url: "https://nformacy.com/"},
      article: "zero-to-launch",
      headline: "Took a two-sided marketplace from empty repo to beta launch",
      story:
        "Nformacy connects business advisors with companies that need their expertise. I built it full stack in React and Ruby on Rails, from the first MVP to the beta launch, along with the cloud infrastructure and deploy pipelines it ran on.",
      descBullets: [
        "Led full-stack features from requirements to deployment, and moved the web apps to a SaaS model.",
        "Built mentor calendar booking on Zoom, ClickUp and calendar integrations.",
        "Wrote BDD tests and owned the CI/CD pipelines."
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
      product: {name: "Shapa", url: "https://shapahealth.com/"},
      article: "",
      headline:
        "Built Shapa's mobile app and backend test-first, and mentored teams adopting XP",
      story:
        "DevSquads started as Fikr Labs, a Cairo venture studio, and became an agile consultancy that takes Extreme Programming seriously: TDD, pair programming and continuous delivery. I delivered products for its international clients. For Shapa, a US health product built around a numberless smart scale and a behavior change program, I built the mobile app and the backend behind it in React Native, Node.js and Java Spring.",
      descBullets: [
        "Built software in self-organizing Extreme Programming teams with TDD, thin vertical slices and test-covered refactoring of legacy code, across React Native, Ruby on Rails, Java Spring and React.",
        "Mentored teams adopting XP and Agile practices: pairing, code review discipline and iterative planning."
      ]
    }
  ]
};

export const contactInfo = {
  title: "Contact me",
  subtitle:
    "Hiring for a senior full-stack or platform role, or stuck on a production problem? Email me.",
  email_address: "abdelwahabahmed93@gmail.com"
};

export const openSource = {
  title: "Open Source",
  projects: [
    {
      name: "ecs-drain-scaler",
      url: "https://github.com/abdelwahab313/ecs-drain-scaler",
      desc: "Backlog-driven scaling for queue workers on ECS Fargate, with a worker protocol that keeps scale-in and deploys from killing a task mid-job.",
      role: "Author",
      outcome: "Design stage: ADRs and the scaling policy in Go, with tests.",
      tags: ["Go", "AWS", "SQS"]
    },
    {
      name: "focusflow",
      url: "https://github.com/abdelwahab313/focusflow",
      desc: "Offline-first daily planner and focus timer, with an optional local agent that proposes tasks from open tickets, merge requests and parked branches.",
      role: "Author",
      outcome: "Built for my own working day.",
      tags: ["TypeScript", "PocketBase"]
    },
    {
      name: "handoff-mcp-server",
      url: "https://github.com/abdelwahab313/handoff-mcp-server",
      desc: "MCP server that saves an AI coding agent's task state and loads it back in the next session as a short briefing.",
      role: "Author",
      outcome: "A briefing, not a transcript: one to two thousand tokens.",
      tags: ["TypeScript", "MCP"]
    },
    {
      name: "egy-finance-radar",
      url: "https://github.com/abdelwahab313/egy-finance-radar",
      desc: "Research tool for the Egyptian Exchange: positions in Postgres, fundamentals, technical signals and dated recommendations.",
      role: "Author",
      outcome: "Every number carries where it came from.",
      tags: ["Python", "PostgreSQL", "Next.js"]
    }
  ]
};

export const workChallenges = {
  title: "What I work on",
  subtitle:
    "The problems I've spent the most time on. Each card is backed by something I shipped; open one to see how I approached it.",
  footer:
    "Plus the everyday work around them: REST APIs, internal tools and the glue between systems.",
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
      article: "aurora"
    }
  ]
};
