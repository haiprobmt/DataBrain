/**
 * Controlled vocabulary shared by requirement extraction, scenario attributes and Finder scoring.
 * A token is matched only when one of its patterns literally appears in the text — nothing is inferred.
 */
export interface VocabEntry {
  token: string;
  label: string;
  patterns: RegExp[];
}

const e = (token: string, label: string, ...patterns: RegExp[]): VocabEntry => ({ token, label, patterns });

export const VOCAB = {
  platforms: [
    e("fabric", "Microsoft Fabric", /\bfabric\b/i, /\bonelake\b/i),
    e("databricks", "Databricks", /\bdatabricks\b/i),
    e("snowflake", "Snowflake", /\bsnowflake\b/i),
    e("synapse", "Azure Synapse Analytics", /\bsynapse\b/i),
    e("bigquery", "BigQuery", /\bbig ?query\b/i),
    e("redshift", "Amazon Redshift", /\bredshift\b/i),
    e("aws-lakehouse", "AWS lakehouse (S3, Glue, Athena)", /\bathena\b/i, /\bglue\b/i, /\blake formation\b/i),
    e("azure-ai", "Azure AI (Azure OpenAI, AI Search)", /\bazure openai\b/i, /\bai search\b/i, /\bcognitive search\b/i),
  ],
  clouds: [
    e("azure", "Azure", /\bazure\b/i, /\bmicrosoft cloud\b/i),
    e("aws", "AWS", /\baws\b/i, /\bamazon web services\b/i),
    e("gcp", "Google Cloud", /\bgcp\b/i, /\bgoogle cloud\b/i),
    e("on-premises", "On-premises", /\bon[- ]?prem(ises?)?\b/i, /\bdata ?cent(er|re)\b/i),
  ],
  sourceSystems: [
    e("sql-server", "SQL Server", /\bsql server\b/i, /\bmssql\b/i, /\bssis\b/i),
    e("oracle", "Oracle", /\boracle\b/i),
    e("sap", "SAP", /\bsap\b/i),
    e("teradata", "Teradata", /\bteradata\b/i),
    e("netezza", "Netezza", /\bnetezza\b/i),
    e("db2", "Db2", /\bdb2\b/i),
    e("postgresql", "PostgreSQL", /\bpostgres(ql)?\b/i),
    e("mysql", "MySQL", /\bmysql\b/i),
    e("mongodb", "MongoDB", /\bmongo ?db\b/i),
    e("salesforce", "Salesforce", /\bsalesforce\b/i),
    e("dynamics", "Dynamics 365", /\bdynamics\b/i),
    e("kafka", "Kafka / event streams", /\bkafka\b/i, /\bevent hubs?\b/i, /\bkinesis\b/i, /\bpub\/?sub\b/i),
    e("iot", "IoT / telemetry", /\biot\b/i, /\btelemetry\b/i, /\bsensors?\b/i),
    e("files", "Files (CSV, Excel, Parquet)", /\bcsv\b/i, /\bexcel\b/i, /\bflat files?\b/i, /\bparquet\b/i, /\bsftp\b/i),
    e("api", "REST / SaaS APIs", /\brest apis?\b/i, /\bsaas apis?\b/i, /\bapis\b/i),
    e("documents", "Documents (PDF, SharePoint)", /\bsharepoint\b/i, /\bpdfs?\b/i, /\bdocuments?\b/i),
  ],
  workloads: [
    e("bi", "Enterprise BI and reporting", /\bbi\b/i, /\breport(s|ing)?\b/i, /\bdashboards?\b/i, /\bpower bi\b/i, /\btableau\b/i, /\blooker\b/i),
    e("self-service", "Self-service analytics", /\bself[- ]service\b/i, /\bad[- ]hoc\b/i),
    e("data-warehouse", "Data warehousing", /\bdata ?warehous(e|ing)\b/i, /\bdwh?\b/i, /\bedw\b/i),
    e("data-engineering", "Data engineering (ETL / ELT)", /\betl\b/i, /\belt\b/i, /\bpipelines?\b/i, /\bdata engineering\b/i, /\blakehouse\b/i, /\bdata lake\b/i),
    e("data-science", "Data science and ML", /\bmachine learning\b/i, /\bml\b/i, /\bdata science\b/i, /\bforecast(s|ing)?\b/i, /\bpredictive\b/i),
    e("streaming-analytics", "Streaming analytics", /\bstreaming\b/i, /\bevent[- ]driven\b/i, /\breal[- ]time analytics\b/i),
    e("genai", "Generative AI / RAG", /\bgen(erative)? ?ai\b/i, /\brag\b/i, /\bllms?\b/i, /\bchatbot\b/i, /\bcopilot\b/i, /\bassistant\b/i),
    e("data-sharing", "Data sharing", /\bdata sharing\b/i, /\bdata products?\b/i, /\bdata mesh\b/i),
  ],
  latency: [
    e("batch", "Batch", /\bbatch\b/i, /\bdaily\b/i, /\bnightly\b/i, /\bovernight\b/i, /\bweekly\b/i),
    e("near-real-time", "Near real-time", /\bnear[- ]real[- ]?time\b/i, /\bhourly\b/i, /\bmicro[- ]?batch\b/i, /\bevery \d+ minutes?\b/i),
    e("real-time", "Real-time / streaming", /(?<!near[- ])\breal[- ]?time\b/i, /\bstreaming\b/i, /\bsub[- ]second\b/i, /\blow[- ]latency\b/i),
  ],
  compliance: [
    e("gdpr", "GDPR", /\bgdpr\b/i),
    e("hipaa", "HIPAA", /\bhipaa\b/i),
    e("pci", "PCI DSS", /\bpci\b/i),
    e("soc2", "SOC 2", /\bsoc ?2\b/i),
    e("iso27001", "ISO 27001", /\biso ?27001\b/i),
    e("data-residency", "Data residency", /\bresidency\b/i, /\bdata (must )?(stay|remain)s?\b/i, /\bsovereign(ty)?\b/i),
    e("masking", "Sensitive data masking", /\bmasking\b/i, /\bpii\b/i, /\bsensitive data\b/i),
    e("cmk", "Customer-managed keys", /\bcustomer[- ]managed keys?\b/i, /\bcmk\b/i, /\bbyok\b/i),
  ],
  identity: [
    e("sso", "Single sign-on", /\bsso\b/i, /\bsingle sign[- ]on\b/i, /\bentra\b/i, /\bazure ad\b/i, /\bactive directory\b/i, /\bokta\b/i, /\biam identity center\b/i),
    e("rls", "Row-level security", /\brow[- ]level security\b/i, /\brls\b/i),
    e("rbac", "Role-based access control", /\brbac\b/i, /\brole[- ]based\b/i),
  ],
  network: [
    e("private-networking", "Private networking", /\bprivate (endpoints?|links?|network(ing)?)\b/i, /\bv(net|pc)\b/i, /\bno public (access|endpoints?|internet)\b/i),
    e("hybrid-connectivity", "Hybrid connectivity", /\bexpress ?route\b/i, /\bdirect connect\b/i, /\bvpn\b/i, /\bhybrid\b/i, /\bgateway\b/i),
  ],
  availability: [
    e("dr", "Disaster recovery", /\bdisaster recovery\b/i, /\bdr\b/i, /\brpo\b/i, /\brto\b/i, /\bmulti[- ]region\b/i),
    e("ha", "High availability", /\bhigh availability\b/i, /\b99\.\d+ ?%/i, /\bsla\b/i),
  ],
  skills: [
    e("sql", "SQL", /\bsql\b/i, /\bt-?sql\b/i),
    e("python", "Python", /\bpython\b/i, /\bpyspark\b/i),
    e("spark", "Spark", /\bspark\b/i, /\bpyspark\b/i),
    e("dbt", "dbt", /\bdbt\b/i),
    e("power-bi", "Power BI", /\bpower bi\b/i, /\bdax\b/i),
    e("terraform", "Terraform", /\bterraform\b/i),
    e("kafka", "Kafka", /\bkafka\b/i),
    e("data-factory", "Data Factory", /\bdata factory\b/i, /\badf\b/i),
  ],
  cicd: [
    e("github-actions", "GitHub Actions", /\bgithub\b/i),
    e("azure-devops", "Azure DevOps", /\bazure devops\b/i, /\bado\b/i),
    e("gitlab", "GitLab CI", /\bgitlab\b/i),
    e("terraform", "Terraform", /\bterraform\b/i),
    e("bicep", "Bicep", /\bbicep\b/i),
  ],
  budget: [
    e("cost-sensitive", "Cost-sensitive", /\bcost[- ]sensitiv/i, /\b(limited|tight|small|constrained) budget\b/i, /\blow[- ]cost\b/i, /\bminimi[sz]e cost/i),
    e("cost-flexible", "Budget available", /\bbudget (is )?(approved|available|flexible)\b/i, /\bwell[- ]funded\b/i),
  ],
  industry: [
    e("financial-services", "Financial services", /\bbank(s|ing)?\b/i, /\binsurance\b/i, /\bfinancial services\b/i, /\bfintech\b/i),
    e("retail", "Retail", /\bretail(er)?\b/i, /\be-?commerce\b/i),
    e("healthcare", "Healthcare", /\bhealth ?care\b/i, /\bhospitals?\b/i, /\bpharma/i),
    e("manufacturing", "Manufacturing", /\bmanufactur/i, /\bfactory\b/i),
    e("public-sector", "Public sector", /\bgovernment\b/i, /\bpublic sector\b/i),
    e("telecom", "Telecommunications", /\btelecom/i),
    e("energy", "Energy and utilities", /\benergy\b/i, /\butilit(y|ies)\b/i),
    e("logistics", "Logistics", /\blogistics\b/i, /\bsupply chain\b/i),
  ],
} satisfies Record<string, VocabEntry[]>;

export type VocabGroup = keyof typeof VOCAB;

/** Which vocabulary groups feed each intake field. */
export const FIELD_VOCAB: Record<string, VocabGroup[]> = {
  target_platform: ["platforms", "clouds"],
  source_systems: ["sourceSystems"],
  workloads: ["workloads"],
  latency: ["latency"],
  compliance: ["compliance"],
  identity: ["identity"],
  network: ["network"],
  availability: ["availability"],
  team_skills: ["skills"],
  cicd: ["cicd"],
  budget: ["budget"],
  industry: ["industry"],
};

export function matchGroup(group: VocabGroup, text: string): VocabEntry[] {
  return VOCAB[group].filter((entry) => entry.patterns.some((p) => p.test(text)));
}

/** Tokens for a field value typed by the user or extracted from text. */
export function tokensForField(field: string, value: string): string[] {
  const groups = FIELD_VOCAB[field] ?? [];
  return [...new Set(groups.flatMap((g) => matchGroup(g, value).map((entry) => entry.token)))];
}

export function tokenLabel(token: string): string {
  for (const group of Object.values(VOCAB)) {
    const hit = group.find((entry) => entry.token === token);
    if (hit) return hit.label;
  }
  return token;
}

/** Cloud each platform runs on, used for the platform hard filter. */
export const PLATFORM_CLOUDS: Record<string, string[]> = {
  fabric: ["azure"],
  synapse: ["azure"],
  "azure-ai": ["azure"],
  databricks: ["azure", "aws", "gcp"],
  snowflake: ["azure", "aws", "gcp"],
  bigquery: ["gcp"],
  redshift: ["aws"],
  "aws-lakehouse": ["aws"],
};
