/** Project intake schema (solution-factory skill). Every field supports known / unknown / not-applicable. */
export interface IntakeFieldDef {
  key: string;
  label: string;
  group: "Business" | "Data & workloads" | "Security & network" | "Delivery";
  question: string;
  placeholder: string;
}

export const INTAKE_FIELDS: IntakeFieldDef[] = [
  { key: "business_objective", label: "Business objective", group: "Business", question: "What business outcome should this platform deliver?", placeholder: "e.g. Single trusted reporting layer for finance" },
  { key: "industry", label: "Industry", group: "Business", question: "Which industry or regulatory context applies?", placeholder: "e.g. Retail banking" },
  { key: "source_systems", label: "Source systems", group: "Data & workloads", question: "Which source systems must be integrated?", placeholder: "e.g. SQL Server, SAP ECC, Salesforce" },
  { key: "target_platform", label: "Target platform", group: "Data & workloads", question: "Is a target platform or cloud already chosen?", placeholder: "e.g. Microsoft Fabric on Azure" },
  { key: "data_volume", label: "Data volume / growth", group: "Data & workloads", question: "What is the current data volume and expected growth?", placeholder: "e.g. 4 TB, growing 30% per year" },
  { key: "latency", label: "Batch / streaming / latency", group: "Data & workloads", question: "What data freshness is required (batch, near real-time, streaming)?", placeholder: "e.g. Daily batch, hourly for sales" },
  { key: "users", label: "Users / concurrency", group: "Data & workloads", question: "How many users and concurrent sessions are expected?", placeholder: "e.g. 300 report users, 40 concurrent" },
  { key: "workloads", label: "BI / AI workloads", group: "Data & workloads", question: "Which analytics, BI, data science or AI workloads are in scope?", placeholder: "e.g. Enterprise BI, self-service, ML forecasting" },
  { key: "compliance", label: "Residency / compliance", group: "Security & network", question: "Which data residency or compliance obligations apply?", placeholder: "e.g. GDPR, data stays in EU" },
  { key: "identity", label: "Identity", group: "Security & network", question: "Which identity provider and access model must be used?", placeholder: "e.g. Microsoft Entra ID, row-level security" },
  { key: "network", label: "Network connectivity", group: "Security & network", question: "What network connectivity and isolation is required?", placeholder: "e.g. Private endpoints, ExpressRoute to on-premises" },
  { key: "availability", label: "Availability / DR", group: "Security & network", question: "What availability and disaster-recovery targets apply?", placeholder: "e.g. RPO 24h, RTO 8h" },
  { key: "cicd", label: "CI/CD", group: "Delivery", question: "Which CI/CD and infrastructure-as-code tooling is expected?", placeholder: "e.g. GitHub Actions, Terraform" },
  { key: "budget", label: "Budget / cost sensitivity", group: "Delivery", question: "How cost-sensitive is the project?", placeholder: "e.g. Cost-sensitive, prefers pay-per-use" },
  { key: "team_skills", label: "Team skills", group: "Delivery", question: "Which skills does the delivery and operations team have?", placeholder: "e.g. Strong SQL and Power BI, limited Spark" },
  { key: "timeline", label: "Timeline", group: "Delivery", question: "What is the delivery timeline?", placeholder: "e.g. First release in 4 months" },
  { key: "constraints", label: "Constraints", group: "Delivery", question: "Are there other constraints (licensing, existing contracts, standards)?", placeholder: "e.g. Existing Microsoft enterprise agreement" },
];

export const INTAKE_FIELD_KEYS = INTAKE_FIELDS.map((f) => f.key);
export const intakeField = (key: string) => INTAKE_FIELDS.find((f) => f.key === key);
