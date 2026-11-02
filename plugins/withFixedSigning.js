// Signs every release APK with the same key (credentials/kanakku.keystore),
// so a new build always installs over the old one without "package conflicts".
const { withAppBuildGradle } = require('expo/config-plugins');

const RELEASE_CONFIG = `
        release {
            storeFile file('../../credentials/kanakku.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }`;

module.exports = function withFixedSigning(config) {
  return withAppBuildGradle(config, cfg => {
    let g = cfg.modResults.contents;
    if (!g.includes("credentials/kanakku.keystore")) {
      g = g.replace(/signingConfigs\s*\{/, m => m + RELEASE_CONFIG);
      g = g.replace(/(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/, '$1signingConfig signingConfigs.release');
      if (!g.includes('signingConfig signingConfigs.release')) {
        throw new Error('withFixedSigning: could not set the release signing config');
      }
    }
    cfg.modResults.contents = g;
    return cfg;
  });
};
