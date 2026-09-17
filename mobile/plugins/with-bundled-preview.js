const { withAppBuildGradle } = require('expo/config-plugins');

// Include JS in debug APKs so a preview still opens after the USB cable is unplugged.
module.exports = function withBundledPreview(config) {
  return withAppBuildGradle(config, config => {
    if (!config.modResults.contents.includes('debuggableVariants = []')) {
      config.modResults.contents = config.modResults.contents.replace('react {', 'react {\n    // Relay previews include a local bundle for testing away from Metro.\n    debuggableVariants = []');
    }
    return config;
  });
};
