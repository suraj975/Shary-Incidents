export type EnvName = "uat" | "prod";

export type SiteConfig = {
  site1Url: string;
  site2Url: string;
};

const PLACEHOLDER_UAT_SITE1 = "https://SITE1_UAT_URL";
const PLACEHOLDER_UAT_SITE2 = "https://SITE2_UAT_URL";
const PLACEHOLDER_PROD_SITE1 = "https://SITE1_PROD_URL";
const PLACEHOLDER_PROD_SITE2 = "https://SITE2_PROD_URL";

export function getConfig(envName: EnvName): SiteConfig {
  if (envName === "prod") {
    return {
      site1Url: process.env.SITE1_URL || PLACEHOLDER_PROD_SITE1,
      site2Url: process.env.SITE2_URL || PLACEHOLDER_PROD_SITE2
    };
  }

  return {
    site1Url: process.env.SITE1_URL || PLACEHOLDER_UAT_SITE1,
    site2Url: process.env.SITE2_URL || PLACEHOLDER_UAT_SITE2
  };
}
