export default [
  {
    ignores: ["node_modules/**", "assets/**"]
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        fetch: "readonly",
        navigator: "readonly",
        Audio: "readonly",
        alert: "readonly",
        confirm: "readonly",
        location: "readonly",
        history: "readonly",
        process: "readonly",
        module: "readonly",
        require: "readonly",
        __dirname: "readonly"
      }
    },
    rules: {
      "no-undef": "warn",
      "no-unused-vars": "warn",
      "no-unreachable": "error",
      "no-constant-condition": "warn",
      "no-duplicate-case": "error"
    }
  }
];
