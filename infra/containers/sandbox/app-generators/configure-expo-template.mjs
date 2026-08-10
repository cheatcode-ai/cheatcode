import { readFile, writeFile } from "node:fs/promises";

const appConfigPath = process.argv[2];
if (!appConfigPath) {
  throw new TypeError("Expo template configuration requires an app.json path");
}

const appConfig = JSON.parse(await readFile(appConfigPath, "utf8"));
const expoConfig = appConfig.expo;
if (!expoConfig || typeof expoConfig !== "object" || Array.isArray(expoConfig)) {
  throw new TypeError("Pinned Expo template does not contain an expo configuration");
}
if (!Array.isArray(expoConfig.plugins)) {
  throw new TypeError("Pinned Expo template does not contain a plugins array");
}

let hasSplashScreenPlugin = false;
expoConfig.plugins = expoConfig.plugins.map((entry) => {
  if (entry === "expo-splash-screen") {
    hasSplashScreenPlugin = true;
    return "expo-splash-screen/app.plugin.js";
  }
  if (Array.isArray(entry) && entry[0] === "expo-splash-screen") {
    hasSplashScreenPlugin = true;
    return ["expo-splash-screen/app.plugin.js", ...entry.slice(1)];
  }
  return entry;
});
if (!hasSplashScreenPlugin) {
  throw new TypeError("Pinned Expo template no longer declares expo-splash-screen");
}

expoConfig.name = "cheatcode-expo-template";
expoConfig.slug = "cheatcode-expo-template";
expoConfig.web = {
  ...(expoConfig.web ?? {}),
  bundler: "metro",
  output: "single",
};

await writeFile(appConfigPath, `${JSON.stringify(appConfig, null, 2)}\n`);
