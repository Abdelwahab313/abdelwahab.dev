// Site content. Source of truth for wording: CONTENT.md. CV is source of
// truth for facts.

export const greeting = {
  username: "Abdelwahab",
  title: "Abdelwahab Mahmoud",
  subTitle: "Senior Full-Stack Engineer · Node.js, React, AWS",
  valueProp:
    "I build and run production systems end to end, from React in the browser to AWS underneath. Most recently I built the LLM engine and the cloud platform behind PTC, the AI translation platform at OnTheGoSystems, where the job queues peaked at 100K jobs an hour.",
  resumeLink: "/resume.pdf",
  githubLink: "https://github.com/abdelwahab313",
  linkedinLink: "https://www.linkedin.com/in/abdelwahab313/"
};

export const socialMediaLinks = {
  github: "https://github.com/abdelwahab313",
  linkedin: "https://www.linkedin.com/in/abdelwahab313/",
  gmail: "abdelwahabahmed93@gmail.com"
};

// Same rows as the node CV's skills.tex (CONTENT.md section 1).
export const cvStack = {
  languages: ["TypeScript", "JavaScript", "Ruby", "Go", "SQL"],
  backend: [
    "Node.js",
    "Express",
    "Socket.IO",
    "REST",
    "OpenAPI/Swagger",
    "Apollo GraphQL",
    "Prisma"
  ],
  messaging: [
    "BullMQ",
    "SQS",
    "EventBridge",
    "Step Functions"
  ],
  frontend: ["React", "Next.js", "React Native"],
  databases: ["PostgreSQL", "MongoDB", "Redis", "TimescaleDB", "DynamoDB"],
  cloud: [
    "AWS (ECS Fargate, EKS, Lambda, SQS, S3)",
    "Kubernetes",
    "KEDA",
    "Terraform",
    "Docker",
    "GitLab CI/CD"
  ],
  testing_observability: [
    "TDD",
    "BDD",
    "E2E",
    "Jest",
    "k6",
    "JMeter",
    "Datadog",
    "OpenTelemetry",
    "Prometheus",
    "CloudWatch"
  ],
  ai_llm: [
    "Claude Code",
    "Claude Agent SDK",
    "MCP",
    "CrewAI",
    "Bedrock",
    "OpenAI",
    "Gemini",
    "Langfuse",
    "RAG",
    "evals"
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
      company: "OnTheGoSystems (WPML)",
      companylogo: "",
      date: "December 2024 – September 2026",
      duration: "1 yr 9 mo",
      location: "Remote · Hong Kong",
      tags: [
        "Node.js",
        "TypeScript",
        "ECS Fargate",
        "EKS",
        "KEDA",
        "Lambda",
        "Terraform",
        "DynamoDB",
        "Bedrock",
        "Claude Agent SDK",
        "MCP"
      ],
      article: "scaling-ecs-workers-on-queue-depth-without-killing-long-jobs",
      headline:
        "Ran AI translation queues that peaked at 100K jobs an hour without scale-in killing a job mid-run",
      story:
        "I worked on PTC, the AI translation platform at OnTheGoSystems, and owned the AWS platform under it. Load sat at about 5K jobs an hour and peaked at 100K. I led the move of the platform and its background workers from EC2 to containers on ECS Fargate. A single job could run for hours, and the default ECS scale-in stopped busy tasks. I designed and built an autoscaler on Node.js Lambdas that read queue depth and let a worker finish its jobs before it was stopped, so scale-in and deploys no longer killed jobs. Other products at the company adopted the pattern. The following year I moved the workers to EKS for more load and traffic spikes, and replaced my autoscaler with KEDA.",
      descBullets: [
        "Built the LLM engine with fallback chains across Bedrock, OpenAI and Gemini, retries with backoff on provider rate limits, evaluation, output validation and Langfuse tracing.",
        "Started and built the incident-triage platform with the team lead on the Claude Agent SDK. Investigator and critic agents worked each case, a decider filed the ticket, and it handled over 200 bugs, incidents and support requests in its first month.",
        "Built the TypeScript MCP server that gated the agents' access to production: CloudWatch logs and Prometheus metrics, GitLab code at the deployed tag, a read-only database user, and business data only through tools with limits.",
        "Led the move of the platform and its background workers from EC2 to containers on ECS Fargate, then to EKS the following year for more load and traffic spikes. Owned it afterward, on-call included, and shared the systems team's GitLab on-call.",
        "Built with the team the usage-based credit engine that charged clients per word, owning a job's credit estimate, the credit check that authorized it before work started and the capture after. Also built the ledger and clients' credit history.",
        "Built job retries with backoff and a failed-job queue for replay.",
        "Owned the GitLab CI/CD pipelines: build, e2e test, SAST via OpenGrep and deploy gates."
      ]
    },
    {
      role: "Senior Software Engineer",
      company: "Dailymealz",
      companylogo: "/img/dailymealzLogo.png",
      date: "December 2021 – December 2024",
      duration: "3 yrs",
      location: "Remote · Saudi Arabia",
      tags: [
        "Node.js",
        "TypeScript",
        "Socket.IO",
        "React Native",
        "Next.js",
        "SQS",
        "BullMQ",
        "Redis",
        "PostgreSQL",
        "AWS",
        "Datadog"
      ],
      product: {name: "Dailymealz", url: "https://dailymealz.com/"},
      article: "extracting-fulfillment-from-a-php-monolith-over-sqs",
      headline:
        "Moved fulfilment into the Node.js order service while 100K daily users kept ordering",
      story:
        "Dailymealz runs meal subscriptions across Saudi Arabia. I built the Node.js and Socket.IO order service that pushed order status to around 100K daily active users, with hot order state in Redis written behind to PostgreSQL. Fulfilment then moved into it. Order events came from the monolith over AWS SQS, same-day orders came over REST on confirmation, and the monolith stayed the system of record. A full event-driven rewrite was on the table and I rejected it, because it would have frozen feature work and left two systems inconsistent for a long time.",
      descBullets: [
        "Scoped and built the driver-location pipeline, which stored positions in TimescaleDB and marked pickup and drop-off on the order by geofence. Built the React admin dashboard where operations tracked drivers and the operating day live.",
        "Built the BullMQ fulfilment queues on Redis with idempotent consumers, so order, geofence and payment events were applied once under retries with backoff, and added payment-queue alarms and a dead-letter queue for re-applying failed jobs.",
        "Cut Mean Time To Resolve by 30% by instrumenting order, driver and kitchen flows with Datadog and OpenTelemetry.",
        "Built the payment system in the monolith and integrated Apple Pay and other wallets into the mobile apps.",
        "Migrated the real-time order service from JavaScript to TypeScript, so event and message payload mismatches failed at compile time instead of in front of customers.",
        "Led a team of 6 on the React Native driver app, owning its architecture and planning sprints with company stakeholders. Built subscription management and payment in the React Native customer app, and features on the Next.js web ordering site."
      ]
    },
    {
      role: "Team Lead",
      company: "Nformacy",
      companylogo: "/img/nformacy.png",
      date: "October 2020 – December 2021",
      duration: "1 yr 2 mo",
      location: "Remote · Jordan",
      tags: ["Next.js", "React", "BDD", "CI/CD"],
      product: {name: "Nformacy", url: "https://nformacy.com/"},
      article: "building-a-booking-marketplace-from-empty-repo-to-beta",
      headline: "Took a two-sided marketplace from empty repo to beta launch",
      story:
        "Nformacy connects business advisors with companies that need their expertise. I built it from the first MVP to the beta launch, React on the front end, along with the cloud infrastructure and deploy pipelines it ran on.",
      descBullets: [
        "Led a team of 5 and owned the roadmap as the company's web apps moved to a multi-tenant SaaS with a Next.js front end.",
        "Built the platform's third-party integrations with Zoom, ClickUp and calendars, driven by webhooks.",
        "Built the BDD test suite and the CI/CD pipelines, and mentored the team in TDD and spec-driven design."
      ]
    },
    {
      role: "Software Engineer",
      company: "DevSquads",
      companylogo: "/img/devsquads.webp",
      date: "December 2017 – October 2020",
      duration: "2 yrs 10 mo",
      location: "Remote · United States",
      tags: ["React", "React Native", "TDD"],
      product: {name: "Shapa", url: "https://home.myshapa.com/"},
      article: "",
      headline:
        "Built Shapa's scale link, recommender and dashboards test-first, and mentored teams adopting XP",
      story:
        "DevSquads was an outsourcing company that practised Extreme Programming: TDD, pair programming and continuous delivery. I worked with its external clients to maintain and support their products. For Shapa, a US health product built around a numberless smart scale and a behaviour change program, I built the health-task recommender, the Bluetooth Low Energy link to the scale in the React Native app, and analytics dashboards for health specialists.",
      descBullets: [
        "Built the Bluetooth Low Energy connection to the scale in Shapa's React Native app, its screens for health tips and missions, and its integrations with Apple Health, Google Fit, Fitbit and Garmin.",
        "Built client products in React Native and React in XP teams, with TDD, pairing and thin vertical slices.",
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
      article: "scaling-ecs-workers-on-queue-depth-without-killing-long-jobs"
    },
    {
      id: "event-driven-services",
      title: "Event-driven order flows",
      summary:
        "Order fulfilment moved out of a monolith over queues, with consumers that apply each event once.",
      covers: [
        "Node.js order service for a meal subscription platform",
        "Fulfilment moved into it on SQS order events, with the monolith as system of record",
        "BullMQ consumers made idempotent, with retries, backoff and a dead-letter queue"
      ],
      article: "extracting-fulfillment-from-a-php-monolith-over-sqs"
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
      article: "handling-llm-rate-limits-as-reschedules-not-errors"
    },
    {
      id: "zero-to-launch",
      title: "Product from zero to launch",
      summary:
        "From the first MVP to a launched product, with the cloud and deploy pipelines behind it.",
      covers: [
        "Took a marketplace from first MVP to beta launch",
        "Cloud infrastructure and deploy pipelines",
        "Full-stack delivery with React on the front end"
      ],
      article: "building-a-booking-marketplace-from-empty-repo-to-beta"
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
      article: "live-order-status-over-socket-io-and-redis"
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
      article: "fixing-aurora-mysql-100-percent-cpu-by-removing-a-join"
    }
  ]
};
