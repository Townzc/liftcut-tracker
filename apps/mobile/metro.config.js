// apps/mobile is its own npm project (React Native pins a different React than the
// web app), so it is not an npm workspace. Watch the shared core sources, and
// resolve core's only dependency, zod, from this app so the bundle has one copy
// even when the repository root has its own node_modules.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const appOrigin = path.join(__dirname, "package.json");
config.watchFolders = [path.resolve(__dirname, "../../packages/core")];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
config.resolver.resolveRequest = (context, moduleName, platform) =>
  context.resolveRequest(moduleName === "zod" || moduleName.startsWith("zod/") ? { ...context, originModulePath: appOrigin } : context, moduleName, platform);

module.exports = config;
