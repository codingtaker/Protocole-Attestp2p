// Configuration Babel pour Expo. Modifiable librement.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
  };
};
