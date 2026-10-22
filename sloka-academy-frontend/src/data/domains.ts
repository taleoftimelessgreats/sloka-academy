import type { StreamId } from "./streams";

/**
 * Frontend domain catalogue: the single source for the Domains page, search,
 * stream filters and every domain detail page.
 *
 * Content rules (from the website brief):
 * - Publish only approved curricula, fees, schedules and credentials. Optional
 *   fields (`modules`, `projects`, `fees`, `batches`, `brochure`) stay empty
 *   until Sloka Academy approves them; the domain page then shows an enquiry
 *   prompt instead.
 * - `focusAreas` are short topic summaries for discovery. Replace them with
 *   approved session-wise curriculum modules when available.
 * - `roles` are illustrative career directions, not placement outcomes.
 * - Each visible domain needs at least one stream tag. Run
 *   `npm run validate:data` after edits.
 */

export const CATEGORIES = [
  "Software Development",
  "Testing and Foundations",
  "Enterprise Applications",
  "Design and Digital",
  "AI and Data",
  "Cloud and DevOps",
  "Security and Emerging Computing",
  "Embedded and Smart Systems",
  "Engineering and Advanced Science",
  "Bio and Life Sciences",
  "Healthcare and Clinical",
  "Business Finance and Management",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type Availability = "open" | "enquire";

export interface CurriculumModule {
  title: string;
  sessions: string[];
}

export interface DomainFees {
  total: string;
  preRegistration: string;
  balance: string;
  dueRule: string;
}

export interface Domain {
  id: string;
  name: string;
  category: Category;
  streams: StreamId[];
  aliases: string[];
  visible: boolean;
  availability: Availability;
  summary: string;
  audience: string;
  focusAreas: string[];
  roles: string[];
  // Approved operational content — leave undefined until confirmed.
  modules?: CurriculumModule[];
  projects?: string[];
  prerequisites?: string;
  deliveryMode?: string;
  fees?: DomainFees;
  batches?: string[];
  /** Path under /public, e.g. "/brochures/vlsi.pdf". */
  brochure?: string;
}

type DomainInput = Omit<Domain, "visible" | "availability"> &
  Partial<Pick<Domain, "visible" | "availability">>;

const d = (input: DomainInput): Domain => ({
  visible: true,
  availability: "enquire",
  ...input,
});

export const DOMAINS: Domain[] = [
  // Software Development
  d({
    id: "dotnet",
    name: ".NET",
    category: "Software Development",
    streams: ["computer-science"],
    aliases: ["dotnet", "dot net", "c#", "csharp", "asp.net"],
    summary:
      "Build applications on the Microsoft .NET platform, from C# fundamentals to web APIs and data access.",
    audience: "Computer science and IT learners interested in Microsoft application development.",
    focusAreas: ["C# language fundamentals", "Object-oriented design", "ASP.NET Core web applications", "Web APIs", "Data access with Entity Framework", "Deployment basics"],
    roles: [".NET Developer", "Backend Developer", "Application Developer"],
  }),
  d({
    id: "java-programming",
    name: "Java Programming",
    category: "Software Development",
    streams: ["computer-science"],
    aliases: ["java", "JAVA", "core java", "java programming"],
    summary:
      "Learn core Java and object-oriented programming through structured exercises and small applications.",
    audience: "Learners starting or strengthening their programming foundation.",
    focusAreas: ["Java syntax and control flow", "Object-oriented programming", "Collections framework", "Exception handling", "File I/O and streams", "Introduction to JDBC"],
    roles: ["Java Developer", "Software Engineer (Trainee)", "Application Support Engineer"],
  }),
  d({
    id: "java-full-stack",
    name: "Java Full Stack",
    category: "Software Development",
    streams: ["computer-science"],
    aliases: ["java fullstack", "java full stack development", "spring boot"],
    summary:
      "Combine Java backend development with modern frontend tools to build complete web applications.",
    audience: "Learners who want to build end-to-end web applications with Java.",
    focusAreas: ["Core Java", "Spring Boot and REST APIs", "SQL databases", "HTML, CSS and JavaScript", "Frontend framework fundamentals", "Version control with Git"],
    roles: ["Java Full Stack Developer", "Backend Developer", "Web Developer"],
  }),
  d({
    id: "python-programming",
    name: "Python Programming",
    category: "Software Development",
    streams: ["computer-science"],
    aliases: ["python", "PYTHON", "core python"],
    summary:
      "Learn Python from fundamentals to practical scripting, problem solving and working with data.",
    audience: "Beginners and learners from any stream moving into programming.",
    focusAreas: ["Python syntax and data types", "Functions and modules", "Object-oriented Python", "File handling", "Working with libraries", "Problem-solving practice"],
    roles: ["Python Developer", "Automation Engineer", "Junior Data Analyst"],
  }),
  d({
    id: "python-full-stack-development",
    name: "Python Full Stack Development",
    category: "Software Development",
    streams: ["computer-science"],
    aliases: ["python full stack", "python fullstack", "django", "flask"],
    summary:
      "Build full web applications with a Python backend, relational databases and a modern frontend.",
    audience: "Learners who want to build complete web products using Python.",
    focusAreas: ["Core Python", "Django or Flask web frameworks", "REST APIs", "SQL databases", "HTML, CSS and JavaScript", "Deployment basics"],
    roles: ["Python Full Stack Developer", "Backend Developer", "Web Developer"],
  }),
  d({
    id: "full-stack",
    name: "Full Stack",
    category: "Software Development",
    streams: ["computer-science"],
    aliases: ["full stack development", "fullstack", "mern", "web development"],
    summary:
      "Learn frontend and backend web development together and assemble working applications.",
    audience: "Learners interested in building and shipping web applications.",
    focusAreas: ["HTML, CSS and responsive layouts", "JavaScript fundamentals", "Frontend framework (React)", "Node.js and Express APIs", "Databases", "Git and deployment"],
    roles: ["Full Stack Developer", "Frontend Developer", "Web Developer"],
  }),

  // Testing and Foundations
  d({
    id: "data-structures",
    name: "Data Structures",
    category: "Testing and Foundations",
    streams: ["computer-science"],
    aliases: ["dsa", "data structures and algorithms", "algorithms"],
    summary:
      "Strengthen problem-solving with core data structures, algorithms and complexity analysis.",
    audience: "Computer science learners preparing for technical problem solving.",
    focusAreas: ["Arrays and strings", "Linked lists, stacks and queues", "Trees and graphs", "Sorting and searching", "Recursion and dynamic programming", "Time and space complexity"],
    roles: ["Software Engineer (Trainee)", "Programmer", "Competitive Programmer"],
  }),
  d({
    id: "selenium-testing-with-java",
    name: "Selenium Testing with Java",
    category: "Testing and Foundations",
    streams: ["computer-science"],
    aliases: ["selenium", "SELENIUM", "selenium java", "automation testing", "software testing", "qa"],
    summary:
      "Automate web application testing with Selenium WebDriver and Java, from test design to frameworks.",
    audience: "Learners interested in software quality and test automation.",
    focusAreas: ["Software testing fundamentals", "Core Java for testers", "Selenium WebDriver", "TestNG", "Page Object Model frameworks", "Test reporting"],
    roles: ["QA Automation Engineer", "Software Test Engineer", "SDET (Trainee)"],
  }),

  // Enterprise Applications
  d({
    id: "servicenow",
    name: "ServiceNow",
    category: "Enterprise Applications",
    streams: ["computer-science"],
    aliases: ["service now", "SERVICENOW", "SERVICE NOW", "itsm"],
    summary:
      "Understand the ServiceNow platform, IT service management processes and platform administration.",
    audience: "Learners interested in enterprise IT workflows and platform roles.",
    focusAreas: ["ServiceNow platform overview", "ITSM processes", "Platform administration", "Forms, lists and workflows", "Scripting basics", "Reporting and dashboards"],
    roles: ["ServiceNow Administrator", "ServiceNow Developer", "ITSM Analyst"],
  }),
  d({
    id: "salesforce",
    name: "Salesforce",
    category: "Enterprise Applications",
    streams: ["computer-science", "management", "commerce"],
    aliases: ["sfdc", "crm", "salesforce admin"],
    summary:
      "Learn Salesforce CRM administration and configuration for sales, service and business processes.",
    audience: "Technology and business learners interested in CRM platforms.",
    focusAreas: ["CRM concepts", "Salesforce administration", "Data model and security", "Process automation with Flow", "Reports and dashboards", "Introduction to Apex"],
    roles: ["Salesforce Administrator", "Salesforce Developer", "CRM Analyst"],
  }),
  d({
    id: "sap",
    name: "SAP",
    category: "Enterprise Applications",
    streams: ["computer-science", "management", "commerce"],
    aliases: ["erp", "sap erp", "sap fico", "sap mm", "s/4hana"],
    summary:
      "Understand enterprise resource planning with SAP and how business processes map to SAP modules.",
    audience: "Commerce, management and IT learners interested in ERP systems.",
    focusAreas: ["ERP fundamentals", "SAP navigation", "Business process overview", "Key functional modules", "Master data", "Reporting basics"],
    roles: ["SAP Functional Consultant (Trainee)", "SAP End User Analyst", "ERP Support Analyst"],
  }),

  // Design and Digital
  d({
    id: "ui-ux-design",
    name: "UI/UX Design",
    category: "Design and Digital",
    streams: ["computer-science"],
    aliases: ["ui ux", "uiux", "ux design", "ui design", "figma", "product design"],
    summary:
      "Design usable digital products through research, wireframing, visual design and prototyping.",
    audience: "Creative and technical learners interested in product design.",
    focusAreas: ["Design thinking", "User research", "Information architecture", "Wireframing", "Visual design and design systems", "Prototyping in Figma"],
    roles: ["UI/UX Designer", "Product Designer", "UX Researcher (Junior)"],
  }),
  d({
    id: "digital-marketing",
    name: "Digital Marketing",
    category: "Design and Digital",
    streams: ["management", "commerce"],
    aliases: ["seo", "sem", "social media marketing", "performance marketing"],
    summary:
      "Plan and run digital campaigns across search, social, content and email, and measure results.",
    audience: "Management, commerce and creative learners interested in marketing.",
    focusAreas: ["Digital marketing strategy", "Search engine optimisation", "Paid search and social ads", "Content and social media", "Email marketing", "Analytics and reporting"],
    roles: ["Digital Marketing Executive", "SEO Analyst", "Social Media Executive"],
  }),

  // AI and Data
  d({
    id: "ai-ml",
    name: "AI/ML",
    category: "AI and Data",
    streams: ["computer-science"],
    aliases: ["ai ml", "aiml", "artificial intelligence", "machine learning", "ml", "ai"],
    summary:
      "Learn how machine learning models are built, trained and evaluated using Python.",
    audience: "Learners with basic programming who want to work with AI and ML.",
    focusAreas: ["Python for ML", "Data preparation", "Supervised learning", "Unsupervised learning", "Model evaluation", "Introduction to deep learning"],
    roles: ["Machine Learning Engineer (Trainee)", "AI Engineer (Junior)", "Data Scientist (Junior)"],
  }),
  d({
    id: "agentic-ai",
    name: "Agentic AI",
    category: "AI and Data",
    streams: ["computer-science"],
    aliases: ["ai agents", "agents", "autonomous agents", "llm agents"],
    summary:
      "Explore AI agents that plan, use tools and complete multi-step tasks with large language models.",
    audience: "Learners with programming basics interested in applied AI systems.",
    focusAreas: ["LLM fundamentals", "Prompt design", "Tool use and function calling", "Agent workflows", "Retrieval and memory", "Evaluation and safety"],
    roles: ["AI Engineer (Junior)", "AI Application Developer", "Automation Engineer"],
  }),
  d({
    id: "data-analytics",
    name: "Data Analytics",
    category: "AI and Data",
    streams: ["computer-science", "management", "commerce"],
    aliases: ["analytics", "data analysis", "power bi", "excel", "sql"],
    summary:
      "Turn raw data into insight using spreadsheets, SQL, Python and dashboards.",
    audience: "Learners from technology, management and commerce backgrounds.",
    focusAreas: ["Excel for analysis", "SQL querying", "Python for data analysis", "Data cleaning", "Visualisation and dashboards", "Communicating insights"],
    roles: ["Data Analyst", "Business Analyst (Junior)", "MIS Analyst"],
  }),
  d({
    id: "data-engineering",
    name: "Data Engineering",
    category: "AI and Data",
    streams: ["computer-science"],
    aliases: ["etl", "big data", "data pipelines", "spark"],
    summary:
      "Design and build data pipelines that collect, transform and store data for analytics.",
    audience: "Computer science learners interested in data infrastructure.",
    focusAreas: ["SQL and data modelling", "Python for data engineering", "ETL and ELT pipelines", "Data warehousing", "Distributed processing with Spark", "Cloud data services"],
    roles: ["Data Engineer (Junior)", "ETL Developer", "Big Data Engineer (Trainee)"],
  }),
  d({
    id: "data-science",
    name: "Data Science",
    category: "AI and Data",
    streams: ["computer-science"],
    aliases: ["ds", "data scientist", "statistics"],
    summary:
      "Combine statistics, programming and machine learning to answer questions with data.",
    audience: "Learners with an interest in statistics, programming and research.",
    focusAreas: ["Statistics and probability", "Python for data science", "Exploratory data analysis", "Machine learning models", "Model evaluation", "Data storytelling"],
    roles: ["Data Scientist (Junior)", "Data Analyst", "ML Engineer (Trainee)"],
  }),
  d({
    id: "business-analytics",
    name: "Business Analytics",
    category: "AI and Data",
    streams: ["computer-science", "management", "commerce"],
    aliases: ["ba", "business analysis", "business intelligence", "bi"],
    summary:
      "Use data to support business decisions through analysis, reporting and dashboards.",
    audience: "Management, commerce and technology learners.",
    focusAreas: ["Business problem framing", "Excel and SQL", "Descriptive statistics", "Dashboards with BI tools", "KPIs and reporting", "Presenting recommendations"],
    roles: ["Business Analyst", "BI Analyst", "Reporting Analyst"],
  }),

  // Cloud and DevOps
  d({
    id: "aws",
    name: "AWS",
    category: "Cloud and DevOps",
    streams: ["computer-science"],
    aliases: ["amazon web services", "cloud", "cloud computing"],
    summary:
      "Learn core Amazon Web Services for compute, storage, networking and security in the cloud.",
    audience: "Learners interested in cloud infrastructure and operations.",
    focusAreas: ["Cloud computing concepts", "EC2 and compute", "S3 and storage", "VPC networking", "IAM and security", "Monitoring and cost basics"],
    roles: ["Cloud Engineer (Junior)", "AWS Support Associate", "Cloud Operations Engineer"],
  }),
  d({
    id: "devops",
    name: "DevOps",
    category: "Cloud and DevOps",
    streams: ["computer-science"],
    aliases: ["ci cd", "cicd", "docker", "kubernetes", "jenkins"],
    summary:
      "Automate building, testing and deploying software with modern DevOps tools and practices.",
    audience: "Learners interested in software delivery and infrastructure automation.",
    focusAreas: ["Linux fundamentals", "Git workflows", "CI/CD pipelines", "Docker containers", "Kubernetes basics", "Infrastructure as code"],
    roles: ["DevOps Engineer (Junior)", "Build and Release Engineer", "Site Reliability Engineer (Trainee)"],
  }),

  // Security and Emerging Computing
  d({
    id: "cyber-security",
    name: "Cyber Security",
    category: "Security and Emerging Computing",
    streams: ["computer-science"],
    aliases: ["cybersecurity", "security", "ethical hacking", "infosec", "network security"],
    summary:
      "Understand how systems are attacked and defended, with hands-on security fundamentals.",
    audience: "Learners interested in protecting systems, networks and data.",
    focusAreas: ["Networking fundamentals", "Security principles", "Threats and vulnerabilities", "Ethical hacking basics", "Security tools", "Incident response"],
    roles: ["Security Analyst (Junior)", "SOC Analyst", "Vulnerability Assessment Analyst"],
  }),
  d({
    id: "blockchain",
    name: "Blockchain",
    category: "Security and Emerging Computing",
    streams: ["computer-science", "more"],
    aliases: ["web3", "smart contracts", "ethereum", "solidity"],
    summary:
      "Learn how distributed ledgers work and how smart contracts and decentralised apps are built.",
    audience: "Technology learners curious about decentralised systems.",
    focusAreas: ["Blockchain fundamentals", "Cryptography basics", "Consensus mechanisms", "Smart contracts", "Decentralised applications", "Use cases and limitations"],
    roles: ["Blockchain Developer (Junior)", "Smart Contract Developer", "Web3 Analyst"],
  }),
  d({
    id: "quantum-computing",
    name: "Quantum Computing",
    category: "Security and Emerging Computing",
    streams: ["computer-science", "electronics", "more"],
    aliases: ["quantum", "qiskit", "qubits"],
    summary:
      "Explore qubits, quantum gates and introductory quantum algorithms using simulation tools.",
    audience: "Learners with an interest in physics, mathematics and computing.",
    focusAreas: ["Linear algebra refresher", "Qubits and superposition", "Quantum gates and circuits", "Entanglement", "Introductory quantum algorithms", "Quantum programming with simulators"],
    roles: ["Quantum Computing Researcher (Trainee)", "Research Assistant", "Quantum Software Enthusiast"],
  }),
  d({
    id: "generative-ai-llm",
    name: "Generative AI & LLM",
    category: "Security and Emerging Computing",
    streams: ["computer-science"],
    aliases: ["genai", "gen ai", "generative ai", "llm", "llms", "large language models", "prompt engineering", "rag"],
    summary:
      "Understand large language models and build applications with prompting, retrieval and APIs.",
    audience: "Learners with programming basics interested in generative AI.",
    focusAreas: ["How LLMs work", "Prompt engineering", "Working with model APIs", "Embeddings and retrieval (RAG)", "Building AI applications", "Responsible AI"],
    roles: ["Generative AI Developer (Junior)", "AI Application Developer", "Prompt Engineer"],
  }),

  // Embedded and Smart Systems
  d({
    id: "embedded-systems",
    name: "Embedded Systems",
    category: "Embedded and Smart Systems",
    streams: ["electronics", "eee"],
    aliases: ["embedded", "embedded c", "microcontrollers", "arduino", "arm"],
    summary:
      "Program microcontrollers and interface hardware using Embedded C and common peripherals.",
    audience: "Electronics and electrical engineering learners.",
    focusAreas: ["Digital electronics refresher", "Embedded C", "Microcontroller architecture", "GPIO, timers and interrupts", "Communication protocols (UART, SPI, I2C)", "Sensor interfacing"],
    roles: ["Embedded Engineer (Trainee)", "Firmware Developer", "Hardware Test Engineer"],
  }),
  d({
    id: "iot",
    name: "Internet of Things (IoT)",
    category: "Embedded and Smart Systems",
    streams: ["computer-science", "mechanical", "electronics", "eee"],
    aliases: ["iot", "IOT", "internet of things", "smart devices"],
    summary:
      "Connect sensors and devices to the cloud and build simple monitoring and automation systems.",
    audience: "Engineering and computing learners interested in connected devices.",
    focusAreas: ["IoT architecture", "Sensors and actuators", "Microcontroller boards", "Connectivity and protocols (MQTT, HTTP)", "Cloud dashboards", "IoT security basics"],
    roles: ["IoT Engineer (Trainee)", "Embedded Developer", "IoT Solutions Associate"],
  }),
  d({
    id: "robotics",
    name: "Robotics",
    category: "Embedded and Smart Systems",
    streams: ["computer-science", "mechanical", "electronics", "eee", "more"],
    aliases: ["robots", "automation", "ros"],
    summary:
      "Learn how robots sense, decide and move, combining mechanics, electronics and programming.",
    audience: "Mechanical, electronics, electrical and computing learners.",
    focusAreas: ["Robotics fundamentals", "Sensors and actuators", "Motor control", "Kinematics basics", "Robot programming", "Introduction to ROS"],
    roles: ["Robotics Engineer (Trainee)", "Automation Engineer", "Controls Technician"],
  }),
  d({
    id: "vlsi",
    name: "VLSI",
    category: "Embedded and Smart Systems",
    streams: ["electronics", "eee"],
    aliases: ["vlsi design", "VLSI", "chip design", "verilog", "asic", "fpga", "semiconductor"],
    summary:
      "Connect device fundamentals, CMOS logic, Verilog HDL, synthesis, physical design, DFT, FPGA/ASIC methods and sign-off through one structured learning path.",
    audience: "Electronics and electrical engineering learners interested in chip design.",
    focusAreas: ["Device fundamentals and CMOS logic", "Verilog HDL", "Logic synthesis", "Physical design", "Design for testability (DFT)", "FPGA/ASIC methods and sign-off"],
    roles: ["VLSI Design Engineer (Trainee)", "Verification Engineer (Trainee)", "Physical Design Engineer (Trainee)"],
  }),
  d({
    id: "hybrid-electric-vehicles",
    name: "Hybrid Electric Vehicles",
    category: "Embedded and Smart Systems",
    streams: ["mechanical", "electronics", "eee"],
    aliases: ["hev", "ev", "electric vehicles", "e mobility"],
    summary:
      "Understand electric and hybrid vehicle architecture, batteries, motors and power electronics.",
    audience: "Mechanical, electrical and electronics learners interested in e-mobility.",
    focusAreas: ["EV and HEV architectures", "Battery technology and management", "Electric motors and drives", "Power electronics", "Charging systems", "Vehicle modelling basics"],
    roles: ["EV Engineer (Trainee)", "Battery Systems Associate", "Powertrain Engineer (Trainee)"],
  }),

  // Engineering and Advanced Science
  d({
    id: "autocad",
    name: "AutoCAD",
    category: "Engineering and Advanced Science",
    streams: ["civil", "mechanical", "eee"],
    aliases: ["cad", "auto cad", "drafting", "2d drafting"],
    summary:
      "Create precise 2D drawings and introductory 3D models using AutoCAD for engineering work.",
    audience: "Civil, mechanical and electrical engineering learners.",
    focusAreas: ["AutoCAD interface and setup", "2D drawing and editing", "Layers, blocks and annotation", "Dimensioning", "Layouts and plotting", "Introduction to 3D"],
    roles: ["CAD Draftsperson", "Design Engineer (Trainee)", "Drafting Technician"],
  }),
  d({
    id: "nano-science-nanotechnology",
    name: "Nano Science & Nanotechnology",
    category: "Engineering and Advanced Science",
    streams: ["life-sciences", "mechanical", "electronics", "more"],
    aliases: ["nano", "nanotech", "nanotechnology", "nano science", "nanoscience", "nanomaterials"],
    summary:
      "Explore materials and devices at the nanoscale and their applications across science and engineering.",
    audience: "Science and engineering learners interested in advanced materials.",
    focusAreas: ["Nanoscale fundamentals", "Nanomaterials", "Synthesis methods", "Characterisation techniques", "Applications in electronics and medicine", "Safety and ethics"],
    roles: ["Research Assistant", "Materials Lab Associate", "Nanotechnology Research Trainee"],
  }),

  // Bio and Life Sciences
  d({
    id: "bioinformatics",
    name: "Bioinformatics",
    category: "Bio and Life Sciences",
    streams: ["life-sciences", "more"],
    aliases: ["computational biology", "genomics", "biological databases"],
    summary:
      "Apply computing to biological data, from sequence analysis to databases and genomics tools.",
    audience: "Life sciences learners interested in computational methods.",
    focusAreas: ["Molecular biology refresher", "Biological databases", "Sequence alignment", "Phylogenetics", "Genomics tools", "Scripting for biology"],
    roles: ["Bioinformatics Analyst (Junior)", "Research Assistant", "Genomics Data Associate"],
  }),
  d({
    id: "genetic-engineering",
    name: "Genetic Engineering",
    category: "Bio and Life Sciences",
    streams: ["life-sciences", "more"],
    aliases: ["genetics", "recombinant dna", "crispr", "biotechnology"],
    summary:
      "Understand the principles and laboratory techniques used to study and modify genes.",
    audience: "Life sciences and biotechnology learners.",
    focusAreas: ["Molecular genetics", "Recombinant DNA technology", "Cloning and vectors", "PCR and gene expression", "Genome editing concepts", "Bioethics and regulation"],
    roles: ["Research Assistant", "Lab Technician", "Biotech Associate"],
  }),

  // Healthcare and Clinical
  d({
    id: "clinical-sas",
    name: "Clinical SAS",
    category: "Healthcare and Clinical",
    streams: ["pharmacy", "life-sciences"],
    aliases: ["sas", "clinical sas programming", "clinical data", "cdisc"],
    summary:
      "Learn SAS programming for clinical trial data, from data handling to standard reports.",
    audience: "Pharmacy and life sciences learners interested in clinical data roles.",
    focusAreas: ["Clinical trial basics", "Base SAS programming", "Data step and procedures", "CDISC standards overview", "Tables, listings and figures", "Data validation"],
    roles: ["Clinical SAS Programmer (Trainee)", "Clinical Data Associate", "Statistical Programmer (Junior)"],
  }),
  d({
    id: "medical-coding",
    name: "Medical Coding",
    category: "Healthcare and Clinical",
    streams: ["pharmacy", "life-sciences"],
    aliases: ["coding", "icd", "icd 10", "cpt", "medical billing"],
    summary:
      "Learn to translate clinical documentation into standard medical codes used in healthcare records.",
    audience: "Pharmacy, life sciences and allied health learners.",
    focusAreas: ["Medical terminology", "Anatomy and physiology basics", "ICD-10-CM coding", "CPT coding", "HCPCS overview", "Coding guidelines and compliance"],
    roles: ["Medical Coder (Trainee)", "Coding Quality Associate", "Healthcare Documentation Associate"],
  }),
  d({
    id: "pharmacovigilance",
    name: "Pharmacovigilance",
    category: "Healthcare and Clinical",
    streams: ["pharmacy", "life-sciences"],
    aliases: ["pv", "drug safety", "adverse events"],
    summary:
      "Understand drug safety monitoring, adverse event reporting and the regulations behind them.",
    audience: "Pharmacy and life sciences learners interested in drug safety.",
    focusAreas: ["Drug safety fundamentals", "Adverse event case processing", "MedDRA coding overview", "Signal detection basics", "Regulatory reporting", "Safety databases"],
    roles: ["Drug Safety Associate (Trainee)", "Pharmacovigilance Associate", "Case Processing Associate"],
  }),

  // Business Finance and Management
  d({
    id: "entrepreneurship",
    name: "Entrepreneurship",
    category: "Business Finance and Management",
    streams: ["management", "commerce", "more"],
    aliases: ["startup", "startups", "business plan"],
    summary:
      "Take an idea from problem discovery to a validated business model and pitch.",
    audience: "Learners from any stream interested in starting or growing ventures.",
    focusAreas: ["Opportunity identification", "Customer discovery", "Business model design", "Startup finance basics", "Marketing and sales", "Pitching"],
    roles: ["Founder", "Business Development Associate", "Startup Operations Associate"],
  }),
  d({
    id: "finance",
    name: "Finance",
    category: "Business Finance and Management",
    streams: ["management", "commerce"],
    aliases: ["financial analysis", "accounting", "financial modelling"],
    summary:
      "Build practical finance skills in accounting, financial statements, analysis and modelling.",
    audience: "Commerce and management learners.",
    focusAreas: ["Accounting fundamentals", "Financial statements", "Ratio analysis", "Excel for finance", "Financial modelling basics", "Budgeting and forecasting"],
    roles: ["Financial Analyst (Junior)", "Accounts Executive", "Finance Associate"],
  }),
  d({
    id: "hr",
    name: "HR",
    category: "Business Finance and Management",
    streams: ["management", "commerce"],
    aliases: ["human resources", "hrm", "recruitment", "talent acquisition"],
    summary:
      "Learn core human resources processes from recruitment to performance and employee relations.",
    audience: "Management and commerce learners interested in people functions.",
    focusAreas: ["HR fundamentals", "Recruitment and selection", "Onboarding", "Performance management", "Compensation basics", "HR analytics and policies"],
    roles: ["HR Executive", "Recruiter", "HR Operations Associate"],
  }),
  d({
    id: "investment-banking",
    name: "Investment Banking",
    category: "Business Finance and Management",
    streams: ["management", "commerce"],
    aliases: ["ib", "capital markets", "equity research", "valuation"],
    summary:
      "Understand capital markets, valuation and the core processes of investment banking operations.",
    audience: "Commerce and management learners interested in financial markets.",
    focusAreas: ["Financial markets overview", "Investment banking functions", "Valuation methods", "Financial modelling", "Trade life cycle", "Regulation and compliance basics"],
    roles: ["Investment Banking Operations Analyst", "Equity Research Associate (Junior)", "KYC Analyst"],
  }),
  d({
    id: "supply-chain-management",
    name: "Supply Chain Management",
    category: "Business Finance and Management",
    streams: ["management", "mechanical", "commerce"],
    aliases: ["scm", "logistics", "procurement", "operations management"],
    summary:
      "Learn how goods move from suppliers to customers through planning, procurement and logistics.",
    audience: "Management, commerce and mechanical engineering learners.",
    focusAreas: ["Supply chain fundamentals", "Procurement and sourcing", "Inventory management", "Logistics and warehousing", "Demand planning", "Supply chain analytics"],
    roles: ["Supply Chain Analyst (Junior)", "Procurement Executive", "Logistics Coordinator"],
  }),
];

export const VISIBLE_DOMAINS = DOMAINS.filter((domain) => domain.visible);

export function getDomain(id: string): Domain | undefined {
  return DOMAINS.find((domain) => domain.id === id);
}
