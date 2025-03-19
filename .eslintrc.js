// .eslintrc.js
module.exports = {
    env: {
      node: true,
      es6: true,
    },
    plugins: ["security"],
    extends: [
      "eslint:recommended",
      "plugin:security/recommended"
    ],
    rules: {
      // Add any project-specific rules here
    },
  };
  