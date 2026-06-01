export const ENV = {
  appId: process.env.VITE_APP_ID ?? "local-kiss",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  localOwnerOpenId: process.env.APP_LOCAL_OPEN_ID ?? "local_owner",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  appPasswordHash: process.env.APP_PASSWORD_HASH ?? "",
  appPasswordMustChange: process.env.APP_PASSWORD_MUST_CHANGE !== "false",
  appPasswordStatePath: process.env.APP_PASSWORD_STATE_PATH ?? ".runtime/app-password.json",
};
